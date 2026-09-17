package com.docuvault.service.task

import com.docuvault.domain.inbox.InboxNote
import com.docuvault.domain.space.Space
import com.docuvault.domain.space.SpaceType
import com.docuvault.domain.task.Task
import com.docuvault.domain.task.TaskPriority
import com.docuvault.domain.task.TaskSourceType
import com.docuvault.domain.task.TaskStatus
import com.docuvault.domain.user.EmailMode
import com.docuvault.domain.user.User
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.TaskRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.EmailService
import com.docuvault.service.PermissionService
import com.docuvault.service.SettingsService
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Propagation
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.server.ResponseStatusException
import org.springframework.web.util.HtmlUtils
import java.time.Instant
import java.time.LocalDate
import java.util.*

data class TaskUserDto(val id: UUID, val name: String, val email: String)

data class TaskSourceDto(val type: TaskSourceType, val id: String, val label: String?)

data class TaskDto(
    val id: UUID,
    val spaceId: UUID,
    val spaceName: String,
    val spaceFullPath: String,
    val title: String,
    val description: String?,
    val status: TaskStatus,
    val priority: TaskPriority?,
    val assignee: TaskUserDto?,
    val dueDate: LocalDate?,
    val createdBy: TaskUserDto?,
    val source: TaskSourceDto?,
    val createdAt: Instant,
    val updatedAt: Instant,
    val doneAt: Instant?,
    /** Whether the caller may change more than the status. */
    val canEdit: Boolean
)

data class MyTasksDto(val assigned: List<TaskDto>, val toConfirm: List<TaskDto>)

data class TaskChanges(
    val title: String? = null,
    val description: String? = null,
    val status: TaskStatus? = null,
    val priority: TaskPriority? = null,
    val clearPriority: Boolean = false,
    val assigneeId: UUID? = null,
    val clearAssignee: Boolean = false,
    val dueDate: LocalDate? = null,
    val clearDueDate: Boolean = false
)

data class NewTask(
    val title: String,
    val description: String? = null,
    val status: TaskStatus = TaskStatus.OPEN,
    val priority: TaskPriority? = null,
    val assigneeId: UUID? = null,
    val dueDate: LocalDate? = null,
    val sourceType: TaskSourceType? = null,
    val sourceId: String? = null,
    val sourceLabel: String? = null
)

/**
 * Tasks live in repository spaces. Anyone who can read the space sees its
 * tasks; creating, editing and deleting takes edit access, except that the
 * assignee may always move their own task along. Suggested tasks are drafts:
 * only whoever they were suggested to sees them until they are confirmed.
 */
@Service
class TaskService(
    private val taskRepository: TaskRepository,
    private val spaceRepository: SpaceRepository,
    private val userRepository: UserRepository,
    private val permissionService: PermissionService,
    private val emailService: EmailService,
    private val settingsService: SettingsService,
    @Value("\${app.public-url:https://docuvault.systaro.de}") private val publicUrl: String
) {
    private val logger = LoggerFactory.getLogger(TaskService::class.java)

    companion object {
        private const val MAX_TITLE = 500
        private val ACTIVE = listOf(TaskStatus.OPEN, TaskStatus.IN_PROGRESS)
    }

    @Transactional(readOnly = true)
    fun listForSpace(userEmail: String, spaceId: UUID, status: TaskStatus?, assigneeId: UUID?): List<TaskDto> {
        val user = user(userEmail)
        val spaceIds = permissionService.readableRepositoryIds(user.id!!, user.role, spaceId)
        if (spaceIds.isEmpty()) throw ResponseStatusException(HttpStatus.NOT_FOUND, "Space not found")
        return spaceIds.flatMap { taskRepository.findBySpaceIdOrderByCreatedAtDesc(it) }
            .filter { visibleTo(it, user) }
            .filter { status == null || it.status == status }
            .filter { assigneeId == null || it.assignee?.id == assigneeId }
            .sortedWith(taskOrder())
            .let { dtos(it, user) }
    }

    @Transactional(readOnly = true)
    fun mine(userEmail: String): MyTasksDto {
        val user = user(userEmail)
        val readable = readableSpaceIds(user)
        val assigned = taskRepository.findByAssigneeIdAndStatusInOrderByDueDateAscCreatedAtDesc(user.id!!, ACTIVE)
            .filter { it.space.id in readable }
            .sortedWith(taskOrder())
        val toConfirm = taskRepository.findByCreatedByIdAndStatusOrderByCreatedAtDesc(user.id!!, TaskStatus.SUGGESTED)
            .filter { it.space.id in readable }
        return MyTasksDto(dtos(assigned, user), dtos(toConfirm, user))
    }

    @Transactional(readOnly = true)
    fun get(userEmail: String, taskId: UUID): TaskDto {
        val user = user(userEmail)
        return dtos(listOf(visibleTask(user, taskId)), user).single()
    }

    @Transactional(readOnly = true)
    fun forSource(userEmail: String, sourceType: TaskSourceType, sourceId: String): List<TaskDto> {
        val user = user(userEmail)
        val readable = readableSpaceIds(user)
        return taskRepository.findBySourceTypeAndSourceIdOrderByCreatedAtAsc(sourceType, sourceId)
            .filter { it.space.id in readable && visibleTo(it, user) }
            .let { dtos(it, user) }
    }

    @Transactional(readOnly = true)
    fun assignees(userEmail: String, spaceId: UUID): List<TaskUserDto> {
        val user = user(userEmail)
        val space = readableRepository(user, spaceId)
        return permissionService.effectiveMembersOf(space)
            .map { it.user }
            .filter { it.enabled }
            .distinctBy { it.id }
            .sortedBy { it.name.lowercase() }
            .map { TaskUserDto(it.id!!, it.name, it.email) }
    }

    @Transactional
    fun create(userEmail: String, spaceId: UUID, input: NewTask): TaskDto {
        val user = user(userEmail)
        val space = readableRepository(user, spaceId)
        requireEdit(user, space)
        if (input.status == TaskStatus.DONE) throw ResponseStatusException(HttpStatus.BAD_REQUEST, "A new task cannot start out done")

        val assignee = input.assigneeId?.let { assignable(it, space) }
        val now = Instant.now()
        val task = taskRepository.save(
            Task(
                space = space,
                title = cleanTitle(input.title),
                description = input.description?.trim()?.ifEmpty { null },
                status = input.status,
                priority = input.priority,
                assignee = assignee,
                dueDate = input.dueDate,
                createdBy = user,
                assignedAt = assignee?.let { now },
                assignedBy = assignee?.let { user },
                sourceType = input.sourceType,
                sourceId = input.sourceId?.take(1000),
                sourceLabel = input.sourceLabel?.take(500)
            )
        )
        if (task.status != TaskStatus.SUGGESTED) notifyAssignee(task, user)
        return dtos(listOf(task), user).single()
    }

    @Transactional
    fun update(userEmail: String, taskId: UUID, changes: TaskChanges): TaskDto {
        val user = user(userEmail)
        val task = visibleTask(user, taskId)
        val canEdit = canEdit(user, task)
        val onlyStatus = changes.copy(status = null) == TaskChanges()
        if (!canEdit && !(onlyStatus && task.assignee?.id == user.id)) {
            throw ResponseStatusException(HttpStatus.FORBIDDEN, "You need edit access to this space to change the task")
        }

        val wasSuggested = task.status == TaskStatus.SUGGESTED
        val previousAssignee = task.assignee?.id
        changes.title?.let { task.title = cleanTitle(it) }
        changes.description?.let { task.description = it.trim().ifEmpty { null } }
        if (changes.clearPriority) task.priority = null else changes.priority?.let { task.priority = it }
        if (changes.clearDueDate) task.dueDate = null else changes.dueDate?.let { task.dueDate = it }
        if (changes.clearAssignee) {
            task.assignee = null
        } else changes.assigneeId?.let { id ->
            if (id != previousAssignee) {
                task.assignee = assignable(id, task.space)
                task.assignedAt = Instant.now()
                task.assignedBy = user
            }
        }
        changes.status?.let { status ->
            if (status == TaskStatus.SUGGESTED && !wasSuggested) {
                throw ResponseStatusException(HttpStatus.BAD_REQUEST, "A confirmed task cannot go back to suggested")
            }
            task.doneAt = if (status == TaskStatus.DONE) (task.doneAt ?: Instant.now()) else null
            task.status = status
        }
        task.updatedAt = Instant.now()

        val confirmed = wasSuggested && task.status != TaskStatus.SUGGESTED
        val reassigned = task.assignee != null && task.assignee?.id != previousAssignee
        if (task.status != TaskStatus.SUGGESTED && (confirmed || reassigned)) {
            if (confirmed && task.assignee != null) {
                task.assignedAt = Instant.now()
                task.assignedBy = user
            }
            notifyAssignee(task, user)
        }
        return dtos(listOf(taskRepository.save(task)), user).single()
    }

    @Transactional
    fun delete(userEmail: String, taskId: UUID) {
        val user = user(userEmail)
        val task = visibleTask(user, taskId)
        // Dismissing a suggestion is its recipient's call, even without edit access.
        val ownSuggestion = task.status == TaskStatus.SUGGESTED && task.createdBy?.id == user.id
        if (!ownSuggestion && !canEdit(user, task)) {
            throw ResponseStatusException(HttpStatus.FORBIDDEN, "You need edit access to this space to delete the task")
        }
        taskRepository.delete(task)
    }

    /**
     * Turns the action items of a meeting note into suggested tasks for the
     * person who invited the bot. They are drafts until that person confirms
     * them, so a misheard item never reaches anyone's list on its own.
     */
    // Its own transaction: a failure here must not take the meeting note down with it.
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    fun suggestFromMeetingNote(note: InboxNote): List<Task> {
        val items = ActionItems.parse(note.content)
        if (items.isEmpty()) return emptyList()
        val members = permissionService.effectiveMembersOf(note.space).map { it.user }.filter { it.enabled }
        val label = ActionItems.title(note.content) ?: "Meeting note"
        val now = Instant.now()
        return taskRepository.saveAll(
            items.map { item ->
                val assignee = ActionItems.matchOwner(item.owner, members)
                Task(
                    space = note.space,
                    title = item.title,
                    description = item.owner?.takeIf { assignee == null }?.let { "Owner named in the meeting: $it" },
                    status = TaskStatus.SUGGESTED,
                    assignee = assignee,
                    createdBy = note.author,
                    assignedAt = assignee?.let { now },
                    assignedBy = assignee?.let { note.author },
                    sourceType = TaskSourceType.MEETING,
                    sourceId = note.id.toString(),
                    sourceLabel = label.take(500)
                )
            }
        ).also { logger.info("Suggested ${it.size} task(s) from meeting note ${note.id}") }
    }

    // ---- Access -----------------------------------------------------------------

    private fun user(email: String): User =
        userRepository.findByEmail(email) ?: throw ResponseStatusException(HttpStatus.UNAUTHORIZED)

    private fun readableSpaceIds(user: User): Set<UUID> =
        permissionService.getAccessibleSpaces(user.id!!, user.role).filter { it.type == SpaceType.REPOSITORY }.mapNotNull { it.id }.toSet()

    /** Tasks belong to repositories; a group or an unreadable space is reported as missing. */
    private fun readableRepository(user: User, spaceId: UUID): Space {
        val space = spaceRepository.findById(spaceId).orElse(null)
            ?.takeIf { it.type == SpaceType.REPOSITORY && permissionService.readableRepositoryIds(user.id!!, user.role, spaceId) == listOf(spaceId) }
        return space ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Space not found")
    }

    private fun visibleTask(user: User, taskId: UUID): Task =
        taskRepository.findById(taskId).orElse(null)
            ?.takeIf { permissionService.readableRepositoryIds(user.id!!, user.role, it.space.id!!).isNotEmpty() && visibleTo(it, user) }
            ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Task not found")

    private fun visibleTo(task: Task, user: User): Boolean =
        task.status != TaskStatus.SUGGESTED || task.createdBy?.id == user.id

    private fun canEdit(user: User, task: Task): Boolean =
        permissionService.hasEditAccess(user.id!!, task.space.id!!, user.role)

    private fun requireEdit(user: User, space: Space) {
        if (!permissionService.hasEditAccess(user.id!!, space.id!!, user.role)) {
            throw ResponseStatusException(HttpStatus.FORBIDDEN, "You need edit access to this space to add tasks")
        }
    }

    /** Only someone who can see the space can be given a task in it. */
    private fun assignable(userId: UUID, space: Space): User {
        val assignee = userRepository.findById(userId).orElse(null)?.takeIf { it.enabled }
            ?: throw ResponseStatusException(HttpStatus.BAD_REQUEST, "The assignee does not exist")
        if (permissionService.readableRepositoryIds(assignee.id!!, assignee.role, space.id!!).isEmpty()) {
            throw ResponseStatusException(HttpStatus.BAD_REQUEST, "${assignee.name} cannot see this space, so the task cannot be assigned to them")
        }
        return assignee
    }

    private fun cleanTitle(title: String): String =
        title.trim().take(MAX_TITLE).ifEmpty { throw ResponseStatusException(HttpStatus.BAD_REQUEST, "The task needs a title") }

    /** Overdue and soonest due first, undated after, newest first within each. */
    private fun taskOrder(): Comparator<Task> =
        compareBy<Task> { it.status == TaskStatus.DONE }
            .thenBy(nullsLast()) { it.dueDate }
            .thenByDescending { it.createdAt }

    // ---- Notification ------------------------------------------------------------------

    private fun notifyAssignee(task: Task, actor: User) {
        val assignee = task.assignee ?: return
        if (assignee.id == actor.id || assignee.emailMode == EmailMode.NONE || !settingsService.isMailConfigured()) return
        val url = "${publicUrl.trimEnd('/')}/tasks"
        val due = task.dueDate?.let { "<p style=\"color:#555;font-size:14px;margin:0 0 16px;\">Due ${it}</p>" } ?: ""
        emailService.sendHtml(
            to = assignee.email,
            subject = "${actor.name} assigned you a task: ${task.title.take(80)}",
            htmlBody = """
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f2f5;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:16px;">
        <tr><td style="padding:36px 40px;">
          <p style="color:#7a9a9d;font-size:13px;margin:0 0 8px;">${esc(task.space.name)}</p>
          <h1 style="color:#1a2e30;font-size:20px;margin:0 0 16px;">${esc(task.title)}</h1>
          $due
          <p style="color:#555;font-size:15px;line-height:1.6;margin:0 0 24px;">${esc(actor.name)} assigned this task to you.</p>
          <table cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:#4a8a8f;">
            <a href="$url" style="display:inline-block;padding:12px 26px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">Open my tasks</a>
          </td></tr></table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
            """.trimIndent()
        )
    }

    private fun esc(text: String): String = HtmlUtils.htmlEscape(text)

    /** Edit access is looked up once per space, not once per task. */
    private fun dtos(tasks: List<Task>, viewer: User): List<TaskDto> {
        val editable = tasks.map { it.space.id!! }.distinct()
            .filter { permissionService.hasEditAccess(viewer.id!!, it, viewer.role) }
            .toSet()
        return tasks.map { it.toDto(it.space.id in editable) }
    }

    private fun Task.toDto(canEdit: Boolean) = TaskDto(
        id = id!!,
        spaceId = space.id!!,
        spaceName = space.name,
        spaceFullPath = space.getFullPath(),
        title = title,
        description = description,
        status = status,
        priority = priority,
        assignee = assignee?.let { TaskUserDto(it.id!!, it.name, it.email) },
        dueDate = dueDate,
        createdBy = createdBy?.let { TaskUserDto(it.id!!, it.name, it.email) },
        source = sourceType?.let { TaskSourceDto(it, sourceId.orEmpty(), sourceLabel) },
        createdAt = createdAt,
        updatedAt = updatedAt,
        doneAt = doneAt,
        canEdit = canEdit
    )
}
