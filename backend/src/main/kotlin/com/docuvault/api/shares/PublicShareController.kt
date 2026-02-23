package com.docuvault.api.shares

import com.docuvault.service.SharedLinkService
import com.docuvault.service.git.GitService
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.CacheControl
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*
import java.nio.file.Files
import java.util.concurrent.TimeUnit

@RestController
@RequestMapping("/shared")
class PublicShareController(
    private val sharedLinkService: SharedLinkService,
    private val gitService: GitService
) {
    @GetMapping("/{token}")
    fun getMetadata(@PathVariable token: String): ResponseEntity<SharedFileMetadataDto> {
        val link = sharedLinkService.findActiveByToken(token)
            ?: return ResponseEntity.status(HttpStatus.NOT_FOUND).build()

        sharedLinkService.recordAccess(link)

        val fileName = link.filePath.substringAfterLast('/')
        val extension = fileName.substringAfterLast('.', "")
        val contentType = getContentType(extension)

        return ResponseEntity.ok(SharedFileMetadataDto(
            fileName = fileName,
            extension = extension,
            contentType = contentType,
            spaceName = link.space.name,
            filePath = link.filePath
        ))
    }

    @GetMapping("/{token}/content")
    fun getContent(@PathVariable token: String): ResponseEntity<String> {
        val link = sharedLinkService.findActiveByToken(token)
            ?: return ResponseEntity.status(HttpStatus.NOT_FOUND).build()

        val repoPath = gitService.getRepoPath(link.space.id!!)
        val resolved = repoPath.resolve(link.filePath).normalize()

        if (!resolved.startsWith(repoPath.normalize())) {
            return ResponseEntity.badRequest().build()
        }

        if (!Files.exists(resolved) || !Files.isRegularFile(resolved)) {
            return ResponseEntity.notFound().build()
        }

        val content = Files.readString(resolved)
        return ResponseEntity.ok()
            .contentType(MediaType.TEXT_PLAIN)
            .body(content)
    }

    @GetMapping("/{token}/raw")
    fun getRaw(@PathVariable token: String): ResponseEntity<ByteArray> {
        val link = sharedLinkService.findActiveByToken(token)
            ?: return ResponseEntity.status(HttpStatus.NOT_FOUND).build()

        val repoPath = gitService.getRepoPath(link.space.id!!)
        val resolved = repoPath.resolve(link.filePath).normalize()

        if (!resolved.startsWith(repoPath.normalize())) {
            return ResponseEntity.badRequest().build()
        }

        if (!Files.exists(resolved) || !Files.isRegularFile(resolved)) {
            return ResponseEntity.notFound().build()
        }

        val contentType = Files.probeContentType(resolved) ?: "application/octet-stream"
        val bytes = Files.readAllBytes(resolved)

        return ResponseEntity.ok()
            .contentType(MediaType.parseMediaType(contentType))
            .cacheControl(CacheControl.maxAge(1, TimeUnit.HOURS).cachePublic())
            .body(bytes)
    }

    @GetMapping("/{token}/files/**")
    fun getRelativeFile(
        @PathVariable token: String,
        request: HttpServletRequest
    ): ResponseEntity<ByteArray> {
        val link = sharedLinkService.findActiveByToken(token)
            ?: return ResponseEntity.status(HttpStatus.NOT_FOUND).build()

        val basePath = "/api/shared/$token/files/"
        val relativePath = if (request.requestURI.startsWith(basePath)) {
            request.requestURI.substring(basePath.length)
        } else {
            return ResponseEntity.badRequest().build()
        }

        val repoPath = gitService.getRepoPath(link.space.id!!)

        // Resolve relative to the shared file's directory
        val fileDir = repoPath.resolve(link.filePath).parent ?: repoPath
        val resolved = fileDir.resolve(relativePath).normalize()

        // Path traversal protection: must stay within the repo
        if (!resolved.startsWith(repoPath.normalize())) {
            return ResponseEntity.badRequest().build()
        }

        if (!Files.exists(resolved) || !Files.isRegularFile(resolved)) {
            return ResponseEntity.notFound().build()
        }

        val contentType = Files.probeContentType(resolved) ?: "application/octet-stream"
        val bytes = Files.readAllBytes(resolved)

        return ResponseEntity.ok()
            .contentType(MediaType.parseMediaType(contentType))
            .cacheControl(CacheControl.maxAge(1, TimeUnit.HOURS).cachePublic())
            .body(bytes)
    }

    @GetMapping("/{token}/og")
    fun getOgPreview(
        @PathVariable token: String,
        request: HttpServletRequest
    ): ResponseEntity<String> {
        val link = sharedLinkService.findActiveByToken(token)
            ?: return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .contentType(MediaType.TEXT_HTML)
                .body("<html><head><title>Link Not Available</title></head><body><p>This shared link is no longer available.</p></body></html>")

        val fileName = link.filePath.substringAfterLast('/')
        val spaceName = link.space.name
        val breadcrumb = link.filePath.replace("/", " / ")
        val description = "$fileName - shared from $spaceName on DocuVault"
        val scheme = request.getHeader("X-Forwarded-Proto") ?: request.scheme
        val host = request.getHeader("X-Forwarded-Host") ?: request.getHeader("Host") ?: request.serverName
        val shareUrl = "$scheme://$host/share/$token"

        val html = """
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="utf-8">
                <title>$fileName - $spaceName | DocuVault</title>
                <meta name="description" content="$description">
                <meta property="og:title" content="$fileName - $spaceName">
                <meta property="og:description" content="$breadcrumb">
                <meta property="og:type" content="article">
                <meta property="og:url" content="$shareUrl">
                <meta property="og:site_name" content="DocuVault">
                <meta name="twitter:card" content="summary">
                <meta name="twitter:title" content="$fileName - $spaceName">
                <meta name="twitter:description" content="$breadcrumb">
                <meta http-equiv="refresh" content="0;url=$shareUrl">
            </head>
            <body>
                <p>Redirecting to <a href="$shareUrl">$fileName</a>...</p>
            </body>
            </html>
        """.trimIndent()

        return ResponseEntity.ok()
            .contentType(MediaType.TEXT_HTML)
            .body(html)
    }

    private fun getContentType(extension: String): String = when (extension.lowercase()) {
        "md" -> "text/markdown"
        "html", "htm" -> "text/html"
        "pdf" -> "application/pdf"
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "gif" -> "image/gif"
        "svg" -> "image/svg+xml"
        "webp" -> "image/webp"
        else -> "application/octet-stream"
    }
}
