package com.docuvault.domain.space

import com.docuvault.domain.user.User
import jakarta.persistence.*
import java.time.Instant
import java.util.*

/**
 * Per-(user, space) override of the default-on notification subscription.
 * A row only exists when the user has explicitly muted or re-enabled a space.
 * Absence = subscribed. A row on a GROUP space cascades to its child repos.
 */
@Entity
@Table(
    name = "space_notification_settings",
    uniqueConstraints = [UniqueConstraint(columnNames = ["user_id", "space_id"])]
)
class SpaceNotificationSetting(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID? = null,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    val user: User,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "space_id", nullable = false)
    val space: Space,

    @Column(nullable = false)
    var enabled: Boolean,

    @Column(name = "updated_at", nullable = false)
    var updatedAt: Instant = Instant.now()
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is SpaceNotificationSetting) return false
        return id != null && id == other.id
    }

    override fun hashCode(): Int = id?.hashCode() ?: 0
}
