package com.docuvault.service.ai

import com.aallam.openai.api.chat.ChatCompletionRequest
import com.aallam.openai.api.chat.ChatMessage
import com.aallam.openai.api.chat.ChatRole
import com.aallam.openai.api.chat.Tool
import com.aallam.openai.api.chat.ToolCall
import com.aallam.openai.api.core.Parameters
import com.aallam.openai.api.model.ModelId
import com.docuvault.config.OpenAIProvider
import com.docuvault.domain.ai.ChatHistory
import com.docuvault.domain.space.SyncStatus
import com.docuvault.infrastructure.repository.ChatHistoryRepository
import com.docuvault.infrastructure.repository.DocumentRepository
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.DocumentPersistService
import com.docuvault.service.PermissionService
import com.docuvault.service.embedding.EmbeddingService
import com.docuvault.service.git.GitService
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.slf4j.LoggerFactory
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.web.server.ResponseStatusException
import java.time.Instant
import java.util.*
import com.docuvault.domain.ai.ChatMessage as DomainChatMessage

@Service
class ChatService(
    private val openAIProvider: OpenAIProvider,
    private val embeddingService: EmbeddingService,
    private val chatHistoryRepository: ChatHistoryRepository,
    private val userRepository: UserRepository,
    private val spaceRepository: SpaceRepository,
    private val documentRepository: DocumentRepository,
    private val permissionService: PermissionService,
    private val documentPersistService: DocumentPersistService,
    private val gitService: GitService
) {
    private val logger = LoggerFactory.getLogger(ChatService::class.java)

    companion object {
        /** Cap on tool round-trips per message, so a looping model can't run away. */
        private const val MAX_TOOL_ROUNDS = 4
        private const val MAX_LISTED_FILES = 400
        private const val MAX_LISTED_FOLDERS = 100

        private val WRITE_INSTRUCTIONS = """
            You can create documents in this space with the create_document tool.
            When the user asks for a document, CALL THE TOOL. Never say you have created,
            saved or added a document unless a create_document call actually succeeded —
            claiming it without calling the tool is the worst thing you can do here.
            Put the file in a folder that already exists where one fits, using the folder
            list above; only invent a new folder when nothing suitable is there.
            After a successful call, tell the user the exact path you wrote.
            If a call is refused, say so plainly and why — do not pretend it worked.
            You cannot edit or delete existing documents; for those, point the user at the
            document itself.
        """.trimIndent()

        private val READ_ONLY_INSTRUCTIONS = """
            You can only read and search this space. You cannot create, edit or delete
            documents here, so never claim to have done so or offer to do it. If the user
            asks for a document to be created or changed, say plainly that you cannot in
            this space and that they can do it in the editor — then offer to draft the
            content in your reply so they can paste it.
        """.trimIndent()
    }

    fun chat(
        userEmail: String,
        spaceId: UUID,
        message: String,
        chatHistoryId: UUID? = null
    ): ChatResponse {
        val openAI = openAIProvider.getClient()
        if (openAI == null) {
            return ChatResponse(
                message = "AI features are not configured. Please set up your OpenAI API key in Admin Settings.",
                sources = emptyList()
            )
        }

        val user = userRepository.findByEmail(userEmail)
            ?: throw IllegalArgumentException("User not found")

        // Checked before anything is loaded or retrieved: an unreadable space
        // must look exactly like a missing one.
        val readableSpaceIds = permissionService.readableRepositoryIds(user.id!!, user.role, spaceId)
        if (readableSpaceIds.isEmpty()) throw ResponseStatusException(HttpStatus.NOT_FOUND, "Space not found")
        val space = spaceRepository.findById(spaceId).orElse(null)
            ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Space not found")

        // A conversation is continued only by its owner and only in its own space,
        // otherwise its earlier messages would be sent to the model on someone else's behalf.
        val existing = chatHistoryId?.let { id ->
            chatHistoryRepository.findById(id).orElse(null)
                ?.takeIf { it.user.id == user.id && it.space?.id == space.id }
                ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Conversation not found")
        }

        // Retrieve relevant context using semantic search
        val relevantChunks = embeddingService.findSimilar(readableSpaceIds, message, limit = 5)
        val context = relevantChunks.joinToString("\n\n") { chunk ->
            "From ${chunk.documentPath}:\n${chunk.content}"
        }

        // Load or create chat history
        val chatHistory = existing
            ?: ChatHistory(
                user = user,
                space = space,
                title = message.take(50)
            )

        // Writing is offered only to someone who could make the same change by
        // hand. Withholding the tool (rather than refusing the call later) also
        // keeps the assistant from promising an edit it will not be allowed to make.
        val canWrite = permissionService.hasEditAccess(user.id!!, space.id!!, user.role) &&
            space.syncStatus != SyncStatus.IN_CONFLICT

        // Build space metadata for context
        val spaceInfo = buildSpaceInfo(space)

        // Build conversation messages
        val messages = buildMessages(chatHistory, message, context, spaceInfo, canWrite).toMutableList()

        val created = mutableListOf<String>()
        val response = runBlocking {
            try {
                runChat(openAI, messages, space, user, canWrite, created)
            } catch (e: Exception) {
                logger.error("Chat completion failed", e)
                "An error occurred while processing your request: ${e.message}"
            }
        }

        // Save to chat history. A document the assistant just wrote is a source
        // for this answer as much as anything it read.
        val sources = (relevantChunks.map { it.documentPath } + created).distinct()
        val updatedMessages = chatHistory.messages.toMutableList()
        updatedMessages.add(DomainChatMessage(role = "user", content = message))
        updatedMessages.add(DomainChatMessage(role = "assistant", content = response, sources = sources))

        chatHistory.messages = updatedMessages
        chatHistory.updatedAt = Instant.now()
        val savedHistory = chatHistoryRepository.save(chatHistory)

        return ChatResponse(
            chatHistoryId = savedHistory.id,
            message = response,
            sources = sources
        )
    }

    fun getChatHistory(userEmail: String, spaceId: UUID? = null): List<ChatHistoryDto> {
        val user = userRepository.findByEmail(userEmail)
            ?: throw IllegalArgumentException("User not found")

        val histories = if (spaceId != null) {
            chatHistoryRepository.findByUserIdAndSpaceIdOrderByUpdatedAtDesc(user.id!!, spaceId)
        } else {
            chatHistoryRepository.findByUserIdOrderByUpdatedAtDesc(user.id!!)
        }

        return histories.map { it.toDto() }
    }

    fun getChatHistoryById(chatHistoryId: UUID): ChatHistoryDto? {
        return chatHistoryRepository.findById(chatHistoryId).orElse(null)?.toDto()
    }

    fun isOwnedBy(chatHistoryId: UUID, userEmail: String): Boolean {
        val history = chatHistoryRepository.findById(chatHistoryId).orElse(null) ?: return false
        return history.user?.email == userEmail
    }

    fun deleteChatHistory(chatHistoryId: UUID) {
        chatHistoryRepository.deleteById(chatHistoryId)
    }

    /**
     * Runs the completion, carrying out any document the assistant asks to
     * create and feeding the outcome back so it can report honestly.
     *
     * Bounded by [MAX_TOOL_ROUNDS]: a model that keeps asking for tools without
     * ever answering would otherwise loop against a paid API.
     */
    private suspend fun runChat(
        openAI: com.aallam.openai.client.OpenAI,
        messages: MutableList<ChatMessage>,
        space: com.docuvault.domain.space.Space,
        user: com.docuvault.domain.user.User,
        canWrite: Boolean,
        created: MutableList<String>
    ): String {
        val tools = if (canWrite) listOf(createDocumentTool()) else null

        repeat(MAX_TOOL_ROUNDS) {
            val completion = openAI.chatCompletion(
                ChatCompletionRequest(
                    model = ModelId(openAIProvider.getChatModel()),
                    messages = messages,
                    tools = tools
                )
            )
            val reply = completion.choices.firstOrNull()?.message
                ?: return "I couldn't generate a response."

            val calls = reply.toolCalls.orEmpty().filterIsInstance<ToolCall.Function>()
            if (calls.isEmpty()) {
                return reply.content ?: "I couldn't generate a response."
            }

            messages.add(reply)
            for (call in calls) {
                val result = executeCreateDocument(call, space, user, created)
                messages.add(
                    ChatMessage(
                        role = ChatRole.Tool,
                        toolCallId = call.id,
                        content = result
                    )
                )
            }
        }

        // Out of rounds: answer from what has happened rather than silently stopping.
        return if (created.isEmpty()) {
            "I wasn't able to finish that. Please try rephrasing the request."
        } else {
            "I created ${created.joinToString(", ")}."
        }
    }

    /** The one thing the assistant may change: adding a document to this space. */
    private fun createDocumentTool(): Tool = Tool.function(
        name = "create_document",
        description = "Create a new document in this space and commit it. " +
            "Use this whenever the user asks for a document to be created — never claim " +
            "to have created one without calling it. Fails if the path already exists.",
        parameters = Parameters.fromJsonString(
            """
            {
              "type": "object",
              "properties": {
                "path": {
                  "type": "string",
                  "description": "Repository-relative path including folders and extension, e.g. 'projekt-management/systemtechnik/security-architecture.md'. Use an existing folder from the project overview when one fits."
                },
                "title": {
                  "type": "string",
                  "description": "Human-readable document title."
                },
                "content": {
                  "type": "string",
                  "description": "Full document body in Markdown."
                }
              },
              "required": ["path", "content"]
            }
            """.trimIndent()
        )
    )

    /**
     * Carries out a create_document call. The returned string goes back to the
     * model as the tool result, so a refusal has to explain itself well enough
     * for the assistant to tell the user what happened.
     */
    private fun executeCreateDocument(
        call: ToolCall.Function,
        space: com.docuvault.domain.space.Space,
        user: com.docuvault.domain.user.User,
        created: MutableList<String>
    ): String {
        return try {
            val args = Json.parseToJsonElement(call.function.argumentsOrNull ?: "{}").jsonObject
            createDocument(
                space = space,
                user = user,
                rawPath = args["path"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                title = args["title"]?.jsonPrimitive?.contentOrNull,
                content = args["content"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                created = created
            )
        } catch (e: Exception) {
            logger.warn("create_document call failed in space '${space.name}': ${e.message}")
            "Failed: ${e.message ?: "the document could not be created."}"
        }
    }

    /**
     * The write itself, separated from argument parsing so the rules it enforces
     * — a path inside the space, non-empty content, never overwriting — can be
     * tested without going near a model.
     */
    internal fun createDocument(
        space: com.docuvault.domain.space.Space,
        user: com.docuvault.domain.user.User,
        rawPath: String,
        title: String?,
        content: String,
        created: MutableList<String>
    ): String {
        val path = sanitizeDocumentPath(rawPath)
            ?: return "Refused: '$rawPath' is not a valid path inside this space."
        if (content.isBlank()) return "Refused: the document content was empty."
        if (gitService.itemExists(space, path)) {
            return "Refused: '$path' already exists. Choose a different name, or tell " +
                "the user to open the existing document if they meant to change it."
        }

        val saved = documentPersistService.persistDocument(
            space = space,
            user = user,
            documentPath = path,
            content = content,
            title = title,
            autoCommit = true,
            commitMessage = "Create $path via AI chat"
        ) ?: return "Failed: the document could not be written."

        created.add(saved.path)
        logger.info("AI chat created '${saved.path}' in space '${space.name}' for ${user.email}")
        return "Created '${saved.path}' and committed it."
    }

    /**
     * A repo-relative path, or null if it tries to escape the space or names
     * nothing. Mirrors the upload endpoint's sanitising so the assistant cannot
     * reach anywhere a person could not.
     */
    internal fun sanitizeDocumentPath(raw: String): String? {
        val cleaned = raw.replace('\\', '/')
            .split('/')
            .map { it.trim() }
            .filter { it.isNotEmpty() && it != "." && it != ".." && !it.endsWith(":") }
            .joinToString("/")
        if (cleaned.isBlank() || cleaned.startsWith(".")) return null
        // Default to Markdown rather than writing an extensionless file.
        return if (cleaned.substringAfterLast('/').contains('.')) cleaned else "$cleaned.md"
    }

    /**
     * What is actually in the space, listed by path so folders are visible.
     *
     * The file list comes from the repository rather than the `documents` table:
     * only Markdown gets a row there, so a space of HTML pages would otherwise
     * look empty to the assistant — which is how it ended up inventing paths.
     */
    private fun buildSpaceInfo(space: com.docuvault.domain.space.Space): String {
        val paths = try {
            gitService.listFilesUnder(space, "")
        } catch (e: Exception) {
            logger.warn("Could not list files for space '${space.name}': ${e.message}")
            emptyList()
        }.filterNot { it.startsWith(".") || it.contains("/.") }

        val sb = StringBuilder()
        sb.appendLine("Project: ${space.name}")
        if (!space.description.isNullOrBlank()) {
            sb.appendLine("Description: ${space.description}")
        }
        sb.appendLine("Branch: ${space.branch}")

        val folders = paths.mapNotNull { it.substringBeforeLast('/', "").ifBlank { null } }
            .distinct().sorted()
        if (folders.isNotEmpty()) {
            sb.appendLine("Folders (${folders.size}):")
            folders.take(MAX_LISTED_FOLDERS).forEach { sb.appendLine("  $it/") }
            if (folders.size > MAX_LISTED_FOLDERS) {
                sb.appendLine("  … and ${folders.size - MAX_LISTED_FOLDERS} more")
            }
        }

        sb.appendLine("Files (${paths.size}):")
        paths.take(MAX_LISTED_FILES).forEach { sb.appendLine("  $it") }
        if (paths.size > MAX_LISTED_FILES) {
            sb.appendLine("  … and ${paths.size - MAX_LISTED_FILES} more")
        }
        return sb.toString()
    }

    private fun buildMessages(
        chatHistory: ChatHistory,
        newMessage: String,
        context: String,
        spaceInfo: String,
        canWrite: Boolean
    ): List<ChatMessage> {
        val messages = mutableListOf<ChatMessage>()

        // System message
        messages.add(
            ChatMessage(
                role = ChatRole.System,
                content = """You are a helpful documentation assistant for the "${chatHistory.space?.name ?: "documentation"}" project.
                |
                |Here is an overview of this project, including every folder and file it contains:
                |$spaceInfo
                |
                |Your job is to answer questions about the documentation based on the project info and context provided.
                |Be concise and helpful. If you don't have enough detail to answer a specific question, summarize what you do know about the project from the available documents.
                |When referencing documentation, mention the source document.
                |
                |${if (canWrite) WRITE_INSTRUCTIONS else READ_ONLY_INSTRUCTIONS}
                |
                |Context from relevant documents:
                |$context
                """.trimMargin()
            )
        )

        // Previous messages from history
        for (msg in chatHistory.messages) {
            messages.add(
                ChatMessage(
                    role = if (msg.role == "user") ChatRole.User else ChatRole.Assistant,
                    content = msg.content
                )
            )
        }

        // New user message
        messages.add(ChatMessage(role = ChatRole.User, content = newMessage))

        return messages
    }
}

data class ChatResponse(
    val chatHistoryId: UUID? = null,
    val message: String,
    val sources: List<String>
)

data class ChatHistoryDto(
    val id: UUID,
    val spaceId: UUID?,
    val spaceName: String?,
    val title: String?,
    val messages: List<DomainChatMessage>,
    val createdAt: Instant,
    val updatedAt: Instant
)

fun ChatHistory.toDto() = ChatHistoryDto(
    id = this.id!!,
    spaceId = this.space?.id,
    spaceName = this.space?.name,
    title = this.title,
    messages = this.messages,
    createdAt = this.createdAt,
    updatedAt = this.updatedAt
)
