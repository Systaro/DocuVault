package com.docuvault.domain.user

import jakarta.persistence.*
import java.time.Instant
import java.util.*

@Entity
@Table(name = "api_tokens")
data class ApiToken(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID? = null,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    val user: User,

    @Column(nullable = false)
    val name: String,

    @Column(name = "token_hash", nullable = false, unique = true)
    val tokenHash: String,

    @Column(name = "token_prefix", nullable = false)
    val tokenPrefix: String,

    @Column(name = "last_used_at")
    var lastUsedAt: Instant? = null,

    @Column(name = "expires_at")
    val expiresAt: Instant? = null,

    @Column(name = "revoked_at")
    var revokedAt: Instant? = null,

    @Column(name = "created_at")
    val createdAt: Instant = Instant.now()
) {
    fun isValid(): Boolean = revokedAt == null && (expiresAt == null || expiresAt.isAfter(Instant.now()))

    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is ApiToken) return false
        return id != null && id == other.id
    }

    override fun hashCode(): Int = id?.hashCode() ?: 0
}
