package com.docuvault.domain.user

import jakarta.persistence.*
import java.time.Instant
import java.util.*

@Entity
@Table(name = "password_reset_tokens")
data class PasswordResetToken(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID? = null,

    @Column(nullable = false)
    val email: String,

    @Column(unique = true, nullable = false)
    val token: String,

    @Column(name = "expires_at", nullable = false)
    val expiresAt: Instant,

    @Column(name = "used_at")
    var usedAt: Instant? = null,

    @Column(name = "created_at")
    val createdAt: Instant = Instant.now()
)
