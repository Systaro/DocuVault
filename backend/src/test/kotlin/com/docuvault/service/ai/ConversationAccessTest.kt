package com.docuvault.service.ai

import com.docuvault.config.OpenAIProvider
import com.docuvault.domain.ai.Conversation
import com.docuvault.domain.space.Space
import com.docuvault.domain.user.User
import com.docuvault.domain.user.UserRole
import com.docuvault.infrastructure.repository.ConversationMessageRepository
import com.docuvault.infrastructure.repository.ConversationRepository
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.PermissionService
import com.docuvault.service.embedding.EmbeddingService
import com.docuvault.service.git.GitService
import com.docuvault.service.tools.ToolRegistry
import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.mockito.Mockito.mock
import org.mockito.Mockito.verifyNoInteractions
import org.mockito.Mockito.`when`
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException
import java.util.*

/**
 * Who may talk to the assistant about what. Every refusal happens before a
 * message is stored or anything is retrieved, so nothing from the space or the
 * conversation reaches the model.
 */
class ConversationAccessTest {

    private val openAIProvider = mock(OpenAIProvider::class.java)
    private val embeddingService = mock(EmbeddingService::class.java)
    private val conversationRepository = mock(ConversationRepository::class.java)
    private val messageRepository = mock(ConversationMessageRepository::class.java)
    private val userRepository = mock(UserRepository::class.java)
    private val spaceRepository = mock(SpaceRepository::class.java)
    private val permissionService = mock(PermissionService::class.java)

    private val service = ConversationService(
        openAIProvider,
        embeddingService,
        conversationRepository,
        messageRepository,
        userRepository,
        spaceRepository,
        permissionService,
        mock(GitService::class.java),
        mock(ToolRegistry::class.java),
        ObjectMapper()
    )

    private val user = User(id = UUID.randomUUID(), email = "u@x.io", passwordHash = "h", name = "User", role = UserRole.VIEWER)
    private val other = User(id = UUID.randomUUID(), email = "o@x.io", passwordHash = "h", name = "Other")
    private val space = Space(id = UUID.randomUUID(), name = "Docs", slug = "docs", createdBy = other)

    init {
        `when`(openAIProvider.isConfigured()).thenReturn(true)
        `when`(userRepository.findByEmail(user.email)).thenReturn(user)
        `when`(spaceRepository.findById(space.id!!)).thenReturn(Optional.of(space))
    }

    @Test
    fun `a space the user cannot read is reported as not found and nothing is stored`() {
        `when`(permissionService.readableRepositoryIds(user.id!!, user.role, space.id!!)).thenReturn(emptyList())

        val error = assertThrows<ResponseStatusException> {
            service.prepareTurn(user.email, space.id, null, null, "what is in here?")
        }

        assertEquals(HttpStatus.NOT_FOUND, error.statusCode)
        verifyNoInteractions(messageRepository, embeddingService)
    }

    @Test
    fun `another user's conversation cannot be continued, read or deleted`() {
        val foreign = Conversation(id = UUID.randomUUID(), user = other, space = space, title = "private")
        `when`(conversationRepository.findById(foreign.id!!)).thenReturn(Optional.of(foreign))

        val continued = assertThrows<ResponseStatusException> {
            service.prepareTurn(user.email, null, foreign.id, null, "what did we talk about?")
        }
        val read = assertThrows<ResponseStatusException> { service.get(user.email, foreign.id!!) }
        val deleted = assertThrows<ResponseStatusException> { service.delete(user.email, foreign.id!!) }

        listOf(continued, read, deleted).forEach { assertEquals(HttpStatus.NOT_FOUND, it.statusCode) }
        verifyNoInteractions(messageRepository, embeddingService)
    }

    @Test
    fun `titles come from the first line and stop at a word`() {
        assertEquals("How do we deploy?", ConversationService.titleFor("\n  How do we deploy?\nMore detail"))
        val long = ConversationService.titleFor("word ".repeat(40))
        assertTrue(long.length <= 83 && long.endsWith("..."), long)
    }

    @Test
    fun `search input cannot smuggle in LIKE wildcards`() {
        assertEquals("100\\% done\\_now", ConversationService.escapeLike("100% done_now"))
    }
}
