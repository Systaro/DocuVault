package com.docuvault.api.ai

import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.PermissionService
import com.docuvault.service.ai.SuggestionType
import com.docuvault.service.ai.WritingAssistantService
import com.docuvault.service.embedding.EmbeddingService
import com.docuvault.service.embedding.SimilarChunk
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.core.userdetails.UserDetails
import org.springframework.web.bind.annotation.*
import java.util.*

@RestController
@RequestMapping("/ai")
class AiController(
    private val embeddingService: EmbeddingService,
    private val writingAssistantService: WritingAssistantService,
    private val userRepository: UserRepository,
    private val permissionService: PermissionService
) {
    @PostMapping("/search")
    fun semanticSearch(
        @AuthenticationPrincipal userDetails: UserDetails,
        @Valid @RequestBody request: SearchRequest
    ): ResponseEntity<List<SimilarChunk>> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()
        val spaceIds = permissionService.readableRepositoryIds(user.id!!, user.role, request.spaceId)
        if (spaceIds.isEmpty()) return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        return ResponseEntity.ok(embeddingService.findSimilar(spaceIds, request.query, request.limit ?: 5))
    }

    @PostMapping("/suggest")
    fun suggest(
        @Valid @RequestBody request: SuggestRequest
    ): ResponseEntity<SuggestResponse> {
        val suggestion = writingAssistantService.suggest(
            context = request.context,
            cursorPosition = request.cursorPosition ?: request.context.length,
            type = SuggestionType.valueOf(request.type.uppercase())
        )
        return ResponseEntity.ok(SuggestResponse(suggestion = suggestion))
    }

    @PostMapping("/generate")
    fun generate(
        @Valid @RequestBody request: GenerateRequest
    ): ResponseEntity<GenerateResponse> {
        val content = writingAssistantService.generateContent(
            prompt = request.prompt,
            documentContext = request.documentContext
        )
        return ResponseEntity.ok(GenerateResponse(content = content))
    }
}

data class SearchRequest(
    val spaceId: UUID,

    @field:NotBlank(message = "Query is required")
    val query: String,

    val limit: Int? = 5
)

data class SuggestRequest(
    @field:NotBlank(message = "Context is required")
    val context: String,

    val cursorPosition: Int? = null,

    @field:NotBlank(message = "Type is required")
    val type: String // AUTOCOMPLETE, IMPROVE, EXPAND, SUMMARIZE, FIX_GRAMMAR
)

data class SuggestResponse(
    val suggestion: String?
)

data class GenerateRequest(
    @field:NotBlank(message = "Prompt is required")
    val prompt: String,

    val documentContext: String? = null
)

data class GenerateResponse(
    val content: String?
)
