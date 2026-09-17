package com.docuvault.infrastructure.repository

import com.docuvault.domain.ai.Conversation
import com.docuvault.domain.ai.ConversationMessage
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import org.springframework.stereotype.Repository
import org.springframework.transaction.annotation.Transactional
import java.util.*

@Repository
interface ConversationRepository : JpaRepository<Conversation, UUID> {
    fun findByUserIdOrderByUpdatedAtDesc(userId: UUID): List<Conversation>

    /** Title or any message containing [query], case-insensitively. LIKE wildcards in [query] must be escaped with a backslash. */
    @Query(
        """
        SELECT c FROM Conversation c
        WHERE c.user.id = :userId
          AND (LOWER(c.title) LIKE LOWER(CONCAT('%', :query, '%')) ESCAPE '\'
               OR EXISTS (SELECT 1 FROM ConversationMessage m
                          WHERE m.conversation = c AND LOWER(m.content) LIKE LOWER(CONCAT('%', :query, '%')) ESCAPE '\'))
        ORDER BY c.updatedAt DESC
        """
    )
    fun search(@Param("userId") userId: UUID, @Param("query") query: String): List<Conversation>

    @Modifying
    @Transactional
    @Query("UPDATE Conversation c SET c.updatedAt = :at WHERE c.id = :id")
    fun touch(@Param("id") id: UUID, @Param("at") at: java.time.Instant)
}

@Repository
interface ConversationMessageRepository : JpaRepository<ConversationMessage, UUID> {
    fun findByConversationIdOrderByCreatedAtAsc(conversationId: UUID): List<ConversationMessage>
}
