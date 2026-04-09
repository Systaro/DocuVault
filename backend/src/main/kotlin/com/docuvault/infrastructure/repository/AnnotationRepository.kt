package com.docuvault.infrastructure.repository

import com.docuvault.domain.space.Annotation
import org.springframework.data.jpa.repository.JpaRepository
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
}
