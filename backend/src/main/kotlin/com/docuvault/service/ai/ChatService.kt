package com.docuvault.service.ai

import com.aallam.openai.api.chat.ChatCompletionRequest
import com.aallam.openai.api.chat.ChatMessage
import com.aallam.openai.api.chat.ChatRole
import com.aallam.openai.api.model.ModelId
import com.docuvault.config.OpenAIProvider
import com.docuvault.domain.ai.ChatHistory
import com.docuvault.infrastructure.repository.ChatHistoryRepository
import com.docuvault.infrastructure.repository.DocumentRepository
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.embedding.EmbeddingService
import kotlinx.coroutines.runBlocking
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
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
    private val documentRepository: DocumentRepository
) {
    private val logger = LoggerFactory.getLogger(ChatService::class.java)

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

        val space = spaceRepository.findById(spaceId).orElse(null)
            ?: throw IllegalArgumentException("Space not found")

        // Retrieve relevant context using semantic search
        val relevantChunks = embeddingService.findSimilar(spaceId, message, limit = 5)
        val context = relevantChunks.joinToString("\n\n") { chunk ->
            "From ${chunk.documentPath}:\n${chunk.content}"
        }

        // Load or create chat history
        val chatHistory = chatHistoryId?.let { chatHistoryRepository.findById(it).orElse(null) }
            ?: ChatHistory(
                user = user,
                space = space,
                title = message.take(50)
            )

        // Build space metadata for context
        val documents = documentRepository.findBySpaceId(spaceId)
        val spaceInfo = buildSpaceInfo(space, documents.map { it.title ?: it.path })

        // Build conversation messages
        val messages = buildMessages(chatHistory, message, context, spaceInfo)

        // Call OpenAI
        val response = runBlocking {
            try {
                val completion = openAI.chatCompletion(
                    ChatCompletionRequest(
                        model = ModelId(openAIProvider.getChatModel()),
                        messages = messages
                    )
                )
                completion.choices.firstOrNull()?.message?.content ?: "I couldn't generate a response."
            } catch (e: Exception) {
                logger.error("Chat completion failed", e)
                "An error occurred while processing your request: ${e.message}"
            }
        }

        // Save to chat history
        val sources = relevantChunks.map { it.documentPath }.distinct()
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

    private fun buildSpaceInfo(space: com.docuvault.domain.space.Space, documentTitles: List<String>): String {
        val sb = StringBuilder()
        sb.appendLine("Project: ${space.name}")
        if (!space.description.isNullOrBlank()) {
            sb.appendLine("Description: ${space.description}")
        }
        sb.appendLine("Branch: ${space.branch}")
        sb.appendLine("Documents (${documentTitles.size}):")
        documentTitles.forEach { sb.appendLine("  - $it") }
        return sb.toString()
    }

    private fun buildMessages(
        chatHistory: ChatHistory,
        newMessage: String,
        context: String,
        spaceInfo: String
    ): List<ChatMessage> {
        val messages = mutableListOf<ChatMessage>()

        // System message
        messages.add(
            ChatMessage(
                role = ChatRole.System,
                content = """You are a helpful documentation assistant for the "${chatHistory.space?.name ?: "documentation"}" project.
                |
                |Here is an overview of this project:
                |$spaceInfo
                |
                |Your job is to answer questions about the documentation based on the project info and context provided.
                |Be concise and helpful. If you don't have enough detail to answer a specific question, summarize what you do know about the project from the available documents.
                |When referencing documentation, mention the source document.
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
