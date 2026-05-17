package com.docuvault.service

import com.docuvault.domain.space.DocumentSettings
import com.docuvault.domain.space.Space
import com.docuvault.domain.user.User
import com.docuvault.infrastructure.repository.DocumentSettingsRepository
import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Instant
import java.util.*

@Service
class DocumentSettingsService(
    private val repo: DocumentSettingsRepository,
    private val objectMapper: ObjectMapper
) {
    @Transactional(readOnly = true)
    fun getSettings(spaceId: UUID, filePath: String): Map<String, Any> {
        val row = repo.findBySpaceIdAndFilePath(spaceId, filePath) ?: return emptyMap()
        @Suppress("UNCHECKED_CAST")
        return objectMapper.readValue(row.settings, Map::class.java) as Map<String, Any>
    }

    @Transactional
    fun upsertSettings(
        space: Space,
        filePath: String,
        settings: Map<String, Any>,
        user: User?
    ): Map<String, Any> {
        val json = objectMapper.writeValueAsString(settings)
        val existing = repo.findBySpaceIdAndFilePath(space.id!!, filePath)
        val saved = if (existing != null) {
            existing.settings = json
            existing.updatedAt = Instant.now()
            existing.updatedBy = user
            repo.save(existing)
        } else {
            repo.save(
                DocumentSettings(
                    space = space,
                    filePath = filePath,
                    settings = json,
                    updatedAt = Instant.now(),
                    updatedBy = user
                )
            )
        }
        @Suppress("UNCHECKED_CAST")
        return objectMapper.readValue(saved.settings, Map::class.java) as Map<String, Any>
    }
}
