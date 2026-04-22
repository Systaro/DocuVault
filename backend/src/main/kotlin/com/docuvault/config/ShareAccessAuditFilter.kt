package com.docuvault.config

import com.docuvault.domain.space.DenialReason
import com.docuvault.service.SharedLinkAccessDenialService
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.beans.factory.ObjectProvider
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter

// Records denied access attempts on public /api/shared/ endpoints into the
// shared_link_access_denials table. Runs after the RateLimitFilter so it also
// captures 429 responses produced upstream.
@Component
@Order(Ordered.LOWEST_PRECEDENCE)
class ShareAccessAuditFilter(
    private val denialServiceProvider: ObjectProvider<SharedLinkAccessDenialService>
) : OncePerRequestFilter() {

    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain
    ) {
        val path = request.requestURI
        if (!path.startsWith("/api/shared/")) {
            filterChain.doFilter(request, response)
            return
        }

        filterChain.doFilter(request, response)

        val reason = when (response.status) {
            401 -> DenialReason.UNAUTHORIZED
            403 -> DenialReason.FORBIDDEN
            404 -> DenialReason.NOT_FOUND
            429 -> DenialReason.RATE_LIMITED
            else -> return
        }

        val token = path.removePrefix("/api/shared/").substringBefore('/').ifBlank { "unknown" }
        denialServiceProvider.ifAvailable { it.record(token, reason, request) }
    }
}
