package com.docuvault.domain.space

import jakarta.persistence.*
import java.time.Instant
import java.util.*

/**
 * One rename or move of a file or folder — within a space or across spaces.
 * Rows are written whenever the app relocates an item and are never rewritten,
 * so a chain of moves resolves hop by hop.
 *
 * Folder rows exist so an old folder URL still forwards; the per-file rows of a
 * cross-space move additionally carry where the document originally came from.
 */
@Entity
@Table(name = "document_moves")
data class DocumentMove(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID? = null,

    @Column(name = "source_space_id", nullable = false)
    val sourceSpaceId: UUID,

    @Column(name = "source_path", nullable = false, columnDefinition = "TEXT")
    val sourcePath: String,

    @Column(name = "target_space_id", nullable = false)
    val targetSpaceId: UUID,

    @Column(name = "target_path", nullable = false, columnDefinition = "TEXT")
    val targetPath: String,

    @Column(name = "is_directory", nullable = false)
    val isDirectory: Boolean = false,

    /**
     * Who created the document before it crossed spaces. Only set on the
     * per-file rows of a cross-space move: within a space git rename detection
     * finds the original commit by itself, so recording it would be redundant.
     */
    @Column(name = "origin_author_name")
    val originAuthorName: String? = null,

    @Column(name = "origin_author_email", length = 320)
    val originAuthorEmail: String? = null,

    @Column(name = "origin_commit_sha", length = 64)
    val originCommitSha: String? = null,

    @Column(name = "origin_created_at")
    val originCreatedAt: Instant? = null,

    @Column(name = "moved_at", nullable = false)
    val movedAt: Instant = Instant.now(),

    @Column(name = "moved_by")
    val movedBy: UUID? = null
)
