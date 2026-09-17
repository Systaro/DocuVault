package com.docuvault.service.ai

import com.docuvault.domain.inbox.InboxNote
import com.docuvault.domain.space.Document
import com.docuvault.domain.space.Space
import com.docuvault.domain.task.Task
import com.docuvault.domain.task.TaskStatus
import com.docuvault.domain.user.User
import com.docuvault.infrastructure.repository.DocumentRepository
import com.docuvault.infrastructure.repository.InboxNoteRepository
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.TaskRepository
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.ArgumentMatchers.eq
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import java.time.Instant
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import java.util.*

/** What a draft is written from: the period's notes, the tasks that matter, the documents that changed. */
class DraftMaterialServiceTest {

    private val spaceRepository = mock(SpaceRepository::class.java)
    private val inboxNoteRepository = mock(InboxNoteRepository::class.java)
    private val taskRepository = mock(TaskRepository::class.java)
    private val documentRepository = mock(DocumentRepository::class.java)
    private val service = DraftMaterialService(spaceRepository, inboxNoteRepository, taskRepository, documentRepository)

    private val anna = User(id = UUID.randomUUID(), email = "anna@x.io", passwordHash = "h", name = "Anna Berg")
    private val space = Space(id = UUID.randomUUID(), name = "Office", slug = "office", createdBy = anna)
    private val longAgo = Instant.now().minus(60, ChronoUnit.DAYS)

    private fun task(title: String, status: TaskStatus, doneAt: Instant? = null, due: LocalDate? = null) =
        Task(space = space, title = title, status = status, doneAt = doneAt, updatedAt = doneAt ?: Instant.now(), dueDate = due, assignee = anna)

    @Test
    fun `collects recent notes as text, relevant tasks and changed documents`() {
        `when`(spaceRepository.findAllById(listOf(space.id!!))).thenReturn(listOf(space))
        `when`(inboxNoteRepository.findBySpaceIdAndCreatedAtAfterOrderByCreatedAtAsc(eq(space.id!!) ?: space.id!!, any() ?: Instant.now()))
            .thenReturn(listOf(InboxNote(space = space, author = anna, content = "<h1>Weekly sync</h1><p>The printer is <b>fixed</b>.</p>")))
        `when`(taskRepository.findBySpaceIdOrderByCreatedAtDesc(space.id!!)).thenReturn(
            listOf(
                task("Order chairs", TaskStatus.OPEN, due = LocalDate.now().minusDays(2)),
                task("Fix the printer", TaskStatus.DONE, doneAt = Instant.now().minus(1, ChronoUnit.DAYS)),
                task("Paint the hall", TaskStatus.DONE, doneAt = longAgo),
                task("Maybe buy plants", TaskStatus.SUGGESTED)
            )
        )
        `when`(documentRepository.findBySpaceId(space.id!!)).thenReturn(
            listOf(
                Document(space = space, path = "ops/printer.md", title = "Printer", updatedAt = Instant.now()),
                Document(space = space, path = "ops/old.md", title = "Old", updatedAt = longAgo)
            )
        )

        val material = service.material(listOf(space.id!!), DraftTemplate.STATUS_REPORT, 7)

        assertTrue(material.contains("The printer is fixed."), material)
        assertFalse(material.contains("<b>"), "notes are plain text")
        assertTrue(material.contains("[OPEN] Order chairs") && material.contains("(overdue)"), material)
        assertTrue(material.contains("[DONE] Fix the printer"), material)
        assertFalse(material.contains("Paint the hall"), "done before the period")
        assertFalse(material.contains("Maybe buy plants"), "suggestions are not tasks yet")
        assertTrue(material.contains("ops/printer.md") && !material.contains("ops/old.md"), material)
    }
}
