package com.docuvault.domain.user

import jakarta.persistence.*
import java.time.Instant
import java.util.*

enum class PushPlatform {
    ios, android
}

@Entity
@Table(name = "user_push_tokens")
data class UserPushToken(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID? = null,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    val user: User,

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    val platform: PushPlatform,

    @Column(nullable = false, columnDefinition = "TEXT")
    val token: String,

    @Column(name = "device_name", nullable = false)
    val deviceName: String,

    @Column(name = "created_at", nullable = false)
    val createdAt: Instant = Instant.now(),

    @Column(name = "last_seen_at", nullable = false)
    var lastSeenAt: Instant = Instant.now()
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is UserPushToken) return false
        return id != null && id == other.id
    }

    override fun hashCode(): Int = id?.hashCode() ?: 0
}
