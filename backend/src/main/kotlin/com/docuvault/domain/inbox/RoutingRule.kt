package com.docuvault.domain.inbox

import com.docuvault.domain.space.Space
import jakarta.persistence.*
import java.time.Instant
import java.util.*

enum class RuleType {
    CATEGORY,
    PATTERN
}

enum class RuleAction {
    APPEND_TO_DOCUMENT,
    CREATE_DOCUMENT
}

@Entity
@Table(name = "routing_rules")
data class RoutingRule(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID? = null,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "space_id", nullable = false)
    val space: Space,

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    val type: RuleType,

    @Column(nullable = false)
    var condition: String,

    @Enumerated(EnumType.STRING)
    @Column(name = "action_type", nullable = false)
    var actionType: RuleAction = RuleAction.APPEND_TO_DOCUMENT,

    @Column(name = "target_document_path")
    var targetDocumentPath: String? = null,

    @Column(name = "target_group_path")
    var targetGroupPath: String? = null,

    @Column(name = "auto_file")
    var autoFile: Boolean = false,

    var description: String? = null,

    @Column(name = "created_at")
    val createdAt: Instant = Instant.now()
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is RoutingRule) return false
        return id != null && id == other.id
    }

    override fun hashCode(): Int = id?.hashCode() ?: 0
}
