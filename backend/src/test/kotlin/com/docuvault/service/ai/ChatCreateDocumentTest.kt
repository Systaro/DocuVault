package com.docuvault.service.ai

import com.docuvault.config.OpenAIProvider
import com.docuvault.domain.space.Document
import com.docuvault.domain.space.Space
import com.docuvault.domain.user.User
import com.docuvault.infrastructure.repository.ChatHistoryRepository
import com.docuvault.infrastructure.repository.DocumentRepository
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.DocumentPersistService
import com.docuvault.service.PermissionService
import com.docuvault.service.embedding.EmbeddingService
import com.docuvault.service.git.GitService
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.mockito.Mockito.verifyNoInteractions
import org.mockito.Mockito.`when`
import java.util.*

/**
 * The rules around the assistant writing files. The model decides *whether* to
 * call the tool; these are the guarantees that hold whatever it decides — that
 * it cannot write outside the space, cannot overwrite, and cannot report a
 * success that never happened.
 *
 * Stubs use exact arguments rather than matchers: Mockito's `any()` returns null,
 * which trips Kotlin's non-null parameter checks on these signatures.
 */
class ChatCreateDocumentTest {

    private val gitService = mock(GitService::class.java)
    private val documentPersistService = mock(DocumentPersistService::class.java)

    private val service = ChatService(
        mock(OpenAIProvider::class.java),
        mock(EmbeddingService::class.java),
        mock(ChatHistoryRepository::class.java),
        mock(UserRepository::class.java),
        mock(SpaceRepository::class.java),
        mock(DocumentRepository::class.java),
        mock(PermissionService::class.java),
        documentPersistService,
        gitService
    )

    private val space = Space(
        id = UUID.randomUUID(),
        name = "Product Handbook",
        slug = "product-handbook-docs",
        createdBy = mock(User::class.java)
    )
    private val user = mock(User::class.java)

    @Test
    fun `writes the document and reports the path it used`() {
        val path = "projekt-management/systemtechnik/security.md"
        val body = "# Security\n\nbody"
        val doc = mock(Document::class.java)
        `when`(doc.path).thenReturn(path)
        `when`(gitService.itemExists(space, path)).thenReturn(false)
        `when`(
            documentPersistService.persistDocument(
                space, user, path, body, "Security", true, "Create $path via AI chat"
            )
        ).thenReturn(doc)
        val created = mutableListOf<String>()

        val result = service.createDocument(space, user, path, "Security", body, created)

        assertTrue(result.startsWith("Created"), result)
        assertEquals(listOf(path), created)
    }

    @Test
    fun `refuses to overwrite a document that already exists`() {
        `when`(gitService.itemExists(space, "docs/existing.md")).thenReturn(true)
        val created = mutableListOf<String>()

        val result = service.createDocument(space, user, "docs/existing.md", null, "body", created)

        assertTrue(result.startsWith("Refused"), result)
        assertTrue(created.isEmpty())
        verifyNoInteractions(documentPersistService)
    }

    @Test
    fun `refuses empty content rather than creating a blank file`() {
        val created = mutableListOf<String>()

        val result = service.createDocument(space, user, "docs/empty.md", null, "   ", created)

        assertTrue(result.startsWith("Refused"), result)
        assertTrue(created.isEmpty())
        verifyNoInteractions(documentPersistService)
    }

    @Test
    fun `reports a failure instead of claiming success when the write fails`() {
        // persistDocument is left unstubbed, so it returns null — a failed write.
        `when`(gitService.itemExists(space, "docs/x.md")).thenReturn(false)
        val created = mutableListOf<String>()

        val result = service.createDocument(space, user, "docs/x.md", null, "body", created)

        assertTrue(result.startsWith("Failed"), result)
        assertTrue(created.isEmpty(), "a failed write must not be reported as a source")
    }

    // --- path handling -----------------------------------------------------

    @Test
    fun `keeps a normal path and its folders`() {
        assertEquals("a/b/c.md", service.sanitizeDocumentPath("a/b/c.md"))
    }

    @Test
    fun `adds a markdown extension when none was given`() {
        assertEquals("notes/plan.md", service.sanitizeDocumentPath("notes/plan"))
    }

    @Test
    fun `strips traversal segments instead of escaping the space`() {
        assertEquals("etc/passwd.md", service.sanitizeDocumentPath("../../etc/passwd"))
        assertEquals("a/b.md", service.sanitizeDocumentPath("a/../b"))
    }

    @Test
    fun `drops windows drive letters and backslashes`() {
        assertEquals("Users/x/note.md", service.sanitizeDocumentPath("C:\\Users\\x\\note.md"))
    }

    @Test
    fun `rejects a path that names nothing`() {
        assertNull(service.sanitizeDocumentPath(""))
        assertNull(service.sanitizeDocumentPath("   "))
        assertNull(service.sanitizeDocumentPath("../.."))
    }

    @Test
    fun `rejects a hidden path so repository plumbing stays out of reach`() {
        assertNull(service.sanitizeDocumentPath(".git/config"))
    }
}
