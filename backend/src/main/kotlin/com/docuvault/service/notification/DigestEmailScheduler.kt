package com.docuvault.service.notification

import com.docuvault.domain.space.NotificationChannel
import com.docuvault.domain.space.NotificationDispatch
import com.docuvault.domain.space.Space
import com.docuvault.domain.space.SpaceChangeEvent
import com.docuvault.domain.user.EmailMode
import com.docuvault.domain.user.User
import com.docuvault.domain.user.UserRole
import com.docuvault.infrastructure.repository.NotificationDispatchRepository
import com.docuvault.infrastructure.repository.SpaceChangeEventRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.EmailService
import com.docuvault.service.PermissionService
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Instant
import java.time.temporal.ChronoUnit

@Service
class DigestEmailScheduler(
    private val changeEventRepository: SpaceChangeEventRepository,
    private val dispatchRepository: NotificationDispatchRepository,
    private val permissionService: PermissionService,
    private val userRepository: UserRepository,
    private val subscriptionService: NotificationSubscriptionService,
    private val emailService: EmailService,
    @Value("\${app.public-url:https://docuvault.systaro.de}") private val publicUrl: String
) {
    private val logger = LoggerFactory.getLogger(DigestEmailScheduler::class.java)

    /** Top of every hour — sends to users with emailMode=HOURLY. */
    @Scheduled(cron = "0 0 * * * *")
    @Transactional
    fun sendHourlyDigests() = sendDigest(
        windowHours = 1,
        targetMode = EmailMode.HOURLY,
        channel = NotificationChannel.EMAIL_HOURLY,
        headingLabel = "Hourly",
        windowLabel = "hour"
    )

    /** 08:00 server time — sends to users with emailMode=DAILY. */
    @Scheduled(cron = "0 0 8 * * *")
    @Transactional
    fun sendDailyDigests() = sendDigest(
        windowHours = 24,
        targetMode = EmailMode.DAILY,
        channel = NotificationChannel.EMAIL_DAILY,
        headingLabel = "Daily",
        windowLabel = "24 hours"
    )

    private data class PendingSpace(val space: Space, val events: List<SpaceChangeEvent>)

    private fun sendDigest(
        windowHours: Long,
        targetMode: EmailMode,
        channel: NotificationChannel,
        headingLabel: String,
        windowLabel: String
    ) {
        val to = Instant.now()
        val from = to.minus(windowHours, ChronoUnit.HOURS)

        val events = changeEventRepository.findByDetectedAtBetweenOrderBySpaceIdAscDetectedAtAsc(from, to)
        if (events.isEmpty()) {
            logger.debug("No change events in last {}h, skipping {} digest", windowHours, targetMode)
            return
        }

        // Build, per recipient, the set of spaces + still-undispatched events they should see.
        // One consolidated email per user across all the spaces they're subscribed to.
        val perUser = LinkedHashMap<User, MutableList<PendingSpace>>()

        for ((_, spaceEvents) in events.groupBy { it.space.id!! }) {
            val space = spaceEvents.first().space
            for (user in candidatesFor(space, targetMode)) {
                if (!subscriptionService.isSubscribed(user.id!!, space)) continue
                // Don't notify someone about their own commits.
                val visible = spaceEvents.filter { it.triggeredBy?.id != user.id }
                val undispatched = visible.filter {
                    !dispatchRepository.existsByEventIdAndUserIdAndChannel(it.id!!, user.id!!, channel)
                }
                if (undispatched.isEmpty()) continue
                perUser.getOrPut(user) { mutableListOf() }.add(PendingSpace(space, undispatched))
            }
        }

        for ((user, pendingSpaces) in perUser) {
            val token = subscriptionService.tokenFor(user)
            val views = pendingSpaces.map { ps ->
                DigestSpaceView(
                    spaceId = ps.space.id!!,
                    spaceName = ps.space.name,
                    changes = ps.events.map { evt ->
                        DigestChange(
                            changeType = evt.changeType,
                            path = evt.filePath,
                            oldPath = evt.oldPath,
                            author = evt.triggeredBy?.name ?: evt.commitAuthorName ?: "Unknown"
                        )
                    }
                )
            }
            val totalChanges = views.sumOf { it.changes.size }
            val html = NotificationEmail.buildDigest(views, headingLabel, publicUrl, token)
            val subject = digestSubject(views, totalChanges, windowLabel)
            val headers = NotificationEmail.unsubscribeHeaders(publicUrl, token)

            val result = runCatching { emailService.sendHtml(user.email, subject, html, headers) }
            if (result.isSuccess) {
                pendingSpaces.forEach { ps ->
                    ps.events.forEach { evt ->
                        dispatchRepository.save(
                            NotificationDispatch(event = evt, user = user, channel = channel, success = true)
                        )
                    }
                }
            } else {
                logger.warn("Failed to send {} digest to {}: {}", targetMode, user.email, result.exceptionOrNull()?.message)
                pendingSpaces.firstOrNull()?.events?.firstOrNull()?.let { evt ->
                    dispatchRepository.save(
                        NotificationDispatch(
                            event = evt,
                            user = user,
                            channel = channel,
                            success = false,
                            error = result.exceptionOrNull()?.message?.take(500)
                        )
                    )
                }
            }
        }
    }

    private fun digestSubject(views: List<DigestSpaceView>, total: Int, windowLabel: String): String {
        val plural = if (total == 1) "" else "s"
        return if (views.size == 1) {
            "${views[0].spaceName}: $total change$plural in last $windowLabel"
        } else {
            "DocuVault digest: $total change$plural across ${views.size} spaces (last $windowLabel)"
        }
    }

    /** Members of the space, members of its parent group, plus org/super admins — on this cadence. */
    private fun candidatesFor(space: Space, targetMode: EmailMode): List<User> {
        val candidates = mutableSetOf<User>()
        candidates += permissionService.membersOf(space)
        space.parent?.let {
            candidates += permissionService.membersOf(it)
        }
        candidates += userRepository.findAll().filter {
            it.role == UserRole.SUPER_ADMIN || it.role == UserRole.ORG_ADMIN
        }
        return candidates
            .filter { it.enabled }
            .filter { it.emailMode == targetMode }
    }
}
