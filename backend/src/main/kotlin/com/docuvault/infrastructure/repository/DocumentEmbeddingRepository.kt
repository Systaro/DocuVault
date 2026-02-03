package com.docuvault.infrastructure.repository

import com.docuvault.domain.space.DocumentEmbedding
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.stereotype.Repository
import java.util.*

@Repository
interface DocumentEmbeddingRepository : JpaRepository<DocumentEmbedding, UUID> {
    fun findByDocumentId(documentId: UUID): List<DocumentEmbedding>
    fun deleteByDocumentId(documentId: UUID)

    @Query(
        value = """
            SELECT de.id, de.document_id, de.chunk_index, de.content, d.path, d.title
            FROM document_embeddings de
            JOIN documents d ON de.document_id = d.id
            WHERE d.space_id = :spaceId
            ORDER BY de.embedding <=> cast(:queryEmbedding as vector)
            LIMIT :limit
        """,
        nativeQuery = true
    )
    fun findSimilarBySpaceId(
        spaceId: UUID,
        queryEmbedding: String,
        limit: Int = 5
    ): List<Array<Any>>
}
