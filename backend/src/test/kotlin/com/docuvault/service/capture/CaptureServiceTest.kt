package com.docuvault.service.capture

import com.docuvault.config.OpenAIProvider
import com.docuvault.domain.space.Space
import com.docuvault.domain.space.SpaceType
import com.docuvault.domain.user.User
import com.docuvault.domain.user.UserRole
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.PermissionService
import com.docuvault.service.embedding.CrossSpaceChunk
import com.docuvault.service.embedding.EmbeddingService
import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.mockito.Mockito.verifyNoInteractions
import org.mockito.Mockito.`when`
import java.time.LocalDate
import java.util.*

/** The decisions around a quick note that do not depend on what a model says. */
class CaptureServiceTest {

    private val openAIProvider = mock(OpenAIProvider::class.java)
    private val embeddingService = mock(EmbeddingService::class.java)
    private val permissionService = mock(PermissionService::class.java)
    private val userRepository = mock(UserRepository::class.java)
    private val objectMapper = ObjectMapper()

    private val service = CaptureService(openAIProvider, embeddingService, permissionService, userRepository, objectMapper)

    private val user = User(id = UUID.randomUUID(), email = "anna@x.io", passwordHash = "h", name = "Anna Berg", role = UserRole.EDITOR)
    private val colleague = User(id = UUID.randomUUID(), email = "tom@x.io", passwordHash = "h", name = "Tom Klein")
    private fun repo(name: String) = Space(id = UUID.randomUUID(), name = name, slug = name.lowercase(), type = SpaceType.REPOSITORY, createdBy = user)
    private val office = repo("Office")
    private val sales = repo("Sales")
    private val secret = repo("Secret")

    private fun chunk(space: Space) = CrossSpaceChunk(UUID.randomUUID(), "doc.md", null, 0, "text", space.id!!)

    @Test
    fun `a space the model names but the user cannot write to is ignored`() {
        assertEquals(sales, service.chooseSpace(secret.id.toString(), listOf(chunk(sales)), listOf(office, sales)))
    }

    @Test
    fun `the model's pick wins when it is a candidate`() {
        assertEquals(sales, service.chooseSpace(sales.id.toString(), listOf(chunk(office)), listOf(office, sales)))
    }

    @Test
    fun `without a pick or a related document the first writable space is used`() {
        assertEquals(office, service.chooseSpace(null, listOf(chunk(secret)), listOf(office, sales)))
    }

    @Test
    fun `tasks resolve me, members and dates and keep an unknown owner as text`() {
        val mine = service.toTask(objectMapper.readTree("""{"title":"Call the landlord","dueDate":"2026-10-02","assignee":"me"}"""), user, listOf(colleague))!!
        assertEquals(user.id, mine.assigneeId)
        assertEquals(LocalDate.of(2026, 10, 2), mine.dueDate)

        assertEquals(colleague.id, service.toTask(objectMapper.readTree("""{"title":"Send slides","assignee":"Tom"}"""), user, listOf(colleague))!!.assigneeId)

        val unknown = service.toTask(objectMapper.readTree("""{"title":"Book the room","assignee":"Petra","dueDate":"soon"}"""), user, listOf(colleague))!!
        assertNull(unknown.assigneeId)
        assertEquals("Petra", unknown.assigneeName)
        assertNull(unknown.dueDate)

        assertNull(service.toTask(objectMapper.readTree("""{"title":"  "}"""), user, emptyList()))
    }

    @Test
    fun `without AI the note still gets a space and nothing is sent anywhere`() {
        `when`(userRepository.findByEmail(user.email)).thenReturn(user)
        `when`(permissionService.getAccessibleSpaces(user.id!!, user.role)).thenReturn(listOf(sales, office))
        `when`(permissionService.hasEditAccess(user.id!!, office.id!!, user.role)).thenReturn(true)
        `when`(openAIProvider.isConfigured()).thenReturn(false)

        val suggestion = service.suggest(user.email, "<p>Remember to renew the parking permit</p>")

        assertEquals(office.id, suggestion.space?.id)
        assertFalse(suggestion.aiUsed)
        verifyNoInteractions(embeddingService)
    }
}
