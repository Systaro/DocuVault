package com.docuvault.api.inbox

import com.docuvault.domain.inbox.*
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.PermissionService
import com.docuvault.service.inbox.InboxService
import com.docuvault.service.inbox.RoutingRuleUpdate
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.core.userdetails.UserDetails
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.*
import java.time.Instant
import java.util.*

@RestController
@RequestMapping("/spaces/{spaceId}/inbox")
class InboxController(
    private val inboxService: InboxService,
    private val spaceRepository: SpaceRepository,
    private val userRepository: UserRepository,
    private val permissionService: PermissionService
) {
    // --- Notes ---

    @GetMapping("/notes")
    @Transactional(readOnly = true)
    fun listNotes(
        @PathVariable spaceId: UUID,
        @RequestParam(defaultValue = "UNSORTED") status: NoteStatus,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<List<InboxNoteDto>> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        if (!permissionService.hasAccess(user.id!!, spaceId, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val notes = inboxService.getNotes(spaceId, status)
        return ResponseEntity.ok(notes.map { it.toDto() })
    }

    @GetMapping("/count")
    @Transactional(readOnly = true)
    fun getUnsortedCount(
        @PathVariable spaceId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<Map<String, Long>> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        if (!permissionService.hasAccess(user.id!!, spaceId, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val count = inboxService.getUnsortedCount(spaceId)
        return ResponseEntity.ok(mapOf("count" to count))
    }

    @PostMapping("/notes")
    fun createNote(
        @PathVariable spaceId: UUID,
        @Valid @RequestBody request: CreateNoteRequest,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<InboxNoteDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        if (!permissionService.hasEditAccess(user.id!!, spaceId, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val note = inboxService.createNote(spaceId, userDetails.username, request.content)
        return ResponseEntity.status(HttpStatus.CREATED).body(note.toDto())
    }

    @GetMapping("/notes/{noteId}")
    @Transactional(readOnly = true)
    fun getNote(
        @PathVariable spaceId: UUID,
        @PathVariable noteId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<InboxNoteDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        if (!permissionService.hasAccess(user.id!!, spaceId, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val note = inboxService.getNote(noteId) ?: return ResponseEntity.notFound().build()
        if (note.space.id != spaceId) return ResponseEntity.notFound().build()

        return ResponseEntity.ok(note.toDto())
    }

    @PostMapping("/notes/{noteId}/suggest")
    fun generateSuggestion(
        @PathVariable spaceId: UUID,
        @PathVariable noteId: UUID,
        @RequestBody(required = false) request: SuggestRequest?,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<InboxNoteDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        if (!permissionService.hasEditAccess(user.id!!, spaceId, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val note = inboxService.getNote(noteId) ?: return ResponseEntity.notFound().build()
        if (note.space.id != spaceId) return ResponseEntity.notFound().build()

        val updated = inboxService.generateSuggestion(noteId, request?.hint)
        return ResponseEntity.ok(updated.toDto())
    }

    @PostMapping("/notes/{noteId}/file")
    fun fileNote(
        @PathVariable spaceId: UUID,
        @PathVariable noteId: UUID,
        @Valid @RequestBody request: FileNoteRequest,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<InboxNoteDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        if (!permissionService.hasEditAccess(user.id!!, spaceId, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val note = inboxService.getNote(noteId) ?: return ResponseEntity.notFound().build()
        if (note.space.id != spaceId) return ResponseEntity.notFound().build()

        val updated = inboxService.fileNote(
            noteId = noteId,
            filedByEmail = userDetails.username,
            documentPath = request.documentPath,
            mergedContent = request.mergedContent,
            createNew = request.createNew ?: false,
            newTitle = request.newTitle,
            saveAsRule = request.saveAsRule ?: false,
            ruleCondition = request.ruleCondition
        )
        return ResponseEntity.ok(updated.toDto())
    }

    @PostMapping("/notes/{noteId}/dismiss")
    fun dismissNote(
        @PathVariable spaceId: UUID,
        @PathVariable noteId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<InboxNoteDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        if (!permissionService.hasEditAccess(user.id!!, spaceId, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val note = inboxService.getNote(noteId) ?: return ResponseEntity.notFound().build()
        if (note.space.id != spaceId) return ResponseEntity.notFound().build()

        val updated = inboxService.dismissNote(noteId)
        return ResponseEntity.ok(updated.toDto())
    }

    // --- Routing Rules ---

    @GetMapping("/rules")
    @Transactional(readOnly = true)
    fun listRules(
        @PathVariable spaceId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<List<RoutingRuleDto>> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        if (!permissionService.hasAccess(user.id!!, spaceId, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val rules = inboxService.getRules(spaceId)
        return ResponseEntity.ok(rules.map { it.toDto() })
    }

    @PostMapping("/rules")
    fun createRule(
        @PathVariable spaceId: UUID,
        @Valid @RequestBody request: CreateRuleRequest,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<RoutingRuleDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        if (!permissionService.hasAdminAccess(user.id!!, spaceId, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val rule = inboxService.createRule(
            spaceId = spaceId,
            type = request.type,
            condition = request.condition,
            actionType = request.actionType,
            targetDocumentPath = request.targetDocumentPath,
            targetGroupPath = request.targetGroupPath,
            autoFile = request.autoFile,
            description = request.description
        )
        return ResponseEntity.status(HttpStatus.CREATED).body(rule.toDto())
    }

    @PutMapping("/rules/{ruleId}")
    fun updateRule(
        @PathVariable spaceId: UUID,
        @PathVariable ruleId: UUID,
        @RequestBody request: UpdateRuleRequest,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<RoutingRuleDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        if (!permissionService.hasAdminAccess(user.id!!, spaceId, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val rule = inboxService.updateRule(
            ruleId, RoutingRuleUpdate(
                condition = request.condition,
                actionType = request.actionType,
                targetDocumentPath = request.targetDocumentPath,
                targetGroupPath = request.targetGroupPath,
                autoFile = request.autoFile,
                description = request.description
            )
        )
        return ResponseEntity.ok(rule.toDto())
    }

    @DeleteMapping("/rules/{ruleId}")
    fun deleteRule(
        @PathVariable spaceId: UUID,
        @PathVariable ruleId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<Void> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        if (!permissionService.hasAdminAccess(user.id!!, spaceId, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        inboxService.deleteRule(ruleId)
        return ResponseEntity.noContent().build()
    }
}

// --- Request DTOs ---

data class CreateNoteRequest(
    @field:NotBlank val content: String
)

data class SuggestRequest(
    val hint: String? = null
)

data class FileNoteRequest(
    @field:NotBlank val documentPath: String,
    @field:NotBlank val mergedContent: String,
    val createNew: Boolean? = false,
    val newTitle: String? = null,
    val saveAsRule: Boolean? = false,
    val ruleCondition: String? = null
)

data class CreateRuleRequest(
    val type: RuleType,
    @field:NotBlank val condition: String,
    val actionType: RuleAction = RuleAction.APPEND_TO_DOCUMENT,
    val targetDocumentPath: String? = null,
    val targetGroupPath: String? = null,
    val autoFile: Boolean = false,
    val description: String? = null
)

data class UpdateRuleRequest(
    val condition: String? = null,
    val actionType: RuleAction? = null,
    val targetDocumentPath: String? = null,
    val targetGroupPath: String? = null,
    val autoFile: Boolean? = null,
    val description: String? = null
)

// --- Response DTOs ---

data class InboxNoteDto(
    val id: UUID,
    val spaceId: UUID,
    val authorId: UUID,
    val authorName: String,
    val content: String,
    val status: NoteStatus,
    val aiSuggestion: String?,
    val filedToDocumentPath: String?,
    val filedByName: String?,
    val autoFiled: Boolean,
    val appliedRuleId: UUID?,
    val createdAt: Instant,
    val filedAt: Instant?
)

data class RoutingRuleDto(
    val id: UUID,
    val spaceId: UUID,
    val type: RuleType,
    val condition: String,
    val actionType: RuleAction,
    val targetDocumentPath: String?,
    val targetGroupPath: String?,
    val autoFile: Boolean,
    val description: String?,
    val createdAt: Instant
)

// --- Extension functions ---

fun InboxNote.toDto() = InboxNoteDto(
    id = this.id!!,
    spaceId = this.space.id!!,
    authorId = this.author.id!!,
    authorName = this.author.name,
    content = this.content,
    status = this.status,
    aiSuggestion = this.aiSuggestion,
    filedToDocumentPath = this.filedToDocumentPath,
    filedByName = this.filedBy?.name,
    autoFiled = this.autoFiled,
    appliedRuleId = this.appliedRule?.id,
    createdAt = this.createdAt,
    filedAt = this.filedAt
)

fun RoutingRule.toDto() = RoutingRuleDto(
    id = this.id!!,
    spaceId = this.space.id!!,
    type = this.type,
    condition = this.condition,
    actionType = this.actionType,
    targetDocumentPath = this.targetDocumentPath,
    targetGroupPath = this.targetGroupPath,
    autoFile = this.autoFile,
    description = this.description,
    createdAt = this.createdAt
)
