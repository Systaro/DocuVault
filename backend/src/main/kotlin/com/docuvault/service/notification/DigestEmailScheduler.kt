package com.docuvault.service.notification

import com.docuvault.domain.space.NotificationChannel
import com.docuvault.domain.space.NotificationDispatch
import com.docuvault.domain.space.SpaceChangeEvent
import com.docuvault.domain.user.EmailMode
import com.docuvault.domain.user.User
import com.docuvault.domain.user.UserRole
import com.docuvault.infrastructure.repository.NotificationDispatchRepository
import com.docuvault.infrastructure.repository.SpaceChangeEventRepository
import com.docuvault.infrastructure.repository.SpacePermissionRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.EmailService
import org.slf4j.LoggerFactory
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Instant
import java.time.temporal.ChronoUnit

@Service
class DigestEmailScheduler(
    private val changeEventRepository: SpaceChangeEventRepository,
    private val dispatchRepository: NotificationDispatchRepository,
    private val spacePermissionRepository: SpacePermissionRepository,
    private val userRepository: UserRepository,
    private val emailService: EmailService
) {
    private val logger = LoggerFactory.getLogger(DigestEmailScheduler::class.java)

    /** Top of every hour — sends to users with emailMode=HOURLY. */
    @Scheduled(cron = "0 0 * * * *")
    @Transactional
    fun sendHourlyDigests() = sendDigest(
        windowHours = 1,
        targetMode = EmailMode.HOURLY,
        channel = NotificationChannel.EMAIL_HOURLY,
        periodLabel = "hourly"
    )

    /** 08:00 server time — sends to users with emailMode=DAILY. */
    @Scheduled(cron = "0 0 8 * * *")
    @Transactional
    fun sendDailyDigests() = sendDigest(
        windowHours = 24,
        targetMode = EmailMode.DAILY,
        channel = NotificationChannel.EMAIL_DAILY,
        periodLabel = "24h"
    )

    private fun sendDigest(
        windowHours: Long,
        targetMode: EmailMode,
        channel: NotificationChannel,
        periodLabel: String
    ) {
        val to = Instant.now()
        val from = to.minus(windowHours, ChronoUnit.HOURS)

        val events = changeEventRepository.findByDetectedAtBetweenOrderBySpaceIdAscDetectedAtAsc(from, to)
        if (events.isEmpty()) {
            logger.debug("No change events in last {}h, skipping {} digest", windowHours, targetMode)
            return
        }

        for ((_, spaceEvents) in events.groupBy { it.space.id!! }) {
            val space = spaceEvents.first().space
            val recipients = digestRecipientsFor(space, spaceEvents, targetMode)
            if (recipients.isEmpty()) continue

            val html = NotificationEmail.buildDigest(space.name, spaceEvents, periodLabel)
            val subject = "${space.name}: ${spaceEvents.size} change${if (spaceEvents.size == 1) "" else "s"} in last $periodLabel"

            for (user in recipients) {
                if (spaceEvents.all { evt ->
                        dispatchRepository.existsByEventIdAndUserIdAndChannel(evt.id!!, user.id!!, channel)
                    }) continue

                val result = runCatching { emailService.sendHtml(user.email, subject, html) }
                if (result.isSuccess) {
                    spaceEvents.forEach { evt ->
                        dispatchRepository.save(
                            NotificationDispatch(
                                event = evt,
                                user = user,
                                channel = channel,
                                success = true
                            )
                        )
                    }
                } else {
                    logger.warn("Failed to send {} digest to {} for space {}: {}", targetMode, user.email, space.name, result.exceptionOrNull()?.message)
                    spaceEvents.firstOrNull()?.let { evt ->
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
    }

    private fun digestRecipientsFor(
        space: com.docuvault.domain.space.Space,
        events: List<SpaceChangeEvent>,
        targetMode: EmailMode
    ): List<User> {
        val triggeringUserIds = events.mapNotNull { it.triggeredBy?.id }.toSet()

        val candidates = mutableSetOf<User>()
        candidates += spacePermissionRepository.findAllBySpaceId(space.id!!).map { it.user }
        space.parent?.let {
            candidates += spacePermissionRepository.findAllBySpaceId(it.id!!).map { it.user }
        }
        candidates += userRepository.findAll().filter {
            it.role == UserRole.SUPER_ADMIN || it.role == UserRole.ORG_ADMIN
        }

        return candidates
            .filter { it.enabled }
            .filter { it.emailMode == targetMode }
            .filter { it.id !in triggeringUserIds }
    }
}
