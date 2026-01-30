package com.docuvault.service.embedding

import com.aallam.openai.api.embedding.EmbeddingRequest
import com.aallam.openai.api.model.ModelId
import com.docuvault.config.OpenAIProvider
import com.docuvault.domain.space.DocumentEmbedding
import com.docuvault.infrastructure.repository.DocumentEmbeddingRepository
import com.docuvault.infrastructure.repository.DocumentRepository
import kotlinx.coroutines.runBlocking
import org.springframework.scheduling.annotation.Async
import org.springframework.stereotype.Service
import java.util.*

@Service
class EmbeddingService(
    private val openAIProvider: OpenAIProvider,
    private val documentRepository: DocumentRepository,
    private val documentEmbeddingRepository: DocumentEmbeddingRepository
) {
    companion object {
        private const val CHUNK_SIZE = 500 // tokens (approximate by splitting on words)
        private const val CHUNK_OVERLAP = 50
    }

    @Async
    fun processDocument(documentId: UUID, content: String) {
        if (openAIProvider.getClient() == null) return

        val document = documentRepository.findById(documentId).orElse(null) ?: return

        // Delete existing embeddings
        documentEmbeddingRepository.deleteByDocumentId(documentId)

        // Chunk the content
        val chunks = chunkText(content)

        // Generate embeddings for each chunk
        chunks.forEachIndexed { index, chunk ->
            val embedding = generateEmbedding(chunk)
            if (embedding != null) {
                val docEmbedding = DocumentEmbedding(
                    document = document,
                    chunkIndex = index,
                    content = chunk,
                    embedding = embedding
                )
                documentEmbeddingRepository.save(docEmbedding)
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

        return results.map { embedding ->
            SimilarChunk(
                documentId = embedding.document.id!!,
                documentPath = embedding.document.path,
                documentTitle = embedding.document.title,
                chunkIndex = embedding.chunkIndex,
                content = embedding.content
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
