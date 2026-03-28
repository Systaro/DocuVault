package com.docuvault.domain.inbox

import com.docuvault.domain.space.Space
import com.docuvault.domain.user.User
import jakarta.persistence.*
import java.time.Instant
import java.util.*

enum class NoteStatus {
    UNSORTED, FILED, DISMISSED
}

@Entity
@Table(name = "inbox_notes")
data class InboxNote(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID? = null,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "space_id", nullable = false)
    val space: Space,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "author_id", nullable = false)
    val author: User,

    @Column(nullable = false, columnDefinition = "TEXT")
    var content: String,

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    var status: NoteStatus = NoteStatus.UNSORTED,

    @Column(name = "ai_suggestion", columnDefinition = "TEXT")
    var aiSuggestion: String? = null,

    @Column(name = "filed_to_document_path")
    var filedToDocumentPath: String? = null,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "filed_by_id")
    var filedBy: User? = null,

    @Column(name = "auto_filed")
    var autoFiled: Boolean = false,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "applied_rule_id")
    var appliedRule: RoutingRule? = null,

    @Column(name = "created_at")
    val createdAt: Instant = Instant.now(),

    @Column(name = "filed_at")
    var filedAt: Instant? = null
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is InboxNote) return false
        return id != null && id == other.id
    }

    override fun hashCode(): Int = id?.hashCode() ?: 0
}
