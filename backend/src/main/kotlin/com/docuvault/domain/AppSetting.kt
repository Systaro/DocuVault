package com.docuvault.domain

import jakarta.persistence.*
import java.time.Instant

@Entity
@Table(name = "app_settings")
data class AppSetting(
    @Id
    val key: String,

    @Column(columnDefinition = "TEXT")
    var value: String? = null,

    val encrypted: Boolean = false,

    @Column(name = "updated_at")
    var updatedAt: Instant = Instant.now()
)
