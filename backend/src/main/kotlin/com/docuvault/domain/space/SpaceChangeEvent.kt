package com.docuvault.domain.space

import com.docuvault.domain.user.User
import jakarta.persistence.*
import java.time.Instant
import java.util.*

enum class ChangeType {
    ADDED, MODIFIED, DELETED, RENAMED
}

@Entity
@Table(name = "space_change_events")
class SpaceChangeEvent(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID? = null,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "space_id", nullable = false)
    val space: Space,

    @Column(name = "file_path", nullable = false, columnDefinition = "TEXT")
    val filePath: String,

    @Column(name = "old_path", columnDefinition = "TEXT")
    val oldPath: String? = null,

    @Enumerated(EnumType.STRING)
    @Column(name = "change_type", nullable = false)
    val changeType: ChangeType,

    @Column(name = "commit_sha", length = 40)
    val commitSha: String? = null,

    @Column(name = "commit_message", columnDefinition = "TEXT")
    val commitMessage: String? = null,

    @Column(name = "commit_author_email", length = 320)
    val commitAuthorEmail: String? = null,

    @Column(name = "commit_author_name")
    val commitAuthorName: String? = null,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "triggered_by_user_id")
    val triggeredBy: User? = null,

    @Column(name = "detected_at", nullable = false)
    val detectedAt: Instant = Instant.now()
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is SpaceChangeEvent) return false
        return id != null && id == other.id
    }

    override fun hashCode(): Int = id?.hashCode() ?: 0
}
