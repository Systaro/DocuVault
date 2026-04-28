package com.docuvault.domain.user

import jakarta.persistence.*
import java.time.Instant
import java.util.*

@Entity
@Table(name = "users")
data class User(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID? = null,

    @Column(unique = true, nullable = false)
    val email: String,

    @Column(name = "password_hash", nullable = false)
    var passwordHash: String,

    @Column(nullable = false)
    var name: String,

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    var role: UserRole = UserRole.VIEWER,

    @Enumerated(EnumType.STRING)
    @Column(name = "push_mode", nullable = false)
    var pushMode: PushMode = PushMode.INSTANT,

    @Enumerated(EnumType.STRING)
    @Column(name = "email_mode", nullable = false)
    var emailMode: EmailMode = EmailMode.NONE,

    @Column(nullable = false)
    var enabled: Boolean = true,

    @Column(name = "created_at")
    val createdAt: Instant = Instant.now(),

    @Column(name = "updated_at")
    var updatedAt: Instant = Instant.now()
)

enum class UserRole {
    SUPER_ADMIN,
    ORG_ADMIN,
    EDITOR,
    VIEWER
}

enum class PushMode {
    INSTANT,
    NONE
}

enum class EmailMode {
    INSTANT,
    HOURLY,
    DAILY,
    NONE
}
