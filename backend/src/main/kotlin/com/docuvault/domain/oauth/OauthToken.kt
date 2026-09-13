package com.docuvault.domain.oauth

import com.docuvault.domain.user.User
import jakarta.persistence.*
import java.time.Instant
import java.util.*

/**
 * One access/refresh token pair. A refresh rotates the pair: the old row is
 * marked revoked and a new one is written, so a replayed refresh token is
 * recognisable as one that was already rotated away.
 */
@Entity
@Table(name = "oauth_tokens")
class OauthToken(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID? = null,

    @ManyToOne(fetch = FetchType.EAGER)
    @JoinColumn(name = "client_id", nullable = false)
    val client: OauthClient,

    @ManyToOne(fetch = FetchType.EAGER)
    @JoinColumn(name = "user_id", nullable = false)
    val user: User,

    @Column(name = "access_token_hash", nullable = false, unique = true, columnDefinition = "TEXT")
    val accessTokenHash: String,

    @Column(name = "refresh_token_hash", nullable = false, unique = true, columnDefinition = "TEXT")
    val refreshTokenHash: String,

    @Column(nullable = false, columnDefinition = "TEXT")
    val scope: String,

    @Column(name = "access_expires_at", nullable = false)
    val accessExpiresAt: Instant,

    @Column(name = "refresh_expires_at", nullable = false)
    val refreshExpiresAt: Instant,

    @Column(name = "revoked_at")
    var revokedAt: Instant? = null,

    @Column(name = "last_used_at")
    var lastUsedAt: Instant? = null,

    @Column(name = "created_at", nullable = false)
    val createdAt: Instant = Instant.now()
)
