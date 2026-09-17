package com.docuvault.api.ai

import com.docuvault.service.ai.ConversationDto
import com.docuvault.service.ai.ConversationService
import com.docuvault.service.ai.ConversationSummaryDto
import com.docuvault.service.ai.DraftRequest
import com.docuvault.service.ai.DraftTemplate
import com.docuvault.service.ai.ProposalDto
import com.docuvault.service.tools.ToolCredential
import jakarta.annotation.PreDestroy
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
import java.io.IOException
import java.util.*
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** The in-app assistant: conversations across all of a user's spaces, answered as a stream. */
@RestController
@RequestMapping("/ai/conversations")
class ConversationController(private val conversationService: ConversationService) {

    private val logger = LoggerFactory.getLogger(ConversationController::class.java)

    // Turns wait on a model for tens of seconds; they must not occupy request threads or the @Async pool.
    private val turns = Executors.newCachedThreadPool { runnable ->
        Thread(runnable, "assistant-turn").apply { isDaemon = true }
    }
    private val heartbeats = Executors.newSingleThreadScheduledExecutor { runnable ->
        Thread(runnable, "assistant-heartbeat").apply { isDaemon = true }
    }

    @PreDestroy
    fun shutdown() {
        turns.shutdownNow()
        heartbeats.shutdownNow()
    }

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
            request.draftTemplate?.let { DraftRequest(it, request.draftDays ?: 7) }
        )

        // nginx would otherwise hold the events back until the buffer fills.
        servletResponse.setHeader("X-Accel-Buffering", "no")
        servletResponse.setHeader("Cache-Control", "no-cache")

        val emitter = SseEmitter(TURN_TIMEOUT_MS)
        val open = AtomicBoolean(true)
        emitter.onCompletion { open.set(false) }
        emitter.onTimeout { open.set(false) }
        emitter.onError { open.set(false) }

        fun send(event: SseEmitter.SseEventBuilder) {
            if (!open.get()) return
            try {
                synchronized(emitter) { emitter.send(event) }
            } catch (e: IOException) {
                // The client went away. The turn still finishes and is stored.
                open.set(false)
            } catch (e: IllegalStateException) {
                open.set(false)
            }
        }

        // Keeps proxies with idle timeouts from cutting the stream while a model thinks.
        val heartbeat = heartbeats.scheduleAtFixedRate(
            { send(SseEmitter.event().comment("keep-alive")) }, HEARTBEAT_SECONDS, HEARTBEAT_SECONDS, TimeUnit.SECONDS
        )

        send(SseEmitter.event().name("conversation").data(prepared.summary, MediaType.APPLICATION_JSON))
        turns.execute {
            try {
                conversationService.runTurn(prepared, credential) { name, data ->
                    send(SseEmitter.event().name(name).data(data, MediaType.APPLICATION_JSON))
                }
            } catch (e: Exception) {
                logger.error("Assistant turn crashed for conversation ${prepared.conversationId}", e)
                send(SseEmitter.event().name("error").data(mapOf("message" to "The answer could not be stored."), MediaType.APPLICATION_JSON))
            } finally {
                heartbeat.cancel(false)
                if (open.getAndSet(false)) emitter.complete()
            }
        }
        return emitter
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
        private const val HEARTBEAT_SECONDS = 15L
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
    @field:NotBlank(message = "Message is required")
    val message: String
)

data class RenameConversationRequest(
    @field:NotBlank(message = "Title is required")
    val title: String
)
