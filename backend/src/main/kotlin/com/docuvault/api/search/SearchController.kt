package com.docuvault.api.search

import com.docuvault.domain.space.SpaceType
import com.docuvault.infrastructure.repository.DocumentRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.PermissionService
import com.docuvault.service.embedding.EmbeddingService
import com.docuvault.service.git.GitService
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.core.userdetails.UserDetails
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.*
import java.util.*

@RestController
@RequestMapping("/search")
class SearchController(
    private val documentRepository: DocumentRepository,
    private val userRepository: UserRepository,
    private val permissionService: PermissionService,
    private val gitService: GitService,
    private val embeddingService: EmbeddingService
) {
    @GetMapping
    @Transactional(readOnly = true)
    fun search(
        @RequestParam q: String,
        @RequestParam(defaultValue = "20") limit: Int,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<List<SearchResultDto>> {
        if (q.length < 2) return ResponseEntity.ok(emptyList())

        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val spaces = permissionService.getAccessibleSpaces(user.id!!, user.role)
        if (spaces.isEmpty()) return ResponseEntity.ok(emptyList())

        val spaceIds = spaces.mapNotNull { it.id }
        val spaceMap = spaces.associateBy { it.id }
        val qLower = q.lowercase()

        // 1) Literal title/path matches — fast, free, deterministic
        val scored = mutableListOf<ScoredResult>()
        val seenDocIds = mutableSetOf<UUID>()

        documentRepository.searchByTitleOrPath(spaceIds, q).forEach { doc ->
            val docId = doc.id ?: return@forEach
            val space = spaceMap[doc.space.id]
            val snippet = try {
                val content = gitService.readFile(doc.space, doc.path)
                content?.take(300)?.let { if (content.length > 300) "$it..." else it }
            } catch (_: Exception) {
                null
            }
            val score = literalScore(doc, qLower)
            scored += ScoredResult(doc.toResultDto(space, snippet), score)
            seenDocIds += docId
        }

        // 2) Semantic vector hits (authentication -> login, etc.)
        val repoSpaceIds = spaces.filter { it.type == SpaceType.REPOSITORY }.mapNotNull { it.id }
        if (repoSpaceIds.isNotEmpty()) {
            // Over-fetch since one doc can produce multiple high-rank chunks
            val chunks = embeddingService.findSimilarAcrossSpaces(repoSpaceIds, q, limit * 3)
            val bestChunkPerDoc = chunks
                .distinctBy { it.documentId } // chunks come ranked, distinctBy keeps the best
                .filter { it.documentId !in seenDocIds }

            if (bestChunkPerDoc.isNotEmpty()) {
                val semanticDocs = documentRepository
                    .findAllById(bestChunkPerDoc.map { it.documentId })
                    .associateBy { it.id }

                bestChunkPerDoc.forEach { chunk ->
                    val doc = semanticDocs[chunk.documentId] ?: return@forEach
                    val space = spaceMap[doc.space.id]
                    val snippet = chunk.content.take(300).let {
                        if (chunk.content.length > 300) "$it..." else it
                    }
                    scored += ScoredResult(doc.toResultDto(space, snippet), semanticScore(chunk.distance))
                }
            }
        }

        val ranked = scored
            .sortedByDescending { it.score }
            .take(limit)
            .map { it.result }

        return ResponseEntity.ok(ranked)
    }

    /**
     * Literal score in [0.85, 1.0]. Title hit dominates path hit so renamed files
     * with stale-looking paths don't outrank fresh content.
     */
    private fun literalScore(doc: com.docuvault.domain.space.Document, qLower: String): Double {
        val titleHit = (doc.title ?: "").lowercase().contains(qLower)
        return if (titleHit) 1.0 else 0.85
    }

    /**
     * Semantic score from pgvector cosine distance. OpenAI vectors are normalized, so
     * `<=>` is in [0, 2]; (2 - d) / 2 maps that to [0, 1]. Capped under 0.85 so a
     * direct title hit always wins over even a near-perfect semantic match.
     */
    private fun semanticScore(distance: Double): Double {
        val sim = ((2.0 - distance) / 2.0).coerceIn(0.0, 1.0)
        return sim * 0.84
    }

    private data class ScoredResult(val result: SearchResultDto, val score: Double)

    private fun com.docuvault.domain.space.Document.toResultDto(
        space: com.docuvault.domain.space.Space?,
        snippet: String?
    ) = SearchResultDto(
        documentPath = this.path,
        documentTitle = this.title ?: this.path.substringAfterLast("/").substringBeforeLast("."),
        spaceId = this.space.id!!,
        spaceName = space?.name ?: "",
        spaceFullPath = space?.getFullPath() ?: "",
        snippet = snippet,
        updatedAt = this.updatedAt.toString()
    )

    @PostMapping("/semantic")
    @Transactional(readOnly = true)
    fun semanticSearch(
        @Valid @RequestBody request: SemanticSearchRequest,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<List<SemanticSearchResultDto>> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val limit = request.limit ?: 10

        if (request.spaceId != null) {
            // Search within specific space (handles groups -> child repos internally)
            if (!permissionService.hasAccess(user.id!!, request.spaceId, user.role)) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
            }

            val chunks = embeddingService.findSimilar(request.spaceId, request.query, limit)
            val results = chunks.map { chunk ->
                SemanticSearchResultDto(
                    documentPath = chunk.documentPath,
                    documentTitle = chunk.documentTitle ?: chunk.documentPath.substringAfterLast("/").substringBeforeLast("."),
                    content = chunk.content,
                    spaceId = request.spaceId,
                    spaceName = null,
                    spaceFullPath = null
                )
            }
            return ResponseEntity.ok(results)
        }

        // Cross-space search: search all accessible repository spaces
        val spaces = permissionService.getAccessibleSpaces(user.id!!, user.role)
        if (spaces.isEmpty()) return ResponseEntity.ok(emptyList())

        val repoSpaces = spaces.filter { it.type == SpaceType.REPOSITORY }
        if (repoSpaces.isEmpty()) return ResponseEntity.ok(emptyList())

        val spaceIds = repoSpaces.mapNotNull { it.id }
        val spaceMap = repoSpaces.associateBy { it.id }

        val chunks = embeddingService.findSimilarAcrossSpaces(spaceIds, request.query, limit)
        val results = chunks.map { chunk ->
            val space = spaceMap[chunk.spaceId]
            SemanticSearchResultDto(
                documentPath = chunk.documentPath,
                documentTitle = chunk.documentTitle ?: chunk.documentPath.substringAfterLast("/").substringBeforeLast("."),
                content = chunk.content,
                spaceId = chunk.spaceId,
                spaceName = space?.name,
                spaceFullPath = space?.getFullPath()
            )
        }

        return ResponseEntity.ok(results)
    }
}

data class SemanticSearchRequest(
    @field:NotBlank(message = "Query is required")
    val query: String,
    val spaceId: UUID? = null,
    val limit: Int? = null
)

data class SemanticSearchResultDto(
    val documentPath: String,
    val documentTitle: String,
    val content: String,
    val spaceId: UUID,
    val spaceName: String?,
    val spaceFullPath: String?
)

data class SearchResultDto(
    val documentPath: String,
    val documentTitle: String,
    val spaceId: UUID,
    val spaceName: String,
    val spaceFullPath: String,
    val snippet: String?,
    val updatedAt: String
)
