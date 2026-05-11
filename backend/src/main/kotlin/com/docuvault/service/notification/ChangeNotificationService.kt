package com.docuvault.service.notification

import com.docuvault.domain.space.ChangeType
import com.docuvault.domain.space.NotificationChannel
import com.docuvault.domain.space.NotificationDispatch
import com.docuvault.domain.space.Space
import com.docuvault.domain.space.SpaceChangeEvent
import com.docuvault.domain.user.EmailMode
import com.docuvault.domain.user.PushMode
import com.docuvault.domain.user.User
import com.docuvault.domain.user.UserRole
import com.docuvault.infrastructure.repository.NotificationDispatchRepository
import com.docuvault.infrastructure.repository.SpaceChangeEventRepository
import com.docuvault.infrastructure.repository.SpacePermissionRepository
import com.docuvault.infrastructure.repository.UserPushTokenRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.EmailService
import com.docuvault.service.git.DetectedChange
import com.docuvault.service.git.GitDiffService
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

@Service
class ChangeNotificationService(
    private val gitDiffService: GitDiffService,
    private val changeEventRepository: SpaceChangeEventRepository,
    private val dispatchRepository: NotificationDispatchRepository,
    private val pushTokenRepository: UserPushTokenRepository,
    private val spacePermissionRepository: SpacePermissionRepository,
    private val userRepository: UserRepository,
    private val pushSenders: List<PushSender>,
    private val emailService: EmailService,
    @Value("\${app.public-url:https://docuvault.systaro.de}") private val publicUrl: String
) {
    private val logger = LoggerFactory.getLogger(ChangeNotificationService::class.java)

    @Transactional
    fun recordSyncedChanges(space: Space, fromRef: String?, toRef: String, triggeredBy: User? = null) {
        if (fromRef == null || fromRef == toRef) return

        val detected = gitDiffService.changesBetween(space, fromRef, toRef)
        if (detected.isEmpty()) return

        val recipients = resolveRecipients(space, triggeredBy, detected.firstOrNull()?.authorEmail)

        val byCommit = detected.groupBy { it.commitSha }

        for ((sha, group) in byCommit) {
            val first = group.first()
            val resolvedAuthor = triggeredBy ?: first.authorEmail?.let { userRepository.findByEmail(it) }
            val perCommitRecipients = recipients.filter { it.id != resolvedAuthor?.id }

            val savedEvents = group.map { change ->
                changeEventRepository.save(
                    SpaceChangeEvent(
                        space = space,
                        filePath = change.filePath,
                        oldPath = change.oldPath,
                        changeType = change.changeType,
                        commitSha = sha,
                        commitMessage = change.commitMessage,
                        commitAuthorEmail = change.authorEmail,
                        commitAuthorName = change.authorName,
                        triggeredBy = resolvedAuthor
                    )
                )
            }

            // Anchor real-time dispatch on the first event so we send one notification per commit, not per file.
            val anchorEvent = savedEvents.first()
            for (user in perCommitRecipients) {
                if (user.pushMode == PushMode.INSTANT) {
                    dispatchPush(anchorEvent, user, group)
                }
                if (user.emailMode == EmailMode.INSTANT) {
                    dispatchInstantEmail(anchorEvent, user, group, space)
                }
                // EmailMode.HOURLY / DAILY → handled by their schedulers reading space_change_events.
            }
        }
    }

    private fun dispatchPush(event: SpaceChangeEvent, user: User, group: List<DetectedChange>) {
        if (dispatchRepository.existsByEventIdAndUserIdAndChannel(event.id!!, user.id!!, NotificationChannel.PUSH)) return

        val tokens = pushTokenRepository.findByUserIdOrderByLastSeenAtDesc(user.id!!)
        if (tokens.isEmpty()) return

        val payload = buildPushPayload(event, group)

        for (token in tokens) {
            val sender = pushSenders.firstOrNull { it.supports(token) } ?: continue
            val result = sender.send(token, payload)
            dispatchRepository.save(
                NotificationDispatch(
                    event = event,
                    user = user,
                    channel = NotificationChannel.PUSH,
                    success = result.isSuccess,
                    error = result.exceptionOrNull()?.message?.take(500)
                )
            )
        }
    }

    private fun dispatchInstantEmail(event: SpaceChangeEvent, user: User, group: List<DetectedChange>, space: Space) {
        if (dispatchRepository.existsByEventIdAndUserIdAndChannel(event.id!!, user.id!!, NotificationChannel.EMAIL_INSTANT)) return

        val author = event.triggeredBy?.name ?: event.commitAuthorName ?: "Someone"
        val subject = "${space.name}: $author ${verb(event.changeType)} ${event.filePath}" +
            if (group.size > 1) " (+${group.size - 1} more)" else ""
        val html = NotificationEmail.buildInstant(spaceName = space.name, author = author, changes = group, publicUrl = publicUrl)

        val result = runCatching { emailService.sendHtml(user.email, subject, html) }
        dispatchRepository.save(
            NotificationDispatch(
                event = event,
                user = user,
                channel = NotificationChannel.EMAIL_INSTANT,
                success = result.isSuccess,
                error = result.exceptionOrNull()?.message?.take(500)
            )
        )
    }

    private fun buildPushPayload(event: SpaceChangeEvent, group: List<DetectedChange>): PushPayload {
        val author = event.triggeredBy?.name ?: event.commitAuthorName ?: "Someone"
        val body = if (group.size == 1) {
            "$author ${verb(event.changeType)} ${event.filePath}"
        } else {
            "$author ${verb(event.changeType)} ${event.filePath} (+${group.size - 1} more)"
        }
        return PushPayload(
            title = event.space.name,
            body = body,
            data = mapOf(
                "spaceId" to event.space.id!!.toString(),
                "filePath" to event.filePath,
                "commitSha" to (event.commitSha ?: ""),
                "changeType" to event.changeType.name
            )
        )
    }

    private fun verb(type: ChangeType): String = when (type) {
        ChangeType.ADDED -> "added"
        ChangeType.MODIFIED -> "edited"
        ChangeType.DELETED -> "deleted"
        ChangeType.RENAMED -> "renamed"
    }

    private fun resolveRecipients(space: Space, triggeredBy: User?, authorEmail: String?): List<User> {
        val candidates = mutableSetOf<User>()
        candidates += spacePermissionRepository.findAllBySpaceId(space.id!!).map { it.user }
        space.parent?.let { parent ->
            candidates += spacePermissionRepository.findAllBySpaceId(parent.id!!).map { it.user }
        }
        candidates += userRepository.findAll().filter {
            it.role == UserRole.SUPER_ADMIN || it.role == UserRole.ORG_ADMIN
        }

        val excluded = mutableSetOf<java.util.UUID?>()
        triggeredBy?.id?.let { excluded.add(it) }
        authorEmail?.let { email -> userRepository.findByEmail(email)?.id?.let { excluded.add(it) } }

        return candidates
            .filter { it.enabled }
            .filter { it.pushMode == PushMode.INSTANT || it.emailMode != EmailMode.NONE }
            .filter { it.id !in excluded }
    }
}
