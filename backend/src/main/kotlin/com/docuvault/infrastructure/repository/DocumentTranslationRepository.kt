package com.docuvault.infrastructure.repository

import com.docuvault.domain.space.DocumentTranslation
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Repository
import java.util.*

@Repository
interface DocumentTranslationRepository : JpaRepository<DocumentTranslation, UUID> {
    fun findByDocumentIdAndTargetLanguage(documentId: UUID, targetLanguage: String): DocumentTranslation?
}
