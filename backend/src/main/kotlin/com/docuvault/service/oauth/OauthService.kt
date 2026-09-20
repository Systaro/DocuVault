package com.docuvault.service.oauth

import com.docuvault.domain.oauth.OauthAuthorizationCode
import com.docuvault.domain.oauth.OauthClient
import com.docuvault.domain.oauth.OauthToken
import com.docuvault.domain.user.User
import com.docuvault.infrastructure.repository.OauthAuthorizationCodeRepository
import com.docuvault.infrastructure.repository.OauthClientRepository
import com.docuvault.infrastructure.repository.OauthTokenRepository
import com.docuvault.service.TokenHashing
import org.jsoup.Jsoup
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.io.Serializable
import java.net.URI
import java.net.URISyntaxException
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Duration
import java.time.Instant
import java.util.*

/** An OAuth error the endpoint reports as `{ "error": ..., "error_description": ... }` (RFC 6749 §5.2). */
class OauthException(val error: String, val description: String, val status: Int = 400) : RuntimeException(description)

/**
 * A validated authorization request parked in the HTTP session under a nonce
 * while the user looks at the consent page. The approve click turns it into a
 * code; nothing from the query string is trusted a second time.
 */
data class PendingAuthorization(
    val clientId: UUID,
    val clientName: String,
    val redirectUri: String,
    val codeChallenge: String,
    val scope: String,
    val state: String?
) : Serializable {
    companion object {
        private const val serialVersionUID = 1L
    }
}

sealed class AuthorizationOutcome {
    /** Show the consent page. */
    data class Consent(val pending: PendingAuthorization) : AuthorizationOutcome()

    /** The redirect target is trusted, so the error goes back to the client. */
    data class Redirect(val url: String) : AuthorizationOutcome()
}

data class AuthorizeParams(
    val clientId: String?,
    val redirectUri: String?,
    val responseType: String?,
    val codeChallenge: String?,
    val codeChallengeMethod: String?,
    val scope: String?,
    val state: String?,
    val resource: String?
)

/** Client credentials as presented at the token endpoint (body or Basic header). */
data class ClientAuth(val clientId: String, val clientSecret: String?)

data class RegisteredClient(val client: OauthClient, val rawSecret: String?)

data class IssuedTokens(val accessToken: String, val refreshToken: String, val expiresIn: Long, val scope: String)

/**
 * The small OAuth 2.1 authorization server that lets MCP clients connect the
 * way they connect to GitLab: URL in the config, consent in the browser, done.
 *
 * Discovery (RFC 8414 / 9728), dynamic registration (RFC 7591), authorization
 * code with mandatory PKCE S256, refresh rotation with replay detection.
 */
@Service
class OauthService(
    private val clientRepository: OauthClientRepository,
    private val codeRepository: OauthAuthorizationCodeRepository,
    private val tokenRepository: OauthTokenRepository,
    @Value("\${app.public-url}") publicUrl: String
) {
    companion object {
        const val ACCESS_TOKEN_PREFIX = "dvo_"
        const val REFRESH_TOKEN_PREFIX = "dvr_"
        const val SCOPE_MCP = "mcp"
        val SUPPORTED_SCOPES = listOf(SCOPE_MCP)
        val SUPPORTED_AUTH_METHODS = listOf("none", "client_secret_basic", "client_secret_post")
        val SUPPORTED_GRANT_TYPES = listOf("authorization_code", "refresh_token")
        val CODE_TTL: Duration = Duration.ofMinutes(10)

        /**
         * Deliberately long. A short access token is only harmless when the client
         * silently exchanges the refresh token for a new one, and Claude Code does
         * not do that reliably: it answers a 401 by registering a new client and
         * asking the user to sign in again, even with a valid refresh token in hand
         * (seven sign-ins in five days with a two-hour token, verified in the prod
         * logs on 2026-09-18). Tokens stay hashed here and can be revoked, so the
         * cost of a long one is bounded, while re-authenticating every two hours
         * costs the user something every working day.
         */
        val ACCESS_TOKEN_TTL: Duration = Duration.ofDays(30)
        val REFRESH_TOKEN_TTL: Duration = Duration.ofDays(90)
        private const val MAX_CLIENT_NAME_LENGTH = 100

        fun pkceChallenge(verifier: String): String {
            val digest = MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(StandardCharsets.US_ASCII))
            return Base64.getUrlEncoder().withoutPadding().encodeToString(digest)
        }

        fun isLoopbackHost(host: String?): Boolean =
            host == "localhost" || host == "127.0.0.1" || host == "[::1]" || host == "::1"

        /** Loopback redirect URIs may differ in port (RFC 8252 §7.3); everything else must match exactly. */
        fun redirectUriMatches(registered: String, requested: String): Boolean {
            if (registered == requested) return true
            val a = runCatching { URI(registered) }.getOrNull() ?: return false
            val b = runCatching { URI(requested) }.getOrNull() ?: return false
            val loopback = a.scheme == "http" && b.scheme == "http" && isLoopbackHost(a.host) && isLoopbackHost(b.host)
            return loopback && a.host == b.host && a.rawPath == b.rawPath && a.rawQuery == b.rawQuery
        }

        /** Null when the URI may be registered, otherwise why not. */
        fun redirectUriProblem(uri: String): String? {
            val parsed = try {
                URI(uri)
            } catch (e: URISyntaxException) {
                return "not a valid URI"
            }
            val scheme = parsed.scheme?.lowercase() ?: return "must be absolute"
            if (parsed.rawFragment != null) return "must not contain a fragment"
            return when (scheme) {
                "https" -> null
                "http" -> if (isLoopbackHost(parsed.host)) null else "http is only allowed for loopback hosts"
                "javascript", "data", "file", "vbscript" -> "scheme $scheme is not allowed"
                // Native app schemes (com.example.app:/callback)
                else -> if (parsed.schemeSpecificPart.isNullOrBlank()) "must have a target" else null
            }
        }
    }

    private val logger = LoggerFactory.getLogger(OauthService::class.java)
    private val secureRandom = SecureRandom()

    /** The issuer comes from configuration, never from the request: behind a proxy the Host header is unreliable. */
    val issuer: String = publicUrl.trimEnd('/')
    val resourceUrl: String = "$issuer/api/mcp"
    val protectedResourceMetadataUrl: String = "$issuer/.well-known/oauth-protected-resource"

    fun authorizationServerMetadata(): Map<String, Any> = linkedMapOf(
        "issuer" to issuer,
        // The consent page is an app route, the machine endpoints live under /api.
        "authorization_endpoint" to "$issuer/oauth/authorize",
        "token_endpoint" to "$issuer/api/oauth/token",
        "registration_endpoint" to "$issuer/api/oauth/register",
        "response_types_supported" to listOf("code"),
        "grant_types_supported" to SUPPORTED_GRANT_TYPES,
        "code_challenge_methods_supported" to listOf("S256"),
        "token_endpoint_auth_methods_supported" to SUPPORTED_AUTH_METHODS,
        "scopes_supported" to SUPPORTED_SCOPES
    )

    fun protectedResourceMetadata(): Map<String, Any> = linkedMapOf(
        "resource" to resourceUrl,
        "resource_name" to "DocuVault MCP server",
        "authorization_servers" to listOf(issuer),
        "scopes_supported" to SUPPORTED_SCOPES,
        "bearer_methods_supported" to listOf("header")
    )

    fun randomToken(): String {
        val bytes = ByteArray(32)
        secureRandom.nextBytes(bytes)
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }

    // ---- Registration (RFC 7591) -------------------------------------------------

    @Transactional
    fun registerClient(
        clientName: String?,
        redirectUris: List<String>?,
        grantTypes: List<String>?,
        responseTypes: List<String>?,
        tokenEndpointAuthMethod: String?
    ): RegisteredClient {
        val uris = redirectUris?.map { it.trim() }?.filter { it.isNotEmpty() } ?: emptyList()
        if (uris.isEmpty()) throw OauthException("invalid_redirect_uri", "redirect_uris is required")
        uris.forEach { uri ->
            redirectUriProblem(uri)?.let { throw OauthException("invalid_redirect_uri", "$uri: $it") }
        }

        val authMethod = tokenEndpointAuthMethod?.takeIf { it.isNotBlank() } ?: "none"
        if (authMethod !in SUPPORTED_AUTH_METHODS) {
            throw OauthException("invalid_client_metadata", "token_endpoint_auth_method must be one of ${SUPPORTED_AUTH_METHODS.joinToString()}")
        }
        val grants = grantTypes?.filter { it.isNotBlank() }?.takeIf { it.isNotEmpty() } ?: listOf("authorization_code")
        if ("authorization_code" !in grants || grants.any { it !in SUPPORTED_GRANT_TYPES }) {
            throw OauthException("invalid_client_metadata", "grant_types must contain authorization_code and only ${SUPPORTED_GRANT_TYPES.joinToString()}")
        }
        if (responseTypes != null && responseTypes.any { it != "code" }) {
            throw OauthException("invalid_client_metadata", "response_types may only contain \"code\"")
        }

        // The name is shown on the consent page, so it is text only and short.
        val name = Jsoup.parse(clientName ?: "").text().trim().take(MAX_CLIENT_NAME_LENGTH).ifBlank { "Unnamed MCP client" }
        val rawSecret = if (authMethod == "none") null else randomToken()
        val client = clientRepository.save(
            OauthClient(
                clientId = randomToken(),
                clientSecretHash = rawSecret?.let { TokenHashing.sha256Hex(it) },
                clientName = name,
                redirectUris = uris,
                tokenEndpointAuthMethod = authMethod,
                grantTypes = grants
            )
        )
        logger.info("Registered OAuth client '$name' (${client.clientId}) with redirect URIs $uris")
        return RegisteredClient(client, rawSecret)
    }

    // ---- Authorization request -----------------------------------------------------

    /**
     * Two classes of failure, in this order: an unknown client or an unregistered
     * redirect_uri is fatal (thrown, never redirected, or this would be an open
     * redirect); everything after that goes back to the client as an error redirect.
     */
    fun validateAuthorizationRequest(p: AuthorizeParams): AuthorizationOutcome {
        val client = p.clientId?.takeIf { it.isNotBlank() }?.let { clientRepository.findByClientId(it) }
            ?: throw OauthException("invalid_client", "Unknown client_id")
        val redirectUri = when {
            p.redirectUri.isNullOrBlank() ->
                client.redirectUris.singleOrNull() ?: throw OauthException("invalid_request", "redirect_uri is required")
            client.redirectUris.any { redirectUriMatches(it, p.redirectUri) } -> p.redirectUri
            else -> throw OauthException("invalid_request", "redirect_uri is not registered for this client")
        }

        fun redirectError(error: String, description: String) = AuthorizationOutcome.Redirect(
            buildRedirect(redirectUri, mapOf("error" to error, "error_description" to description, "state" to p.state))
        )

        if (p.responseType != "code") return redirectError("unsupported_response_type", "response_type must be \"code\"")
        if (p.codeChallenge.isNullOrBlank()) return redirectError("invalid_request", "code_challenge is required (PKCE)")
        if ((p.codeChallengeMethod ?: "plain") != "S256") return redirectError("invalid_request", "code_challenge_method must be S256")
        val scopes = p.scope?.split(' ')?.filter { it.isNotBlank() }?.takeIf { it.isNotEmpty() } ?: SUPPORTED_SCOPES
        if (scopes.any { it !in SUPPORTED_SCOPES }) {
            return redirectError("invalid_scope", "Supported scopes: ${SUPPORTED_SCOPES.joinToString(" ")}")
        }
        if (!p.resource.isNullOrBlank() && p.resource.trimEnd('/') != resourceUrl) {
            return redirectError("invalid_target", "This server only issues tokens for $resourceUrl")
        }

        return AuthorizationOutcome.Consent(
            PendingAuthorization(
                clientId = client.id!!,
                clientName = client.clientName,
                redirectUri = redirectUri,
                codeChallenge = p.codeChallenge,
                scope = scopes.joinToString(" "),
                state = p.state
            )
        )
    }

    @Transactional
    fun issueAuthorizationCode(pending: PendingAuthorization, user: User): String {
        val client = clientRepository.findById(pending.clientId).orElseThrow {
            OauthException("invalid_client", "The client no longer exists")
        }
        val raw = randomToken()
        codeRepository.save(
            OauthAuthorizationCode(
                codeHash = TokenHashing.sha256Hex(raw),
                client = client,
                user = user,
                redirectUri = pending.redirectUri,
                codeChallenge = pending.codeChallenge,
                scope = pending.scope,
                expiresAt = Instant.now().plus(CODE_TTL)
            )
        )
        logger.info("Authorization code issued to client '${client.clientName}' for ${user.email}")
        return raw
    }

    fun buildRedirect(redirectUri: String, params: Map<String, String?>): String {
        val query = params.entries
            .filter { it.value != null }
            .joinToString("&") { (k, v) -> "${encode(k)}=${encode(v!!)}" }
        val separator = if (redirectUri.contains('?')) "&" else "?"
        return redirectUri + separator + query
    }

    private fun encode(s: String) = URLEncoder.encode(s, StandardCharsets.UTF_8).replace("+", "%20")

    // ---- Token endpoint ------------------------------------------------------------

    // The replay branches revoke and then throw; the revocation must survive the error.
    @Transactional(noRollbackFor = [OauthException::class])
    fun exchangeAuthorizationCode(auth: ClientAuth, code: String?, codeVerifier: String?, redirectUri: String?): IssuedTokens {
        val client = authenticateClient(auth)
        if (code.isNullOrBlank()) throw OauthException("invalid_request", "code is required")
        if (codeVerifier.isNullOrBlank()) throw OauthException("invalid_request", "code_verifier is required")

        val stored = codeRepository.findByCodeHash(TokenHashing.sha256Hex(code))
            ?: throw OauthException("invalid_grant", "Unknown authorization code")
        if (stored.client.id != client.id) throw OauthException("invalid_grant", "The code was issued to a different client")
        if (stored.usedAt != null) {
            // A code redeemed twice was intercepted somewhere: cut off everything it produced.
            revokeFamily(stored.user.id!!, client.id!!)
            throw OauthException("invalid_grant", "The authorization code was already used")
        }
        if (stored.expiresAt.isBefore(Instant.now())) throw OauthException("invalid_grant", "The authorization code expired")
        if (!redirectUri.isNullOrBlank() && redirectUri != stored.redirectUri) {
            throw OauthException("invalid_grant", "redirect_uri does not match the authorization request")
        }
        if (!MessageDigest.isEqual(pkceChallenge(codeVerifier).toByteArray(), stored.codeChallenge.toByteArray())) {
            throw OauthException("invalid_grant", "PKCE verification failed")
        }

        stored.usedAt = Instant.now()
        codeRepository.save(stored)
        return issueTokens(client, stored.user, stored.scope)
    }

    // The replay branches revoke and then throw; the revocation must survive the error.
    @Transactional(noRollbackFor = [OauthException::class])
    fun refreshTokens(auth: ClientAuth, refreshToken: String?): IssuedTokens {
        val client = authenticateClient(auth)
        if (refreshToken.isNullOrBlank()) throw OauthException("invalid_request", "refresh_token is required")
        if ("refresh_token" !in client.grantTypes) {
            throw OauthException("unauthorized_client", "The client did not register the refresh_token grant")
        }

        val stored = tokenRepository.findByRefreshTokenHash(TokenHashing.sha256Hex(refreshToken))
            ?: throw OauthException("invalid_grant", "Unknown refresh token")
        if (stored.client.id != client.id) throw OauthException("invalid_grant", "The refresh token was issued to a different client")
        if (stored.revokedAt != null) {
            // Rotated away earlier and presented again: somebody copied it.
            revokeFamily(stored.user.id!!, client.id!!)
            throw OauthException("invalid_grant", "The refresh token was already used")
        }
        if (stored.refreshExpiresAt.isBefore(Instant.now())) throw OauthException("invalid_grant", "The refresh token expired")

        stored.revokedAt = Instant.now()
        tokenRepository.save(stored)
        return issueTokens(client, stored.user, stored.scope)
    }

    private fun authenticateClient(auth: ClientAuth): OauthClient {
        val client = clientRepository.findByClientId(auth.clientId)
            ?: throw OauthException("invalid_client", "Unknown client", 401)
        val secretHash = client.clientSecretHash
        if (secretHash != null) {
            val presented = auth.clientSecret ?: throw OauthException("invalid_client", "Client authentication required", 401)
            if (!MessageDigest.isEqual(secretHash.toByteArray(), TokenHashing.sha256Hex(presented).toByteArray())) {
                throw OauthException("invalid_client", "Invalid client credentials", 401)
            }
        }
        return client
    }

    private fun issueTokens(client: OauthClient, user: User, scope: String): IssuedTokens {
        if (!user.enabled) throw OauthException("invalid_grant", "The user account is disabled")
        val access = ACCESS_TOKEN_PREFIX + randomToken()
        val refresh = REFRESH_TOKEN_PREFIX + randomToken()
        val now = Instant.now()
        tokenRepository.save(
            OauthToken(
                client = client,
                user = user,
                accessTokenHash = TokenHashing.sha256Hex(access),
                refreshTokenHash = TokenHashing.sha256Hex(refresh),
                scope = scope,
                accessExpiresAt = now.plus(ACCESS_TOKEN_TTL),
                refreshExpiresAt = now.plus(REFRESH_TOKEN_TTL)
            )
        )
        return IssuedTokens(access, refresh, ACCESS_TOKEN_TTL.seconds, scope)
    }

    private fun revokeFamily(userId: UUID, clientId: UUID) {
        val now = Instant.now()
        val live = tokenRepository.findByUser_IdAndClient_IdAndRevokedAtIsNull(userId, clientId)
        live.forEach { it.revokedAt = now }
        tokenRepository.saveAll(live)
        logger.warn("OAuth replay detected: revoked ${live.size} token pair(s) of user $userId for client $clientId")
    }

    // ---- Resource access -----------------------------------------------------------

    /** The user behind a `dvo_` access token, or null when it is unknown, expired or revoked. */
    @Transactional
    fun userForAccessToken(rawToken: String): User? {
        if (!rawToken.startsWith(ACCESS_TOKEN_PREFIX)) return null
        val token = tokenRepository.findByAccessTokenHash(TokenHashing.sha256Hex(rawToken)) ?: return null
        if (token.revokedAt != null || token.accessExpiresAt.isBefore(Instant.now())) return null
        if (!token.user.enabled) return null
        token.lastUsedAt = Instant.now()
        tokenRepository.save(token)
        return token.user
    }

    /** Expired codes and token pairs carry nothing worth keeping beyond a grace day. */
    @Scheduled(cron = "0 17 4 * * *")
    @Transactional
    fun purgeExpired() {
        val cutoff = Instant.now().minus(Duration.ofDays(1))
        val codes = codeRepository.deleteByExpiresAtBefore(cutoff)
        val tokens = tokenRepository.deleteByRefreshExpiresAtBefore(cutoff)
        if (codes > 0 || tokens > 0) logger.info("Purged $codes expired OAuth codes and $tokens expired token pairs")
    }
}
