package com.docuvault.infrastructure.repository

import com.docuvault.domain.space.Annotation
import com.docuvault.domain.space.Space
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.stereotype.Repository
import java.util.*

@Repository
interface AnnotationRepository : JpaRepository<Annotation, UUID> {
    fun findBySpaceIdAndFilePathAndParentIsNullOrderByCreatedAtAsc(
        spaceId: UUID,
        filePath: String
    ): List<Annotation>

    fun findByParentIdOrderByCreatedAtAsc(parentId: UUID): List<Annotation>

    fun findBySpaceIdAndFilePath(spaceId: UUID, filePath: String): List<Annotation>

    @Query("""
        SELECT a.filePath, COUNT(a) FROM Annotation a
        WHERE a.space.id = :spaceId AND a.parent IS NULL AND a.resolved = false
        GROUP BY a.filePath
    """)
    fun countUnresolvedBySpaceGroupedByFile(spaceId: UUID): List<Array<Any>>

    @Query("""
        SELECT COUNT(a) FROM Annotation a
        WHERE a.space.id = :spaceId AND a.parent IS NULL AND a.resolved = false
    """)
    fun countUnresolvedBySpace(spaceId: UUID): Long

    @Query("""
        SELECT COUNT(a) FROM Annotation a
        WHERE a.space.id = :spaceId AND a.parent IS NULL AND a.resolved = false
          AND a.anchorState = 'ORPHANED'
    """)
    fun countUnanchoredBySpace(spaceId: UUID): Long

    /**
     * Repoint the comments on one document after it was renamed, moved within a
     * space, or transferred to another one. Without this a rename silently
     * strands every thread: the rows survive, but nothing ever queries that
     * (space, path) pair again.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
        UPDATE Annotation a SET a.space = :targetSpace, a.filePath = :targetPath
        WHERE a.space.id = :sourceSpaceId AND a.filePath = :sourcePath
    """)
    fun repoint(
        sourceSpaceId: UUID,
        sourcePath: String,
        targetSpace: Space,
        targetPath: String
    ): Int

    /** The same, for every document underneath a moved folder. */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
        UPDATE Annotation a
        SET a.space = :targetSpace,
            a.filePath = CONCAT(:targetPrefix, SUBSTRING(a.filePath, :cutFrom))
        WHERE a.space.id = :sourceSpaceId AND a.filePath LIKE :sourceLike
    """)
    fun repointUnderFolder(
        sourceSpaceId: UUID,
        sourceLike: String,
        cutFrom: Int,
        targetSpace: Space,
        targetPrefix: String
    ): Int
}
