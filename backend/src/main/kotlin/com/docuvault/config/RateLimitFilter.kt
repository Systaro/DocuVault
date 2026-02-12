package com.docuvault.config

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

@Component
class RateLimitFilter : OncePerRequestFilter() {

    companion object {
        private const val AUTH_MAX_ATTEMPTS = 10
        private const val AUTH_WINDOW_MS = 15 * 60 * 1000L // 15 minutes
        private const val SHARED_MAX_ATTEMPTS = 60
        private const val SHARED_WINDOW_MS = 15 * 60 * 1000L // 15 minutes
    }

    private data class RateEntry(val count: AtomicInteger = AtomicInteger(0), val windowStart: Long = System.currentTimeMillis())

    private val authAttempts = ConcurrentHashMap<String, RateEntry>()
    private val sharedAttempts = ConcurrentHashMap<String, RateEntry>()

    override fun doFilterInternal(request: HttpServletRequest, response: HttpServletResponse, filterChain: FilterChain) {
        val path = request.requestURI

        if ((path.startsWith("/api/auth/login") || path.startsWith("/api/auth/forgot-password")) && request.method == "POST") {
            if (isRateLimited(request.remoteAddr, authAttempts, AUTH_MAX_ATTEMPTS, AUTH_WINDOW_MS)) {
                response.status = 429
                response.contentType = "application/json"
                response.writer.write("""{"error":"Too many login attempts. Please try again later."}""")
                return
            }
        }

        if (path.startsWith("/api/shared/")) {
            if (isRateLimited(request.remoteAddr, sharedAttempts, SHARED_MAX_ATTEMPTS, SHARED_WINDOW_MS)) {
                response.status = 429
                response.contentType = "application/json"
                response.writer.write("""{"error":"Too many requests. Please try again later."}""")
                return
            }
        }

        filterChain.doFilter(request, response)
    }

    private fun isRateLimited(
        clientIp: String,
        store: ConcurrentHashMap<String, RateEntry>,
        maxAttempts: Int,
        windowMs: Long
    ): Boolean {
        val now = System.currentTimeMillis()
        val entry = store.compute(clientIp) { _, existing ->
            if (existing == null || now - existing.windowStart > windowMs) {
                RateEntry(AtomicInteger(1), now)
            } else {
                existing.count.incrementAndGet()
                existing
            }
        }!!
        return entry.count.get() > maxAttempts
    }
}
