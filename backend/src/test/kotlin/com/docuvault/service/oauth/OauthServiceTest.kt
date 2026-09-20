package com.docuvault.service.oauth

import com.docuvault.domain.oauth.OauthAuthorizationCode
import com.docuvault.domain.oauth.OauthClient
import com.docuvault.domain.oauth.OauthToken
import com.docuvault.domain.user.User
import com.docuvault.infrastructure.repository.OauthAuthorizationCodeRepository
import com.docuvault.infrastructure.repository.OauthClientRepository
import com.docuvault.infrastructure.repository.OauthTokenRepository
import com.docuvault.service.TokenHashing
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.ArgumentMatchers.anyString
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import java.util.*

class OauthServiceTest {

    private val clientRepository = mock(OauthClientRepository::class.java)
    private val codeRepository = mock(OauthAuthorizationCodeRepository::class.java)
    private val tokenRepository = mock(OauthTokenRepository::class.java)
    private val service = OauthService(clientRepository, codeRepository, tokenRepository, "https://docs.example.com/")

    private val user = User(id = UUID.randomUUID(), email = "anna@example.com", passwordHash = "x", name = "Anna")
    private val client = OauthClient(
        id = UUID.randomUUID(),
        clientId = "client-1",
        clientName = "Claude Code",
        redirectUris = listOf("http://localhost:63034/callback"),
        tokenEndpointAuthMethod = "none",
        grantTypes = listOf("authorization_code", "refresh_token")
    )

    private val savedCodes = mutableListOf<OauthAuthorizationCode>()
    private val savedTokens = mutableListOf<OauthToken>()

    init {
        `when`(clientRepository.findByClientId("client-1")).thenReturn(client)
        `when`(clientRepository.findById(client.id!!)).thenReturn(Optional.of(client))
        // The service saves an entity again after mutating it; keep one entry per entity.
        `when`(codeRepository.save(any())).thenAnswer { (it.arguments[0] as OauthAuthorizationCode).also { c -> if (c !in savedCodes) savedCodes += c } }
        `when`(tokenRepository.save(any())).thenAnswer { (it.arguments[0] as OauthToken).also { t -> if (t !in savedTokens) savedTokens += t } }
        `when`(tokenRepository.findByUser_IdAndClient_IdAndRevokedAtIsNull(user.id!!, client.id!!))
            .thenAnswer { savedTokens.filter { it.revokedAt == null } }
    }

    @BeforeEach
    fun resetStores() {
        savedCodes.clear()
        savedTokens.clear()
    }

    @Test
    fun `pkce challenge matches the RFC 7636 test vector`() {
        assertEquals(
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
            OauthService.pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
        )
    }

    @Test
    fun `loopback redirect uris may differ in port, everything else must match exactly`() {
        assertTrue(OauthService.redirectUriMatches("http://localhost:63034/callback", "http://localhost:51000/callback"))
        assertTrue(OauthService.redirectUriMatches("http://127.0.0.1:1/cb", "http://127.0.0.1:2/cb"))
        assertFalse(OauthService.redirectUriMatches("http://localhost:63034/callback", "http://localhost:63034/other"))
        assertFalse(OauthService.redirectUriMatches("https://app.example.com/cb", "https://app.example.com:8443/cb"))
        assertFalse(OauthService.redirectUriMatches("http://localhost/cb", "http://evil.example/cb"))
    }

    @Test
    fun `registration only accepts https, loopback http and native schemes`() {
        assertNull(OauthService.redirectUriProblem("https://app.example.com/callback"))
        assertNull(OauthService.redirectUriProblem("http://localhost:63034/callback"))
        assertNull(OauthService.redirectUriProblem("http://[::1]:63034/callback"))
        assertNull(OauthService.redirectUriProblem("com.example.app:/callback"))
        assertNotNull(OauthService.redirectUriProblem("http://evil.example/callback"))
        assertNotNull(OauthService.redirectUriProblem("javascript:alert(1)"))
        assertNotNull(OauthService.redirectUriProblem("data:text/html,hi"))
        assertNotNull(OauthService.redirectUriProblem("https://app.example.com/cb#fragment"))
        assertNotNull(OauthService.redirectUriProblem("/relative"))
    }

    @Test
    fun `registering with a bad redirect uri or grant type is rejected`() {
        val bad = assertThrows(OauthException::class.java) {
            service.registerClient("X", listOf("http://evil.example/cb"), null, null, null)
        }
        assertEquals("invalid_redirect_uri", bad.error)

        val badGrant = assertThrows(OauthException::class.java) {
            service.registerClient("X", listOf("http://localhost:1/cb"), listOf("client_credentials"), null, "none")
        }
        assertEquals("invalid_client_metadata", badGrant.error)
    }

    @Test
    fun `registration strips markup from the name and only gives confidential clients a secret`() {
        `when`(clientRepository.save(any())).thenAnswer { it.arguments[0] }
        val public = service.registerClient("<b>Claude</b> Code", listOf("http://localhost:1/cb"), null, listOf("code"), "none")
        assertEquals("Claude Code", public.client.clientName)
        assertNull(public.rawSecret)
        assertNull(public.client.clientSecretHash)

        val confidential = service.registerClient("Bot", listOf("https://bot.example/cb"), null, null, "client_secret_basic")
        assertNotNull(confidential.rawSecret)
        assertEquals(TokenHashing.sha256Hex(confidential.rawSecret!!), confidential.client.clientSecretHash)
    }

    @Test
    fun `metadata puts the consent page on the app route and the machine endpoints under api`() {
        val meta = service.authorizationServerMetadata()
        assertEquals("https://docs.example.com", meta["issuer"])
        assertEquals("https://docs.example.com/oauth/authorize", meta["authorization_endpoint"])
        assertEquals("https://docs.example.com/api/oauth/token", meta["token_endpoint"])
        assertEquals("https://docs.example.com/api/oauth/register", meta["registration_endpoint"])
        assertEquals(listOf("S256"), meta["code_challenge_methods_supported"])
        assertTrue((meta["grant_types_supported"] as List<*>).contains("refresh_token"))
        assertEquals("https://docs.example.com/api/mcp", service.protectedResourceMetadata()["resource"])
    }

    @Test
    fun `unknown client and foreign redirect uri are fatal, later problems redirect back`() {
        val unknown = assertThrows(OauthException::class.java) { service.validateAuthorizationRequest(params(clientId = "nope")) }
        assertEquals("invalid_client", unknown.error)

        val foreign = assertThrows(OauthException::class.java) {
            service.validateAuthorizationRequest(params(redirectUri = "http://evil.example/cb"))
        }
        assertEquals("invalid_request", foreign.error)

        val noPkce = service.validateAuthorizationRequest(params(codeChallenge = null))
        assertTrue(noPkce is AuthorizationOutcome.Redirect)
        val url = (noPkce as AuthorizationOutcome.Redirect).url
        assertTrue(url.startsWith("http://localhost:51000/callback?error=invalid_request"), url)
        assertTrue(url.contains("state=xyz"), url)

        val consent = service.validateAuthorizationRequest(params())
        assertTrue(consent is AuthorizationOutcome.Consent)
        val pending = (consent as AuthorizationOutcome.Consent).pending
        assertEquals("mcp", pending.scope)
        assertEquals("http://localhost:51000/callback", pending.redirectUri)
    }

    @Test
    fun `code exchange verifies pkce, then a second redemption revokes the family`() {
        val verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        val pending = (service.validateAuthorizationRequest(params(codeChallenge = OauthService.pkceChallenge(verifier))) as AuthorizationOutcome.Consent).pending
        val rawCode = service.issueAuthorizationCode(pending, user)
        `when`(codeRepository.findByCodeHash(TokenHashing.sha256Hex(rawCode))).thenReturn(savedCodes.single())

        val wrongVerifier = assertThrows(OauthException::class.java) {
            service.exchangeAuthorizationCode(ClientAuth("client-1", null), rawCode, "wrong-verifier-wrong-verifier-wrong-verifier", pending.redirectUri)
        }
        assertEquals("invalid_grant", wrongVerifier.error)
        assertNull(savedCodes.single().usedAt)

        val tokens = service.exchangeAuthorizationCode(ClientAuth("client-1", null), rawCode, verifier, pending.redirectUri)
        assertTrue(tokens.accessToken.startsWith("dvo_"))
        assertTrue(tokens.refreshToken.startsWith("dvr_"))
        assertEquals(OauthService.ACCESS_TOKEN_TTL.seconds, tokens.expiresIn)
        assertNotNull(savedCodes.single().usedAt)
        assertEquals(1, savedTokens.size)

        val replay = assertThrows(OauthException::class.java) {
            service.exchangeAuthorizationCode(ClientAuth("client-1", null), rawCode, verifier, pending.redirectUri)
        }
        assertEquals("invalid_grant", replay.error)
        assertNotNull(savedTokens.single().revokedAt, "the pair issued from the replayed code must be revoked")
    }

    @Test
    fun `refresh rotates the pair and a replayed refresh token kills the whole family`() {
        val verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        val pending = (service.validateAuthorizationRequest(params(codeChallenge = OauthService.pkceChallenge(verifier))) as AuthorizationOutcome.Consent).pending
        val rawCode = service.issueAuthorizationCode(pending, user)
        `when`(codeRepository.findByCodeHash(TokenHashing.sha256Hex(rawCode))).thenReturn(savedCodes.single())
        val first = service.exchangeAuthorizationCode(ClientAuth("client-1", null), rawCode, verifier, null)
        `when`(tokenRepository.findByRefreshTokenHash(anyString())).thenAnswer { inv ->
            savedTokens.firstOrNull { it.refreshTokenHash == inv.arguments[0] }
        }
        `when`(tokenRepository.findByAccessTokenHash(anyString())).thenAnswer { inv ->
            savedTokens.firstOrNull { it.accessTokenHash == inv.arguments[0] }
        }

        val second = service.refreshTokens(ClientAuth("client-1", null), first.refreshToken)
        assertNotNull(savedTokens[0].revokedAt, "rotated pair is marked revoked")
        assertNull(savedTokens[1].revokedAt)
        assertEquals(user, service.userForAccessToken(second.accessToken))
        assertNull(service.userForAccessToken(first.accessToken), "the rotated access token is dead")

        val replay = assertThrows(OauthException::class.java) { service.refreshTokens(ClientAuth("client-1", null), first.refreshToken) }
        assertEquals("invalid_grant", replay.error)
        assertNotNull(savedTokens[1].revokedAt, "replay revokes the live pair too")
        assertNull(service.userForAccessToken(second.accessToken))
    }

    private fun params(
        clientId: String = "client-1",
        redirectUri: String? = "http://localhost:51000/callback",
        codeChallenge: String? = "abc",
        responseType: String = "code"
    ) = AuthorizeParams(
        clientId = clientId,
        redirectUri = redirectUri,
        responseType = responseType,
        codeChallenge = codeChallenge,
        codeChallengeMethod = "S256",
        scope = null,
        state = "xyz",
        resource = "https://docs.example.com/api/mcp"
    )
}
