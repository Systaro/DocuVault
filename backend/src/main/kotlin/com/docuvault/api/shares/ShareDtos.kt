package com.docuvault.api.shares

import com.docuvault.domain.space.SharedLink
import java.time.Instant
import java.util.*

data class CreateShareLinkRequest(
    val filePath: String,
    val expiresInDays: Int? = null
)

data class SharedLinkDto(
    val id: UUID,
    val token: String,
    val spaceId: UUID,
    val filePath: String,
    val expiresAt: Instant?,
    val revokedAt: Instant?,
    val accessCount: Int,
    val lastAccessedAt: Instant?,
    val createdAt: Instant
)

data class SharedFileMetadataDto(
    val fileName: String,
    val extension: String,
    val contentType: String
)

fun SharedLink.toDto() = SharedLinkDto(
    id = this.id!!,
    token = this.token,
    spaceId = this.space.id!!,
    filePath = this.filePath,
    expiresAt = this.expiresAt,
    revokedAt = this.revokedAt,
    accessCount = this.accessCount,
    lastAccessedAt = this.lastAccessedAt,
    createdAt = this.createdAt
)
