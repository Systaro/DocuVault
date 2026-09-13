package com.docuvault.config

import com.docuvault.domain.user.User
import com.docuvault.service.ApiTokenService
import com.docuvault.service.SpaceTokenService
import com.docuvault.service.oauth.OauthService
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.authority.SimpleGrantedAuthority
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter

@Component
class ApiTokenAuthFilter(
    private val apiTokenService: ApiTokenService,
    private val spaceTokenService: SpaceTokenService,
    private val oauthService: OauthService
) : OncePerRequestFilter() {

    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain
    ) {
        // Skip if already authenticated via session
        if (SecurityContextHolder.getContext().authentication?.isAuthenticated == true) {
            filterChain.doFilter(request, response)
            return
        }

        val authHeader = request.getHeader("Authorization")
        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            val token = authHeader.removePrefix("Bearer ")

            when {
                token.startsWith(SpaceTokenService.TOKEN_PREFIX) -> {
                    val spaceId = spaceTokenService.authenticateToken(token)
                    if (spaceId != null) {
                        val authorities = listOf(SimpleGrantedAuthority("ROLE_SPACE_STATE"))
                        val authentication = UsernamePasswordAuthenticationToken(
                            org.springframework.security.core.userdetails.User(
                                "space:$spaceId",
                                "",
                                authorities
                            ),
                            null,
                            authorities
                        )
                        SecurityContextHolder.getContext().authentication = authentication
                    }
                }
                token.startsWith("dv_") -> {
                    apiTokenService.authenticateToken(token)?.let { authenticateAs(it) }
                }
                // OAuth access token issued to an MCP client: same rights as the user.
                token.startsWith(OauthService.ACCESS_TOKEN_PREFIX) -> {
                    oauthService.userForAccessToken(token)?.let { authenticateAs(it) }
                }
            }
        }

        filterChain.doFilter(request, response)
    }

    private fun authenticateAs(user: User) {
        val authorities = listOf(SimpleGrantedAuthority("ROLE_${user.role.name}"))
        val authentication = UsernamePasswordAuthenticationToken(
            org.springframework.security.core.userdetails.User(
                user.email,
                "",
                authorities
            ),
            null,
            authorities
        )
        SecurityContextHolder.getContext().authentication = authentication
    }
}
