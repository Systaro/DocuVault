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

        val documents = documentRepository.searchByTitleOrPath(spaceIds, q)
            .take(limit)

        val results = documents.map { doc ->
            val space = spaceMap[doc.space.id]
            val snippet = try {
                val content = gitService.readFile(doc.space, doc.path)
                content?.take(300)?.let { truncated ->
                    if (content.length > 300) "$truncated..." else truncated
                }
            } catch (_: Exception) {
                null
            }

            SearchResultDto(
                documentPath = doc.path,
                documentTitle = doc.title ?: doc.path.substringAfterLast("/").substringBeforeLast("."),
                spaceId = doc.space.id!!,
                spaceName = space?.name ?: "",
                spaceFullPath = space?.getFullPath() ?: "",
                snippet = snippet,
                updatedAt = doc.updatedAt.toString()
            )
        }

        return ResponseEntity.ok(results)
    }

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
