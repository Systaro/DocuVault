package com.docuvault.api.shares

import com.docuvault.config.GlobalExceptionHandler
import com.docuvault.domain.space.ShareType
import com.docuvault.domain.space.SharedLink
import com.docuvault.domain.space.Space
import com.docuvault.domain.user.User
import com.docuvault.domain.user.UserRole
import com.docuvault.service.AnnotationService
import com.docuvault.service.ShareAccessTokenService
import com.docuvault.service.ShareAssetResolver
import com.docuvault.service.SharedLinkService
import com.docuvault.service.branding.BrandingService
import com.docuvault.service.git.GitService
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import org.mockito.stubbing.Answer
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.content
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import org.springframework.test.web.servlet.setup.MockMvcBuilders
import java.nio.file.Files
import java.nio.file.Path
import java.util.UUID

/**
 * A shared image or Word document must open like any other share. Reading such a
 * file as UTF-8 text for the link preview threw, and every one of them answered
 * with a 500 instead of the viewer.
 */
class PublicShareBinaryFileTest {

    @TempDir
    lateinit var repo: Path

    private val owner = User(id = UUID.randomUUID(), email = "alice@example.com", passwordHash = "x", name = "Alice", role = UserRole.EDITOR)
    private val space = Space(id = UUID.randomUUID(), name = "Handbook", slug = "handbook", createdBy = owner)

    private val sharedLinkService = mock(SharedLinkService::class.java)
    private val brandingService = mock(BrandingService::class.java)

    /** Reads go to a real directory, so a binary fails exactly the way it does on disk. */
    private val gitService = mock(GitService::class.java, Answer { inv ->
        when (inv.method.name) {
            "getContentRoot" -> repo
            "readFile" -> repo.resolve(inv.arguments[1] as String).takeIf { Files.isRegularFile(it) }?.let { Files.readString(it) }
            else -> null
        }
    })

    private val mockMvc = MockMvcBuilders
        .standaloneSetup(
            PublicShareController(
                sharedLinkService,
                gitService,
                mock(ShareAccessTokenService::class.java),
                mock(AnnotationService::class.java),
                mock(ShareAssetResolver::class.java),
                brandingService
            )
        )
        .setControllerAdvice(GlobalExceptionHandler())
        .build()

    /** Not valid UTF-8: the PNG signature starts with 0x89. */
    private val pngBytes = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0xFF.toByte(), 0xFE.toByte())

    @BeforeEach
    fun files() {
        Files.createDirectories(repo.resolve("docs"))
        Files.write(repo.resolve("docs/diagram.png"), pngBytes)
        Files.write(repo.resolve("docs/brief.docx"), byteArrayOf(0x50, 0x4B, 0x03, 0x04, 0xC3.toByte(), 0x28))
        Files.writeString(repo.resolve("docs/guide.md"), "# Getting started\n\nInstall it, then run it.\n")
        `when`(brandingService.appName()).thenReturn("Docs")
    }

    private fun share(path: String): String {
        val token = UUID.randomUUID().toString().replace("-", "")
        val link = SharedLink(token = token, space = space, filePath = path, createdBy = owner, shareType = ShareType.FILE)
        `when`(sharedLinkService.findActiveByToken(token)).thenReturn(link)
        return token
    }

    @Test
    fun `a shared image opens`() {
        val token = share("docs/diagram.png")
        mockMvc.perform(get("/shared/$token"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.fileName").value("diagram.png"))
            .andExpect(jsonPath("$.contentType").value("image/png"))
    }

    @Test
    fun `a shared Word document opens`() {
        val token = share("docs/brief.docx")
        mockMvc.perform(get("/shared/$token"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.fileName").value("brief.docx"))
            .andExpect(jsonPath("$.requiresPassword").value(false))
    }

    @Test
    fun `the crawler preview of a binary share still renders`() {
        val token = share("docs/brief.docx")
        mockMvc.perform(get("/shared/$token/og"))
            .andExpect(status().isOk)
            .andExpect(content().string(org.hamcrest.Matchers.containsString("brief")))
    }

    @Test
    fun `asking for a binary file as text is refused, not a crash`() {
        val token = share("docs/diagram.png")
        mockMvc.perform(get("/shared/$token/content"))
            .andExpect(status().isUnsupportedMediaType)
    }

    @Test
    fun `a markdown share keeps its title in the link preview`() {
        val token = share("docs/guide.md")
        mockMvc.perform(get("/shared/$token"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.ogTitle").value("Getting started"))
            .andExpect(jsonPath("$.ogDescription").value("Install it, then run it."))
    }
}
