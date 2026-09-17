package com.docuvault.domain.ai

import com.docuvault.domain.space.Space
import com.docuvault.domain.user.User
import jakarta.persistence.*
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import java.time.Instant
import java.util.*

/** A conversation with the assistant, owned by one user and pinned to one space. */
@Entity
@Table(name = "conversations")
class Conversation(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID? = null,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    val user: User,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "space_id", nullable = false)
    val space: Space,

    /** Set when the conversation is about one document rather than the whole space. */
    @Column(name = "document_path")
    val documentPath: String? = null,

    var title: String,

    @Column(name = "created_at")
    val createdAt: Instant = Instant.now(),

    @Column(name = "updated_at")
    var updatedAt: Instant = Instant.now()
)

@Entity
@Table(name = "conversation_messages")
class ConversationMessage(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID? = null,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "conversation_id", nullable = false)
    val conversation: Conversation,

    /** "user" or "assistant". */
    val role: String,

    var content: String,

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    var sources: List<MessageSource> = emptyList(),

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "tool_calls", columnDefinition = "jsonb")
    var toolCalls: List<MessageToolCall> = emptyList(),

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "created_documents", columnDefinition = "jsonb")
    var createdDocuments: List<MessageSource> = emptyList(),

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    var proposals: List<MessageProposal> = emptyList(),

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "created_tasks", columnDefinition = "jsonb")
    var createdTasks: List<MessageTask> = emptyList(),

    @Column(name = "created_at")
    val createdAt: Instant = Instant.now()
)

data class MessageSource(
    val spaceId: UUID,
    val path: String,
    val title: String? = null
)

data class MessageTask(
    val id: UUID,
    val spaceId: UUID,
    val title: String
)

/** What the assistant did on the way to an answer, as the user should read it. */
data class MessageToolCall(
    val name: String,
    val label: String,
    val ok: Boolean = true
)

enum class ProposalStatus { PENDING, APPLIED, DISCARDED, FAILED }

/** A change to an existing document that waits for the user to apply or discard it. */
data class MessageProposal(
    val id: UUID,
    val spaceId: UUID,
    val path: String,
    val summary: String,
    val oldText: String,
    val newText: String,
    val contextBefore: String = "",
    val contextAfter: String = "",
    val status: ProposalStatus = ProposalStatus.PENDING,
    val error: String? = null
)
