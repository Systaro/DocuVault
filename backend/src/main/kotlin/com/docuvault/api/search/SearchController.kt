package com.docuvault.api.search

import com.docuvault.infrastructure.repository.DocumentRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.PermissionService
import com.docuvault.service.git.GitService
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.core.userdetails.UserDetails
import org.springframework.web.bind.annotation.*
import java.util.*

@RestController
@RequestMapping("/search")
class SearchController(
    private val documentRepository: DocumentRepository,
    private val userRepository: UserRepository,
    private val permissionService: PermissionService,
    private val gitService: GitService
) {
    @GetMapping
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
}

data class SearchResultDto(
    val documentPath: String,
    val documentTitle: String,
    val spaceId: UUID,
    val spaceName: String,
    val spaceFullPath: String,
    val snippet: String?,
    val updatedAt: String
)
