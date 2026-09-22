package com.docuvault.service.ai

import com.docuvault.config.OpenAIProvider
import com.docuvault.domain.ai.AssistantAttachment
import com.docuvault.domain.ai.AttachmentKind
import com.docuvault.domain.space.Space
import com.docuvault.domain.space.SpaceType
import com.docuvault.domain.user.User
import com.docuvault.domain.user.UserRole
import com.docuvault.infrastructure.repository.AssistantAttachmentRepository
import com.docuvault.infrastructure.repository.DocumentRepository
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.DocumentPersistService
import com.docuvault.service.FileUploadService
import com.docuvault.service.PermissionService
import com.docuvault.service.embedding.EmbeddingService
import com.docuvault.service.git.GitService
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.mockito.Mockito.`when`
import org.mockito.Mockito.mock
import org.mockito.Mockito.verifyNoInteractions
import org.springframework.http.HttpStatus
import org.springframework.mock.web.MockMultipartFile
import org.springframework.web.server.ResponseStatusException
import software.amazon.awssdk.services.s3.S3Client
import java.util.*

/** Files stay with the person who uploaded them and reach a space only where that person may write. */
class AttachmentServiceTest {

    private val repository = mock(AssistantAttachmentRepository::class.java)
    private val userRepository = mock(UserRepository::class.java)
    private val spaceRepository = mock(SpaceRepository::class.java)
    private val permissionService = mock(PermissionService::class.java)
    private val gitService = mock(GitService::class.java)
    private val s3 = mock(S3Client::class.java)

    // Real path cleaning; storing and committing are never reached in these tests.
    private val fileUploadService = FileUploadService(
        gitService, mock(DocumentRepository::class.java), mock(EmbeddingService::class.java), mock(DocumentPersistService::class.java)
    )

    private val service = AttachmentService(
        repository, userRepository, spaceRepository, permissionService, gitService,
        fileUploadService, mock(OpenAIProvider::class.java), s3, "attachments"
    )

    private val owner = User(id = UUID.randomUUID(), email = "o@x.io", passwordHash = "h", name = "Owner", role = UserRole.EDITOR)
    private val space = Space(id = UUID.randomUUID(), name = "Office", slug = "office", createdBy = owner, type = SpaceType.REPOSITORY)

    init {
        `when`(userRepository.findByEmail(owner.email)).thenReturn(owner)
    }

    private fun attachment(conversationId: UUID? = null) = AssistantAttachment(
        id = UUID.randomUUID(), user = owner, conversationId = conversationId, fileName = "note.jpg",
        contentType = "image/jpeg", sizeBytes = 10, kind = AttachmentKind.IMAGE, storageKey = "k"
    )

    private fun status(block: () -> Unit): HttpStatus =
        HttpStatus.valueOf(assertThrows<ResponseStatusException> { block() }.statusCode.value())

    @Test
    fun `someone else's file cannot be sent with a message`() {
        val id = UUID.randomUUID()
        `when`(repository.findByIdInAndUserId(listOf(id), owner.id!!)).thenReturn(emptyList())
        assertEquals(HttpStatus.NOT_FOUND, status { service.attach(owner, UUID.randomUUID(), listOf(id)) })
    }

    @Test
    fun `a file already sent in one conversation cannot move to another`() {
        val sent = attachment(conversationId = UUID.randomUUID())
        `when`(repository.findByIdInAndUserId(listOf(sent.id!!), owner.id!!)).thenReturn(listOf(sent))
        assertEquals(HttpStatus.CONFLICT, status { service.attach(owner, UUID.randomUUID(), listOf(sent.id!!)) })
    }

    @Test
    fun `sending binds the file to the conversation`() {
        val fresh = attachment()
        val conversation = UUID.randomUUID()
        `when`(repository.findByIdInAndUserId(listOf(fresh.id!!), owner.id!!)).thenReturn(listOf(fresh))
        `when`(repository.save(fresh)).thenReturn(fresh)
        assertEquals(conversation, service.attach(owner, conversation, listOf(fresh.id!!)).single().conversationId)
    }

    @Test
    fun `unsupported files and too many files are refused before anything is stored`() {
        val program = MockMultipartFile("files", "setup.exe", "application/octet-stream", byteArrayOf(0x4D, 0x5A, 0))
        assertEquals(HttpStatus.UNSUPPORTED_MEDIA_TYPE, status { service.upload(owner.email, listOf(program)) })

        val text = MockMultipartFile("files", "a.txt", "text/plain", "hi".toByteArray())
        assertEquals(HttpStatus.BAD_REQUEST, status { service.upload(owner.email, List(AttachmentService.MAX_FILES_PER_MESSAGE + 1) { text }) })
        verifyNoInteractions(s3)
    }

    @Test
    fun `keeping a file in a space needs edit access and never replaces an existing file`() {
        val file = attachment()
        `when`(repository.findByIdAndUserId(file.id!!, owner.id!!)).thenReturn(file)
        `when`(spaceRepository.findById(space.id!!)).thenReturn(Optional.of(space))

        `when`(permissionService.hasEditAccess(owner.id!!, space.id!!, owner.role)).thenReturn(false)
        assertEquals(HttpStatus.FORBIDDEN, status { service.saveToSpace(owner.email, file.id!!, space.id!!, "notes/note.jpg") })

        `when`(permissionService.hasEditAccess(owner.id!!, space.id!!, owner.role)).thenReturn(true)
        `when`(gitService.readFile(space, "notes/note.jpg")).thenReturn("existing")
        assertEquals(HttpStatus.CONFLICT, status { service.saveToSpace(owner.email, file.id!!, space.id!!, "notes/note.jpg") })
    }
}
