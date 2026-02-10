package com.docuvault.domain.space

import com.docuvault.domain.user.User
import jakarta.persistence.*
import java.time.Instant
import java.util.*

@Entity
@Table(
    name = "spaces",
    uniqueConstraints = [UniqueConstraint(columnNames = ["slug", "parent_id"])]
)
data class Space(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID? = null,

    @Column(nullable = false)
    var name: String,

    @Column(nullable = false)
    val slug: String,

    var description: String? = null,

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    val type: SpaceType = SpaceType.REPOSITORY,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "parent_id")
    val parent: Space? = null,

    @OneToMany(mappedBy = "parent", cascade = [CascadeType.ALL], orphanRemoval = true)
    val children: MutableSet<Space> = mutableSetOf(),

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
) {
    fun getFullPath(): String {
        val parts = mutableListOf<String>()
        var current: Space? = this
        while (current != null) {
            parts.add(0, current.slug)
            current = current.parent
        }
        return parts.joinToString("/")
    }

    fun getDepth(): Int {
        var depth = 0
        var current: Space? = this.parent
        while (current != null) {
            depth++
            current = current.parent
        }
        return depth
    }

    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is Space) return false
        return id != null && id == other.id
    }

    override fun hashCode(): Int = id?.hashCode() ?: 0
}
