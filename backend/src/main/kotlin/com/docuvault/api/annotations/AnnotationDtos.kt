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
    val authorName: String? = null
)

data class UpdateAnnotationRequest(
    @field:NotBlank(message = "Body is required")
    val body: String
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
    resolved = this.resolved,
    resolvedByName = this.resolvedBy?.name,
    resolvedAt = this.resolvedAt,
    createdAt = this.createdAt,
    updatedAt = this.updatedAt,
    replies = replies
)
