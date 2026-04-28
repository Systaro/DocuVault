package com.docuvault.domain.space

import com.docuvault.domain.user.User
import jakarta.persistence.*
import java.time.Instant
import java.util.*

enum class NotificationChannel {
    PUSH, EMAIL_INSTANT, EMAIL_HOURLY, EMAIL_DAILY
}

@Entity
@Table(name = "notification_dispatches")
class NotificationDispatch(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID? = null,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "event_id", nullable = false)
    val event: SpaceChangeEvent,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    val user: User,

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    val channel: NotificationChannel,

    @Column(name = "dispatched_at", nullable = false)
    val dispatchedAt: Instant = Instant.now(),

    @Column(nullable = false)
    val success: Boolean,

    @Column(columnDefinition = "TEXT")
    val error: String? = null
)
