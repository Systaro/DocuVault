package com.docuvault.api.documents

import com.docuvault.api.EventStreams
import com.docuvault.config.GlobalExceptionHandler
import com.docuvault.domain.space.Space
import com.docuvault.domain.user.User
import com.docuvault.domain.user.UserRole
import com.docuvault.infrastructure.repository.DocumentRepository
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.AnnotationService
import com.docuvault.service.DocumentLineageService
import com.docuvault.service.DocumentPatchService
import com.docuvault.service.DocumentPersistService
import com.docuvault.service.DocumentTransferService
import com.docuvault.service.FileUploadService
import com.docuvault.service.PermissionService
import com.docuvault.service.ai.DocumentGenerationService
import com.docuvault.service.ai.WritingAssistantService
import com.docuvault.service.embedding.EmbeddingService
import com.docuvault.service.git.GitDiffService
import com.docuvault.service.git.GitService
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import org.mockito.stubbing.Answer
import org.springframework.http.MediaType
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.authority.SimpleGrantedAuthority
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.security.web.method.annotation.AuthenticationPrincipalArgumentResolver
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import org.springframework.test.web.servlet.setup.MockMvcBuilders
import java.nio.file.Files
import java.nio.file.Path
import java.util.*

/**
 * A rename that cannot work is refused with a reason before anything is touched,
 * so the web UI and MCP clients can say why instead of reporting a bare 500.
 */
class DocumentRenameTest {

    @TempDir
    lateinit var repo: Path

    private val user = User(id = UUID.randomUUID(), email = "alice@example.com", passwordHash = "x", name = "Alice", role = UserRole.EDITOR)
    private val space = Space(id = UUID.randomUUID(), name = "Handbook", slug = "handbook", createdBy = user)

    private val userRepository = mock(UserRepository::class.java)
    private val spaceRepository = mock(SpaceRepository::class.java)
    private val permissionService = mock(PermissionService::class.java)

    /** Existence comes from a real temp directory, so the checks run against files, not stubs. */
    private val gitService = mock(GitService::class.java, Answer { inv ->
        when (inv.method.name) {
            "itemExists" -> Files.exists(repo.resolve(inv.arguments[1] as String))
            "isDirectory" -> Files.isDirectory(repo.resolve(inv.arguments[1] as String))
            else -> null
        }
    })

    private val renames = mutableListOf<Pair<String, String>>()
    private val transferService = mock(DocumentTransferService::class.java, Answer { inv ->
        if (inv.method.name == "rename") {
            renames += (inv.arguments[1] as String) to (inv.arguments[2] as String)
            true
        } else null
    })

    private val mockMvc = MockMvcBuilders
        .standaloneSetup(
            DocumentController(
                spaceRepository,
                mock(DocumentRepository::class.java),
                userRepository,
                permissionService,
                gitService,
                mock(GitDiffService::class.java),
                mock(EmbeddingService::class.java),
                mock(WritingAssistantService::class.java),
                mock(DocumentGenerationService::class.java),
                mock(DocumentPersistService::class.java),
                transferService,
                mock(AnnotationService::class.java),
                mock(DocumentPatchService::class.java),
                mock(DocumentLineageService::class.java),
                mock(FileUploadService::class.java),
                mock(EventStreams::class.java)
            )
        )
        .setControllerAdvice(GlobalExceptionHandler())
        .setCustomArgumentResolvers(AuthenticationPrincipalArgumentResolver())
        .build()

    @BeforeEach
    fun files() {
        Files.createDirectories(repo.resolve("guides"))
        Files.writeString(repo.resolve("guides/setup.md"), "# Setup")
        Files.writeString(repo.resolve("faq.md"), "# FAQ")
    }

    private fun signIn(canEdit: Boolean = true) {
        val principal = org.springframework.security.core.userdetails.User(user.email, "", listOf(SimpleGrantedAuthority("ROLE_EDITOR")))
        SecurityContextHolder.getContext().authentication = UsernamePasswordAuthenticationToken(principal, null, principal.authorities)
        `when`(userRepository.findByEmail(user.email)).thenReturn(user)
        `when`(spaceRepository.findById(space.id!!)).thenReturn(Optional.of(space))
        `when`(permissionService.hasEditAccess(user.id!!, space.id!!, user.role)).thenReturn(canEdit)
    }

    @AfterEach
    fun clear() = SecurityContextHolder.clearContext()

    private fun rename(oldPath: String, newPath: String) =
        mockMvc.perform(
            post("/spaces/${space.id}/documents/rename")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"oldPath":"$oldPath","newPath":"$newPath"}""")
        )

    @Test
    fun `a file is renamed and the answer says where it is now`() {
        signIn()
        rename("faq.md", "guides/faq.md")
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.path").value("guides/faq.md"))
            .andExpect(jsonPath("$.isDirectory").value(false))
        assertEquals(listOf("faq.md" to "guides/faq.md"), renames)
    }

    @Test
    fun `a renamed folder is reported as one`() {
        signIn()
        rename("guides", "handbook").andExpect(status().isOk).andExpect(jsonPath("$.isDirectory").value(true))
    }

    @Test
    fun `nothing at the old path is a 404 with a reason`() {
        signIn()
        rename("gone.md", "still-gone.md")
            .andExpect(status().isNotFound)
            .andExpect(jsonPath("$.message").value("'gone.md' does not exist in Handbook."))
        assertTrue(renames.isEmpty())
    }

    @Test
    fun `a taken target is a conflict, never an overwrite`() {
        signIn()
        rename("faq.md", "guides/setup.md")
            .andExpect(status().isConflict)
            .andExpect(jsonPath("$.message").value("'guides/setup.md' already exists in Handbook."))
        assertTrue(renames.isEmpty())
    }

    @Test
    fun `a folder cannot move inside itself and a rename has to change something`() {
        signIn()
        rename("guides", "guides/old").andExpect(status().isBadRequest)
        rename("faq.md", "faq.md").andExpect(status().isBadRequest)
        rename("faq.md", "").andExpect(status().isBadRequest)
        assertTrue(renames.isEmpty())
    }

    @Test
    fun `without edit rights the answer is 403 whether or not the file exists`() {
        signIn(canEdit = false)
        rename("faq.md", "faq-old.md").andExpect(status().isForbidden)
        rename("gone.md", "x.md").andExpect(status().isForbidden)
        assertTrue(renames.isEmpty())
    }
}
