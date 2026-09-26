package com.docuvault.service.capture

import com.aallam.openai.api.chat.ChatCompletionRequest
import com.aallam.openai.api.chat.ChatMessage
import com.aallam.openai.api.chat.ChatResponseFormat
import com.aallam.openai.api.chat.ChatRole
import com.aallam.openai.api.model.ModelId
import com.docuvault.config.OpenAIProvider
import com.docuvault.domain.space.Space
import com.docuvault.domain.space.SpaceType
import com.docuvault.domain.space.SyncStatus
import com.docuvault.domain.user.User
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.PermissionService
import com.docuvault.service.branding.BrandingService
import com.docuvault.service.embedding.CrossSpaceChunk
import com.docuvault.service.embedding.EmbeddingService
import com.docuvault.service.task.ActionItems
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import kotlinx.coroutines.runBlocking
import org.jsoup.Jsoup
import org.slf4j.LoggerFactory
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.server.ResponseStatusException
import java.time.LocalDate
import java.util.*

data class CaptureSpaceDto(val id: UUID, val name: String, val fullPath: String)

data class CaptureTaskDto(
    val title: String,
    val dueDate: LocalDate?,
    val assigneeId: UUID?,
    val assigneeName: String?
)

data class CaptureSuggestionDto(
    /** Where the note most likely belongs; null only when the user can write nowhere. */
    val space: CaptureSpaceDto?,
    val reason: String?,
    val tasks: List<CaptureTaskDto>,
    /** False when no model was asked, e.g. because AI is not configured. */
    val aiUsed: Boolean
)

/**
 * Suggests where a quick note belongs and which tasks are in it, so the note
 * can be written first and filed after. Only spaces the user can write to are
 * candidates, and nothing is saved here: the user confirms the space and the
 * tasks before anything is created.
 */
@Service
class CaptureService(
    private val openAIProvider: OpenAIProvider,
    private val embeddingService: EmbeddingService,
    private val permissionService: PermissionService,
    private val userRepository: UserRepository,
    private val objectMapper: ObjectMapper,
    private val brandingService: BrandingService
) {
    private val logger = LoggerFactory.getLogger(CaptureService::class.java)

    companion object {
        private const val MAX_NOTE_CHARS = 6000
        private const val RETRIEVED_CHUNKS = 8
        private const val MAX_CANDIDATES = 60
        private const val MAX_TASKS = 10
    }

    @Transactional(readOnly = true)
    fun suggest(userEmail: String, content: String): CaptureSuggestionDto {
        val user = userRepository.findByEmail(userEmail) ?: throw ResponseStatusException(HttpStatus.UNAUTHORIZED)
        val text = Jsoup.parse(content).wholeText().trim().take(MAX_NOTE_CHARS)
        if (text.isBlank()) throw ResponseStatusException(HttpStatus.BAD_REQUEST, "The note is empty")

        val writable = writableRepositories(user)
        if (writable.isEmpty()) return CaptureSuggestionDto(null, "You cannot write to any space.", emptyList(), aiUsed = false)
        if (!openAIProvider.isConfigured()) return CaptureSuggestionDto(writable.first().toDto(), null, emptyList(), aiUsed = false)

        val chunks = runCatching { embeddingService.findSimilarAcrossSpaces(writable.map { it.id!! }, text, RETRIEVED_CHUNKS) }
            .onFailure { logger.warn("Capture retrieval failed: ${it.message}") }
            .getOrDefault(emptyList())

        val reply = try {
            ask(user, text, writable.take(MAX_CANDIDATES), chunks)
        } catch (e: Exception) {
            logger.warn("Capture suggestion failed, falling back to retrieval: ${e.message}")
            null
        }

        val chosen = chooseSpace(reply?.text("spaceId"), chunks, writable)
        val members = permissionService.effectiveMembersOf(chosen).map { it.user }.filter { it.enabled }
        val tasks = reply?.get("tasks")?.takeIf { it.isArray }?.toList().orEmpty()
            .mapNotNull { node -> toTask(node, user, members) }
            .take(MAX_TASKS)

        return CaptureSuggestionDto(chosen.toDto(), reply?.text("reason"), tasks, aiUsed = reply != null)
    }

    /**
     * The model's pick when it is one of the candidates, else the space of the
     * closest existing document, else the first candidate. A model naming a
     * space the user cannot write to never gets its way.
     */
    internal fun chooseSpace(suggestedId: String?, chunks: List<CrossSpaceChunk>, writable: List<Space>): Space =
        writable.firstOrNull { it.id.toString() == suggestedId }
            ?: chunks.firstNotNullOfOrNull { chunk -> writable.firstOrNull { it.id == chunk.spaceId } }
            ?: writable.first()

    private fun writableRepositories(user: User): List<Space> =
        permissionService.getAccessibleSpaces(user.id!!, user.role)
            .filter { it.type == SpaceType.REPOSITORY && it.syncStatus != SyncStatus.IN_CONFLICT }
            .filter { permissionService.hasEditAccess(user.id!!, it.id!!, user.role) }
            .sortedBy { it.getFullPath() }

    private fun ask(user: User, text: String, candidates: List<Space>, chunks: List<CrossSpaceChunk>): JsonNode? {
        val openAI = openAIProvider.getClient() ?: return null
        val names = candidates.associate { it.id to it.getFullPath() }
        val system = """
            |You file quick notes in ${brandingService.appName()}, a documentation tool organised in spaces.
            |Pick the one space the note below belongs to, and list the tasks it contains.
            |
            |Spaces the user can write to:
            |${candidates.joinToString("\n") { "- spaceId ${it.id}: ${it.getFullPath()} (${it.name})" + (it.description?.takeIf { d -> d.isNotBlank() }?.let { d -> ": $d" } ?: "") }}
            |
            |Existing documents that resemble the note:
            |${chunks.joinToString("\n") { "- ${names[it.spaceId] ?: it.spaceId}/${it.documentPath}: ${it.content.take(300).replace('\n', ' ')}" }.ifEmpty { "(none)" }}
            |
            |The note was written by ${user.name} (${user.email}). Today is ${LocalDate.now()}.
            |
            |Reply with JSON only:
            |{"spaceId": "<one spaceId from the list>", "reason": "<one short sentence why>",
            | "tasks": [{"title": "<imperative sentence>", "dueDate": "<YYYY-MM-DD or null>", "assignee": "<person's name, 'me', or null>"}]}
            |List a task only when the note clearly asks someone to do something. Do not invent tasks, dates or people.
            |Resolve relative dates like "next Friday" against today. Answer the reason in the language of the note.
        """.trimMargin()

        val completion = runBlocking {
            openAI.chatCompletion(
                ChatCompletionRequest(
                    model = ModelId(openAIProvider.getChatModel()),
                    messages = listOf(
                        ChatMessage(role = ChatRole.System, content = system),
                        ChatMessage(role = ChatRole.User, content = text)
                    ),
                    responseFormat = ChatResponseFormat.JsonObject
                )
            )
        }
        val reply = completion.choices.firstOrNull()?.message?.content ?: return null
        return runCatching { objectMapper.readTree(reply) }.getOrNull()?.takeIf { it.isObject }
    }

    internal fun toTask(node: JsonNode, user: User, members: List<User>): CaptureTaskDto? {
        val title = node.text("title")?.trim()?.take(500)?.ifEmpty { null } ?: return null
        val due = node.text("dueDate")?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
        val wanted = node.text("assignee")
        val assignee = if (wanted?.trim()?.lowercase() in setOf("me", "myself", "ich", "mir", "mich")) user
        else ActionItems.matchOwner(wanted, members)
        return CaptureTaskDto(title, due, assignee?.id, assignee?.name ?: wanted?.takeIf { it.isNotBlank() && it != "null" })
    }

    private fun JsonNode.text(field: String): String? = get(field)?.takeIf { !it.isNull }?.asText()?.takeIf { it != "null" }

    private fun Space.toDto() = CaptureSpaceDto(id!!, name, getFullPath())
}
