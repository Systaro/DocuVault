package com.docuvault.infrastructure.repository

import com.docuvault.domain.space.DocumentSettings
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Repository
import java.util.*

@Repository
interface DocumentSettingsRepository : JpaRepository<DocumentSettings, UUID> {
    fun findBySpaceIdAndFilePath(spaceId: UUID, filePath: String): DocumentSettings?
}
