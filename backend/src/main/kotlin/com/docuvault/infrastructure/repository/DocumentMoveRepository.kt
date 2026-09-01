package com.docuvault.infrastructure.repository

import com.docuvault.domain.space.DocumentMove
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Repository
import java.util.*

@Repository
interface DocumentMoveRepository : JpaRepository<DocumentMove, UUID> {

    /** Moves away from exactly this path, newest first. */
    fun findBySourceSpaceIdAndSourcePathOrderByMovedAtDesc(
        sourceSpaceId: UUID,
        sourcePath: String
    ): List<DocumentMove>

    /**
     * Folder moves out of a space, newest first. A path with no exact row of its
     * own may still have travelled inside a moved folder, so the caller matches
     * these by prefix. Folder moves are rare, which keeps this small.
     */
    fun findBySourceSpaceIdAndIsDirectoryTrueOrderByMovedAtDesc(
        sourceSpaceId: UUID
    ): List<DocumentMove>

    /** Where the document now at this path came from, newest first. */
    fun findByTargetSpaceIdAndTargetPathOrderByMovedAtDesc(
        targetSpaceId: UUID,
        targetPath: String
    ): List<DocumentMove>
}
