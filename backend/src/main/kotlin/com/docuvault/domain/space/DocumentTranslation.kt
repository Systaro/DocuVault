package com.docuvault.domain.space

import jakarta.persistence.*
import java.time.Instant
import java.util.*

@Entity
@Table(
    name = "document_translations",
    uniqueConstraints = [UniqueConstraint(columnNames = ["document_id", "target_language"])]
)
data class DocumentTranslation(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID? = null,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "document_id", nullable = false)
    val document: Document,

    @Column(name = "target_language", nullable = false, length = 8)
    val targetLanguage: String,

    @Column(name = "source_content_hash", nullable = false, length = 64)
    var sourceContentHash: String,

    @Column(name = "translated_content", nullable = false, columnDefinition = "TEXT")
    var translatedContent: String,

    @Column(name = "created_at", nullable = false)
    var createdAt: Instant = Instant.now()
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is DocumentTranslation) return false
        return id != null && id == other.id
    }

    override fun hashCode(): Int = id?.hashCode() ?: 0
}
