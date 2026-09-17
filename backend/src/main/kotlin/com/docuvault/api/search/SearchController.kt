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

        // Spaces and groups are containers, not documents, so they are matched
        // separately and put first: someone typing "Product Handbook" is looking for the
        // space itself, and burying it under every document that merely mentions
        // the name is the same as not finding it.
        val containers = matchingContainers(spaces, q)

        // Literal substring match over title, path, and content (via the chunks
        // already indexed for embeddings). The query is split into whitespace
        // terms that are AND-ed, so multi-word searches match across fields.
        // Results are ordered by field-weighted relevance (title > path >
        // content), not recency — see DocumentRepositoryImpl.searchByTerms.
        val documents = documentRepository.searchByTerms(spaceIds, q, limit)

        val documentResults = documents.map { doc ->
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
                kind = SearchResultKind.DOCUMENT,
                documentPath = doc.path,
                documentTitle = doc.title ?: doc.path.substringAfterLast("/").substringBeforeLast("."),
                spaceId = doc.space.id!!,
                spaceName = space?.name ?: "",
                spaceFullPath = space?.getFullPath() ?: "",
                snippet = snippet,
                updatedAt = doc.updatedAt.toString()
            )
        }

        return ResponseEntity.ok(containers + documentResults)
    }

    /**
     * Spaces and groups whose name, slug or full path matches every term of the
     * query. Capped so a broad word can't push the documents off the list —
     * containers are a shortcut to the right place, not the answer itself.
     */
    private fun matchingContainers(
        spaces: List<com.docuvault.domain.space.Space>,
        query: String,
        limit: Int = 5
    ): List<SearchResultDto> {
        val terms = query.trim().split(Regex("\\s+")).filter { it.isNotBlank() }
        if (terms.isEmpty()) return emptyList()

        return spaces
            .filter { space ->
                val haystack = listOf(space.name, space.slug, space.getFullPath())
                    .joinToString(" ")
                    .lowercase()
                terms.all { haystack.contains(it.lowercase()) }
            }
            // A name that starts with what was typed is the likelier target than
            // one that merely contains it somewhere.
            .sortedWith(
                compareByDescending<com.docuvault.domain.space.Space> {
                    it.name.lowercase().startsWith(terms.first().lowercase())
                }.thenBy { it.name.lowercase() }
            )
            .take(limit)
            .map { space ->
                SearchResultDto(
                    kind = if (space.type == SpaceType.GROUP) SearchResultKind.GROUP else SearchResultKind.SPACE,
                    // A container has no document to open; the caller navigates by
                    // spaceFullPath instead.
                    documentPath = "",
                    documentTitle = space.name,
                    spaceId = space.id!!,
                    spaceName = space.parent?.name ?: "",
                    spaceFullPath = space.getFullPath(),
                    snippet = null,
                    updatedAt = space.updatedAt.toString()
                )
            }
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
            // A group searches only the child repositories this user can read.
            val spaceIds = permissionService.readableRepositoryIds(user.id!!, user.role, request.spaceId)
            if (spaceIds.isEmpty()) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
            }

            val chunks = embeddingService.findSimilar(spaceIds, request.query, limit)
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

/** What a hit actually is, so the caller can label and open it correctly. */
enum class SearchResultKind { DOCUMENT, SPACE, GROUP }

data class SearchResultDto(
    val kind: SearchResultKind = SearchResultKind.DOCUMENT,
    /** Empty for SPACE and GROUP hits — they are opened by [spaceFullPath]. */
    val documentPath: String,
    val documentTitle: String,
    val spaceId: UUID,
    /** For a container hit this is its parent group, not the container itself. */
    val spaceName: String,
    val spaceFullPath: String,
    val snippet: String?,
    val updatedAt: String
)
