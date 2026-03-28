package com.docuvault.service.inbox

import com.aallam.openai.api.chat.ChatCompletionRequest
import com.aallam.openai.api.chat.ChatMessage
import com.aallam.openai.api.chat.ChatRole
import com.aallam.openai.api.model.ModelId
import com.docuvault.config.OpenAIProvider
import com.docuvault.domain.inbox.*
import com.docuvault.domain.space.Document
import com.docuvault.infrastructure.repository.*
import com.docuvault.service.embedding.EmbeddingService
import com.docuvault.service.git.GitService
import kotlinx.coroutines.runBlocking
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Instant
import java.util.*

@Service
class InboxService(
    private val inboxNoteRepository: InboxNoteRepository,
    private val routingRuleRepository: RoutingRuleRepository,
    private val spaceRepository: SpaceRepository,
    private val documentRepository: DocumentRepository,
    private val userRepository: UserRepository,
    private val gitService: GitService,
    private val embeddingService: EmbeddingService,
    private val openAIProvider: OpenAIProvider
) {
    private val logger = org.slf4j.LoggerFactory.getLogger(InboxService::class.java)

    fun getNotes(spaceId: UUID, status: NoteStatus): List<InboxNote> =
        inboxNoteRepository.findBySpaceIdAndStatusOrderByCreatedAtDesc(spaceId, status)

    fun getNote(noteId: UUID): InboxNote? =
        inboxNoteRepository.findById(noteId).orElse(null)

    fun getUnsortedCount(spaceId: UUID): Long =
        inboxNoteRepository.countBySpaceIdAndStatus(spaceId, NoteStatus.UNSORTED)

    @Transactional
    fun createNote(spaceId: UUID, authorEmail: String, content: String): InboxNote {
        val space = spaceRepository.findById(spaceId).orElseThrow { IllegalArgumentException("Space not found") }
        val author = userRepository.findByEmail(authorEmail) ?: throw IllegalArgumentException("User not found")

        val note = InboxNote(space = space, author = author, content = content)
        val saved = inboxNoteRepository.save(note)

        // Check routing rules — auto-file if a matching rule has autoFile=true
        val rules = routingRuleRepository.findBySpaceIdOrderByCreatedAtAsc(spaceId)
        val matchedRule = rules.firstOrNull { ruleMatches(it, content) }
        if (matchedRule != null && matchedRule.autoFile) {
            tryAutoFile(saved, matchedRule)
        }

        return inboxNoteRepository.findById(saved.id!!).orElse(saved)
    }

    @Transactional
    fun generateSuggestion(noteId: UUID): InboxNote {
        val note = inboxNoteRepository.findById(noteId).orElseThrow { IllegalArgumentException("Note not found") }
        val space = note.space
        val documents = documentRepository.findBySpaceId(space.id!!)
        val rules = routingRuleRepository.findBySpaceIdOrderByCreatedAtAsc(space.id!!)

        val openAI = openAIProvider.getClient()
        if (openAI == null) {
            note.aiSuggestion = """{"error":"AI features are not configured. Please set up your OpenAI API key in Admin Settings."}"""
            return inboxNoteRepository.save(note)
        }

        // Find best matching document to load current content for merge
        val matchedDoc = findBestMatchingDocument(documents, note.content)
        val currentDocContent = if (matchedDoc != null) gitService.readFile(space, matchedDoc.path) else null

        val docList = documents.joinToString("\n") { "- ${it.path} (${it.title ?: it.path})" }
        val rulesList = if (rules.isEmpty()) "None" else rules.joinToString("\n") { "- [${it.type}] \"${it.condition}\" → ${it.targetDocumentPath ?: it.targetGroupPath ?: "new document"}" }

        val systemPrompt = """You are a documentation assistant. Analyse the note content and determine where it belongs in the documentation space.
Respond with valid JSON only — no markdown, no explanation outside the JSON.

JSON schema:
{
  "action": "APPEND_TO_DOCUMENT" or "CREATE_DOCUMENT",
  "documentPath": "<path to existing doc, only for APPEND_TO_DOCUMENT>",
  "newDocumentPath": "<path for new doc, only for CREATE_DOCUMENT>",
  "newDocumentTitle": "<title for new doc, only for CREATE_DOCUMENT>",
  "groupPath": "<parent folder path for new doc, only for CREATE_DOCUMENT>",
  "confidence": <float 0.0–1.0>,
  "explanation": "<one sentence reasoning>",
  "mergedContent": "<full merged markdown content>",
  "originalContent": "<current document content before merge, empty string for CREATE_DOCUMENT>"
}"""

        val userPrompt = buildString {
            appendLine("Space: ${space.name}")
            if (!space.description.isNullOrBlank()) appendLine("Description: ${space.description}")
            appendLine()
            appendLine("Documents in this space:")
            appendLine(docList)
            appendLine()
            appendLine("Routing rules (hints):")
            appendLine(rulesList)
            appendLine()
            appendLine("Note content:")
            appendLine(note.content.replace(Regex("<[^>]+>"), " ").trim())
            if (currentDocContent != null && matchedDoc != null) {
                appendLine()
                appendLine("Current content of suggested target document (${matchedDoc!!.path}):")
                appendLine(currentDocContent)
            }
        }

        val suggestion = runBlocking {
            try {
                val completion = openAI.chatCompletion(
                    ChatCompletionRequest(
                        model = ModelId(openAIProvider.getChatModel()),
                        messages = listOf(
                            ChatMessage(role = ChatRole.System, content = systemPrompt),
                            ChatMessage(role = ChatRole.User, content = userPrompt)
                        )
                    )
                )
                completion.choices.firstOrNull()?.message?.content ?: """{"error":"No response from AI"}"""
            } catch (e: Exception) {
                logger.error("AI suggestion failed for note $noteId: ${e.message}", e)
                """{"error":"AI suggestion failed: ${e.message?.replace("\"", "'")}"}"""
            }
        }

        note.aiSuggestion = suggestion
        return inboxNoteRepository.save(note)
    }

    @Transactional
    fun fileNote(
        noteId: UUID,
        filedByEmail: String,
        documentPath: String,
        mergedContent: String,
        createNew: Boolean = false,
        newTitle: String? = null,
        saveAsRule: Boolean = false,
        ruleCondition: String? = null
    ): InboxNote {
        val note = inboxNoteRepository.findById(noteId).orElseThrow { IllegalArgumentException("Note not found") }
        val space = note.space
        val filedBy = userRepository.findByEmail(filedByEmail) ?: throw IllegalArgumentException("User not found")

        gitService.writeFile(space, documentPath, mergedContent)

        val now = Instant.now()
        val existing = documentRepository.findBySpaceIdAndPath(space.id!!, documentPath)
        val document = if (existing != null) {
            existing.title = newTitle ?: extractTitle(mergedContent, documentPath)
            existing.updatedAt = now
            documentRepository.save(existing)
        } else {
            val doc = Document(
                space = space,
                path = documentPath,
                title = newTitle ?: extractTitle(mergedContent, documentPath),
                lastSyncedAt = now
            )
            documentRepository.save(doc)
        }
        embeddingService.processDocument(document.id!!, mergedContent)

        note.status = NoteStatus.FILED
        note.filedToDocumentPath = documentPath
        note.filedBy = filedBy
        note.filedAt = now

        if (saveAsRule && !ruleCondition.isNullOrBlank()) {
            val rule = RoutingRule(
                space = space,
                type = RuleType.PATTERN,
                condition = ruleCondition,
                actionType = RuleAction.APPEND_TO_DOCUMENT,
                targetDocumentPath = documentPath,
                autoFile = true,
                description = "Auto-created from 'don't ask next time'"
            )
            val savedRule = routingRuleRepository.save(rule)
            note.appliedRule = savedRule
            note.autoFiled = false // user initiated, rule saved for future
        }

        return inboxNoteRepository.save(note)
    }

    @Transactional
    fun dismissNote(noteId: UUID): InboxNote {
        val note = inboxNoteRepository.findById(noteId).orElseThrow { IllegalArgumentException("Note not found") }
        note.status = NoteStatus.DISMISSED
        return inboxNoteRepository.save(note)
    }

    fun getRules(spaceId: UUID): List<RoutingRule> =
        routingRuleRepository.findBySpaceIdOrderByCreatedAtAsc(spaceId)

    @Transactional
    fun createRule(
        spaceId: UUID,
        type: RuleType,
        condition: String,
        actionType: RuleAction,
        targetDocumentPath: String?,
        targetGroupPath: String?,
        autoFile: Boolean,
        description: String?
    ): RoutingRule {
        val space = spaceRepository.findById(spaceId).orElseThrow { IllegalArgumentException("Space not found") }
        val rule = RoutingRule(
            space = space,
            type = type,
            condition = condition,
            actionType = actionType,
            targetDocumentPath = targetDocumentPath,
            targetGroupPath = targetGroupPath,
            autoFile = autoFile,
            description = description
        )
        return routingRuleRepository.save(rule)
    }

    @Transactional
    fun updateRule(ruleId: UUID, updates: RoutingRuleUpdate): RoutingRule {
        val rule = routingRuleRepository.findById(ruleId).orElseThrow { IllegalArgumentException("Rule not found") }
        updates.condition?.let { rule.condition = it }
        updates.actionType?.let { rule.actionType = it }
        updates.targetDocumentPath?.let { rule.targetDocumentPath = it }
        updates.targetGroupPath?.let { rule.targetGroupPath = it }
        updates.autoFile?.let { rule.autoFile = it }
        updates.description?.let { rule.description = it }
        return routingRuleRepository.save(rule)
    }

    @Transactional
    fun deleteRule(ruleId: UUID) = routingRuleRepository.deleteById(ruleId)

    // --- Private helpers ---

    private fun ruleMatches(rule: RoutingRule, content: String): Boolean {
        val text = content.replace(Regex("<[^>]+>"), " ").lowercase()
        return when (rule.type) {
            RuleType.CATEGORY -> text.contains(rule.condition.lowercase())
            RuleType.PATTERN -> {
                val pattern = rule.condition
                if (pattern.startsWith("#")) {
                    text.contains(pattern.lowercase())
                } else {
                    try {
                        Regex(pattern, RegexOption.IGNORE_CASE).containsMatchIn(text)
                    } catch (e: Exception) {
                        text.contains(pattern.lowercase())
                    }
                }
            }
        }
    }

    private fun tryAutoFile(note: InboxNote, rule: RoutingRule) {
        if (rule.targetDocumentPath == null) return
        val space = note.space
        try {
            val existing = gitService.readFile(space, rule.targetDocumentPath!!) ?: ""
            val stripped = note.content.replace(Regex("<[^>]+>"), "\n").trim()
            val merged = if (existing.isBlank()) stripped else "$existing\n\n---\n\n$stripped"
            gitService.writeFile(space, rule.targetDocumentPath!!, merged)

            val now = Instant.now()
            val doc = documentRepository.findBySpaceIdAndPath(space.id!!, rule.targetDocumentPath!!)
                ?: Document(space = space, path = rule.targetDocumentPath!!, lastSyncedAt = now)
            doc.updatedAt = now
            val saved = documentRepository.save(doc)
            embeddingService.processDocument(saved.id!!, merged)

            note.status = NoteStatus.FILED
            note.filedToDocumentPath = rule.targetDocumentPath
            note.autoFiled = true
            note.appliedRule = rule
            note.filedAt = now
            inboxNoteRepository.save(note)
        } catch (e: Exception) {
            logger.warn("Auto-file failed for note ${note.id} via rule ${rule.id}: ${e.message}")
        }
    }

    private fun findBestMatchingDocument(documents: List<Document>, content: String): Document? {
        if (documents.isEmpty()) return null
        val text = content.replace(Regex("<[^>]+>"), " ").lowercase()
        return documents.maxByOrNull { doc ->
            val title = (doc.title ?: doc.path).lowercase()
            val words = title.split(Regex("\\W+")).filter { it.length > 3 }
            words.count { text.contains(it) }
        }
    }

    private fun extractTitle(content: String, path: String): String {
        val h1 = Regex("^#\\s+(.+)$", RegexOption.MULTILINE).find(content)?.groupValues?.get(1)
        return h1 ?: path.substringAfterLast("/").removeSuffix(".md")
    }
}

data class RoutingRuleUpdate(
    val condition: String? = null,
    val actionType: RuleAction? = null,
    val targetDocumentPath: String? = null,
    val targetGroupPath: String? = null,
    val autoFile: Boolean? = null,
    val description: String? = null
)
