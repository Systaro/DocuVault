package com.docuvault.domain.space

import com.docuvault.domain.user.User
import jakarta.persistence.*
import java.time.Instant
import java.util.*

@Entity
@Table(name = "shared_links")
data class SharedLink(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID? = null,

    @Column(unique = true, nullable = false, length = 64)
    val token: String,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "space_id", nullable = false)
    val space: Space,

    @Column(name = "file_path", nullable = false, length = 1000)
    val filePath: String,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "created_by", nullable = false)
    val createdBy: User,

    @Column(name = "expires_at")
    val expiresAt: Instant? = null,

    @Column(name = "revoked_at")
    var revokedAt: Instant? = null,

    @Column(name = "access_count", nullable = false)
    var accessCount: Int = 0,

    @Column(name = "last_accessed_at")
    var lastAccessedAt: Instant? = null,

    @Column(name = "created_at")
    val createdAt: Instant = Instant.now()
) {
    fun isActive(): Boolean = revokedAt == null && (expiresAt == null || expiresAt.isAfter(Instant.now()))
}
