package com.docuvault.api.oauth

import com.docuvault.domain.user.User
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.oauth.AuthorizationOutcome
import com.docuvault.service.oauth.AuthorizeParams
import com.docuvault.service.oauth.ClientAuth
import com.docuvault.service.oauth.OauthException
import com.docuvault.service.oauth.OauthService
import com.docuvault.service.oauth.PendingAuthorization
import com.fasterxml.jackson.annotation.JsonProperty
import jakarta.servlet.http.HttpSession
import org.springframework.http.CacheControl
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.core.userdetails.UserDetails
import org.springframework.util.MultiValueMap
import org.springframework.web.bind.annotation.*
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.*

/**
 * The OAuth endpoints behind the MCP server. `/oauth/register` and `/oauth/token`
 * are machine endpoints; `/oauth/authorize` backs the consent page, which is an
 * app route (`/oauth/authorize` without `/api`) so it can reuse the normal login
 * and the session cookie of the same host.
 */
@RestController
@RequestMapping("/oauth")
class OauthController(
    private val oauthService: OauthService,
    private val userRepository: UserRepository
) {
    companion object {
        private const val PENDING_PREFIX = "oauth.pending."
    }

    @PostMapping("/register", consumes = [MediaType.APPLICATION_JSON_VALUE])
    fun register(@RequestBody request: ClientRegistrationRequest): ResponseEntity<Map<String, Any?>> {
        val registered = oauthService.registerClient(
            clientName = request.clientName,
            redirectUris = request.redirectUris,
            grantTypes = request.grantTypes,
            responseTypes = request.responseTypes,
            tokenEndpointAuthMethod = request.tokenEndpointAuthMethod
        )
        val client = registered.client
        val body = linkedMapOf<String, Any?>(
            "client_id" to client.clientId,
            "client_id_issued_at" to client.createdAt.epochSecond,
            "client_name" to client.clientName,
            "redirect_uris" to client.redirectUris,
            "grant_types" to client.grantTypes,
            "response_types" to listOf("code"),
            "token_endpoint_auth_method" to client.tokenEndpointAuthMethod,
            "scope" to OauthService.SCOPE_MCP
        )
        registered.rawSecret?.let {
            body["client_secret"] = it
            body["client_secret_expires_at"] = 0
        }
        return ResponseEntity.status(HttpStatus.CREATED).cacheControl(CacheControl.noStore()).body(body)
    }

    /** What the consent page shows. Parks the validated request in the session under a nonce. */
    @GetMapping("/authorize")
    fun describeAuthorization(
        @RequestParam("client_id") clientId: String?,
        @RequestParam("redirect_uri") redirectUri: String?,
        @RequestParam("response_type") responseType: String?,
        @RequestParam("code_challenge") codeChallenge: String?,
        @RequestParam("code_challenge_method") codeChallengeMethod: String?,
        @RequestParam scope: String?,
        @RequestParam state: String?,
        @RequestParam resource: String?,
        @AuthenticationPrincipal userDetails: UserDetails?,
        session: HttpSession
    ): ResponseEntity<Any> {
        val user = currentUser(userDetails) ?: return loginRequired()
        val outcome = oauthService.validateAuthorizationRequest(
            AuthorizeParams(clientId, redirectUri, responseType, codeChallenge, codeChallengeMethod, scope, state, resource)
        )
        return when (outcome) {
            is AuthorizationOutcome.Redirect -> ResponseEntity.ok(AuthorizeResponse(redirectUrl = outcome.url))
            is AuthorizationOutcome.Consent -> {
                val nonce = oauthService.randomToken()
                session.setAttribute(PENDING_PREFIX + nonce, outcome.pending)
                ResponseEntity.ok(
                    AuthorizeResponse(
                        consent = ConsentDto(
                            nonce = nonce,
                            clientName = outcome.pending.clientName,
                            redirectTarget = displayTarget(outcome.pending.redirectUri),
                            scope = outcome.pending.scope,
                            userName = user.name,
                            userEmail = user.email
                        )
                    )
                )
            }
        }
    }

    /** The decision. The nonce ties it to a request this session actually saw. */
    @PostMapping("/authorize")
    fun decide(
        @RequestBody request: ConsentDecisionRequest,
        @AuthenticationPrincipal userDetails: UserDetails?,
        session: HttpSession
    ): ResponseEntity<Any> {
        val user = currentUser(userDetails) ?: return loginRequired()
        val key = PENDING_PREFIX + request.nonce
        val pending = session.getAttribute(key) as? PendingAuthorization
            ?: throw OauthException("invalid_request", "This authorization request has expired. Start again from your MCP client.")
        session.removeAttribute(key)

        val url = if (request.decision == "approve") {
            val code = oauthService.issueAuthorizationCode(pending, user)
            oauthService.buildRedirect(pending.redirectUri, mapOf("code" to code, "state" to pending.state))
        } else {
            oauthService.buildRedirect(pending.redirectUri, mapOf("error" to "access_denied", "state" to pending.state))
        }
        return ResponseEntity.ok(AuthorizeResponse(redirectUrl = url))
    }

    @PostMapping("/token", consumes = [MediaType.APPLICATION_FORM_URLENCODED_VALUE])
    fun token(
        @RequestParam params: MultiValueMap<String, String>,
        @RequestHeader(HttpHeaders.AUTHORIZATION, required = false) authorization: String?
    ): ResponseEntity<Map<String, Any>> {
        val clientAuth = clientAuth(params, authorization)
        val tokens = when (params.getFirst("grant_type")) {
            "authorization_code" -> oauthService.exchangeAuthorizationCode(
                clientAuth, params.getFirst("code"), params.getFirst("code_verifier"), params.getFirst("redirect_uri")
            )
            "refresh_token" -> oauthService.refreshTokens(clientAuth, params.getFirst("refresh_token"))
            else -> throw OauthException("unsupported_grant_type", "grant_type must be authorization_code or refresh_token")
        }
        return ResponseEntity.ok()
            .cacheControl(CacheControl.noStore())
            .header("Pragma", "no-cache")
            .body(
                linkedMapOf(
                    "access_token" to tokens.accessToken,
                    "token_type" to "Bearer",
                    "expires_in" to tokens.expiresIn,
                    "refresh_token" to tokens.refreshToken,
                    "scope" to tokens.scope
                )
            )
    }

    @ExceptionHandler(OauthException::class)
    fun handleOauthError(ex: OauthException): ResponseEntity<Map<String, String>> {
        val builder = ResponseEntity.status(ex.status).cacheControl(CacheControl.noStore())
        if (ex.status == 401) builder.header(HttpHeaders.WWW_AUTHENTICATE, "Basic realm=\"DocuVault OAuth\"")
        return builder.body(mapOf("error" to ex.error, "error_description" to ex.description))
    }

    private fun clientAuth(params: MultiValueMap<String, String>, authorization: String?): ClientAuth {
        if (authorization != null && authorization.startsWith("Basic ", ignoreCase = true)) {
            val decoded = runCatching {
                String(Base64.getDecoder().decode(authorization.substring(6).trim()), StandardCharsets.UTF_8)
            }.getOrNull() ?: throw OauthException("invalid_client", "Malformed Authorization header", 401)
            val separator = decoded.indexOf(':')
            if (separator < 0) throw OauthException("invalid_client", "Malformed Authorization header", 401)
            return ClientAuth(
                URLDecoder.decode(decoded.substring(0, separator), StandardCharsets.UTF_8),
                URLDecoder.decode(decoded.substring(separator + 1), StandardCharsets.UTF_8)
            )
        }
        val clientId = params.getFirst("client_id")?.takeIf { it.isNotBlank() }
            ?: throw OauthException("invalid_client", "client_id is required", 401)
        return ClientAuth(clientId, params.getFirst("client_secret")?.takeIf { it.isNotBlank() })
    }

    private fun currentUser(userDetails: UserDetails?): User? =
        userDetails?.let { userRepository.findByEmail(it.username) }

    private fun loginRequired(): ResponseEntity<Any> = ResponseEntity.status(HttpStatus.UNAUTHORIZED)
        .body(mapOf("error" to "login_required", "error_description" to "Sign in to continue"))

    /** The part of the redirect URI worth showing on the consent page. */
    private fun displayTarget(redirectUri: String): String {
        val uri = runCatching { URI(redirectUri) }.getOrNull() ?: return redirectUri
        return if (uri.authority != null) "${uri.scheme}://${uri.authority}" else redirectUri
    }
}

data class ClientRegistrationRequest(
    @JsonProperty("client_name") val clientName: String? = null,
    @JsonProperty("redirect_uris") val redirectUris: List<String>? = null,
    @JsonProperty("grant_types") val grantTypes: List<String>? = null,
    @JsonProperty("response_types") val responseTypes: List<String>? = null,
    @JsonProperty("token_endpoint_auth_method") val tokenEndpointAuthMethod: String? = null
)

data class ConsentDecisionRequest(
    val nonce: String,
    /** "approve" or "deny" */
    val decision: String
)

data class ConsentDto(
    val nonce: String,
    val clientName: String,
    val redirectTarget: String,
    val scope: String,
    val userName: String,
    val userEmail: String
)

/** Exactly one of the two is set. */
data class AuthorizeResponse(
    val redirectUrl: String? = null,
    val consent: ConsentDto? = null
)
