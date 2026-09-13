package com.docuvault.api.transfers

import com.docuvault.config.GlobalExceptionHandler
import com.docuvault.domain.space.Space
import com.docuvault.domain.user.User
import com.docuvault.domain.user.UserRole
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.FileUploadService
import com.docuvault.service.PermissionService
import com.docuvault.service.StoredFile
import com.docuvault.service.TransferKind
import com.docuvault.service.TransferTicket
import com.docuvault.service.TransferTicketService
import com.docuvault.service.git.GitService
import org.junit.jupiter.api.AfterEach
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
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.content
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.header
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import org.springframework.test.web.servlet.setup.MockMvcBuilders
import java.nio.file.Files
import java.nio.file.Path
import java.util.*

class TransferControllerTest {

    @TempDir
    lateinit var repos: Path

    private val user = User(id = UUID.randomUUID(), email = "anna@example.com", passwordHash = "x", name = "Anna", role = UserRole.EDITOR)
    private val space = Space(id = UUID.randomUUID(), name = "Docs", slug = "docs", createdBy = user)

    /** In-memory stand-in for Redis: single use, like the real thing. */
    private val issued = mutableMapOf<String, TransferTicket>()
    private val tickets: TransferTicketService = mock(TransferTicketService::class.java, Answer { inv ->
        when (inv.method.name) {
            "issue" -> "tok-${issued.size}".also { issued[it] = inv.arguments[0] as TransferTicket }
            "redeem" -> issued.remove(inv.arguments[0] as String)
            else -> null
        }
    })
    private val userRepository = mock(UserRepository::class.java)
    private val spaceRepository = mock(SpaceRepository::class.java)
    private val permissionService = mock(PermissionService::class.java)
    private val commits = mutableListOf<List<*>>()
    private val fileUploadService = mock(FileUploadService::class.java, Answer { inv ->
        when (inv.method.name) {
            "commit" -> { commits += inv.arguments[1] as List<*>; null }
            "sanitizeRelativePath" -> (inv.arguments[0] as String?)?.trim('/')?.takeIf { it.isNotBlank() && !it.contains("..") }
            "store" -> {
                val bytes = inv.arguments[2] as ByteArray
                val path = inv.arguments[1] as String
                Files.createDirectories(repos.resolve(space.id.toString()).resolve(path).parent)
                Files.write(repos.resolve(space.id.toString()).resolve(path), bytes)
                StoredFile(path, path.substringAfterLast('/'), bytes.size)
            }
            else -> null
        }
    })
    private val gitService = mock(GitService::class.java, Answer { inv ->
        if (inv.method.name == "getRepoPath") repos.resolve((inv.arguments[0] as UUID).toString()) else null
    })

    private val mockMvc = MockMvcBuilders
        .standaloneSetup(TransferController(tickets, userRepository, spaceRepository, permissionService, fileUploadService, gitService, "https://docs.example.com"))
        .setControllerAdvice(GlobalExceptionHandler())
        .setCustomArgumentResolvers(AuthenticationPrincipalArgumentResolver())
        .build()

    private fun signIn(canEdit: Boolean) {
        val principal = org.springframework.security.core.userdetails.User(user.email, "", listOf(SimpleGrantedAuthority("ROLE_EDITOR")))
        SecurityContextHolder.getContext().authentication = UsernamePasswordAuthenticationToken(principal, null, principal.authorities)
        `when`(userRepository.findByEmail(user.email)).thenReturn(user)
        `when`(userRepository.findById(user.id!!)).thenReturn(Optional.of(user))
        `when`(spaceRepository.findById(space.id!!)).thenReturn(Optional.of(space))
        `when`(permissionService.hasAccess(user.id!!, space.id!!, user.role)).thenReturn(true)
        `when`(permissionService.hasEditAccess(user.id!!, space.id!!, user.role)).thenReturn(canEdit)
    }

    @AfterEach
    fun clear() = SecurityContextHolder.clearContext()

    @Test
    fun `issuing needs a signed-in user with the matching permission`() {
        mockMvc.perform(post("/transfers").contentType(MediaType.APPLICATION_JSON).content("""{"spaceId":"${space.id}","path":"a.png","kind":"upload"}"""))
            .andExpect(status().isUnauthorized)

        signIn(canEdit = false)
        mockMvc.perform(post("/transfers").contentType(MediaType.APPLICATION_JSON).content("""{"spaceId":"${space.id}","path":"a.png","kind":"upload"}"""))
            .andExpect(status().isForbidden)
        mockMvc.perform(post("/transfers").contentType(MediaType.APPLICATION_JSON).content("""{"spaceId":"${space.id}","path":"../etc/passwd","kind":"download"}"""))
            .andExpect(status().isBadRequest)
    }

    @Test
    fun `upload ticket stores the body once and the commit follows, a second use is refused`() {
        signIn(canEdit = true)
        val issue = mockMvc.perform(post("/transfers").contentType(MediaType.APPLICATION_JSON).content("""{"spaceId":"${space.id}","path":"/assets/logo.png","kind":"upload"}"""))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.url").value("https://docs.example.com/api/transfers/tok-0"))
            .andExpect(jsonPath("$.path").value("assets/logo.png"))
            .andReturn()
        val token = issue.response.contentAsString.substringAfter("/transfers/").substringBefore('"')

        mockMvc.perform(put("/transfers/$token").contentType(MediaType.APPLICATION_OCTET_STREAM).content(byteArrayOf(1, 2, 3)))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.path").value("assets/logo.png"))
            .andExpect(jsonPath("$.size").value(3))
            .andExpect(jsonPath("$.url").value("https://docs.example.com/spaces/docs/doc?path=assets/logo.png"))
        org.junit.jupiter.api.Assertions.assertEquals(1, commits.size, "one commit for the upload")

        mockMvc.perform(put("/transfers/$token").contentType(MediaType.APPLICATION_OCTET_STREAM).content(byteArrayOf(1)))
            .andExpect(status().isNotFound)
    }

    @Test
    fun `download ticket serves the file as an attachment and only for its own kind`() {
        signIn(canEdit = false)
        val dir = repos.resolve(space.id.toString()).resolve("docs")
        Files.createDirectories(dir)
        Files.write(dir.resolve("guide.pdf"), "pdf-bytes".toByteArray())

        val issue = mockMvc.perform(post("/transfers").contentType(MediaType.APPLICATION_JSON).content("""{"spaceId":"${space.id}","path":"docs/guide.pdf","kind":"download"}"""))
            .andExpect(status().isOk).andReturn()
        val token = issue.response.contentAsString.substringAfter("/transfers/").substringBefore('"')

        mockMvc.perform(put("/transfers/$token").contentType(MediaType.APPLICATION_OCTET_STREAM).content(byteArrayOf(1)))
            .andExpect(status().isMethodNotAllowed)

        val again = mockMvc.perform(post("/transfers").contentType(MediaType.APPLICATION_JSON).content("""{"spaceId":"${space.id}","path":"docs/guide.pdf","kind":"download"}"""))
            .andExpect(status().isOk).andReturn()
        val token2 = again.response.contentAsString.substringAfter("/transfers/").substringBefore('"')
        mockMvc.perform(get("/transfers/$token2"))
            .andExpect(status().isOk)
            .andExpect(header().string("Content-Disposition", org.hamcrest.Matchers.containsString("guide.pdf")))
            .andExpect(content().bytes("pdf-bytes".toByteArray()))

        mockMvc.perform(post("/transfers").contentType(MediaType.APPLICATION_JSON).content("""{"spaceId":"${space.id}","path":"docs/missing.pdf","kind":"download"}"""))
            .andExpect(status().isNotFound)
    }
}
