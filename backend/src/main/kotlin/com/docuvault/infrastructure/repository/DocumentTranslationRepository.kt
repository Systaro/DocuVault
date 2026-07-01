package com.docuvault.infrastructure.repository

import com.docuvault.domain.space.DocumentTranslation
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import org.springframework.stereotype.Repository
import java.util.*

@Repository
interface DocumentTranslationRepository : JpaRepository<DocumentTranslation, UUID> {
    fun findByDocumentIdAndTargetLanguage(documentId: UUID, targetLanguage: String): DocumentTranslation?

    @Query(
        """
        SELECT d.path AS path, t.targetLanguage AS targetLanguage
        FROM DocumentTranslation t
        JOIN t.document d
        WHERE d.space.id = :spaceId
        """
    )
    fun findLanguagesBySpaceId(@Param("spaceId") spaceId: UUID): List<TranslationLanguageRow>

    @Query(
        """
        SELECT t.targetLanguage
        FROM DocumentTranslation t
        JOIN t.document d
        WHERE d.space.id = :spaceId AND d.path = :path
        """
    )
    fun findLanguagesBySpaceIdAndPath(@Param("spaceId") spaceId: UUID, @Param("path") path: String): List<String>

    @Modifying
    @Query(
        """
        DELETE FROM DocumentTranslation t
        WHERE t.targetLanguage = :targetLanguage
        AND t.document.id IN (
            SELECT d.id FROM Document d WHERE d.space.id = :spaceId AND d.path = :path
        )
        """
    )
    fun deleteBySpaceIdAndPathAndTargetLanguage(
        @Param("spaceId") spaceId: UUID,
        @Param("path") path: String,
        @Param("targetLanguage") targetLanguage: String
    ): Int
}

interface TranslationLanguageRow {
    val path: String
    val targetLanguage: String
}
