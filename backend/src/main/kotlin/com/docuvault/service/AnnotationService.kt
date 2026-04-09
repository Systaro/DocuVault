package com.docuvault.service

import com.docuvault.api.annotations.AnnotationDto
import com.docuvault.api.annotations.toDto
import com.docuvault.domain.space.Annotation
import com.docuvault.domain.space.Space
import com.docuvault.domain.user.User
import com.docuvault.infrastructure.repository.AnnotationRepository
import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Instant
import java.util.*

@Service
class AnnotationService(
    private val annotationRepository: AnnotationRepository,
    private val objectMapper: ObjectMapper
) {

    @Transactional(readOnly = true)
    fun getAnnotations(spaceId: UUID, filePath: String): List<AnnotationDto> {
        val topLevel = annotationRepository
            .findBySpaceIdAndFilePathAndParentIsNullOrderByCreatedAtAsc(spaceId, filePath)

        return topLevel.map { annotation ->
            val replies = annotationRepository
                .findByParentIdOrderByCreatedAtAsc(annotation.id!!)
                .map { it.toDto() }
            annotation.toDto(replies)
        }
    }

    @Transactional
    fun createAnnotation(
        space: Space,
        filePath: String,
        user: User?,
        authorName: String,
        body: String,
        anchor: Map<String, Any>?,
        parent: Annotation? = null
    ): Annotation {
        val annotation = Annotation(
            space = space,
            filePath = filePath,
            user = user,
            authorName = authorName,
            body = body,
            anchor = anchor?.let { objectMapper.writeValueAsString(it) },
            parent = parent
        )
        return annotationRepository.save(annotation)
    }

    @Transactional
    fun updateAnnotation(annotationId: UUID, body: String): Annotation? {
        val annotation = annotationRepository.findById(annotationId).orElse(null) ?: return null
        annotation.body = body
        annotation.updatedAt = Instant.now()
        return annotationRepository.save(annotation)
    }

    @Transactional
    fun resolveAnnotation(annotationId: UUID, resolvedBy: User): Annotation? {
        val annotation = annotationRepository.findById(annotationId).orElse(null) ?: return null
        annotation.resolved = true
        annotation.resolvedBy = resolvedBy
        annotation.resolvedAt = Instant.now()
        annotation.updatedAt = Instant.now()
        return annotationRepository.save(annotation)
    }

    @Transactional
    fun resolveAnonymous(annotationId: UUID): Annotation? {
        val annotation = annotationRepository.findById(annotationId).orElse(null) ?: return null
        annotation.resolved = true
        annotation.resolvedAt = Instant.now()
        annotation.updatedAt = Instant.now()
        return annotationRepository.save(annotation)
    }

    @Transactional
    fun unresolveAnnotation(annotationId: UUID): Annotation? {
        val annotation = annotationRepository.findById(annotationId).orElse(null) ?: return null
        annotation.resolved = false
        annotation.resolvedBy = null
        annotation.resolvedAt = null
        annotation.updatedAt = Instant.now()
        return annotationRepository.save(annotation)
    }

    @Transactional
    fun deleteAnnotation(annotationId: UUID): Boolean {
        if (!annotationRepository.existsById(annotationId)) return false
        annotationRepository.deleteById(annotationId)
        return true
    }

    @Transactional(readOnly = true)
    fun findById(annotationId: UUID): Annotation? {
        return annotationRepository.findById(annotationId).orElse(null)
    }

    @Transactional(readOnly = true)
    fun getUnresolvedCounts(spaceId: UUID): Map<String, Long> {
        return annotationRepository.countUnresolvedBySpaceGroupedByFile(spaceId)
            .associate { row -> row[0] as String to row[1] as Long }
    }

    @Transactional(readOnly = true)
    fun getUnresolvedCountForSpace(spaceId: UUID): Long {
        return annotationRepository.countUnresolvedBySpace(spaceId)
    }
}
