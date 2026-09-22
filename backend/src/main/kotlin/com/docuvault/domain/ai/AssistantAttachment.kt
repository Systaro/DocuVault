package com.docuvault.domain.ai

import com.docuvault.domain.user.User
import jakarta.persistence.*
import java.time.Instant
import java.util.*

enum class AttachmentKind { IMAGE, PDF, TEXT }

/**
 * A file a user gave the assistant. The bytes are in object storage under
 * [storageKey]; scanned PDF pages rendered for the model sit next to it.
 */
@Entity
@Table(name = "assistant_attachments")
class AssistantAttachment(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID? = null,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    val user: User,

    /** Set once the file was sent with a message; until then it can still be dropped. */
    @Column(name = "conversation_id")
    var conversationId: UUID? = null,

    @Column(name = "file_name")
    val fileName: String,

    @Column(name = "content_type")
    val contentType: String,

    @Column(name = "size_bytes")
    val sizeBytes: Long,

    @Enumerated(EnumType.STRING)
    val kind: AttachmentKind,

    @Column(name = "storage_key")
    val storageKey: String,

    @Column(name = "extracted_text")
    val extractedText: String? = null,

    @Column(name = "page_images")
    val pageImages: Int = 0,

    @Column(name = "page_count")
    val pageCount: Int? = null,

    @Column(name = "created_at")
    val createdAt: Instant = Instant.now()
) {
    fun toMessageAttachment() = MessageAttachment(id!!, fileName, contentType, kind, sizeBytes)
}
