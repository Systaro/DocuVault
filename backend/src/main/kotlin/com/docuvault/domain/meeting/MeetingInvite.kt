package com.docuvault.domain.meeting

import com.docuvault.domain.space.Space
import com.docuvault.domain.user.User
import jakarta.persistence.*
import java.time.Instant
import java.util.*

enum class MeetingPlatform {
    DISCORD, TEAMS
}

enum class MeetingInviteStatus {
    /** Token created, bot has not joined yet. */
    PENDING,

    /** Bot joined a call and is recording. */
    ACTIVE,

    /** Bot finished and posted notes to the inbox. */
    COMPLETED,

    /** Bot reported an error. */
    FAILED,

    /** Invite was cancelled before use. */
    CANCELLED
}

/** Fine-grained sub-stage of an [MeetingInviteStatus.ACTIVE] invite, reported
 *  live by the bot so the UI can show what it is doing right now. */
enum class MeetingPhase {
    /** Bot is in the call capturing audio. */
    RECORDING,

    /** Recording stopped, bot is preparing the captured utterances. */
    PROCESSING,

    /** Bot is running speech-to-text over the utterances. */
    TRANSCRIBING,

    /** Bot is generating the AI meeting note from the transcript. */
    SUMMARIZING
}

@Entity
@Table(name = "meeting_invites")
data class MeetingInvite(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID? = null,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "space_id", nullable = false)
    val space: Space,

    /** Inbox notes produced by this meeting are attributed to this user. */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "created_by", nullable = false)
    val createdBy: User,

    @Column(nullable = false)
    var label: String,

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    val platform: MeetingPlatform = MeetingPlatform.DISCORD,

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    var status: MeetingInviteStatus = MeetingInviteStatus.PENDING,

    @Column(name = "token_hash", nullable = false, unique = true, length = 64)
    val tokenHash: String,

    @Column(name = "token_prefix", nullable = false, length = 16)
    val tokenPrefix: String,

    /** Human-readable call the bot joined, recorded by the bot on claim. */
    @Column(name = "meeting_channel", length = 500)
    var meetingChannel: String? = null,

    /** Comma-separated speaker display names, recorded by the bot. */
    @Column(columnDefinition = "TEXT")
    var participants: String? = null,

    @Column(name = "note_count", nullable = false)
    var noteCount: Int = 0,

    /** Current sub-stage while ACTIVE; null otherwise. Reported live by the bot. */
    @Enumerated(EnumType.STRING)
    @Column(length = 20)
    var phase: MeetingPhase? = null,

    /** Items processed so far in the current phase (e.g. utterances transcribed). */
    @Column(name = "progress_current")
    var progressCurrent: Int? = null,

    /** Total items in the current phase, if known. */
    @Column(name = "progress_total")
    var progressTotal: Int? = null,

    /** Human-readable status line the bot is currently showing (German). */
    @Column(name = "progress_message", length = 500)
    var progressMessage: String? = null,

    @Column(columnDefinition = "TEXT")
    var error: String? = null,

    @Column(name = "expires_at")
    var expiresAt: Instant? = null,

    @Column(name = "claimed_at")
    var claimedAt: Instant? = null,

    @Column(name = "completed_at")
    var completedAt: Instant? = null,

    @Column(name = "created_at")
    val createdAt: Instant = Instant.now()
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is MeetingInvite) return false
        return id != null && id == other.id
    }

    override fun hashCode(): Int = id?.hashCode() ?: 0
}
