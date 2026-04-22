package com.docuvault.domain.space

import jakarta.persistence.*
import java.time.Instant
import java.util.*

enum class DenialReason {
    NOT_FOUND,
    UNAUTHORIZED,
    FORBIDDEN,
    RATE_LIMITED
}

@Entity
@Table(
    name = "shared_link_access_denials",
    indexes = [
        Index(name = "idx_denial_token", columnList = "token"),
        Index(name = "idx_denial_created_at", columnList = "created_at")
    ]
)
data class SharedLinkAccessDenial(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID? = null,

    @Column(nullable = false, length = 64)
    val token: String,

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    val reason: DenialReason,

    @Column(name = "client_ip", length = 45)
    val clientIp: String? = null,

    @Column(name = "user_agent", length = 500)
    val userAgent: String? = null,

    @Column(name = "request_uri", length = 2000)
    val requestUri: String? = null,

    @Column(name = "created_at", nullable = false)
    val createdAt: Instant = Instant.now()
)
