package com.docuvault.api.oauth

import com.docuvault.service.oauth.OauthService
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

/**
 * OAuth discovery documents. MCP clients derive these URLs from the origin of
 * the MCP endpoint, so they must be reachable at the site root: the frontend
 * nginx forwards `/.well-known/oauth-*` here (the backend itself lives under
 * `/api`). Both the plain and the path-suffixed form (RFC 9728 §3.1) answer.
 */
@RestController
@RequestMapping("/.well-known")
class OauthMetadataController(private val oauthService: OauthService) {

    @GetMapping("/oauth-authorization-server", "/oauth-authorization-server/**")
    fun authorizationServer(): Map<String, Any> = oauthService.authorizationServerMetadata()

    @GetMapping("/oauth-protected-resource", "/oauth-protected-resource/**")
    fun protectedResource(): Map<String, Any> = oauthService.protectedResourceMetadata()
}
