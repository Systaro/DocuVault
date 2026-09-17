package com.docuvault.service.ai

import com.aallam.openai.client.OpenAI
import com.docuvault.config.OpenAIProvider
import com.docuvault.domain.ai.ChatHistory
import com.docuvault.domain.space.Space
import com.docuvault.domain.user.User
import com.docuvault.domain.user.UserRole
import com.docuvault.infrastructure.repository.ChatHistoryRepository
import com.docuvault.infrastructure.repository.DocumentRepository
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.DocumentPersistService
import com.docuvault.service.PermissionService
import com.docuvault.service.embedding.EmbeddingService
import com.docuvault.service.git.GitService
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.mockito.Mockito.mock
import org.mockito.Mockito.verifyNoInteractions
import org.mockito.Mockito.`when`
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException
import java.util.*

/**
 * Who may talk to the assistant about what. Both refusals happen before
 * retrieval, so nothing from the space or the conversation reaches the model.
 */
class ChatAccessTest {

    private val openAIProvider = mock(OpenAIProvider::class.java)
    private val embeddingService = mock(EmbeddingService::class.java)
    private val chatHistoryRepository = mock(ChatHistoryRepository::class.java)
    private val userRepository = mock(UserRepository::class.java)
    private val spaceRepository = mock(SpaceRepository::class.java)
    private val permissionService = mock(PermissionService::class.java)

    private val service = ChatService(
        openAIProvider,
        embeddingService,
        chatHistoryRepository,
        userRepository,
        spaceRepository,
        mock(DocumentRepository::class.java),
        permissionService,
        mock(DocumentPersistService::class.java),
        mock(GitService::class.java)
    )

    private val user = User(id = UUID.randomUUID(), email = "u@x.io", passwordHash = "h", name = "User", role = UserRole.VIEWER)
    private val other = User(id = UUID.randomUUID(), email = "o@x.io", passwordHash = "h", name = "Other")
    private val space = Space(id = UUID.randomUUID(), name = "Docs", slug = "docs", createdBy = other)

    init {
        `when`(openAIProvider.getClient()).thenReturn(mock(OpenAI::class.java))
        `when`(userRepository.findByEmail(user.email)).thenReturn(user)
        `when`(spaceRepository.findById(space.id!!)).thenReturn(Optional.of(space))
    }

    @Test
    fun `a space the user cannot read is reported as not found`() {
        `when`(permissionService.readableRepositoryIds(user.id!!, user.role, space.id!!)).thenReturn(emptyList())

        val error = assertThrows<ResponseStatusException> { service.chat(user.email, space.id!!, "what is in here?") }

        assertEquals(HttpStatus.NOT_FOUND, error.statusCode)
        verifyNoInteractions(embeddingService, chatHistoryRepository)
    }

    @Test
    fun `another user's conversation cannot be continued`() {
        `when`(permissionService.readableRepositoryIds(user.id!!, user.role, space.id!!)).thenReturn(listOf(space.id!!))
        val foreign = ChatHistory(id = UUID.randomUUID(), user = other, space = space, title = "private")
        `when`(chatHistoryRepository.findById(foreign.id!!)).thenReturn(Optional.of(foreign))

        val error = assertThrows<ResponseStatusException> {
            service.chat(user.email, space.id!!, "what did we talk about?", foreign.id)
        }

        assertEquals(HttpStatus.NOT_FOUND, error.statusCode)
        verifyNoInteractions(embeddingService)
    }
}
