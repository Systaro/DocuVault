package com.docuvault.api.mcp

import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.mcp.McpContext
import com.docuvault.service.mcp.McpService
import com.docuvault.service.oauth.OauthService
import com.fasterxml.jackson.databind.ObjectMapper
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.core.userdetails.UserDetails
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestMethod
import org.springframework.web.bind.annotation.RestController

/**
 * The MCP server: Streamable HTTP, stateless, POST only. HTTP and authentication
 * live here, the protocol in McpService, the tools in McpToolService.
 *
 * Authentication is a bearer token, either an OAuth access token issued by
 * `/oauth/token` or a personal `dv_` API token (scripts, CI). Without one the
 * 401 carries the pointer to the protected-resource metadata, which is how an
 * MCP client discovers the OAuth flow.
 */
@RestController
@RequestMapping("/mcp")
class McpController(
    private val mcpService: McpService,
    private val oauthService: OauthService,
    private val userRepository: UserRepository,
    private val objectMapper: ObjectMapper
) {
    @RequestMapping(method = [RequestMethod.GET, RequestMethod.DELETE, RequestMethod.PUT, RequestMethod.PATCH])
    fun methodNotAllowed(): ResponseEntity<Void> =
        ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED).header(HttpHeaders.ALLOW, "POST").build()

    @PostMapping(produces = [MediaType.APPLICATION_JSON_VALUE])
    fun handle(
        @RequestBody(required = false) body: String?,
        @AuthenticationPrincipal userDetails: UserDetails?,
        request: HttpServletRequest
    ): ResponseEntity<String> {
        val authorization = request.getHeader(HttpHeaders.AUTHORIZATION)
        val user = if (authorization != null && userDetails != null) userRepository.findByEmail(userDetails.username) else null
        if (authorization == null || user == null) return unauthorized(tokenPresented = authorization != null)

        val payload = runCatching { objectMapper.readTree(body ?: "") }.getOrNull()
        if (payload == null || payload.isMissingNode || !(payload.isObject || payload.isArray)) {
            return ResponseEntity.badRequest().contentType(MediaType.APPLICATION_JSON).body(mcpService.parseError())
        }

        val result = mcpService.handle(payload, McpContext(user, authorization))
        return if (result == null) {
            ResponseEntity.accepted().build()
        } else {
            ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(objectMapper.writeValueAsString(result))
        }
    }

    private fun unauthorized(tokenPresented: Boolean): ResponseEntity<String> {
        val challenge = buildString {
            append("Bearer realm=\"DocuVault\", resource_metadata=\"${oauthService.protectedResourceMetadataUrl}\"")
            if (tokenPresented) append(", error=\"invalid_token\", error_description=\"The access token is invalid, expired or revoked\"")
        }
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
            .header(HttpHeaders.WWW_AUTHENTICATE, challenge)
            .contentType(MediaType.APPLICATION_JSON)
            .body("""{"error":"unauthorized","error_description":"Authenticate with an OAuth access token or a DocuVault API token"}""")
    }
}
