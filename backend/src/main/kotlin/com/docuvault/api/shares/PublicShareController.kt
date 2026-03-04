package com.docuvault.api.shares

import com.docuvault.domain.space.ShareType
import com.docuvault.domain.space.SharedLink
import com.docuvault.service.ShareAccessTokenService
import com.docuvault.service.SharedLinkService
import com.docuvault.service.git.FileNode
import com.docuvault.service.git.GitService
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.http.CacheControl
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.TimeUnit

@RestController
@RequestMapping("/shared")
class PublicShareController(
    private val sharedLinkService: SharedLinkService,
    private val gitService: GitService,
    private val shareAccessTokenService: ShareAccessTokenService
) {
    @GetMapping("/{token}")
    fun getMetadata(@PathVariable token: String, request: HttpServletRequest): ResponseEntity<SharedFileMetadataDto> {
        val link = sharedLinkService.findActiveByToken(token)
            ?: return ResponseEntity.status(HttpStatus.NOT_FOUND).build()

        sharedLinkService.recordAccess(link)

        val fileName = if (link.shareType == ShareType.FOLDER) {
            if (link.filePath.isBlank()) link.space.name
            else link.filePath.trimEnd('/').substringAfterLast('/')
        } else {
            link.filePath.substringAfterLast('/')
        }
        val extension = if (link.shareType == ShareType.FOLDER) "" else fileName.substringAfterLast('.', "")
        val contentType = if (link.shareType == ShareType.FOLDER) "inode/directory" else getContentType(extension)
        val requiresPassword = link.isPasswordProtected() && !checkAccess(link, request)

        return ResponseEntity.ok(SharedFileMetadataDto(
            fileName = fileName,
            extension = extension,
            contentType = contentType,
            spaceName = link.space.name,
            filePath = link.filePath,
            shareType = link.shareType.name,
            requiresPassword = requiresPassword
        ))
    }

    @PostMapping("/{token}/verify")
    fun verifyPassword(
        @PathVariable token: String,
        @RequestBody body: SharePasswordRequest,
        response: HttpServletResponse
    ): ResponseEntity<Map<String, Boolean>> {
        val link = sharedLinkService.findActiveByToken(token)
            ?: return ResponseEntity.status(HttpStatus.NOT_FOUND).build()

        if (!link.isPasswordProtected()) {
            return ResponseEntity.ok(mapOf("valid" to true))
        }

        if (!sharedLinkService.validatePassword(link, body.password)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(mapOf("valid" to false))
        }

        val cookie = shareAccessTokenService.generateAccessCookie(token)
        response.addCookie(cookie)
        return ResponseEntity.ok(mapOf("valid" to true))
    }

    @GetMapping("/{token}/content")
    fun getContent(@PathVariable token: String, request: HttpServletRequest): ResponseEntity<String> {
        val link = sharedLinkService.findActiveByToken(token)
            ?: return ResponseEntity.status(HttpStatus.NOT_FOUND).build()

        if (!checkAccess(link, request)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()
        }

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
    fun getRaw(@PathVariable token: String, request: HttpServletRequest): ResponseEntity<ByteArray> {
        val link = sharedLinkService.findActiveByToken(token)
            ?: return ResponseEntity.status(HttpStatus.NOT_FOUND).build()

        if (!checkAccess(link, request)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()
        }

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

        val cachePolicy = if (contentType.startsWith("image/") || contentType.startsWith("font/")) {
            CacheControl.maxAge(1, TimeUnit.HOURS).cachePublic()
        } else {
            CacheControl.noCache()
        }

        return ResponseEntity.ok()
            .contentType(MediaType.parseMediaType(contentType))
            .cacheControl(cachePolicy)
            .body(bytes)
    }

    @GetMapping("/{token}/files/**")
    fun getRelativeFile(
        @PathVariable token: String,
        request: HttpServletRequest
    ): ResponseEntity<ByteArray> {
        val link = sharedLinkService.findActiveByToken(token)
            ?: return ResponseEntity.status(HttpStatus.NOT_FOUND).build()

        if (!checkAccess(link, request)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()
        }

        val basePath = "/api/shared/$token/files/"
        val relativePath = if (request.requestURI.startsWith(basePath)) {
            request.requestURI.substring(basePath.length)
        } else {
            return ResponseEntity.badRequest().build()
        }

        val repoPath = gitService.getRepoPath(link.space.id!!)

        val fileDir = if (link.shareType == ShareType.FOLDER) {
            val folderRoot = if (link.filePath.isBlank()) repoPath else repoPath.resolve(link.filePath).normalize()
            folderRoot
        } else {
            repoPath.resolve(link.filePath).parent ?: repoPath
        }
        val resolved = fileDir.resolve(relativePath).normalize()

        // Path traversal protection: must stay within the repo
        if (!resolved.startsWith(repoPath.normalize())) {
            return ResponseEntity.badRequest().build()
        }

        // For folder shares, also ensure we stay within the shared folder
        if (link.shareType == ShareType.FOLDER && link.filePath.isNotBlank()) {
            val folderRoot = repoPath.resolve(link.filePath).normalize()
            if (!resolved.startsWith(folderRoot)) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
            }
        }

        if (!Files.exists(resolved) || !Files.isRegularFile(resolved)) {
            return ResponseEntity.notFound().build()
        }

        val contentType = Files.probeContentType(resolved) ?: "application/octet-stream"
        val bytes = Files.readAllBytes(resolved)

        val cachePolicy = if (contentType.startsWith("image/") || contentType.startsWith("font/")) {
            CacheControl.maxAge(1, TimeUnit.HOURS).cachePublic()
        } else {
            CacheControl.noCache()
        }

        return ResponseEntity.ok()
            .contentType(MediaType.parseMediaType(contentType))
            .cacheControl(cachePolicy)
            .body(bytes)
    }

    @GetMapping("/{token}/tree")
    fun getFileTree(@PathVariable token: String, request: HttpServletRequest): ResponseEntity<List<FileNode>> {
        val link = sharedLinkService.findActiveByToken(token)
            ?: return ResponseEntity.status(HttpStatus.NOT_FOUND).build()

        if (link.shareType != ShareType.FOLDER) {
            return ResponseEntity.badRequest().build()
        }

        if (!checkAccess(link, request)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()
        }

        val repoPath = gitService.getRepoPath(link.space.id!!)
        val folderRoot = if (link.filePath.isBlank()) repoPath else repoPath.resolve(link.filePath).normalize()

        if (!folderRoot.startsWith(repoPath.normalize())) {
            return ResponseEntity.badRequest().build()
        }

        val tree = buildFileTree(folderRoot, folderRoot)
        return ResponseEntity.ok(tree)
    }

    @GetMapping("/{token}/content/{*subPath}")
    fun getFolderContent(
        @PathVariable token: String,
        @PathVariable subPath: String,
        request: HttpServletRequest
    ): ResponseEntity<String> {
        val link = sharedLinkService.findActiveByToken(token)
            ?: return ResponseEntity.status(HttpStatus.NOT_FOUND).build()

        if (link.shareType != ShareType.FOLDER) {
            return ResponseEntity.badRequest().build()
        }

        if (!checkAccess(link, request)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()
        }

        val cleanSubPath = subPath.trimStart('/')
        val repoPath = gitService.getRepoPath(link.space.id!!)
        val folderRoot = if (link.filePath.isBlank()) repoPath else repoPath.resolve(link.filePath).normalize()
        val resolved = folderRoot.resolve(cleanSubPath).normalize()

        // Path traversal protection
        if (!resolved.startsWith(folderRoot) || !resolved.startsWith(repoPath.normalize())) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        if (!Files.exists(resolved) || !Files.isRegularFile(resolved)) {
            return ResponseEntity.notFound().build()
        }

        val content = Files.readString(resolved)
        return ResponseEntity.ok()
            .contentType(MediaType.TEXT_PLAIN)
            .body(content)
    }

    @GetMapping("/{token}/raw/{*subPath}")
    fun getFolderRaw(
        @PathVariable token: String,
        @PathVariable subPath: String,
        request: HttpServletRequest
    ): ResponseEntity<ByteArray> {
        val link = sharedLinkService.findActiveByToken(token)
            ?: return ResponseEntity.status(HttpStatus.NOT_FOUND).build()

        if (link.shareType != ShareType.FOLDER) {
            return ResponseEntity.badRequest().build()
        }

        if (!checkAccess(link, request)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()
        }

        val cleanSubPath = subPath.trimStart('/')
        val repoPath = gitService.getRepoPath(link.space.id!!)
        val folderRoot = if (link.filePath.isBlank()) repoPath else repoPath.resolve(link.filePath).normalize()
        val resolved = folderRoot.resolve(cleanSubPath).normalize()

        // Path traversal protection
        if (!resolved.startsWith(folderRoot) || !resolved.startsWith(repoPath.normalize())) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        if (!Files.exists(resolved) || !Files.isRegularFile(resolved)) {
            return ResponseEntity.notFound().build()
        }

        val contentType = Files.probeContentType(resolved) ?: "application/octet-stream"
        val bytes = Files.readAllBytes(resolved)

        val cachePolicy = if (contentType.startsWith("image/") || contentType.startsWith("font/")) {
            CacheControl.maxAge(1, TimeUnit.HOURS).cachePublic()
        } else {
            CacheControl.noCache()
        }

        return ResponseEntity.ok()
            .contentType(MediaType.parseMediaType(contentType))
            .cacheControl(cachePolicy)
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

    private fun checkAccess(link: SharedLink, request: HttpServletRequest): Boolean {
        if (!link.isPasswordProtected()) return true

        val cookieName = shareAccessTokenService.getCookieName(link.token)
        val cookie = request.cookies?.find { it.name == cookieName } ?: return false
        return shareAccessTokenService.validateAccessCookie(cookie.value, link.token)
    }

    private fun buildFileTree(dir: Path, basePath: Path): List<FileNode> {
        if (!Files.exists(dir) || !Files.isDirectory(dir)) return emptyList()
        return Files.list(dir).use { stream ->
            stream.filter { !it.fileName.toString().startsWith(".") }
                .sorted(compareBy<Path> { !Files.isDirectory(it) }.thenBy { it.fileName.toString().lowercase() })
                .map { path ->
                    val relativePath = basePath.relativize(path).toString()
                    val isDir = Files.isDirectory(path)
                    FileNode(
                        name = path.fileName.toString(),
                        path = relativePath,
                        isDirectory = isDir,
                        children = if (isDir) buildFileTree(path, basePath) else null
                    )
                }.toList()
        }
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
