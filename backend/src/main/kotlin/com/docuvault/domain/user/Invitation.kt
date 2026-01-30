package com.docuvault.domain.user

import com.docuvault.domain.space.Space
import jakarta.persistence.*
import java.time.Instant
import java.util.*

@Entity
@Table(name = "invitations")
data class Invitation(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID? = null,

    @Column(nullable = false)
    val email: String,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "space_id")
    val space: Space? = null,

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    val role: UserRole = UserRole.VIEWER,

    @Column(unique = true, nullable = false)
    val token: String,

    @Column(name = "expires_at", nullable = false)
    var expiresAt: Instant,

    @Column(name = "accepted_at")
    var acceptedAt: Instant? = null,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "created_by")
    val createdBy: User,

    @Column(name = "created_at")
    val createdAt: Instant = Instant.now()
)
