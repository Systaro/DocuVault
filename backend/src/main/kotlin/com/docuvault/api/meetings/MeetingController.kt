package com.docuvault.api.meetings

import com.docuvault.domain.meeting.MeetingInvite
import com.docuvault.domain.meeting.MeetingInviteStatus
import com.docuvault.domain.meeting.MeetingPhase
import com.docuvault.domain.meeting.MeetingPlatform
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.PermissionService
import com.docuvault.service.meeting.MeetingService
import com.docuvault.service.meeting.MeetingStreamService
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import org.springframework.beans.factory.annotation.Value
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.core.userdetails.UserDetails
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.*
import org.springframework.web.server.ResponseStatusException
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter
import java.time.Instant
import java.util.*

/**
 * User-facing endpoints for managing meeting transcription invites. A meeting
 * invite hands the transcription bot a one-time token scoped to one space.
 */
@RestController
@RequestMapping("/spaces/{spaceId}/meetings")
class MeetingController(
    private val meetingService: MeetingService,
    private val userRepository: UserRepository,
    private val permissionService: PermissionService,
    private val streamService: MeetingStreamService
) {
    @GetMapping
    @Transactional(readOnly = true)
    fun listInvites(
        @PathVariable spaceId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<List<MeetingInviteDto>> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()
        if (!permissionService.hasAccess(user.id!!, spaceId, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }
        return ResponseEntity.ok(meetingService.listInvites(spaceId).map { it.toDto() })
    }

    /**
     * Live stream of meeting-invite updates for this space (Server-Sent Events).
     * Pushes the full invite DTO whenever the bot claims, reports progress, or
     * finishes — letting the inbox show transcription status in real time.
     */
    @GetMapping("/stream")
    fun stream(
        @PathVariable spaceId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails,
        response: jakarta.servlet.http.HttpServletResponse
    ): SseEmitter {
        val user = userRepository.findByEmail(userDetails.username)
            ?: throw ResponseStatusException(HttpStatus.UNAUTHORIZED)
        if (!permissionService.hasAccess(user.id!!, spaceId, user.role)) {
            throw ResponseStatusException(HttpStatus.FORBIDDEN)
        }
        // Tell nginx (and any buffering proxy) to stream this response immediately.
        response.setHeader("X-Accel-Buffering", "no")
        response.setHeader("Cache-Control", "no-cache")
        return streamService.subscribe(spaceId)
    }

    @PostMapping
    fun createInvite(
        @PathVariable spaceId: UUID,
        @Valid @RequestBody request: CreateInviteRequest,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<MeetingInviteDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()
        if (!permissionService.hasEditAccess(user.id!!, spaceId, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }
        val platform = request.platform ?: MeetingPlatform.DISCORD
        val (invite, rawToken) = meetingService.createInvite(
            spaceId, userDetails.username, request.label, platform, request.language
        )
        // The raw token is returned exactly once, on creation.
        return ResponseEntity.status(HttpStatus.CREATED).body(invite.toDto(rawToken))
    }

    @DeleteMapping("/{inviteId}")
    fun cancelInvite(
        @PathVariable spaceId: UUID,
        @PathVariable inviteId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<Void> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()
        if (!permissionService.hasEditAccess(user.id!!, spaceId, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }
        return if (meetingService.cancelInvite(inviteId, spaceId)) {
            ResponseEntity.noContent().build()
        } else {
            ResponseEntity.notFound().build()
        }
    }
}

/**
 * Bot-facing endpoints. These are public (see SecurityConfig) and authenticate
 * solely via the meeting token in the Authorization header — the bot never has
 * a user session.
 */
@RestController
@RequestMapping("/meetings/bot")
class MeetingBotController(
    private val meetingService: MeetingService,
    private val streamService: MeetingStreamService,
    @Value("\${app.public-url}") private val publicUrl: String
) {
    @PostMapping("/claim")
    fun claim(
        @RequestHeader("Authorization") authHeader: String,
        @RequestBody request: ClaimRequest
    ): ResponseEntity<ClaimResponse> {
        val invite = meetingService.claimInvite(bearerToken(authHeader), request.meetingChannel)
        streamService.publish(invite.space.id!!, invite.toDto())
        val base = publicUrl.trimEnd('/')
        val inboxUrl = "$base/${invite.space.getFullPath()}/inbox"
        return ResponseEntity.ok(
            ClaimResponse(
                spaceId = invite.space.id!!,
                spaceName = invite.space.name,
                label = invite.label,
                language = invite.language,
                inboxUrl = inboxUrl
            )
        )
    }

    @PostMapping("/progress")
    fun progress(
        @RequestHeader("Authorization") authHeader: String,
        @RequestBody request: ProgressRequest
    ): ResponseEntity<MeetingInviteDto> {
        val invite = meetingService.recordProgress(
            bearerToken(authHeader), request.phase, request.current, request.total, request.message
        )
        val dto = invite.toDto()
        streamService.publish(invite.space.id!!, dto)
        return ResponseEntity.ok(dto)
    }

    @PostMapping("/notes")
    fun submitNotes(
        @RequestHeader("Authorization") authHeader: String,
        @RequestBody request: SubmitNotesRequest
    ): ResponseEntity<MeetingInviteDto> {
        val invite = meetingService.submitNotes(
            bearerToken(authHeader), request.notes, request.participants
        )
        val dto = invite.toDto()
        streamService.publish(invite.space.id!!, dto)
        return ResponseEntity.ok(dto)
    }

    @PostMapping("/fail")
    fun fail(
        @RequestHeader("Authorization") authHeader: String,
        @RequestBody request: FailRequest
    ): ResponseEntity<MeetingInviteDto> {
        val invite = meetingService.failInvite(bearerToken(authHeader), request.error)
        val dto = invite.toDto()
        streamService.publish(invite.space.id!!, dto)
        return ResponseEntity.ok(dto)
    }

    private fun bearerToken(authHeader: String): String {
        if (!authHeader.startsWith("Bearer ")) {
            throw IllegalArgumentException("Missing bearer token")
        }
        return authHeader.removePrefix("Bearer ").trim()
    }
}

// --- Request DTOs ---

data class CreateInviteRequest(
    @field:NotBlank val label: String,
    val platform: MeetingPlatform? = null,
    /** ISO-639-1 spoken language; defaults to German server-side when omitted. */
    val language: String? = null
)

data class ClaimRequest(
    val meetingChannel: String? = null
)

data class SubmitNotesRequest(
    val notes: List<String> = emptyList(),
    val participants: String? = null
)

data class FailRequest(
    val error: String? = null
)

data class ProgressRequest(
    val phase: MeetingPhase,
    val current: Int? = null,
    val total: Int? = null,
    val message: String? = null
)

// --- Response DTOs ---

data class MeetingInviteDto(
    val id: UUID,
    val spaceId: UUID,
    val label: String,
    val platform: MeetingPlatform,
    val language: String,
    val status: MeetingInviteStatus,
    val tokenPrefix: String,
    /** Full token — only populated in the response to invite creation. */
    val token: String?,
    val meetingChannel: String?,
    val participants: String?,
    val noteCount: Int,
    val phase: MeetingPhase?,
    val progressCurrent: Int?,
    val progressTotal: Int?,
    val progressMessage: String?,
    val error: String?,
    val expiresAt: Instant?,
    val claimedAt: Instant?,
    val completedAt: Instant?,
    val createdAt: Instant
)

data class ClaimResponse(
    val spaceId: UUID,
    val spaceName: String,
    val label: String,
    /** ISO-639-1 spoken language to pin for speech-to-text and the meeting note. */
    val language: String,
    /** Ready-to-open URL of the target inbox; built from app.public-url. */
    val inboxUrl: String
)

fun MeetingInvite.toDto(rawToken: String? = null) = MeetingInviteDto(
    id = this.id!!,
    spaceId = this.space.id!!,
    label = this.label,
    platform = this.platform,
    language = this.language,
    status = this.status,
    tokenPrefix = this.tokenPrefix,
    token = rawToken,
    meetingChannel = this.meetingChannel,
    participants = this.participants,
    noteCount = this.noteCount,
    phase = this.phase,
    progressCurrent = this.progressCurrent,
    progressTotal = this.progressTotal,
    progressMessage = this.progressMessage,
    error = this.error,
    expiresAt = this.expiresAt,
    claimedAt = this.claimedAt,
    completedAt = this.completedAt,
    createdAt = this.createdAt
)
