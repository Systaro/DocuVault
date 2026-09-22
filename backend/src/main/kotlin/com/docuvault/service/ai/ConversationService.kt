package com.docuvault.service.ai

import com.aallam.openai.api.chat.ChatCompletionRequest
import com.aallam.openai.api.chat.ChatMessage
import com.aallam.openai.api.chat.ChatRole
import com.aallam.openai.api.chat.ContentPart
import com.aallam.openai.api.chat.TextPart
import com.aallam.openai.api.chat.Tool
import com.aallam.openai.api.chat.ToolCall
import com.aallam.openai.api.core.Parameters
import com.aallam.openai.api.model.ModelId
import com.aallam.openai.client.OpenAI
import com.docuvault.config.OpenAIProvider
import com.docuvault.domain.ai.AssistantAttachment
import com.docuvault.domain.ai.Conversation
import com.docuvault.domain.ai.ConversationMessage
import com.docuvault.domain.ai.MessageAttachment
import com.docuvault.domain.ai.MessageProposal
import com.docuvault.domain.ai.MessageSource
import com.docuvault.domain.ai.MessageTask
import com.docuvault.domain.ai.MessageToolCall
import com.docuvault.domain.ai.ProposalStatus
import com.docuvault.domain.space.Space
import com.docuvault.domain.space.SpaceType
import com.docuvault.domain.space.SyncStatus
import com.docuvault.domain.user.User
import com.docuvault.infrastructure.repository.ConversationMessageRepository
import com.docuvault.infrastructure.repository.ConversationRepository
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.PermissionService
import com.docuvault.service.embedding.CrossSpaceChunk
import com.docuvault.service.embedding.EmbeddingService
import com.docuvault.service.git.GitService
import com.docuvault.service.tools.LoopbackStatusException
import com.docuvault.service.tools.ToolCredential
import com.docuvault.service.tools.ToolException
import com.docuvault.service.tools.ToolRegistry
import com.docuvault.service.tools.ToolScope
import com.docuvault.service.tools.ToolSession
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ObjectNode
import kotlinx.coroutines.runBlocking
import org.slf4j.LoggerFactory
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.server.ResponseStatusException
import java.time.Instant
import java.util.*
import kotlin.time.Duration.Companion.seconds

data class ConversationSummaryDto(
    val id: UUID,
    val title: String,
    val spaceId: UUID,
    val spaceName: String,
    val spaceFullPath: String,
    val documentPath: String?,
    val updatedAt: Instant
)

data class SourceDto(val spaceId: UUID, val spaceFullPath: String?, val path: String, val title: String?)

data class ProposalDto(
    val id: UUID,
    val spaceId: UUID,
    val spaceFullPath: String?,
    val path: String,
    val summary: String,
    val oldText: String,
    val newText: String,
    val contextBefore: String,
    val contextAfter: String,
    val status: ProposalStatus,
    val error: String?
)

data class MessageDto(
    val id: UUID,
    val role: String,
    val content: String,
    val sources: List<SourceDto>,
    val toolCalls: List<MessageToolCall>,
    val createdDocuments: List<SourceDto>,
    val proposals: List<ProposalDto>,
    val createdTasks: List<MessageTask>,
    val attachments: List<MessageAttachment>,
    val createdAt: Instant
)

data class ConversationDto(val conversation: ConversationSummaryDto, val messages: List<MessageDto>)

/** Starts a conversation that writes a draft from what happened in the space. */
data class DraftRequest(val template: DraftTemplate, val days: Int)

/** Receives what happens during a turn, in order; the controller turns these into server-sent events. */
fun interface TurnListener {
    fun onEvent(name: String, data: Any)
}

/** Everything a turn needs from the database, read up front so the long model call holds no transaction. */
data class PreparedTurn(
    val conversationId: UUID,
    val created: Boolean,
    val summary: ConversationSummaryDto,
    val userMessageId: UUID,
    val message: String,
    val scope: ToolScope.Conversation,
    val canWrite: Boolean,
    val systemPrompt: String,
    val history: List<ConversationMessage>,
    val retrievalSpaceIds: List<UUID>,
    val spacePaths: Map<UUID, String>,
    /** The document a document conversation is about; always a source of its answers. */
    val documentSource: MessageSource? = null,
    /** The turn writes a draft: the text goes into the answer for the user to edit and save, never straight into Git. */
    val drafting: Boolean = false,
    /** Files sent with this message. */
    val attachments: List<AssistantAttachment> = emptyList(),
    /** Files sent earlier in the conversation, so follow-up questions can still see them. */
    val historyAttachments: Map<UUID, AssistantAttachment> = emptyMap()
)

@Service
class ConversationService(
    private val openAIProvider: OpenAIProvider,
    private val embeddingService: EmbeddingService,
    private val conversationRepository: ConversationRepository,
    private val messageRepository: ConversationMessageRepository,
    private val userRepository: UserRepository,
    private val spaceRepository: SpaceRepository,
    private val permissionService: PermissionService,
    private val gitService: GitService,
    private val toolRegistry: ToolRegistry,
    private val objectMapper: ObjectMapper,
    private val draftMaterialService: DraftMaterialService,
    private val attachmentService: AttachmentService
) {
    private val logger = LoggerFactory.getLogger(ConversationService::class.java)

    companion object {
        /** Cap on tool round-trips per message, so a looping model can't run away against a paid API. */
        private const val MAX_TOOL_ROUNDS = 8
        private const val HISTORY_MESSAGES = 20
        private const val RETRIEVED_CHUNKS = 6
        private const val MAX_SOURCES = 8
        private const val MAX_LISTED_FILES = 400
        private const val MAX_LISTED_FOLDERS = 100
        private const val MAX_DOCUMENT_CHARS = 60_000
        private const val TITLE_LENGTH = 80
        /** Tools that change something; left out when the user cannot write or a draft is being written. */
        private val WRITING_TOOLS = setOf("create_document", "propose_edit", "create_task", "save_attachment")

        private val WRITE_INSTRUCTIONS = """
            Writing:
            - For a new document, call create_document. It writes and commits right away.
            - To change an existing document, read it, then call propose_edit. The change is only
              proposed: the user applies or discards it. Say that it is waiting for them.
            - When the user asks for a task or a to-do, call create_task. It is created right away.
            - Never say you have created or changed something unless the tool call succeeded.
              If a call is refused, say so plainly and why.
        """.trimIndent()

        private val DRAFT_INSTRUCTIONS = """
            Drafting: write the complete draft as your answer, in Markdown, starting with a # heading.
            Do not save it anywhere and do not create tasks; the user edits the draft and saves it themselves.
        """.trimIndent()

        private val ATTACHMENT_INSTRUCTIONS = """
            Files: the user can attach photos, scans, PDFs and text files. They are part of their message.
            - Read them closely, handwriting included. When you quote or transcribe handwriting, do it faithfully,
              keep crossed-out words crossed out (~~like this~~) and mark words you cannot read as [illegible];
              never guess silently.
            - When files come without a question, say briefly what each one is, give the transcription of handwritten
              or scanned pages, and offer what you can do with it: keep it in the space, turn it into a document, make tasks.
            - Attachments belong to this conversation, not to the space. Only call save_attachment to keep an original file
              in the space, or create_document to keep a transcription or summary, when the user asks for it.
        """.trimIndent()

        private val READ_ONLY_INSTRUCTIONS = """
            Writing: the user cannot edit this space, so you cannot create or change documents
            here. Never offer to. If they ask, say so and offer to draft the text in your reply.
        """.trimIndent()

        internal fun titleFor(message: String): String {
            val line = message.lineSequence().map { it.trim() }.firstOrNull { it.isNotEmpty() } ?: "Conversation"
            if (line.length <= TITLE_LENGTH) return line
            val cut = line.take(TITLE_LENGTH).substringBeforeLast(' ')
            return (if (cut.length >= TITLE_LENGTH / 2) cut else line.take(TITLE_LENGTH)).trimEnd() + "..."
        }

        internal fun escapeLike(query: String): String =
            query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    }

    // ---- Reading and managing conversations ---------------------------------------

    @Transactional(readOnly = true)
    fun list(userEmail: String, query: String?): List<ConversationSummaryDto> {
        val user = user(userEmail)
        val conversations = if (query.isNullOrBlank()) {
            conversationRepository.findByUserIdOrderByUpdatedAtDesc(user.id!!)
        } else {
            conversationRepository.search(user.id!!, escapeLike(query.trim()))
        }
        return conversations.map { it.toSummary() }
    }

    @Transactional(readOnly = true)
    fun get(userEmail: String, conversationId: UUID): ConversationDto {
        val conversation = owned(user(userEmail), conversationId)
        val messages = messageRepository.findByConversationIdOrderByCreatedAtAsc(conversationId)
        val paths = spacePaths(messages.flatMap { m -> m.sources.map { it.spaceId } + m.createdDocuments.map { it.spaceId } + m.proposals.map { it.spaceId } })
        return ConversationDto(conversation.toSummary(), messages.map { it.toDto(paths) })
    }

    @Transactional
    fun rename(userEmail: String, conversationId: UUID, title: String): ConversationSummaryDto {
        val cleaned = title.trim().take(255)
        if (cleaned.isEmpty()) throw ResponseStatusException(HttpStatus.BAD_REQUEST, "The title cannot be empty")
        val conversation = owned(user(userEmail), conversationId)
        conversation.title = cleaned
        return conversationRepository.save(conversation).toSummary()
    }

    @Transactional
    fun delete(userEmail: String, conversationId: UUID) {
        conversationRepository.delete(owned(user(userEmail), conversationId))
    }

    // ---- A turn: the user's message, the model's rounds, the stored answer ---------

    /**
     * Checks access and stores the user's message. Throws before anything is
     * stored or sent to the model when the space is unreadable or the
     * conversation belongs to someone else.
     */
    @Transactional
    fun prepareTurn(
        userEmail: String,
        spaceId: UUID?,
        conversationId: UUID?,
        documentPath: String?,
        message: String,
        draft: DraftRequest? = null,
        attachmentIds: List<UUID> = emptyList()
    ): PreparedTurn {
        if (message.isBlank() && attachmentIds.isEmpty()) throw ResponseStatusException(HttpStatus.BAD_REQUEST, "The message is empty")
        if (!openAIProvider.isConfigured()) {
            throw ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "AI features are not configured. Please set up your OpenAI API key in Admin Settings.")
        }
        val user = user(userEmail)

        val existing = conversationId?.let { owned(user, it) }
        val space = existing?.space
            ?: spaceId?.let { spaceRepository.findById(it).orElse(null) }
            ?: throw ResponseStatusException(HttpStatus.BAD_REQUEST, "Choose a space for the conversation")

        // An unreadable space must look exactly like a missing one.
        val repositoryIds = permissionService.readableRepositoryIds(user.id!!, user.role, space.id!!)
        if (repositoryIds.isEmpty()) throw ResponseStatusException(HttpStatus.NOT_FOUND, "Space not found")

        val docPath = existing?.documentPath ?: documentPath?.trim()?.trimStart('/')?.ifEmpty { null }
        val conversation = existing ?: conversationRepository.save(
            Conversation(user = user, space = space, documentPath = docPath, title = titleFor(message))
        )
        val history = if (existing == null) emptyList()
        else messageRepository.findByConversationIdOrderByCreatedAtAsc(conversation.id!!).takeLast(HISTORY_MESSAGES)

        val attachments = attachmentService.attach(user, conversation.id!!, attachmentIds)
        // A question that is only files is named after them.
        if (existing == null && message.isBlank()) conversation.title = titleFor(attachments.joinToString(", ") { it.fileName })
        val historyAttachments = attachmentService.byIds(history.flatMap { m -> m.attachments.map { it.id } })

        val now = Instant.now()
        val userMessage = messageRepository.save(
            ConversationMessage(
                conversation = conversation, role = "user", content = message.trim(), createdAt = now,
                attachments = attachments.map { it.toMessageAttachment() }
            )
        )
        conversation.updatedAt = now

        val repositories = spaceRepository.findAllById(repositoryIds)
        val canWrite = repositories.any { repo ->
            repo.syncStatus != SyncStatus.IN_CONFLICT && permissionService.hasEditAccess(user.id!!, repo.id!!, user.role)
        }
        val documentContent = docPath?.let { path ->
            val repo = repositories.singleOrNull()
                ?: throw ResponseStatusException(HttpStatus.BAD_REQUEST, "A document conversation needs a repository space")
            gitService.readFile(repo, path)
                ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Document not found")
        }

        // A draft starts a conversation with what happened in the space; follow-ups refine it from the history.
        val draftMaterial = draft?.takeIf { existing == null }?.let { draftMaterialService.material(repositoryIds, it.template, it.days) }

        return PreparedTurn(
            conversationId = conversation.id!!,
            created = existing == null,
            summary = conversation.toSummary(),
            userMessageId = userMessage.id!!,
            message = message,
            scope = ToolScope.Conversation(space.id.toString(), space.name, repositoryIds.map { it.toString() }.toSet(), conversation.id.toString()),
            canWrite = canWrite,
            systemPrompt = systemPrompt(
                user, space, repositories, docPath, documentContent,
                writing = when {
                    draftMaterial != null -> DRAFT_INSTRUCTIONS
                    canWrite -> WRITE_INSTRUCTIONS
                    else -> READ_ONLY_INSTRUCTIONS
                },
                files = (historyAttachments.values + attachments).distinctBy { it.id }
            ) + (draftMaterial?.let { "\n\nMaterial for the draft (write from this, do not invent anything beyond it):\n$it" } ?: ""),
            history = history,
            retrievalSpaceIds = if (docPath != null || draftMaterial != null) emptyList() else repositoryIds,
            spacePaths = (repositories + space).associate { it.id!! to it.getFullPath() },
            documentSource = docPath?.let { MessageSource(repositories.single().id!!, it) },
            drafting = draftMaterial != null,
            attachments = attachments,
            historyAttachments = historyAttachments
        )
    }

    /**
     * Runs the model against a prepared turn and stores its answer. Long-running:
     * the controller calls it off the request thread. Failures end up as an
     * `error` event and as the stored answer, never as a dangling user message.
     */
    fun runTurn(turn: PreparedTurn, credential: ToolCredential, listener: TurnListener) {
        val session = toolRegistry.session(credential, turn.scope)
        val toolLog = mutableListOf<MessageToolCall>()
        var answer: String
        var failed = false

        val query = turn.message.ifBlank {
            turn.attachments.mapNotNull { it.extractedText?.take(500) }.joinToString("\n").ifBlank { turn.attachments.joinToString(" ") { it.fileName } }
        }
        val chunks = if (turn.retrievalSpaceIds.isEmpty()) emptyList()
        else runCatching { embeddingService.findSimilarAcrossSpaces(turn.retrievalSpaceIds, query, RETRIEVED_CHUNKS) }
            .onFailure { logger.warn("Retrieval failed for conversation ${turn.conversationId}: ${it.message}") }
            .getOrDefault(emptyList())

        try {
            val openAI = openAIProvider.getClient(socketTimeout = 180.seconds)
                ?: throw ToolException("AI features are not configured.")
            val messages = mutableListOf(ChatMessage(role = ChatRole.System, content = turn.systemPrompt + retrievedContext(chunks)))
            messages += conversationMessages(turn)
            answer = converse(openAI, messages, session, turn, toolLog, listener)
        } catch (e: Exception) {
            logger.error("Assistant turn failed for conversation ${turn.conversationId}", e)
            failed = true
            answer = "Something went wrong while answering: ${e.message ?: e.javaClass.simpleName}"
            listener.onEvent("error", mapOf("message" to answer))
        }

        val effects = session.effects
        // An answer about attached files draws on them; the best search hit is no stand-in for a source then.
        val chunkSources = retrievalSources(chunks, answer, fallback = turn.attachments.isEmpty() && turn.historyAttachments.isEmpty())
        val sources = (listOfNotNull(turn.documentSource) + effects.sources.values.map { MessageSource(UUID.fromString(it.spaceId), it.path, it.title) } + chunkSources)
            .distinctBy { it.spaceId to it.path }
            .take(MAX_SOURCES)
        val stored = messageRepository.save(
            ConversationMessage(
                conversation = conversationRepository.getReferenceById(turn.conversationId),
                role = "assistant",
                content = answer,
                sources = if (failed) emptyList() else sources,
                toolCalls = toolLog,
                createdDocuments = effects.created.map { MessageSource(UUID.fromString(it.spaceId), it.path, it.title) },
                proposals = effects.proposals.map {
                    MessageProposal(it.id, UUID.fromString(it.spaceId), it.path, it.summary, it.oldText, it.newText, it.contextBefore, it.contextAfter)
                },
                createdTasks = effects.createdTasks.map { MessageTask(UUID.fromString(it.id), UUID.fromString(it.spaceId), it.title) }
            )
        )
        conversationRepository.touch(turn.conversationId, stored.createdAt)
        listener.onEvent("done", stored.toDto(turn.spacePaths))
    }

    private fun converse(
        openAI: OpenAI,
        messages: MutableList<ChatMessage>,
        session: ToolSession,
        turn: PreparedTurn,
        toolLog: MutableList<MessageToolCall>,
        listener: TurnListener
    ): String {
        val tools = toolRegistry.conversationTools()
            .filter { (turn.canWrite && !turn.drafting) || it.name !in WRITING_TOOLS }
        val openAiTools = tools.map { tool ->
            Tool.function(
                name = tool.name,
                description = tool.description,
                parameters = Parameters.fromJsonString(objectMapper.writeValueAsString(tool.inputSchema))
            )
        }
        var streaming = true

        repeat(MAX_TOOL_ROUNDS) {
            val request = ChatCompletionRequest(
                model = ModelId(openAIProvider.getChatModel()),
                messages = messages,
                tools = openAiTools.ifEmpty { null }
            )
            val round = if (streaming) {
                try {
                    runBlocking {
                        val accumulator = CompletionAccumulator()
                        openAI.chatCompletions(request).collect { chunk ->
                            accumulator.add(chunk)?.let { listener.onEvent("delta", mapOf("text" to it)) }
                        }
                        accumulator.result()
                    }
                } catch (e: Exception) {
                    // Some organisations may not stream some models. Answer anyway, just not word by word.
                    if (e.message?.contains("stream", ignoreCase = true) != true) throw e
                    logger.warn("Streaming refused by OpenAI, falling back to a single response: ${e.message}")
                    streaming = false
                    runBlocking { AssistantRound.of(openAI.chatCompletion(request)) }
                        .also { r -> if (r.text.isNotEmpty()) listener.onEvent("delta", mapOf("text" to r.text)) }
                }
            } else {
                runBlocking { AssistantRound.of(openAI.chatCompletion(request)) }
                    .also { r -> if (r.text.isNotEmpty()) listener.onEvent("delta", mapOf("text" to r.text)) }
            }

            if (round.toolCalls.isEmpty()) return round.text.ifBlank { "I couldn't generate a response." }

            // Text before a tool call is thinking out loud, not the answer.
            if (round.text.isNotEmpty()) listener.onEvent("reset", emptyMap<String, Any>())
            messages += round.toMessage()
            for (call in round.toolCalls) {
                messages += ChatMessage(role = ChatRole.Tool, toolCallId = call.id, content = runTool(call, session, toolLog, listener))
            }
        }

        return "I wasn't able to finish that within ${MAX_TOOL_ROUNDS} steps. Please try a narrower question."
    }

    /**
     * The history and the new message as the model sees them. Files go along
     * with the message they were sent with; the newest images come first when
     * there are more than one request may carry.
     */
    private fun conversationMessages(turn: PreparedTurn): List<ChatMessage> {
        val (currentParts, currentImages) = attachmentService.contentParts(turn.attachments, AttachmentService.MAX_IMAGES_PER_REQUEST)
        var budget = AttachmentService.MAX_IMAGES_PER_REQUEST - currentImages
        val historyParts = HashMap<UUID, List<ContentPart>>()
        turn.history.asReversed().filter { it.role == "user" && it.attachments.isNotEmpty() }.forEach { m ->
            val files = m.attachments.mapNotNull { turn.historyAttachments[it.id] }
            val (parts, used) = attachmentService.contentParts(files, budget)
            budget -= used
            historyParts[m.id!!] = parts
        }

        fun userMessage(text: String, files: List<ContentPart>): ChatMessage =
            if (files.isEmpty()) ChatMessage(role = ChatRole.User, content = text)
            else ChatMessage(role = ChatRole.User, content = listOf(TextPart(text.ifBlank { "(Only the attached files, no question.)" })) + files)

        return turn.history.map { m ->
            if (m.role == "user") userMessage(m.content, historyParts[m.id!!].orEmpty())
            else ChatMessage(role = ChatRole.Assistant, content = m.content)
        } + userMessage(turn.message, currentParts)
    }

    private fun runTool(
        call: ToolCall.Function,
        session: ToolSession,
        toolLog: MutableList<MessageToolCall>,
        listener: TurnListener
    ): String {
        val name = call.function.nameOrNull.orEmpty()
        val args = runCatching { objectMapper.readTree(call.function.argumentsOrNull ?: "{}") as ObjectNode }
            .getOrElse { objectMapper.createObjectNode() }
        val label = toolLabel(name, args)
        listener.onEvent("status", mapOf("label" to label))
        val tool = toolRegistry.conversationTool(name)
        val (result, ok) = when {
            tool == null -> "Unknown tool: $name" to false
            else -> try {
                tool.handler(session, args) to true
            } catch (e: ToolException) {
                (e.message ?: "Tool failed") to false
            } catch (e: Exception) {
                logger.warn("Assistant tool $name failed: ${e.message}", e)
                "Tool failed: ${e.message}" to false
            }
        }
        val entry = MessageToolCall(name, label, ok)
        toolLog += entry
        listener.onEvent("tool", entry)
        return result
    }

    /** What the user sees for a tool call, e.g. `Read guides/setup.md`. */
    internal fun toolLabel(name: String, args: ObjectNode): String {
        fun arg(key: String) = args.get(key)?.takeIf { !it.isNull }?.asText()?.takeIf { it.isNotBlank() }
        return when (name) {
            "search_documentation", "search_by_keyword" -> "Searched for \"${arg("query") ?: ""}\""
            "list_documents" -> "Listed the documents"
            "list_directory" -> "Listed ${arg("path") ?: "the top folder"}"
            "read_document" -> "Read ${arg("path") ?: "a document"}"
            "create_document" -> "Created ${arg("path") ?: "a document"}"
            "propose_edit" -> "Proposed a change to ${arg("path") ?: "a document"}"
            "list_tasks" -> if (args.get("assigned_to_me")?.asBoolean() == true) "Looked up your tasks" else "Listed the tasks"
            "create_task" -> "Created the task \"${arg("title") ?: ""}\""
            "update_task" -> "Updated a task"
            "save_attachment" -> "Saved ${arg("path") ?: "the file"} in the space"
            else -> name.replace('_', ' ').replaceFirstChar { it.uppercase() }
        }
    }

    // ---- Proposals ------------------------------------------------------------------

    /**
     * Applies a proposed change through the same PATCH endpoint an MCP client
     * would use, as the user who clicked Apply: edit access, exact-text matching
     * and the commit are all that endpoint's. A proposal that no longer matches
     * fails instead of editing the wrong place.
     */
    fun applyProposal(userEmail: String, conversationId: UUID, messageId: UUID, proposalId: UUID, credential: ToolCredential): ProposalDto {
        val (message, proposal) = pendingProposal(userEmail, conversationId, messageId, proposalId)
        val api = toolRegistry.session(credential, ToolScope.Unrestricted).api
        val outcome = try {
            api.patchDocument(
                proposal.spaceId.toString(), proposal.path,
                mapOf(
                    "operations" to listOf(mapOf("op" to "replace", "oldText" to proposal.oldText, "newText" to proposal.newText)),
                    "autoCommit" to true,
                    "commitMessage" to "${proposal.summary.take(72)} (${proposal.path}, via AI assistant)"
                )
            )
            proposal.copy(status = ProposalStatus.APPLIED, error = null)
        } catch (e: LoopbackStatusException) {
            proposal.copy(
                status = ProposalStatus.FAILED,
                error = when (e.status) {
                    400 -> "The document changed since this was proposed, so the text to replace is no longer there."
                    403 -> "You need edit access to this space to apply the change."
                    404 -> "The document no longer exists."
                    409 -> "The space is in a sync conflict. Resolve it first."
                    else -> e.message
                }
            )
        }
        return storeProposal(message, outcome)
    }

    fun discardProposal(userEmail: String, conversationId: UUID, messageId: UUID, proposalId: UUID): ProposalDto {
        val (message, proposal) = pendingProposal(userEmail, conversationId, messageId, proposalId)
        return storeProposal(message, proposal.copy(status = ProposalStatus.DISCARDED))
    }

    private fun pendingProposal(userEmail: String, conversationId: UUID, messageId: UUID, proposalId: UUID): Pair<ConversationMessage, MessageProposal> {
        owned(user(userEmail), conversationId)
        val message = messageRepository.findById(messageId).orElse(null)
            ?.takeIf { it.conversation.id == conversationId }
            ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Message not found")
        val proposal = message.proposals.firstOrNull { it.id == proposalId }
            ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Proposal not found")
        if (proposal.status != ProposalStatus.PENDING) {
            throw ResponseStatusException(HttpStatus.CONFLICT, "This change was already ${proposal.status.name.lowercase()}")
        }
        return message to proposal
    }

    private fun storeProposal(message: ConversationMessage, updated: MessageProposal): ProposalDto {
        message.proposals = message.proposals.map { if (it.id == updated.id) updated else it }
        messageRepository.save(message)
        return updated.toDto(spacePaths(listOf(updated.spaceId)))
    }

    // ---- Prompt ---------------------------------------------------------------------

    private fun systemPrompt(
        user: User,
        space: Space,
        repositories: List<Space>,
        documentPath: String?,
        documentContent: String?,
        writing: String,
        files: List<AssistantAttachment> = emptyList()
    ): String {
        val overview = if (space.type == SpaceType.GROUP) {
            buildString {
                appendLine("Group: ${space.name}")
                space.description?.takeIf { it.isNotBlank() }?.let { appendLine("Description: $it") }
                appendLine("Repositories in this group (pass spaceId to tools):")
                repositories.forEach { appendLine("  - ${it.name} (${it.getFullPath()}) [spaceId: ${it.id}]") }
            }
        } else {
            repositoryOverview(space)
        }
        val focus = if (documentPath != null && documentContent != null) {
            val truncated = documentContent.length > MAX_DOCUMENT_CHARS
            """
            |The user is asking about one document: $documentPath
            |Answer about this document. Only look elsewhere in the space when the question needs it.
            |
            |Content of $documentPath${if (truncated) " (truncated)" else ""}:
            |${documentContent.take(MAX_DOCUMENT_CHARS)}
            """.trimMargin()
        } else ""
        val attached = if (files.isEmpty()) "" else ATTACHMENT_INSTRUCTIONS + "\nFiles in this conversation:\n" +
            files.joinToString("\n") { "  - ${it.fileName} (${it.kind.name.lowercase()}) [attachment_id: ${it.id}]" }

        return """
            |You are the assistant inside DocuVault, a documentation tool where every space is a Git repository.
            |You help with the "${space.name}" space.
            |You are talking to ${user.name} (${user.email}); when they say "me", they mean this person. Today is ${java.time.LocalDate.now()}.
            |
            |$overview
            |
            |How to answer:
            |- Answer in the language the user writes in. Be concise. Use Markdown.
            |- Base answers on the documents. When the context below is not enough, search and read with the tools
            |  before answering. If the documents do not say, say that instead of guessing.
            |- Name the documents you used by their path.
            |
            |$writing
            |
            |$attached
            |
            |$focus
        """.trimMargin().trim()
    }

    /**
     * What is actually in the space, listed by path so folders are visible.
     *
     * The file list comes from the repository rather than the `documents` table:
     * only Markdown gets a row there, so a space of HTML pages would otherwise
     * look empty to the assistant, which is how it ended up inventing paths.
     */
    private fun repositoryOverview(space: Space): String {
        val paths = try {
            gitService.listFilesUnder(space, "")
        } catch (e: Exception) {
            logger.warn("Could not list files for space '${space.name}': ${e.message}")
            emptyList()
        }.filterNot { it.startsWith(".") || it.contains("/.") }

        val sb = StringBuilder()
        sb.appendLine("Repository: ${space.name}")
        space.description?.takeIf { it.isNotBlank() }?.let { sb.appendLine("Description: $it") }

        val folders = paths.mapNotNull { it.substringBeforeLast('/', "").ifBlank { null } }.distinct().sorted()
        if (folders.isNotEmpty()) {
            sb.appendLine("Folders (${folders.size}):")
            folders.take(MAX_LISTED_FOLDERS).forEach { sb.appendLine("  $it/") }
            if (folders.size > MAX_LISTED_FOLDERS) sb.appendLine("  ... and ${folders.size - MAX_LISTED_FOLDERS} more")
        }
        sb.appendLine("Files (${paths.size}):")
        paths.take(MAX_LISTED_FILES).forEach { sb.appendLine("  $it") }
        if (paths.size > MAX_LISTED_FILES) sb.appendLine("  ... and ${paths.size - MAX_LISTED_FILES} more")
        return sb.toString()
    }

    /**
     * The retrieved passages the answer actually drew on. Retrieval always
     * returns something, often from unrelated documents, so only documents the
     * answer names count; when it names none, the best match stands in.
     */
    internal fun retrievalSources(chunks: List<CrossSpaceChunk>, answer: String, fallback: Boolean = true): List<MessageSource> {
        val named = chunks.filter { chunk ->
            answer.contains(chunk.documentPath) ||
                chunk.documentTitle?.takeIf { it.length > 3 }?.let { answer.contains(it, ignoreCase = true) } == true
        }
        return named.ifEmpty { if (fallback) chunks.take(1) else emptyList() }.map { MessageSource(it.spaceId, it.documentPath, it.documentTitle) }
    }

    private fun retrievedContext(chunks: List<CrossSpaceChunk>): String =
        if (chunks.isEmpty()) ""
        else "\n\nPassages that may be relevant to the question:\n\n" +
            chunks.joinToString("\n\n") { "From ${it.documentPath}:\n${it.content}" }

    // ---- Helpers ----------------------------------------------------------------------

    private fun user(email: String): User =
        userRepository.findByEmail(email) ?: throw ResponseStatusException(HttpStatus.UNAUTHORIZED)

    /** Someone else's conversation is reported as missing, not as forbidden. */
    private fun owned(user: User, conversationId: UUID): Conversation =
        conversationRepository.findById(conversationId).orElse(null)
            ?.takeIf { it.user.id == user.id }
            ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Conversation not found")

    private fun spacePaths(ids: Collection<UUID>): Map<UUID, String> =
        if (ids.isEmpty()) emptyMap()
        else spaceRepository.findAllById(ids.toSet()).associate { it.id!! to it.getFullPath() }

    private fun Conversation.toSummary() = ConversationSummaryDto(
        id = id!!,
        title = title,
        spaceId = space.id!!,
        spaceName = space.name,
        spaceFullPath = space.getFullPath(),
        documentPath = documentPath,
        updatedAt = updatedAt
    )

    private fun ConversationMessage.toDto(paths: Map<UUID, String>) = MessageDto(
        id = id!!,
        role = role,
        content = content,
        sources = sources.map { SourceDto(it.spaceId, paths[it.spaceId], it.path, it.title) },
        toolCalls = toolCalls,
        createdDocuments = createdDocuments.map { SourceDto(it.spaceId, paths[it.spaceId], it.path, it.title) },
        proposals = proposals.map { it.toDto(paths) },
        createdTasks = createdTasks,
        attachments = attachments,
        createdAt = createdAt
    )

    private fun MessageProposal.toDto(paths: Map<UUID, String>) = ProposalDto(
        id, spaceId, paths[spaceId], path, summary, oldText, newText, contextBefore, contextAfter, status, error
    )
}
