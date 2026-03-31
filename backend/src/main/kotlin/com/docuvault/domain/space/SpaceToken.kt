package com.docuvault.domain.space

import jakarta.persistence.*
import java.time.Instant
import java.util.*

@Entity
@Table(name = "space_tokens")
data class SpaceToken(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID? = null,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "space_id", nullable = false)
    val space: Space,

    @Column(nullable = false)
    val name: String,

    @Column(name = "token_hash", nullable = false, unique = true)
    val tokenHash: String,

    @Column(name = "token_prefix", nullable = false)
    val tokenPrefix: String,

    @Column(name = "created_at")
    val createdAt: Instant = Instant.now(),

    @Column(name = "last_used_at")
    var lastUsedAt: Instant? = null,

    @Column(name = "revoked_at")
    var revokedAt: Instant? = null
) {
    fun isValid(): Boolean = revokedAt == null

    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is SpaceToken) return false
        return id != null && id == other.id
    }

    override fun hashCode(): Int = id?.hashCode() ?: 0
}
