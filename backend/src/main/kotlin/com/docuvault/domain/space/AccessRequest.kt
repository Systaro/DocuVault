package com.docuvault.domain.space

import com.docuvault.domain.user.User
import jakarta.persistence.*
import java.time.Instant
import java.util.*

/**
 * One person asking to be let into a space they cannot open.
 *
 * Recorded rather than only mailed: it stops a second click mailing the admins
 * again, and leaves a trace of who asked for what.
 */
@Entity
@Table(name = "access_requests")
class AccessRequest(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID? = null,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "space_id", nullable = false)
    val space: Space,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    val user: User,

    @Column(columnDefinition = "TEXT")
    val message: String? = null,

    /** Admins the request actually reached; 0 means nobody could be told. */
    @Column(nullable = false)
    var notified: Int = 0,

    @Column(name = "created_at", nullable = false)
    val createdAt: Instant = Instant.now()
)
