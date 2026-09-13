package com.docuvault.domain.oauth

import com.docuvault.domain.user.User
import jakarta.persistence.*
import java.time.Instant
import java.util.*

/** A one-time code handed to the client after consent, redeemable for ten minutes. */
@Entity
@Table(name = "oauth_authorization_codes")
class OauthAuthorizationCode(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID? = null,

    @Column(name = "code_hash", nullable = false, unique = true, columnDefinition = "TEXT")
    val codeHash: String,

    @ManyToOne(fetch = FetchType.EAGER)
    @JoinColumn(name = "client_id", nullable = false)
    val client: OauthClient,

    @ManyToOne(fetch = FetchType.EAGER)
    @JoinColumn(name = "user_id", nullable = false)
    val user: User,

    @Column(name = "redirect_uri", nullable = false, columnDefinition = "TEXT")
    val redirectUri: String,

    @Column(name = "code_challenge", nullable = false, columnDefinition = "TEXT")
    val codeChallenge: String,

    @Column(nullable = false, columnDefinition = "TEXT")
    val scope: String,

    @Column(name = "expires_at", nullable = false)
    val expiresAt: Instant,

    @Column(name = "used_at")
    var usedAt: Instant? = null,

    @Column(name = "created_at", nullable = false)
    val createdAt: Instant = Instant.now()
)
