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
        parent: Annotation? = null,
        docHash: String? = null
    ): Annotation {
        val serialised = anchor?.let { objectMapper.writeValueAsString(it) }
        val annotation = Annotation(
            space = space,
            filePath = filePath,
            user = user,
            authorName = authorName,
            body = body,
            anchor = serialised,
            // The original doubles as the current resolution until something moves.
            anchorCurrent = serialised,
            anchorState = "ANCHORED",
            anchorDocHash = docHash,
            anchorVersion = ((anchor?.get("v") as? Number)?.toShort()) ?: 0,
            parent = parent
        )
        return annotationRepository.save(annotation)
    }

    /**
     * Record where a comment currently lands. Called by whichever client last
     * rendered the document, so a re-anchor is computed once and then read from
     * the cache by everyone after them.
     */
    @Transactional
    fun updateAnchor(
        annotationId: UUID,
        anchorCurrent: Map<String, Any>?,
        anchorState: String,
        docHash: String?
    ): Annotation? {
        val annotation = annotationRepository.findById(annotationId).orElse(null) ?: return null
        val state = anchorState.uppercase()
        if (state !in ANCHOR_STATES) return null

        anchorCurrent?.let {
            annotation.anchorCurrent = objectMapper.writeValueAsString(it)
            (it["v"] as? Number)?.let { version -> annotation.anchorVersion = version.toShort() }
        }
        annotation.anchorState = state
        annotation.anchorDocHash = docHash
        // Deliberately not touching updatedAt: re-anchoring is bookkeeping, and
        // letting it bump the timestamp would reorder threads on every render.
        return annotationRepository.save(annotation)
    }

    private companion object {
        val ANCHOR_STATES = setOf("ANCHORED", "SHIFTED", "ORPHANED")
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

    /** Open comments that no longer have a place in their document. */
    @Transactional(readOnly = true)
    fun getUnanchoredCount(spaceId: UUID): Long =
        annotationRepository.countUnanchoredBySpace(spaceId)

    /**
     * Move the comments on a document to wherever the document went — a rename,
     * a move within a space, or a transfer into another one.
     *
     * Comments are addressed by (space, path), so without this a rename strands
     * every thread on the file: the rows survive, but nothing queries that pair
     * again. The bulk update needs a transaction of its own, which is the whole
     * reason this lives here rather than being inlined at the call sites.
     */
    @Transactional
    fun repointToNewPath(
        sourceSpaceId: UUID,
        sourcePath: String,
        targetSpace: Space,
        targetPath: String,
        isDirectory: Boolean
    ): Int = if (isDirectory) {
        annotationRepository.repointUnderFolder(
            sourceSpaceId = sourceSpaceId,
            sourceLike = "$sourcePath/%",
            cutFrom = sourcePath.length + 1,
            targetSpace = targetSpace,
            targetPrefix = targetPath
        )
    } else {
        annotationRepository.repoint(
            sourceSpaceId = sourceSpaceId,
            sourcePath = sourcePath,
            targetSpace = targetSpace,
            targetPath = targetPath
        )
    }

    @Transactional(readOnly = true)
    fun getUnresolvedCountForSpace(spaceId: UUID): Long {
        return annotationRepository.countUnresolvedBySpace(spaceId)
    }
}
