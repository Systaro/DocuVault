package com.docuvault.api.spaces

import com.docuvault.config.GlobalExceptionHandler
import com.docuvault.domain.space.Space
import com.docuvault.domain.space.SpaceState
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.SpaceStateRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.PermissionService
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import org.springframework.http.MediaType
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.authority.SimpleGrantedAuthority
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.security.core.userdetails.User
import org.springframework.security.core.userdetails.UserDetails
import org.springframework.security.web.method.annotation.AuthenticationPrincipalArgumentResolver
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.content
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import org.springframework.test.web.servlet.setup.MockMvcBuilders
import java.util.*

class SpaceStateControllerTest {

    private val spaceStateRepository = mock(SpaceStateRepository::class.java)
    private val spaceRepository = mock(SpaceRepository::class.java)
    private val userRepository = mock(UserRepository::class.java)
    private val permissionService = mock(PermissionService::class.java)

    private val mockMvc = MockMvcBuilders
        .standaloneSetup(
            SpaceStateController(spaceStateRepository, spaceRepository, userRepository, permissionService)
        )
        .setControllerAdvice(GlobalExceptionHandler())
        .setCustomArgumentResolvers(AuthenticationPrincipalArgumentResolver())
        .build()

    private val spaceId: UUID = UUID.randomUUID()

    /** Space-token principal for this space — passes canRead/canWrite without touching the repos. */
    private fun spaceTokenPrincipal(): UserDetails =
        User("space:$spaceId", "n/a", listOf(SimpleGrantedAuthority("ROLE_SPACE_STATE")))

    /** Regular user unknown to the user repository — fails canRead/canWrite. */
    private fun unknownUserPrincipal(): UserDetails =
        User("stranger@example.com", "n/a", listOf(SimpleGrantedAuthority("ROLE_USER")))

    private fun authenticateAs(userDetails: UserDetails) {
        SecurityContextHolder.getContext().authentication =
            UsernamePasswordAuthenticationToken(userDetails, userDetails.password, userDetails.authorities)
    }

    @AfterEach
    fun clearSecurityContext() {
        SecurityContextHolder.clearContext()
    }

    @Test
    fun `GET existing key returns 200 with the state`() {
        val state = SpaceState(space = mock(Space::class.java), key = "theme", value = "dark")
        `when`(spaceStateRepository.findBySpaceIdAndKey(spaceId, "theme")).thenReturn(state)
        authenticateAs(spaceTokenPrincipal())

        mockMvc.perform(get("/spaces/$spaceId/state/theme"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.key").value("theme"))
            .andExpect(jsonPath("$.value").value("dark"))
    }

    @Test
    fun `GET absent key returns 404 with the JSON error envelope`() {
        `when`(spaceStateRepository.findBySpaceIdAndKey(spaceId, "missing")).thenReturn(null)
        authenticateAs(spaceTokenPrincipal())

        mockMvc.perform(get("/spaces/$spaceId/state/missing"))
            .andExpect(status().isNotFound)
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.status").value(404))
            .andExpect(jsonPath("$.message").value("State key not found"))
    }

    @Test
    fun `GET without space access returns 403 with the JSON error envelope`() {
        `when`(userRepository.findByEmail("stranger@example.com")).thenReturn(null)
        authenticateAs(unknownUserPrincipal())

        mockMvc.perform(get("/spaces/$spaceId/state/theme"))
            .andExpect(status().isForbidden)
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.status").value(403))
            .andExpect(jsonPath("$.message").value("No access to this space"))
    }

    @Test
    fun `PUT on an unknown space returns 404 with the JSON error envelope`() {
        `when`(spaceRepository.findById(spaceId)).thenReturn(Optional.empty())
        authenticateAs(spaceTokenPrincipal())

        mockMvc.perform(
            put("/spaces/$spaceId/state/theme")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"value": "dark"}""")
        )
            .andExpect(status().isNotFound)
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.status").value(404))
            .andExpect(jsonPath("$.message").value("Space not found"))
    }

    @Test
    fun `DELETE without space access returns 403 with the JSON error envelope`() {
        authenticateAs(unknownUserPrincipal())

        mockMvc.perform(delete("/spaces/$spaceId/state/theme"))
            .andExpect(status().isForbidden)
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.status").value(403))
            .andExpect(jsonPath("$.message").value("No access to this space"))
    }
}
