package com.docuvault.domain.space

import com.docuvault.domain.user.User
import jakarta.persistence.*
import java.time.Instant
import java.util.*

@Entity
@Table(name = "space_permissions")
data class SpacePermission(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID? = null,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    val user: User,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "space_id", nullable = false)
    val space: Space,

    @Enumerated(EnumType.STRING)
    @Column(name = "permission_level", nullable = false)
    var permissionLevel: PermissionLevel = PermissionLevel.VIEW,

    @Column(name = "created_at")
    val createdAt: Instant = Instant.now()
)

enum class PermissionLevel {
    VIEW,
    EDIT,
    ADMIN
}
