package com.docuvault.service

import com.docuvault.domain.space.DenialReason
import com.docuvault.domain.space.SharedLinkAccessDenial
import com.docuvault.infrastructure.repository.SharedLinkAccessDenialRepository
import jakarta.servlet.http.HttpServletRequest
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service

@Service
class SharedLinkAccessDenialService(
    private val repository: SharedLinkAccessDenialRepository
) {
    private val log = LoggerFactory.getLogger(javaClass)

    fun record(token: String, reason: DenialReason, request: HttpServletRequest) {
        val clientIp = request.remoteAddr
        val userAgent = request.getHeader("User-Agent")?.take(500)
        val requestUri = request.requestURI?.take(2000)

        log.warn(
            "SHARE_DENIED token={} reason={} ip={} uri={} ua={}",
            token, reason, clientIp, requestUri, userAgent
        )

        try {
            repository.save(
                SharedLinkAccessDenial(
                    token = token,
                    reason = reason,
                    clientIp = clientIp,
                    userAgent = userAgent,
                    requestUri = requestUri
                )
            )
        } catch (e: Exception) {
            log.error("Failed to persist share denial", e)
        }
    }

    fun findByToken(token: String): List<SharedLinkAccessDenial> {
        return repository.findTop200ByTokenOrderByCreatedAtDesc(token)
    }
}
