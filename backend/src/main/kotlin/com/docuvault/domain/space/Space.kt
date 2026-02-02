package com.docuvault.domain.space

import com.docuvault.domain.user.User
import jakarta.persistence.*
import java.time.Instant
import java.util.*

@Entity
@Table(name = "spaces")
data class Space(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID? = null,

    @Column(nullable = false)
    var name: String,

    @Column(unique = true, nullable = false)
    val slug: String,

    var description: String? = null,

    @Column(name = "gitlab_project_id")
    val gitlabProjectId: Int? = null,

    @Column(name = "gitlab_url")
    val gitlabUrl: String? = null,

    @Column(nullable = false)
    var branch: String = "main",

    @Column(name = "sync_enabled")
    var syncEnabled: Boolean = true,

    @Column(name = "sync_interval_minutes")
    var syncIntervalMinutes: Int = 15,

    @Column(name = "last_synced_at")
    var lastSyncedAt: Instant? = null,

    @Column(name = "last_sync_error", length = 1000)
    var lastSyncError: String? = null,

    @Column(name = "logo_url", length = 500)
    var logoUrl: String? = null,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "created_by")
    val createdBy: User,

    @Column(name = "created_at")
    val createdAt: Instant = Instant.now(),

    @Column(name = "updated_at")
    var updatedAt: Instant = Instant.now(),

    @OneToMany(mappedBy = "space", cascade = [CascadeType.ALL], orphanRemoval = true)
    val permissions: MutableSet<SpacePermission> = mutableSetOf(),

    @OneToMany(mappedBy = "space", cascade = [CascadeType.ALL], orphanRemoval = true)
    val documents: MutableSet<Document> = mutableSetOf()
)
