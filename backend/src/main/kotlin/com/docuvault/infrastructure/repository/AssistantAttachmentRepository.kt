package com.docuvault.infrastructure.repository

import com.docuvault.domain.ai.AssistantAttachment
import org.springframework.data.jpa.repository.JpaRepository
import java.time.Instant
import java.util.*

interface AssistantAttachmentRepository : JpaRepository<AssistantAttachment, UUID> {
    fun findByIdAndUserId(id: UUID, userId: UUID): AssistantAttachment?

    fun findByIdInAndUserId(ids: Collection<UUID>, userId: UUID): List<AssistantAttachment>

    fun findByConversationIdIsNullAndCreatedAtBefore(before: Instant): List<AssistantAttachment>
}
