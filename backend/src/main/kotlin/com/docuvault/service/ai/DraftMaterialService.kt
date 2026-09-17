package com.docuvault.service.ai

import com.docuvault.domain.task.TaskStatus
import com.docuvault.infrastructure.repository.DocumentRepository
import com.docuvault.infrastructure.repository.InboxNoteRepository
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.TaskRepository
import org.jsoup.Jsoup
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.*

enum class DraftTemplate(val instruction: String) {
    STATUS_REPORT(
        "Write a status report for the period. Sections: Summary, What happened (meetings, notes, changed documents), " +
            "Done, Open and at risk (overdue first), Next steps. Name people and dates exactly as the material gives them."
    ),
    MEETING_PROTOCOL(
        "Write a protocol of the most recent meeting in the material. Sections: Date and participants, Topics, Decisions, " +
            "Action items (with owner and due date where known), Open questions. Use only what the meeting note says."
    ),
    CUSTOM("Write what the user asks for, based on the material.")
}

/**
 * Gathers what happened in a space over a period, for the assistant to write
 * a draft from: inbox and meeting notes, tasks and changed documents. Plain
 * text, clipped so a busy space cannot blow the prompt up.
 */
@Service
class DraftMaterialService(
    private val spaceRepository: SpaceRepository,
    private val inboxNoteRepository: InboxNoteRepository,
    private val taskRepository: TaskRepository,
    private val documentRepository: DocumentRepository
) {
    companion object {
        const val MAX_DAYS = 90
        private const val MAX_NOTES = 40
        private const val MAX_NOTE_CHARS = 2500
        private const val MAX_TASKS = 80
        private const val MAX_DOCUMENTS = 40
        private val DATE_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")
    }

    @Transactional(readOnly = true)
    fun material(repositoryIds: List<UUID>, template: DraftTemplate, days: Int): String {
        val period = days.coerceIn(1, MAX_DAYS)
        val since = Instant.now().minus(period.toLong(), ChronoUnit.DAYS)
        val today = LocalDate.now()

        return buildString {
            appendLine("Draft to write: ${template.instruction}")
            appendLine("Period: the last $period days, ${today.minusDays(period.toLong())} to $today.")
            spaceRepository.findAllById(repositoryIds).forEach { space ->
                appendLine()
                appendLine("=== Space: ${space.name} (${space.getFullPath()}) ===")

                val notes = inboxNoteRepository.findBySpaceIdAndCreatedAtAfterOrderByCreatedAtAsc(space.id!!, since).takeLast(MAX_NOTES)
                appendLine()
                appendLine("Notes and meeting notes (${notes.size}):")
                if (notes.isEmpty()) appendLine("(none)")
                notes.forEach { note ->
                    appendLine("--- ${dateTime(note.createdAt)} by ${note.author.name}")
                    appendLine(Jsoup.parse(note.content).wholeText().trim().take(MAX_NOTE_CHARS))
                }

                val tasks = taskRepository.findBySpaceIdOrderByCreatedAtDesc(space.id!!)
                    .filter { it.status != TaskStatus.SUGGESTED }
                    .filter { it.status != TaskStatus.DONE || (it.doneAt ?: it.updatedAt).isAfter(since) }
                    .take(MAX_TASKS)
                appendLine()
                appendLine("Tasks (open ones, and those done in the period) (${tasks.size}):")
                if (tasks.isEmpty()) appendLine("(none)")
                tasks.forEach { task ->
                    val details = listOfNotNull(
                        task.assignee?.name?.let { "owner $it" },
                        task.dueDate?.let { "due $it" + if (task.status != TaskStatus.DONE && it.isBefore(today)) " (overdue)" else "" },
                        task.doneAt?.let { "done ${date(it)}" },
                        task.sourceLabel?.let { "from $it" }
                    )
                    appendLine("- [${task.status}] ${task.title}" + if (details.isEmpty()) "" else " (${details.joinToString(", ")})")
                }

                val documents = documentRepository.findBySpaceId(space.id!!)
                    .filter { it.updatedAt.isAfter(since) }
                    .sortedByDescending { it.updatedAt }
                    .take(MAX_DOCUMENTS)
                appendLine()
                appendLine("Documents changed in the period (${documents.size}):")
                if (documents.isEmpty()) appendLine("(none)")
                documents.forEach { appendLine("- ${it.path}" + (it.title?.let { title -> " \"$title\"" } ?: "") + ", changed ${date(it.updatedAt)}") }
            }
        }
    }

    private fun date(instant: Instant): LocalDate = LocalDate.ofInstant(instant, ZoneId.systemDefault())

    private fun dateTime(instant: Instant): String = DATE_TIME.format(instant.atZone(ZoneId.systemDefault()))
}
