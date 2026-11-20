package com.docuvault.office

import com.docuvault.domain.space.Space
import com.docuvault.domain.user.User
import com.docuvault.domain.user.UserRole
import com.docuvault.infrastructure.repository.DocumentRepository
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.DocumentPersistService
import com.docuvault.service.embedding.EmbeddingService
import com.docuvault.service.FileUploadService
import com.docuvault.service.PermissionService
import com.docuvault.service.git.GitService
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.sun.net.httpserver.HttpServer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.ArgumentMatchers.anyString
import org.mockito.ArgumentMatchers.eq
import org.mockito.Mockito.mock
import org.mockito.Mockito.never
import org.mockito.Mockito.verify
import org.mockito.Mockito.`when`
import java.net.InetSocketAddress
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.Optional
import java.util.UUID

class OfficeServiceTest {
    private val secret = "test-secret-with-enough-length"
    private val json = ObjectMapper()

    private val alice = User(id = UUID.randomUUID(), email = "alice@example.com", passwordHash = "x", name = "Alice", role = UserRole.EDITOR)
    private val carol = User(id = UUID.randomUUID(), email = "carol@example.com", passwordHash = "x", name = "Carol", role = UserRole.VIEWER)
    private val space = Space(id = UUID.randomUUID(), name = "Handbook", slug = "handbook", createdBy = alice)
    private val path = "contracts/brief.docx"
    private val original = docx("<w:t>first</w:t>")
    private val edited = docx("<w:t>second</w:t>")

    /** A minimal Office archive; [stamp] changes the zip metadata only. */
    private fun docx(body: String, stamp: Long = 0L): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        java.util.zip.ZipOutputStream(out).use { zip ->
            for ((name, content) in listOf("[Content_Types].xml" to "<Types/>", "word/document.xml" to body)) {
                zip.putNextEntry(java.util.zip.ZipEntry(name).apply { time = 946684800000L + stamp })
                zip.write(content.toByteArray())
                zip.closeEntry()
            }
        }
        return out.toByteArray()
    }

    /** Stands in for the document server's file cache. */
    private val docServer = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
        createContext("/cache/files/") { exchange ->
            exchange.sendResponseHeaders(200, edited.size.toLong())
            exchange.responseBody.use { it.write(edited) }
        }
        start()
    }

    private val userRepository = mock(UserRepository::class.java)
    private val spaceRepository = mock(SpaceRepository::class.java)
    private val permissionService = mock(PermissionService::class.java)
    private val gitService = mock(GitService::class.java)
    private val persist = DocumentPersistService(
        mock(DocumentRepository::class.java), spaceRepository, gitService, mock(EmbeddingService::class.java)
    )
    private val uploads = FileUploadService(gitService, mock(DocumentRepository::class.java), mock(EmbeddingService::class.java), persist)

    private val service = OfficeService(
        OfficeSettings("/office", secret, "http://backend:7030/api", "http://127.0.0.1:${docServer.address.port}"),
        spaceRepository, userRepository, permissionService, uploads, persist, gitService
    )

    init {
        `when`(spaceRepository.findById(space.id!!)).thenReturn(Optional.of(space))
        for (u in listOf(alice, carol)) {
            `when`(userRepository.findById(u.id!!)).thenReturn(Optional.of(u))
            `when`(permissionService.hasEditAccess(u.id!!, space.id!!, u.role)).thenReturn(u.role != UserRole.VIEWER)
        }
        `when`(gitService.writeBinaryFile(any() ?: space, anyString(), any() ?: edited)).thenReturn(true)
    }

    @AfterEach
    fun stop() = docServer.stop(0)

    private fun config(bytes: ByteArray = original): JsonNode =
        json.valueToTree(service.editorConfig(space, path, bytes, alice, dark = false))

    private fun key(config: JsonNode) = config.path("document").path("key").asText()

    /** The `t` parameter of one of the links in the configuration. */
    private fun tokenOf(url: String): String =
        URLDecoder.decode(URI(url).rawQuery.removePrefix("t="), StandardCharsets.UTF_8)

    /** A callback as the document server sends it: the body signed into its own token. */
    private fun callback(config: JsonNode, status: Int, user: User = alice): Int {
        val body = mapOf(
            "key" to key(config),
            "status" to status,
            "users" to listOf(user.id.toString()),
            "url" to "https://docs.example.com/office/cache/files/data/${key(config)}/output.docx?md5=abc"
        )
        val signed = json.valueToTree<JsonNode>(body + ("token" to OfficeJwt.sign(body, secret)))
        return service.handleCallback(tokenOf(config.path("editorConfig").path("callbackUrl").asText()), signed, null)
    }

    @Test
    fun `the configuration is signed for the document server`() {
        val config = config()
        val claims = OfficeJwt.verify(config.path("token").asText(), secret)!!
        assertEquals(key(config), claims.path("document").path("key").asText())
        assertEquals(alice.id.toString(), claims.path("editorConfig").path("user").path("id").asText())
        assertTrue(claims.path("document").path("url").asText().startsWith("http://backend:7030/api/office/file?t="))
    }

    @Test
    fun `editors of the same file share one session, also after a save from inside it`() {
        val first = config()
        assertEquals(key(first), key(config()))

        // Ctrl+S in the editor: the file changes, the session goes on.
        assertEquals(0, callback(first, 6))
        assertEquals(key(first), key(config(edited)))
        assertTrue(service.sessionOpen(OfficeService.DocRef(space.id!!, path)))

        // Everyone left and the final save arrived: the next editor starts afresh.
        assertEquals(0, callback(first, 2))
        assertFalse(service.sessionOpen(OfficeService.DocRef(space.id!!, path)))
        assertNotEquals(key(first), key(config(edited)))
    }

    @Test
    fun `a save writes the edited file and commits it as the editor`() {
        assertEquals(0, callback(config(), 2))
        verify(gitService).writeBinaryFile(space, path, edited)
        verify(gitService).commitAndPush(
            eq(space) ?: space, eq("Edit brief.docx in the office editor") ?: "", eq("Alice") ?: "",
            eq("alice@example.com") ?: "", any() ?: {}
        )
    }

    @Test
    fun `a save that changes nothing but the archive's timestamps is not committed`() {
        `when`(gitService.readBinaryFile(space, path)).thenReturn(docx("<w:t>second</w:t>", stamp = 86_400_000L))
        assertTrue(OfficeService.sameZipContent(edited, docx("<w:t>second</w:t>", stamp = 86_400_000L)))
        assertFalse(OfficeService.sameZipContent(original, edited))

        assertEquals(0, callback(config(), 2))
        verify(gitService, never()).writeBinaryFile(any() ?: space, anyString(), any() ?: edited)
    }

    @Test
    fun `an unsigned callback or one from someone without write access saves nothing`() {
        val config = config()
        val unsigned = json.valueToTree<JsonNode>(mapOf("status" to 2, "users" to listOf(alice.id.toString()), "url" to "http://x/cache/files/a"))
        assertEquals(1, service.handleCallback(tokenOf(config.path("editorConfig").path("callbackUrl").asText()), unsigned, null))

        assertEquals(1, callback(config, 2, user = carol))
        verify(gitService, never()).writeBinaryFile(any() ?: space, anyString(), any() ?: edited)
    }

    @Test
    fun `a file link is not accepted as a callback link`() {
        val config = config()
        val fileToken = tokenOf(config.path("document").path("url").asText())
        assertEquals(space.id, service.fileRef(fileToken)?.spaceId)
        val body = mapOf("status" to 2, "users" to listOf(alice.id.toString()), "url" to "http://x/cache/files/a")
        val signed = json.valueToTree<JsonNode>(body + ("token" to OfficeJwt.sign(body, secret)))
        assertEquals(1, service.handleCallback(fileToken, signed, null))
    }
}
