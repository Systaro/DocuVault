package com.docuvault.infrastructure.repository

import com.docuvault.domain.ai.ChatHistory
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Repository
import java.util.*

@Repository
interface ChatHistoryRepository : JpaRepository<ChatHistory, UUID> {
    fun findByUserIdOrderByUpdatedAtDesc(userId: UUID): List<ChatHistory>
    fun findByUserIdAndSpaceIdOrderByUpdatedAtDesc(userId: UUID, spaceId: UUID): List<ChatHistory>
}
