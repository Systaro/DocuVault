package com.docuvault.infrastructure.repository

import com.docuvault.domain.space.Annotation
import org.springframework.data.jpa.repository.JpaRepository
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
}
