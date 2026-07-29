package com.docuvault.domain.team

import com.docuvault.domain.user.User
import jakarta.persistence.*
import java.time.Instant
import java.util.*

@Entity
@Table(
    name = "team_memberships",
    uniqueConstraints = [UniqueConstraint(columnNames = ["team_id", "user_id"])]
)
data class TeamMembership(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID? = null,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "team_id", nullable = false)
    val team: Team,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    val user: User,

    @Column(name = "created_at")
    val createdAt: Instant = Instant.now()
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is TeamMembership) return false
        return id != null && id == other.id
    }

    override fun hashCode(): Int = id?.hashCode() ?: 0
}
