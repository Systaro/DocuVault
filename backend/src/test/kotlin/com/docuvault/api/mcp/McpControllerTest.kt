package com.docuvault.api.mcp

import com.docuvault.config.GlobalExceptionHandler
import com.docuvault.domain.user.User
import com.docuvault.infrastructure.repository.OauthAuthorizationCodeRepository
import com.docuvault.infrastructure.repository.OauthClientRepository
import com.docuvault.infrastructure.repository.OauthTokenRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.mcp.McpService
import com.docuvault.service.mcp.McpToolService
import com.docuvault.service.oauth.OauthService
import com.fasterxml.jackson.databind.ObjectMapper
import org.hamcrest.Matchers.containsString
import org.hamcrest.Matchers.not
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import org.springframework.http.MediaType
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.authority.SimpleGrantedAuthority
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.security.web.method.annotation.AuthenticationPrincipalArgumentResolver
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.header
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import org.springframework.test.web.servlet.setup.MockMvcBuilders
import java.util.*

class McpControllerTest {

    private val objectMapper = ObjectMapper()
    private val toolService = mock(McpToolService::class.java)
    private val userRepository = mock(UserRepository::class.java)
    private val oauthService = OauthService(
        mock(OauthClientRepository::class.java),
        mock(OauthAuthorizationCodeRepository::class.java),
        mock(OauthTokenRepository::class.java),
        "https://docs.example.com"
    )
    private val mockMvc = MockMvcBuilders
        .standaloneSetup(McpController(McpService(toolService, objectMapper, "https://docs.example.com"), oauthService, userRepository, objectMapper))
        .setControllerAdvice(GlobalExceptionHandler())
        .setCustomArgumentResolvers(AuthenticationPrincipalArgumentResolver())
        .build()

    private val user = User(id = UUID.randomUUID(), email = "anna@example.com", passwordHash = "x", name = "Anna")

    private fun authenticate() {
        val principal = org.springframework.security.core.userdetails.User(user.email, "", listOf(SimpleGrantedAuthority("ROLE_EDITOR")))
        SecurityContextHolder.getContext().authentication =
            UsernamePasswordAuthenticationToken(principal, null, principal.authorities)
        `when`(userRepository.findByEmail(user.email)).thenReturn(user)
    }

    @AfterEach
    fun clearContext() = SecurityContextHolder.clearContext()

    @Test
    fun `only POST is served`() {
        mockMvc.perform(get("/mcp"))
            .andExpect(status().isMethodNotAllowed)
            .andExpect(header().string("Allow", "POST"))
    }

    @Test
    fun `without a credential the 401 points at the protected resource metadata`() {
        mockMvc.perform(post("/mcp").contentType(MediaType.APPLICATION_JSON).content("""{"jsonrpc":"2.0","id":1,"method":"ping"}"""))
            .andExpect(status().isUnauthorized)
            .andExpect(header().string("WWW-Authenticate", containsString("resource_metadata=\"https://docs.example.com/.well-known/oauth-protected-resource\"")))
            .andExpect(header().string("WWW-Authenticate", not(containsString("invalid_token"))))
    }

    @Test
    fun `a rejected token adds invalid_token so the client re-authenticates instead of retrying`() {
        mockMvc.perform(
            post("/mcp").header("Authorization", "Bearer dvo_expired")
                .contentType(MediaType.APPLICATION_JSON).content("""{"jsonrpc":"2.0","id":1,"method":"ping"}""")
        )
            .andExpect(status().isUnauthorized)
            .andExpect(header().string("WWW-Authenticate", containsString("error=\"invalid_token\"")))
    }

    @Test
    fun `an authenticated request is dispatched, notifications get 202, garbage gets a parse error`() {
        authenticate()
        mockMvc.perform(
            post("/mcp").header("Authorization", "Bearer dvo_valid")
                .contentType(MediaType.APPLICATION_JSON).content("""{"jsonrpc":"2.0","id":1,"method":"ping"}""")
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.id").value(1))
            .andExpect(jsonPath("$.result").exists())

        mockMvc.perform(
            post("/mcp").header("Authorization", "Bearer dvo_valid")
                .contentType(MediaType.APPLICATION_JSON).content("""{"jsonrpc":"2.0","method":"notifications/initialized"}""")
        )
            .andExpect(status().isAccepted)

        mockMvc.perform(
            post("/mcp").header("Authorization", "Bearer dvo_valid")
                .contentType(MediaType.APPLICATION_JSON).content("{not json")
        )
            .andExpect(status().isBadRequest)
            .andExpect(jsonPath("$.error.code").value(-32700))
    }
}
