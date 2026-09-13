package com.docuvault.api.transfers

import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.FileUploadService
import com.docuvault.service.PermissionService
import com.docuvault.service.TransferKind
import com.docuvault.service.TransferTicket
import com.docuvault.service.TransferTicketService
import com.docuvault.service.git.GitService
import com.docuvault.service.requireSpaceWritable
import jakarta.servlet.http.HttpServletRequest
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import org.springframework.beans.factory.annotation.Value
import org.springframework.http.ContentDisposition
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.core.userdetails.UserDetails
import org.springframework.web.bind.annotation.*
import org.springframework.web.server.ResponseStatusException
import java.nio.file.Files
import java.util.*

/**
 * Two-step file transfer for MCP clients. `POST /transfers` (authenticated)
 * issues a ticket after the usual permission check; `PUT` or `GET
 * /transfers/{ticket}` (no other credential, the ticket is one) moves the
 * bytes. Uploads land like a web-UI upload: written, registered, committed.
 */
@RestController
@RequestMapping("/transfers")
class TransferController(
    private val tickets: TransferTicketService,
    private val userRepository: UserRepository,
    private val spaceRepository: SpaceRepository,
    private val permissionService: PermissionService,
    private val fileUploadService: FileUploadService,
    private val gitService: GitService,
    @Value("\${app.public-url}") publicUrl: String
) {
    companion object {
        const val MAX_UPLOAD_BYTES = 50L * 1024 * 1024
    }

    private val baseUrl = publicUrl.trimEnd('/')

    @PostMapping
    fun issue(
        @Valid @RequestBody request: IssueTransferRequest,
        @AuthenticationPrincipal userDetails: UserDetails?
    ): ResponseEntity<Any> {
        val user = userDetails?.let { userRepository.findByEmail(it.username) }
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()
        val space = spaceRepository.findById(request.spaceId).orElse(null)
            ?: return ResponseEntity.notFound().build()
        val kind = runCatching { TransferKind.valueOf(request.kind.uppercase()) }.getOrNull()
            ?: throw ResponseStatusException(HttpStatus.BAD_REQUEST, "kind must be upload or download")
        val path = fileUploadService.sanitizeRelativePath(request.path)
            ?: throw ResponseStatusException(HttpStatus.BAD_REQUEST, "path is required")

        val allowed = when (kind) {
            TransferKind.UPLOAD -> permissionService.hasEditAccess(user.id!!, space.id!!, user.role)
            TransferKind.DOWNLOAD -> permissionService.hasAccess(user.id!!, space.id!!, user.role)
        }
        if (!allowed) return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        if (kind == TransferKind.UPLOAD) requireSpaceWritable(space)
        if (kind == TransferKind.DOWNLOAD && !Files.isRegularFile(resolve(space.id!!, path))) {
            throw ResponseStatusException(HttpStatus.NOT_FOUND, "No file at $path")
        }

        val token = tickets.issue(TransferTicket(kind, user.id!!, space.id!!, path))
        return ResponseEntity.ok(
            IssueTransferResponse(
                url = "$baseUrl/api/transfers/$token",
                path = path,
                expiresInSeconds = TransferTicketService.TTL.seconds
            )
        )
    }

    /** The upload: raw bytes in the body, one file, then a commit. */
    @PutMapping("/{token}")
    fun upload(@PathVariable token: String, request: HttpServletRequest): ResponseEntity<Any> {
        val ticket = redeem(token, TransferKind.UPLOAD)
        val user = userRepository.findById(ticket.userId).orElse(null)?.takeIf { it.enabled }
            ?: throw ResponseStatusException(HttpStatus.GONE, "The ticket's user no longer exists")
        val space = spaceRepository.findById(ticket.spaceId).orElse(null)
            ?: throw ResponseStatusException(HttpStatus.GONE, "The space no longer exists")
        // The ticket was issued with edit access; a permission change in between still counts.
        if (!permissionService.hasEditAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }
        requireSpaceWritable(space)

        val bytes = request.inputStream.use { it.readNBytes(MAX_UPLOAD_BYTES.toInt() + 1) }
        if (bytes.size > MAX_UPLOAD_BYTES) {
            throw ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "Files are limited to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB")
        }
        if (bytes.isEmpty()) throw ResponseStatusException(HttpStatus.BAD_REQUEST, "The request body is empty")

        val stored = fileUploadService.store(space, ticket.path, bytes)
            ?: throw ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Could not write the file")
        fileUploadService.commit(space, listOf(stored), user, null)
        return ResponseEntity.ok(
            UploadResultDto(
                path = stored.path,
                name = stored.name,
                size = stored.size,
                url = "$baseUrl/spaces/${space.getFullPath()}/doc?path=${org.springframework.web.util.UriUtils.encodeQueryParam(stored.path, Charsets.UTF_8)}"
            )
        )
    }

    /** The download: the file as an attachment. */
    @GetMapping("/{token}")
    fun download(@PathVariable token: String): ResponseEntity<ByteArray> {
        val ticket = redeem(token, TransferKind.DOWNLOAD)
        val user = userRepository.findById(ticket.userId).orElse(null)?.takeIf { it.enabled }
            ?: throw ResponseStatusException(HttpStatus.GONE, "The ticket's user no longer exists")
        val space = spaceRepository.findById(ticket.spaceId).orElse(null)
            ?: throw ResponseStatusException(HttpStatus.GONE, "The space no longer exists")
        if (!permissionService.hasAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }
        val file = resolve(space.id!!, ticket.path)
        if (!Files.isRegularFile(file)) throw ResponseStatusException(HttpStatus.NOT_FOUND, "No file at ${ticket.path}")

        val contentType = Files.probeContentType(file) ?: MediaType.APPLICATION_OCTET_STREAM_VALUE
        return ResponseEntity.ok()
            .contentType(MediaType.parseMediaType(contentType))
            .header(
                HttpHeaders.CONTENT_DISPOSITION,
                ContentDisposition.attachment().filename(ticket.path.substringAfterLast('/'), Charsets.UTF_8).build().toString()
            )
            .body(Files.readAllBytes(file))
    }

    private fun redeem(token: String, expected: TransferKind): TransferTicket {
        val ticket = tickets.redeem(token)
            ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Unknown, expired or already used transfer ticket")
        if (ticket.kind != expected) throw ResponseStatusException(HttpStatus.METHOD_NOT_ALLOWED, "This ticket is for a ${ticket.kind.name.lowercase()}")
        return ticket
    }

    private fun resolve(spaceId: UUID, path: String) = gitService.getRepoPath(spaceId).resolve(path).normalize()
}

data class IssueTransferRequest(
    val spaceId: UUID,
    @field:NotBlank val path: String,
    /** "upload" or "download" */
    @field:NotBlank val kind: String
)

data class IssueTransferResponse(val url: String, val path: String, val expiresInSeconds: Long)

data class UploadResultDto(val path: String, val name: String, val size: Int, val url: String)
