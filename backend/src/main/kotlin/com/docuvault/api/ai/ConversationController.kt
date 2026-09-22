package com.docuvault.api.ai

import com.docuvault.api.EventStreams
import com.docuvault.service.ai.ConversationDto
import com.docuvault.service.ai.ConversationService
import com.docuvault.service.ai.ConversationSummaryDto
import com.docuvault.service.ai.DraftRequest
import com.docuvault.service.ai.DraftTemplate
import com.docuvault.service.ai.ProposalDto
import com.docuvault.service.tools.ToolCredential
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import org.slf4j.LoggerFactory
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.core.userdetails.UserDetails
import org.springframework.web.bind.annotation.*
import org.springframework.web.server.ResponseStatusException
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter
import java.util.*

/** The in-app assistant: conversations across all of a user's spaces, answered as a stream. */
@RestController
@RequestMapping("/ai/conversations")
class ConversationController(
    private val conversationService: ConversationService,
    private val eventStreams: EventStreams
) {

    private val logger = LoggerFactory.getLogger(ConversationController::class.java)

    @GetMapping
    fun list(
        @AuthenticationPrincipal userDetails: UserDetails,
        @RequestParam(required = false) q: String?
    ): List<ConversationSummaryDto> = conversationService.list(userDetails.username, q)

    @GetMapping("/{id}")
    fun get(@AuthenticationPrincipal userDetails: UserDetails, @PathVariable id: UUID): ConversationDto =
        conversationService.get(userDetails.username, id)

    @PatchMapping("/{id}")
    fun rename(
        @AuthenticationPrincipal userDetails: UserDetails,
        @PathVariable id: UUID,
        @Valid @RequestBody request: RenameConversationRequest
    ): ConversationSummaryDto = conversationService.rename(userDetails.username, id, request.title)

    @DeleteMapping("/{id}")
    fun delete(@AuthenticationPrincipal userDetails: UserDetails, @PathVariable id: UUID): ResponseEntity<Unit> {
        conversationService.delete(userDetails.username, id)
        return ResponseEntity.noContent().build()
    }

    /**
     * Sends a message and streams the answer as server-sent events:
     * `conversation` (the conversation, first), `status` (a tool is running),
     * `tool` (a tool finished), `delta` (answer text), `reset` (discard the text
     * so far, the model went on to use tools), `error`, and `done` with the stored
     * message. Access problems are ordinary HTTP errors before the stream starts.
     */
    @PostMapping("/turns", produces = [MediaType.TEXT_EVENT_STREAM_VALUE])
    fun turn(
        @AuthenticationPrincipal userDetails: UserDetails,
        @Valid @RequestBody request: TurnRequest,
        servletRequest: HttpServletRequest,
        servletResponse: HttpServletResponse
    ): SseEmitter {
        val credential = ToolCredential.of(servletRequest)
            ?: throw ResponseStatusException(HttpStatus.UNAUTHORIZED)
        val prepared = conversationService.prepareTurn(
            userDetails.username, request.spaceId, request.conversationId, request.documentPath, request.message,
            request.draftTemplate?.let { DraftRequest(it, request.draftDays ?: 7) },
            request.attachmentIds
        )

        // If the client goes away the turn still finishes and is stored.
        return eventStreams.open(servletResponse, TURN_TIMEOUT_MS) { stream ->
            stream.send("conversation", prepared.summary)
            try {
                conversationService.runTurn(prepared, credential) { name, data -> stream.send(name, data) }
            } catch (e: Exception) {
                logger.error("Assistant turn crashed for conversation ${prepared.conversationId}", e)
                stream.send("error", mapOf("message" to "The answer could not be stored."))
            }
        }
    }

    @PostMapping("/{id}/messages/{messageId}/proposals/{proposalId}/apply")
    fun apply(
        @AuthenticationPrincipal userDetails: UserDetails,
        @PathVariable id: UUID,
        @PathVariable messageId: UUID,
        @PathVariable proposalId: UUID,
        servletRequest: HttpServletRequest
    ): ProposalDto {
        val credential = ToolCredential.of(servletRequest) ?: throw ResponseStatusException(HttpStatus.UNAUTHORIZED)
        return conversationService.applyProposal(userDetails.username, id, messageId, proposalId, credential)
    }

    @PostMapping("/{id}/messages/{messageId}/proposals/{proposalId}/discard")
    fun discard(
        @AuthenticationPrincipal userDetails: UserDetails,
        @PathVariable id: UUID,
        @PathVariable messageId: UUID,
        @PathVariable proposalId: UUID
    ): ProposalDto = conversationService.discardProposal(userDetails.username, id, messageId, proposalId)

    companion object {
        private const val TURN_TIMEOUT_MS = 10L * 60 * 1000
    }
}

data class TurnRequest(
    /** Required for a new conversation; an existing one keeps its space. */
    val spaceId: UUID? = null,
    val conversationId: UUID? = null,
    /** Scopes a new conversation to one document of a repository space. */
    val documentPath: String? = null,
    /** Makes a new conversation write a draft from the space's recent notes, tasks and documents. */
    val draftTemplate: DraftTemplate? = null,
    val draftDays: Int? = null,
    /** Uploaded with POST /ai/attachments; a message may consist of files alone. */
    val attachmentIds: List<UUID> = emptyList(),
    val message: String = ""
)

data class RenameConversationRequest(
    @field:NotBlank(message = "Title is required")
    val title: String
)
