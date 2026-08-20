package com.docuvault.domain.space

import com.docuvault.domain.user.User
import jakarta.persistence.*
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import java.time.Instant
import java.util.*

@Entity
@Table(name = "annotations")
data class Annotation(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID? = null,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "space_id", nullable = false)
    val space: Space,

    @Column(name = "file_path", nullable = false, length = 1000)
    val filePath: String,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id")
    val user: User? = null,

    @Column(name = "author_name", nullable = false)
    val authorName: String,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "parent_id")
    val parent: Annotation? = null,

    @Column(nullable = false, columnDefinition = "TEXT")
    var body: String,

    /**
     * Where the comment was originally put. Never rewritten — it is what lets a
     * reader see what a comment used to point at once the text has moved on.
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    val anchor: String? = null,

    /** The last successful re-resolution, written back by whoever opened the document. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "anchor_current", columnDefinition = "jsonb")
    var anchorCurrent: String? = null,

    /** ANCHORED, SHIFTED or ORPHANED — never a synonym for resolved. */
    @Column(name = "anchor_state", nullable = false, length = 16)
    var anchorState: String = "ANCHORED",

    /** Document content hash at the last resolution; equal means skip re-anchoring. */
    @Column(name = "anchor_doc_hash", length = 71)
    var anchorDocHash: String? = null,

    @Column(name = "anchor_commit", length = 40)
    val anchorCommit: String? = null,

    @Column(name = "anchor_version", nullable = false)
    var anchorVersion: Short = 0,

    @Column(nullable = false)
    var resolved: Boolean = false,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "resolved_by")
    var resolvedBy: User? = null,

    @Column(name = "resolved_at")
    var resolvedAt: Instant? = null,

    @Column(name = "created_at")
    val createdAt: Instant = Instant.now(),

    @Column(name = "updated_at")
    var updatedAt: Instant = Instant.now()
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is Annotation) return false
        return id != null && id == other.id
    }

    override fun hashCode(): Int = id?.hashCode() ?: 0
}
