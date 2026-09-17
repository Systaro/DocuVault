package com.docuvault.service.task

import com.docuvault.domain.space.Space
import com.docuvault.domain.space.SpaceType
import com.docuvault.domain.task.Task
import com.docuvault.domain.task.TaskStatus
import com.docuvault.domain.user.User
import com.docuvault.domain.user.UserRole
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.TaskRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.EmailService
import com.docuvault.service.PermissionService
import com.docuvault.service.SettingsService
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.mockito.Mockito.mock
import org.mockito.Mockito.verifyNoInteractions
import org.mockito.Mockito.`when`
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException
import java.util.*

/** Who may see and change which task. */
class TaskAccessTest {

    private val taskRepository = mock(TaskRepository::class.java)
    private val spaceRepository = mock(SpaceRepository::class.java)
    private val userRepository = mock(UserRepository::class.java)
    private val permissionService = mock(PermissionService::class.java)
    private val emailService = mock(EmailService::class.java)

    private val service = TaskService(
        taskRepository, spaceRepository, userRepository, permissionService, emailService,
        mock(SettingsService::class.java), "https://docs.example"
    )

    private fun user(name: String) =
        User(id = UUID.randomUUID(), email = "${name.lowercase()}@x.io", passwordHash = "h", name = name, role = UserRole.VIEWER)
            .also { `when`(userRepository.findByEmail(it.email)).thenReturn(it) }

    private val editor = user("Editor")
    private val viewer = user("Viewer")
    private val stranger = user("Stranger")
    private val space = Space(id = UUID.randomUUID(), name = "Docs", slug = "docs", type = SpaceType.REPOSITORY, createdBy = editor)
        .also { `when`(spaceRepository.findById(it.id!!)).thenReturn(Optional.of(it)) }

    init {
        listOf(editor, viewer).forEach {
            `when`(permissionService.readableRepositoryIds(it.id!!, it.role, space.id!!)).thenReturn(listOf(space.id!!))
        }
        `when`(permissionService.readableRepositoryIds(stranger.id!!, stranger.role, space.id!!)).thenReturn(emptyList())
        `when`(permissionService.hasEditAccess(editor.id!!, space.id!!, editor.role)).thenReturn(true)
        `when`(userRepository.findById(stranger.id!!)).thenReturn(Optional.of(stranger))
    }

    private fun task(status: TaskStatus = TaskStatus.OPEN, assignee: User? = null, createdBy: User = editor) =
        Task(id = UUID.randomUUID(), space = space, title = "Write the release notes", status = status, assignee = assignee, createdBy = createdBy)
            .also { `when`(taskRepository.findById(it.id!!)).thenReturn(Optional.of(it)) }

    @Test
    fun `adding a task takes edit access`() {
        val error = assertThrows<ResponseStatusException> { service.create(viewer.email, space.id!!, NewTask("Do it")) }

        assertEquals(HttpStatus.FORBIDDEN, error.statusCode)
        verifyNoInteractions(taskRepository)
    }

    @Test
    fun `the assignee moves their own task along but cannot rewrite it`() {
        val task = task(assignee = viewer)
        `when`(taskRepository.save(task)).thenReturn(task)

        assertEquals(TaskStatus.DONE, service.update(viewer.email, task.id!!, TaskChanges(status = TaskStatus.DONE)).status)

        val rename = assertThrows<ResponseStatusException> { service.update(viewer.email, task.id!!, TaskChanges(title = "Mine now")) }
        assertEquals(HttpStatus.FORBIDDEN, rename.statusCode)
    }

    @Test
    fun `someone else's suggestion is not visible`() {
        val suggestion = task(status = TaskStatus.SUGGESTED, createdBy = editor)

        val error = assertThrows<ResponseStatusException> { service.get(viewer.email, suggestion.id!!) }

        assertEquals(HttpStatus.NOT_FOUND, error.statusCode)
    }

    @Test
    fun `a task cannot be given to someone who cannot see the space`() {
        val error = assertThrows<ResponseStatusException> {
            service.create(editor.email, space.id!!, NewTask("Do it", assigneeId = stranger.id))
        }

        assertEquals(HttpStatus.BAD_REQUEST, error.statusCode)
    }

    @Test
    fun `a space the user cannot read hides its tasks`() {
        val error = assertThrows<ResponseStatusException> { service.listForSpace(stranger.email, space.id!!, null, null) }

        assertEquals(HttpStatus.NOT_FOUND, error.statusCode)
    }
}
