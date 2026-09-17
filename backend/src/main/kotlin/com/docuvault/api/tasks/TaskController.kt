package com.docuvault.api.tasks

import com.docuvault.domain.task.TaskPriority
import com.docuvault.domain.task.TaskSourceType
import com.docuvault.domain.task.TaskStatus
import com.docuvault.service.task.MyTasksDto
import com.docuvault.service.task.NewTask
import com.docuvault.service.task.TaskChanges
import com.docuvault.service.task.TaskDto
import com.docuvault.service.task.TaskService
import com.docuvault.service.task.TaskUserDto
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.core.userdetails.UserDetails
import org.springframework.web.bind.annotation.*
import java.time.LocalDate
import java.util.*

@RestController
class TaskController(private val taskService: TaskService) {

    /** What is on the caller's plate: tasks assigned to them, and suggestions waiting for them to confirm. */
    @GetMapping("/tasks/mine")
    fun mine(@AuthenticationPrincipal userDetails: UserDetails): MyTasksDto = taskService.mine(userDetails.username)

    /** Tasks that came from one place, e.g. the action items of a meeting note. */
    @GetMapping("/tasks", params = ["sourceType", "sourceId"])
    fun forSource(
        @AuthenticationPrincipal userDetails: UserDetails,
        @RequestParam sourceType: TaskSourceType,
        @RequestParam sourceId: String
    ): List<TaskDto> = taskService.forSource(userDetails.username, sourceType, sourceId)

    /** A group lists the tasks of every repository in it the caller can read. */
    @GetMapping("/spaces/{spaceId}/tasks")
    fun list(
        @AuthenticationPrincipal userDetails: UserDetails,
        @PathVariable spaceId: UUID,
        @RequestParam(required = false) status: TaskStatus?,
        @RequestParam(required = false) assigneeId: UUID?
    ): List<TaskDto> = taskService.listForSpace(userDetails.username, spaceId, status, assigneeId)

    @GetMapping("/spaces/{spaceId}/tasks/assignees")
    fun assignees(@AuthenticationPrincipal userDetails: UserDetails, @PathVariable spaceId: UUID): List<TaskUserDto> =
        taskService.assignees(userDetails.username, spaceId)

    @PostMapping("/spaces/{spaceId}/tasks")
    fun create(
        @AuthenticationPrincipal userDetails: UserDetails,
        @PathVariable spaceId: UUID,
        @Valid @RequestBody request: CreateTaskRequest
    ): ResponseEntity<TaskDto> = ResponseEntity.status(HttpStatus.CREATED).body(
        taskService.create(
            userDetails.username, spaceId,
            NewTask(
                title = request.title,
                description = request.description,
                status = request.status ?: TaskStatus.OPEN,
                priority = request.priority,
                assigneeId = request.assigneeId,
                dueDate = request.dueDate,
                sourceType = request.sourceType,
                sourceId = request.sourceId,
                sourceLabel = request.sourceLabel
            )
        )
    )

    @GetMapping("/tasks/{taskId}")
    fun get(@AuthenticationPrincipal userDetails: UserDetails, @PathVariable taskId: UUID): TaskDto =
        taskService.get(userDetails.username, taskId)

    @PatchMapping("/tasks/{taskId}")
    fun update(
        @AuthenticationPrincipal userDetails: UserDetails,
        @PathVariable taskId: UUID,
        @Valid @RequestBody request: UpdateTaskRequest
    ): TaskDto = taskService.update(
        userDetails.username, taskId,
        TaskChanges(
            title = request.title,
            description = request.description,
            status = request.status,
            priority = request.priority,
            clearPriority = request.clearPriority == true,
            assigneeId = request.assigneeId,
            clearAssignee = request.clearAssignee == true,
            dueDate = request.dueDate,
            clearDueDate = request.clearDueDate == true
        )
    )

    @DeleteMapping("/tasks/{taskId}")
    fun delete(@AuthenticationPrincipal userDetails: UserDetails, @PathVariable taskId: UUID): ResponseEntity<Unit> {
        taskService.delete(userDetails.username, taskId)
        return ResponseEntity.noContent().build()
    }
}

data class CreateTaskRequest(
    @field:NotBlank(message = "Title is required")
    @field:Size(max = 500, message = "Title is too long")
    val title: String,
    val description: String? = null,
    val status: TaskStatus? = null,
    val priority: TaskPriority? = null,
    val assigneeId: UUID? = null,
    val dueDate: LocalDate? = null,
    val sourceType: TaskSourceType? = null,
    val sourceId: String? = null,
    val sourceLabel: String? = null
)

/** Absent fields stay as they are; the clear flags remove a value. */
data class UpdateTaskRequest(
    @field:Size(max = 500, message = "Title is too long")
    val title: String? = null,
    val description: String? = null,
    val status: TaskStatus? = null,
    val priority: TaskPriority? = null,
    val clearPriority: Boolean? = null,
    val assigneeId: UUID? = null,
    val clearAssignee: Boolean? = null,
    val dueDate: LocalDate? = null,
    val clearDueDate: Boolean? = null
)
