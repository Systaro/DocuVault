package com.docuvault.domain.space

import jakarta.persistence.*
import java.time.Instant
import java.util.*

@Entity
@Table(
    name = "space_state",
    uniqueConstraints = [UniqueConstraint(columnNames = ["space_id", "key"])]
)
data class SpaceState(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID? = null,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "space_id", nullable = false)
    val space: Space,

    @Column(nullable = false)
    val key: String,

    @Column(nullable = false, columnDefinition = "TEXT")
    var value: String,

    @Column(name = "created_at")
    val createdAt: Instant = Instant.now(),

    @Column(name = "updated_at")
    var updatedAt: Instant = Instant.now()
)
