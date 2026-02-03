package com.docuvault.service.embedding

import com.aallam.openai.api.embedding.EmbeddingRequest
import com.aallam.openai.api.model.ModelId
import com.docuvault.config.OpenAIProvider
import com.docuvault.infrastructure.repository.DocumentEmbeddingRepository
import com.docuvault.infrastructure.repository.DocumentRepository
import jakarta.persistence.EntityManager
import org.slf4j.LoggerFactory
import kotlinx.coroutines.runBlocking
import org.springframework.scheduling.annotation.Async
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.util.*

@Service
class EmbeddingService(
    private val openAIProvider: OpenAIProvider,
    private val documentRepository: DocumentRepository,
    private val documentEmbeddingRepository: DocumentEmbeddingRepository,
    private val entityManager: EntityManager
) {
    companion object {
        private const val CHUNK_SIZE = 500 // tokens (approximate by splitting on words)
        private const val CHUNK_OVERLAP = 50
    }

    @Async
    @Transactional
    fun processDocument(documentId: UUID, content: String) {
        if (openAIProvider.getClient() == null) return

        if (!documentRepository.existsById(documentId)) return

        // Delete existing embeddings
        documentEmbeddingRepository.deleteByDocumentId(documentId)

        // Chunk the content
        val chunks = chunkText(content)

        // Generate embeddings for each chunk and insert via native query to avoid Hibernate vector mapping issues
        chunks.forEachIndexed { index, chunk ->
            val embedding = generateEmbedding(chunk)
            if (embedding != null) {
                val embeddingStr = "[${embedding.joinToString(",")}]"
                entityManager.createNativeQuery(
                    """INSERT INTO document_embeddings (id, document_id, chunk_index, content, embedding, created_at)
                       VALUES (gen_random_uuid(), :docId, :chunkIndex, :content, cast(:embedding as vector), now())"""
                )
                    .setParameter("docId", documentId)
                    .setParameter("chunkIndex", index)
                    .setParameter("content", chunk)
                    .setParameter("embedding", embeddingStr)
                    .executeUpdate()
            }
        }
    }

    fun generateEmbedding(text: String): FloatArray? {
        val openAI = openAIProvider.getClient() ?: return null

        return runBlocking {
            try {
                val response = openAI.embeddings(
                    EmbeddingRequest(
                        model = ModelId(openAIProvider.getEmbeddingModel()),
                        input = listOf(text)
                    )
                )
                response.embeddings.firstOrNull()?.embedding?.map { it.toFloat() }?.toFloatArray()
            } catch (e: Exception) {
                e.printStackTrace()
                null
            }
        }
    }

    fun findSimilar(spaceId: UUID, query: String, limit: Int = 5): List<SimilarChunk> {
        val queryEmbedding = generateEmbedding(query) ?: return emptyList()

        val embeddingString = "[${queryEmbedding.joinToString(",")}]"
        val results = documentEmbeddingRepository.findSimilarBySpaceId(spaceId, embeddingString, limit)

        // Results: [id, document_id, chunk_index, content, path, title]
        return results.map { row ->
            SimilarChunk(
                documentId = row[1] as UUID,
                documentPath = row[4] as String,
                documentTitle = row[5] as String?,
                chunkIndex = row[2] as Int,
                content = row[3] as String
            )
        }
    }

    private fun chunkText(text: String): List<String> {
        val words = text.split(Regex("\\s+"))
        val chunks = mutableListOf<String>()

        var start = 0
        while (start < words.size) {
            val end = minOf(start + CHUNK_SIZE, words.size)
            val chunk = words.subList(start, end).joinToString(" ")
            chunks.add(chunk)
            start = end - CHUNK_OVERLAP
            if (start >= words.size - CHUNK_OVERLAP) break
        }

        return chunks
    }
}

data class SimilarChunk(
    val documentId: UUID,
    val documentPath: String,
    val documentTitle: String?,
    val chunkIndex: Int,
    val content: String
)
