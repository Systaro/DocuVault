package com.docuvault.api

import com.docuvault.service.PdfRenderService
import jakarta.validation.constraints.NotBlank
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*
import org.springframework.web.server.ResponseStatusException
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

/**
 * Renders a document to PDF. The HTML comes from the client because that is the
 * copy the reader is actually looking at — Mermaid diagrams drawn, image paths
 * resolved — so the PDF matches the page instead of being a second rendering
 * that drifts from it.
 */
@RestController
@RequestMapping("/pdf")
class PdfController(
    private val pdfRenderService: PdfRenderService
) {

    @PostMapping("/render", produces = [MediaType.APPLICATION_PDF_VALUE])
    fun render(@RequestBody request: RenderPdfRequest): ResponseEntity<ByteArray> {
        if (!pdfRenderService.isConfigured()) {
            // Not an error: this install simply has no renderer, and the client
            // is expected to fall back to the browser's print dialog.
            throw ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "No PDF renderer configured")
        }
        if (request.html.isBlank()) {
            throw ResponseStatusException(HttpStatus.BAD_REQUEST, "html is required")
        }
        if (request.html.length > MAX_HTML_CHARS) {
            throw ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "Document too large to render")
        }

        val pdf = pdfRenderService.render(request.html)
            ?: throw ResponseStatusException(HttpStatus.BAD_GATEWAY, "The PDF renderer did not return a document")

        val name = sanitiseFilename(request.title)
        return ResponseEntity.ok()
            .contentType(MediaType.APPLICATION_PDF)
            .header(
                HttpHeaders.CONTENT_DISPOSITION,
                // filename* carries the real name; the plain filename stays ASCII
                // so clients that ignore RFC 5987 still get something usable.
                "attachment; filename=\"${name.replace(Regex("[^A-Za-z0-9._-]"), "_")}.pdf\"; " +
                    "filename*=UTF-8''${URLEncoder.encode("$name.pdf", StandardCharsets.UTF_8).replace("+", "%20")}"
            )
            .body(pdf)
    }

    /** Strips what a filename must not carry — path separators above all. */
    private fun sanitiseFilename(raw: String?): String {
        val cleaned = (raw ?: "").replace(Regex("[/\\\\\\u0000-\\u001F]"), " ").trim().trim('.')
        return if (cleaned.isBlank()) "document" else cleaned.take(120)
    }

    companion object {
        /** Roughly a very long document; past this the renderer would time out anyway. */
        const val MAX_HTML_CHARS = 5_000_000
    }
}

data class RenderPdfRequest(
    @field:NotBlank val html: String,
    val title: String? = null
)
