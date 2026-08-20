package com.docuvault.api.annotations

import com.docuvault.domain.space.Annotation
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.readValue
import jakarta.validation.constraints.NotBlank
import java.time.Instant
import java.util.*

data class AnnotationDto(
    val id: UUID,
    val spaceId: UUID,
    val filePath: String,
    val userId: UUID?,
    val authorName: String,
    val parentId: UUID?,
    val body: String,
    val anchor: Map<String, Any>?,
    /** Last successful re-resolution; falls back to [anchor] when never re-anchored. */
    val anchorCurrent: Map<String, Any>?,
    val anchorState: String,
    val anchorDocHash: String?,
    val anchorVersion: Int,
    val resolved: Boolean,
    val resolvedByName: String?,
    val resolvedAt: Instant?,
    val createdAt: Instant,
    val updatedAt: Instant,
    val replies: List<AnnotationDto> = emptyList()
)

data class CreateAnnotationRequest(
    @field:NotBlank(message = "Body is required")
    val body: String,
    val anchor: Map<String, Any>? = null,
    val parentId: UUID? = null,
    val authorName: String? = null,
    /** Content hash of the document the comment was placed against. */
    val docHash: String? = null
)

data class UpdateAnnotationRequest(
    @field:NotBlank(message = "Body is required")
    val body: String
)

/**
 * Written back by whichever client last resolved this comment against the
 * document. It is a cache of where the anchor currently lands, not content —
 * so anyone who may read the document may also refresh it.
 */
data class UpdateAnchorRequest(
    val anchorCurrent: Map<String, Any>? = null,
    @field:NotBlank(message = "State is required")
    val anchorState: String,
    val docHash: String? = null
)

private val objectMapper = ObjectMapper()

fun Annotation.toDto(replies: List<AnnotationDto> = emptyList()): AnnotationDto = AnnotationDto(
    id = this.id!!,
    spaceId = this.space.id!!,
    filePath = this.filePath,
    userId = this.user?.id,
    authorName = this.authorName,
    parentId = this.parent?.id,
    body = this.body,
    anchor = this.anchor?.let { objectMapper.readValue<Map<String, Any>>(it) },
    anchorCurrent = (this.anchorCurrent ?: this.anchor)?.let { objectMapper.readValue<Map<String, Any>>(it) },
    anchorState = this.anchorState,
    anchorDocHash = this.anchorDocHash,
    anchorVersion = this.anchorVersion.toInt(),
    resolved = this.resolved,
    resolvedByName = this.resolvedBy?.name,
    resolvedAt = this.resolvedAt,
    createdAt = this.createdAt,
    updatedAt = this.updatedAt,
    replies = replies
)
