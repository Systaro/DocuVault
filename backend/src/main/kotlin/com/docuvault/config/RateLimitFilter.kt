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
        private const val MAX_ATTEMPTS = 10
        private const val WINDOW_MS = 15 * 60 * 1000L // 15 minutes
    }

    private data class RateEntry(val count: AtomicInteger = AtomicInteger(0), val windowStart: Long = System.currentTimeMillis())

    private val attempts = ConcurrentHashMap<String, RateEntry>()

    override fun doFilterInternal(request: HttpServletRequest, response: HttpServletResponse, filterChain: FilterChain) {
        val path = request.requestURI
        if ((path.startsWith("/api/auth/login") || path.startsWith("/api/auth/forgot-password")) && request.method == "POST") {
            val clientIp = request.remoteAddr
            val now = System.currentTimeMillis()

            val entry = attempts.compute(clientIp) { _, existing ->
                if (existing == null || now - existing.windowStart > WINDOW_MS) {
                    RateEntry(AtomicInteger(1), now)
                } else {
                    existing.count.incrementAndGet()
                    existing
                }
            }!!

            if (entry.count.get() > MAX_ATTEMPTS) {
                response.status = 429
                response.contentType = "application/json"
                response.writer.write("""{"error":"Too many login attempts. Please try again later."}""")
                return
            }
        }

        filterChain.doFilter(request, response)
    }
}
