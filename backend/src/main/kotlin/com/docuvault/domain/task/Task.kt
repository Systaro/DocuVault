package com.docuvault.domain.task

import com.docuvault.domain.space.Space
import com.docuvault.domain.user.User
import jakarta.persistence.*
import java.time.Instant
import java.time.LocalDate
import java.util.*

enum class TaskStatus {
    /** Proposed from a meeting or a note; becomes OPEN once its creator confirms it. */
    SUGGESTED,
    OPEN,
    IN_PROGRESS,
    DONE
}

enum class TaskPriority { LOW, NORMAL, HIGH }

enum class TaskSourceType { DOCUMENT, INBOX_NOTE, MEETING, CONVERSATION }

@Entity
@Table(name = "tasks")
class Task(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID? = null,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "space_id", nullable = false)
    val space: Space,

    var title: String,

    var description: String? = null,

    @Enumerated(EnumType.STRING)
    var status: TaskStatus = TaskStatus.OPEN,

    @Enumerated(EnumType.STRING)
    var priority: TaskPriority? = null,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "assignee_id")
    var assignee: User? = null,

    @Column(name = "due_date")
    var dueDate: LocalDate? = null,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "created_by")
    val createdBy: User? = null,

    @Column(name = "assigned_at")
    var assignedAt: Instant? = null,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "assigned_by")
    var assignedBy: User? = null,

    @Enumerated(EnumType.STRING)
    @Column(name = "source_type")
    val sourceType: TaskSourceType? = null,

    @Column(name = "source_id")
    val sourceId: String? = null,

    @Column(name = "source_label")
    val sourceLabel: String? = null,

    @Column(name = "created_at")
    val createdAt: Instant = Instant.now(),

    @Column(name = "updated_at")
    var updatedAt: Instant = Instant.now(),

    @Column(name = "done_at")
    var doneAt: Instant? = null
)
