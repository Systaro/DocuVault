package com.docuvault.api.oauth

import com.docuvault.config.GlobalExceptionHandler
import com.docuvault.domain.oauth.OauthClient
import com.docuvault.infrastructure.repository.OauthAuthorizationCodeRepository
import com.docuvault.infrastructure.repository.OauthClientRepository
import com.docuvault.infrastructure.repository.OauthTokenRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.oauth.OauthService
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import org.springframework.http.MediaType
import org.springframework.security.web.method.annotation.AuthenticationPrincipalArgumentResolver
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.header
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import org.springframework.test.web.servlet.setup.MockMvcBuilders
import java.util.*

class OauthControllerTest {

    private val clientRepository = mock(OauthClientRepository::class.java)
    private val oauthService = OauthService(
        clientRepository,
        mock(OauthAuthorizationCodeRepository::class.java),
        mock(OauthTokenRepository::class.java),
        "https://docs.example.com"
    )
    private val mockMvc = MockMvcBuilders
        .standaloneSetup(OauthController(oauthService, mock(UserRepository::class.java)), OauthMetadataController(oauthService))
        .setControllerAdvice(GlobalExceptionHandler())
        .setCustomArgumentResolvers(AuthenticationPrincipalArgumentResolver())
        .build()

    @Test
    fun `discovery documents answer on both the plain and the path-suffixed url`() {
        mockMvc.perform(get("/.well-known/oauth-authorization-server"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.registration_endpoint").value("https://docs.example.com/api/oauth/register"))
        mockMvc.perform(get("/.well-known/oauth-protected-resource/api/mcp"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.resource").value("https://docs.example.com/api/mcp"))
            .andExpect(jsonPath("$.authorization_servers[0]").value("https://docs.example.com"))
    }

    @Test
    fun `registration mirrors the metadata back with a client_id and refuses bad redirect uris`() {
        `when`(clientRepository.save(any())).thenAnswer { it.arguments[0] }
        mockMvc.perform(
            post("/oauth/register").contentType(MediaType.APPLICATION_JSON).content(
                """{"client_name":"Claude Code (DocuVault)","redirect_uris":["http://localhost:63034/callback"],
                    "grant_types":["authorization_code","refresh_token"],"response_types":["code"],"token_endpoint_auth_method":"none"}"""
            )
        )
            .andExpect(status().isCreated)
            .andExpect(jsonPath("$.client_id").isString)
            .andExpect(jsonPath("$.client_name").value("Claude Code (DocuVault)"))
            .andExpect(jsonPath("$.redirect_uris[0]").value("http://localhost:63034/callback"))
            .andExpect(jsonPath("$.token_endpoint_auth_method").value("none"))
            .andExpect(jsonPath("$.client_secret").doesNotExist())

        mockMvc.perform(
            post("/oauth/register").contentType(MediaType.APPLICATION_JSON)
                .content("""{"client_name":"Evil","redirect_uris":["http://evil.example/cb"]}""")
        )
            .andExpect(status().isBadRequest)
            .andExpect(jsonPath("$.error").value("invalid_redirect_uri"))
    }

    @Test
    fun `the consent endpoint needs a session and never redirects on a fatal error`() {
        mockMvc.perform(get("/oauth/authorize").param("client_id", "x"))
            .andExpect(status().isUnauthorized)
            .andExpect(jsonPath("$.error").value("login_required"))
    }

    @Test
    fun `the token endpoint speaks form encoding and reports oauth errors as json`() {
        `when`(clientRepository.findByClientId("client-1")).thenReturn(
            OauthClient(id = UUID.randomUUID(), clientId = "client-1", clientName = "C", redirectUris = listOf("http://localhost:1/cb"), tokenEndpointAuthMethod = "none", grantTypes = listOf("authorization_code"))
        )
        mockMvc.perform(
            post("/oauth/token").contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .param("grant_type", "password").param("client_id", "client-1")
        )
            .andExpect(status().isBadRequest)
            .andExpect(header().string("Cache-Control", "no-store"))
            .andExpect(jsonPath("$.error").value("unsupported_grant_type"))

        mockMvc.perform(
            post("/oauth/token").contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .param("grant_type", "authorization_code").param("code", "abc").param("code_verifier", "v")
                .header("Authorization", "Basic " + Base64.getEncoder().encodeToString("unknown-client:secret".toByteArray()))
        )
            .andExpect(status().isUnauthorized)
            .andExpect(jsonPath("$.error").value("invalid_client"))

        mockMvc.perform(
            post("/oauth/token").contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .param("grant_type", "authorization_code").param("client_id", "client-1").param("code", "unknown").param("code_verifier", "v")
        )
            .andExpect(status().isBadRequest)
            .andExpect(jsonPath("$.error").value("invalid_grant"))
    }
}
