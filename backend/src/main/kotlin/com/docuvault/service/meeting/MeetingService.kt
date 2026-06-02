package com.docuvault.service.meeting

import com.docuvault.domain.meeting.MeetingInvite
import com.docuvault.domain.meeting.MeetingInviteStatus
import com.docuvault.domain.meeting.MeetingPhase
import com.docuvault.domain.meeting.MeetingPlatform
import com.docuvault.infrastructure.repository.MeetingInviteRepository
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.inbox.InboxService
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.*

/**
 * Issues one-time tokens for the meeting transcription bot and accepts the
 * notes it produces. The bot never holds a user session — the meeting token
 * is its only credential, scoped to a single space and a single meeting.
 */
@Service
class MeetingService(
    private val meetingInviteRepository: MeetingInviteRepository,
    private val spaceRepository: SpaceRepository,
    private val userRepository: UserRepository,
    private val inboxService: InboxService
) {
    companion object {
        const val TOKEN_PREFIX = "dvm_"
        private const val TOKEN_BYTE_LENGTH = 32
        private const val DEFAULT_VALID_HOURS = 24L

        /** ISO-639-1 codes offered for meeting transcription. Keep in sync with
         *  the language dropdown in the frontend meeting-invite modal. */
        private val SUPPORTED_LANGUAGES = setOf("de", "en", "fr", "es", "it")
    }

    private val logger = LoggerFactory.getLogger(MeetingService::class.java)
    private val secureRandom = SecureRandom()

    fun listInvites(spaceId: UUID): List<MeetingInvite> =
        meetingInviteRepository.findBySpaceIdOrderByCreatedAtDesc(spaceId)

    fun getInvite(inviteId: UUID): MeetingInvite? =
        meetingInviteRepository.findById(inviteId).orElse(null)

    /** Creates a PENDING invite and returns it together with the raw token (shown once). */
    @Transactional
    fun createInvite(
        spaceId: UUID,
        creatorEmail: String,
        label: String,
        platform: MeetingPlatform,
        language: String?,
        meetingUrl: String? = null
    ): Pair<MeetingInvite, String> {
        val space = spaceRepository.findById(spaceId)
            .orElseThrow { IllegalArgumentException("Space not found") }
        val creator = userRepository.findByEmail(creatorEmail)
            ?: throw IllegalArgumentException("User not found")

        val rawBytes = ByteArray(TOKEN_BYTE_LENGTH)
        secureRandom.nextBytes(rawBytes)
        val rawToken = TOKEN_PREFIX + Base64.getUrlEncoder().withoutPadding().encodeToString(rawBytes)

        val invite = MeetingInvite(
            space = space,
            createdBy = creator,
            label = label.ifBlank { "Meeting" },
            platform = platform,
            language = normalizeLanguage(language),
            tokenHash = hashToken(rawToken),
            tokenPrefix = rawToken.take(12),
            meetingUrl = meetingUrl?.trim()?.takeIf { it.isNotBlank() },
            expiresAt = Instant.now().plus(DEFAULT_VALID_HOURS, ChronoUnit.HOURS)
        )
        return Pair(meetingInviteRepository.save(invite), rawToken)
    }

    /**
     * Teams invites the browser bot can still join: PENDING, not expired, with a
     * join URL. The bot polls this to learn which meetings to dispatch into.
     * Claiming flips PENDING→ACTIVE, so an in-flight meeting won't reappear here.
     */
    fun listPendingTeamsInvites(): List<MeetingInvite> {
        val now = Instant.now()
        return meetingInviteRepository
            .findByPlatformAndStatus(MeetingPlatform.TEAMS, MeetingInviteStatus.PENDING)
            .filter { !it.meetingUrl.isNullOrBlank() }
            .filter { it.expiresAt?.isAfter(now) ?: true }
    }

    /** Falls back to German for blank or unsupported codes so the bot never
     *  receives a language it can't pin on the transcription call. */
    private fun normalizeLanguage(language: String?): String {
        val code = language?.trim()?.lowercase()
        return if (code in SUPPORTED_LANGUAGES) code!! else "de"
    }

    /** Cancels a still-pending invite. Returns false if missing, wrong space, or already used. */
    @Transactional
    fun cancelInvite(inviteId: UUID, spaceId: UUID): Boolean {
        val invite = meetingInviteRepository.findById(inviteId).orElse(null) ?: return false
        if (invite.space.id != spaceId) return false
        if (invite.status != MeetingInviteStatus.PENDING) return false
        invite.status = MeetingInviteStatus.CANCELLED
        meetingInviteRepository.save(invite)
        return true
    }

    // --- Bot-facing operations ---
    //
    // Two credential models resolve to the same entity-level transitions below:
    //  • Discord — the per-invite dvm_ token (the bot holds it); `authenticate`.
    //  • Teams   — the service-level dispatch token + an invite id (server-to-
    //    server, no human ever holds a token); `requireTeamsInvite`. The Teams
    //    bot never gets a dvm_ token, so none is minted or stored in plaintext.

    /** Bot joined a call: marks the invite ACTIVE and records which channel. */
    @Transactional
    fun claimInvite(rawToken: String, meetingChannel: String?): MeetingInvite =
        claimEntity(authenticate(rawToken), meetingChannel)

    /** Teams dispatch variant — resolves the invite by id. */
    @Transactional
    fun claimTeamsInvite(inviteId: UUID, meetingChannel: String?): MeetingInvite =
        claimEntity(requireTeamsInvite(inviteId), meetingChannel)

    private fun claimEntity(invite: MeetingInvite, meetingChannel: String?): MeetingInvite {
        if (invite.status == MeetingInviteStatus.CANCELLED) {
            throw IllegalArgumentException("This meeting invite was cancelled")
        }
        if (invite.status == MeetingInviteStatus.COMPLETED) {
            throw IllegalArgumentException("This meeting invite was already used")
        }
        invite.status = MeetingInviteStatus.ACTIVE
        invite.claimedAt = Instant.now()
        invite.meetingChannel = meetingChannel?.take(500)
        return meetingInviteRepository.save(invite)
    }

    /**
     * Bot finished: creates one inbox note per supplied content blob, attributed
     * to the invite creator, and marks the invite COMPLETED. Routing rules on the
     * space run automatically via [InboxService.createNote].
     */
    @Transactional
    fun submitNotes(rawToken: String, notes: List<String>, participants: String?): MeetingInvite =
        submitNotesEntity(authenticate(rawToken), notes, participants)

    /** Teams dispatch variant — resolves the invite by id. */
    @Transactional
    fun submitTeamsNotes(inviteId: UUID, notes: List<String>, participants: String?): MeetingInvite =
        submitNotesEntity(requireTeamsInvite(inviteId), notes, participants)

    private fun submitNotesEntity(
        invite: MeetingInvite,
        notes: List<String>,
        participants: String?
    ): MeetingInvite {
        if (invite.status == MeetingInviteStatus.CANCELLED) {
            throw IllegalArgumentException("This meeting invite was cancelled")
        }
        if (invite.status == MeetingInviteStatus.COMPLETED) {
            throw IllegalArgumentException("This meeting invite was already used")
        }

        val accepted = notes.filter { it.isNotBlank() }
        accepted.forEach { content ->
            inboxService.createNote(invite.space.id!!, invite.createdBy.email, content)
        }

        invite.status = MeetingInviteStatus.COMPLETED
        invite.completedAt = Instant.now()
        invite.noteCount = accepted.size
        invite.participants = participants?.take(4000)
        logger.info("Meeting invite ${invite.id} completed with ${accepted.size} note(s)")
        return meetingInviteRepository.save(invite)
    }

    /** Bot reports a live progress update while transcribing. Best-effort: never
     *  changes the invite's [MeetingInviteStatus], only its phase/progress. */
    @Transactional
    fun recordProgress(
        rawToken: String,
        phase: MeetingPhase,
        current: Int?,
        total: Int?,
        message: String?
    ): MeetingInvite = recordProgressEntity(authenticate(rawToken), phase, current, total, message)

    /** Teams dispatch variant — resolves the invite by id. */
    @Transactional
    fun recordTeamsProgress(
        inviteId: UUID,
        phase: MeetingPhase,
        current: Int?,
        total: Int?,
        message: String?
    ): MeetingInvite = recordProgressEntity(requireTeamsInvite(inviteId), phase, current, total, message)

    private fun recordProgressEntity(
        invite: MeetingInvite,
        phase: MeetingPhase,
        current: Int?,
        total: Int?,
        message: String?
    ): MeetingInvite {
        invite.phase = phase
        invite.progressCurrent = current
        invite.progressTotal = total
        invite.progressMessage = message?.take(500)
        return meetingInviteRepository.save(invite)
    }

    /** Bot hit an unrecoverable error: records it against the invite. */
    @Transactional
    fun failInvite(rawToken: String, errorMessage: String?): MeetingInvite =
        failEntity(authenticate(rawToken), errorMessage)

    /** Teams dispatch variant — resolves the invite by id. */
    @Transactional
    fun failTeamsInvite(inviteId: UUID, errorMessage: String?): MeetingInvite =
        failEntity(requireTeamsInvite(inviteId), errorMessage)

    private fun failEntity(invite: MeetingInvite, errorMessage: String?): MeetingInvite {
        if (invite.status == MeetingInviteStatus.COMPLETED) return invite
        invite.status = MeetingInviteStatus.FAILED
        invite.error = errorMessage?.take(4000)
        logger.warn("Meeting invite ${invite.id} failed: $errorMessage")
        return meetingInviteRepository.save(invite)
    }

    /** Resolves a TEAMS invite by id for the dispatch-token-authenticated bot.
     *  Rejects unknown ids and non-Teams invites (the dispatch credential must
     *  never reach Discord invites). Expiry only blocks still-PENDING invites,
     *  mirroring [authenticate]. */
    private fun requireTeamsInvite(inviteId: UUID): MeetingInvite {
        val invite = meetingInviteRepository.findById(inviteId).orElse(null)
            ?: throw IllegalArgumentException("Meeting invite not found")
        if (invite.platform != MeetingPlatform.TEAMS) {
            throw IllegalArgumentException("Not a Teams meeting invite")
        }
        val expiresAt = invite.expiresAt
        if (expiresAt != null && expiresAt.isBefore(Instant.now()) &&
            invite.status == MeetingInviteStatus.PENDING
        ) {
            throw IllegalArgumentException("This meeting invite has expired")
        }
        return invite
    }

    private fun authenticate(rawToken: String): MeetingInvite {
        if (!rawToken.startsWith(TOKEN_PREFIX)) {
            throw IllegalArgumentException("Invalid meeting token")
        }
        val invite = meetingInviteRepository.findByTokenHash(hashToken(rawToken))
            ?: throw IllegalArgumentException("Invalid meeting token")
        val expiresAt = invite.expiresAt
        if (expiresAt != null && expiresAt.isBefore(Instant.now()) &&
            invite.status == MeetingInviteStatus.PENDING
        ) {
            throw IllegalArgumentException("This meeting invite has expired")
        }
        return invite
    }

    private fun hashToken(rawToken: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
        return digest.digest(rawToken.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }
}
