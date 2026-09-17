package com.docuvault.infrastructure.repository

import com.docuvault.domain.task.Task
import com.docuvault.domain.task.TaskSourceType
import com.docuvault.domain.task.TaskStatus
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import org.springframework.stereotype.Repository
import java.time.Instant
import java.util.*

@Repository
interface TaskRepository : JpaRepository<Task, UUID> {
    fun findBySpaceIdOrderByCreatedAtDesc(spaceId: UUID): List<Task>

    fun findByAssigneeIdAndStatusInOrderByDueDateAscCreatedAtDesc(assigneeId: UUID, statuses: Collection<TaskStatus>): List<Task>

    fun findByCreatedByIdAndStatusOrderByCreatedAtDesc(createdById: UUID, status: TaskStatus): List<Task>

    fun findBySourceTypeAndSourceIdOrderByCreatedAtAsc(sourceType: TaskSourceType, sourceId: String): List<Task>

    /** Assignments someone else made to [userId] in the given spaces, newest first. */
    @Query(
        """
        SELECT t FROM Task t
        WHERE t.assignee.id = :userId AND t.assignedBy.id <> :userId AND t.assignedAt IS NOT NULL
          AND t.space.id IN :spaceIds AND t.status <> com.docuvault.domain.task.TaskStatus.SUGGESTED
        ORDER BY t.assignedAt DESC
        """
    )
    fun findAssignmentsFor(@Param("userId") userId: UUID, @Param("spaceIds") spaceIds: Collection<UUID>): List<Task>

    @Query(
        """
        SELECT COUNT(t) FROM Task t
        WHERE t.assignee.id = :userId AND t.assignedBy.id <> :userId AND t.assignedAt > :since
          AND t.space.id IN :spaceIds AND t.status <> com.docuvault.domain.task.TaskStatus.SUGGESTED
        """
    )
    fun countAssignmentsSince(@Param("userId") userId: UUID, @Param("spaceIds") spaceIds: Collection<UUID>, @Param("since") since: Instant): Long
}
