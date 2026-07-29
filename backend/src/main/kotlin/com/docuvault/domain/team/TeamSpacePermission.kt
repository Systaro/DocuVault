package com.docuvault.domain.team

import com.docuvault.domain.space.PermissionLevel
import com.docuvault.domain.space.Space
import jakarta.persistence.*
import java.time.Instant
import java.util.*

@Entity
@Table(
    name = "team_space_permissions",
    uniqueConstraints = [UniqueConstraint(columnNames = ["team_id", "space_id"])]
)
data class TeamSpacePermission(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID? = null,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "team_id", nullable = false)
    val team: Team,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "space_id", nullable = false)
    val space: Space,

    @Enumerated(EnumType.STRING)
    @Column(name = "permission_level", nullable = false)
    var permissionLevel: PermissionLevel = PermissionLevel.VIEW,

    @Column(name = "created_at")
    val createdAt: Instant = Instant.now()
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is TeamSpacePermission) return false
        return id != null && id == other.id
    }

    override fun hashCode(): Int = id?.hashCode() ?: 0
}
