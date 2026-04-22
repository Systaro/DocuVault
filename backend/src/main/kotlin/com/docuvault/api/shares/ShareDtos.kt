package com.docuvault.api.shares

import com.docuvault.domain.space.SharedLink
import com.docuvault.domain.space.SharedLinkAccessDenial
import java.time.Instant
import java.util.*

data class CreateShareLinkRequest(
    val filePath: String,
    val expiresInDays: Int? = null,
    val password: String? = null,
    val shareType: String = "FILE",
    val writableScopes: List<String> = emptyList(),
    val accessLevel: String = "VIEW"
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
    val createdAt: Instant,
    val hasPassword: Boolean,
    val shareType: String,
    val writableScopes: List<String>,
    val accessLevel: String
)

data class SharedFileMetadataDto(
    val fileName: String,
    val extension: String,
    val contentType: String,
    val spaceName: String,
    val filePath: String,
    val shareType: String,
    val accessLevel: String,
    val requiresPassword: Boolean,
    val ogTitle: String? = null,
    val ogDescription: String? = null,
    val ogImageUrl: String? = null
)

data class SharePasswordRequest(val password: String)

data class UpdateSharePasswordRequest(val password: String?)

data class SharedLinkAccessDenialDto(
    val id: UUID,
    val reason: String,
    val clientIp: String?,
    val userAgent: String?,
    val requestUri: String?,
    val createdAt: Instant
)

fun SharedLinkAccessDenial.toDto() = SharedLinkAccessDenialDto(
    id = this.id!!,
    reason = this.reason.name,
    clientIp = this.clientIp,
    userAgent = this.userAgent,
    requestUri = this.requestUri,
    createdAt = this.createdAt
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
    createdAt = this.createdAt,
    hasPassword = this.passwordHash != null,
    shareType = this.shareType.name,
    writableScopes = this.writableScopes,
    accessLevel = this.accessLevel.name
)
