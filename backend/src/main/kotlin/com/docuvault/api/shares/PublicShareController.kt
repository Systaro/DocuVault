package com.docuvault.api.shares

import com.docuvault.api.annotations.AnnotationDto
import com.docuvault.api.annotations.CreateAnnotationRequest
import com.docuvault.api.annotations.UpdateAnchorRequest
import com.docuvault.api.annotations.toDto
import com.docuvault.domain.space.AccessLevel
import com.docuvault.domain.space.ShareType
import com.docuvault.domain.space.SharedLink
import com.docuvault.service.AnnotationService
import com.docuvault.service.ShareAccessTokenService
import com.docuvault.service.ShareAssetResolver
import com.docuvault.service.SharedLinkService
import com.docuvault.service.git.FileNode
import com.docuvault.service.git.GitService
import com.docuvault.service.HtmlPreviewInjection
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.commonmark.parser.Parser
import org.commonmark.renderer.html.HtmlRenderer
import org.springframework.http.CacheControl
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.util.Base64
import java.util.UUID
import java.nio.file.Path
import java.util.concurrent.TimeUnit

data class WriteStateRequest(val content: String)

@RestController
@RequestMapping("/shared")
class PublicShareController(
    private val sharedLinkService: SharedLinkService,
    private val gitService: GitService,
    private val shareAccessTokenService: ShareAccessTokenService,
    private val annotationService: AnnotationService,
    private val shareAssetResolver: ShareAssetResolver
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

        // Extract rich metadata from file content for OG tags
        val ogMeta = if (link.shareType == ShareType.FILE && !requiresPassword) {
            extractOgMetadata(link, request)
        } else null

        return ResponseEntity.ok(SharedFileMetadataDto(
            fileName = fileName,
            extension = extension,
            contentType = contentType,
            spaceName = link.space.name,
            filePath = link.filePath,
            shareType = link.shareType.name,
            accessLevel = link.accessLevel.name,
            requiresPassword = requiresPassword,
            ogTitle = ogMeta?.title,
            ogDescription = ogMeta?.description,
            ogImageUrl = ogMeta?.imageUrl
        ))
    }

    private data class OgMetadata(val title: String?, val description: String?, val imageUrl: String?)

    private fun extractOgMetadata(link: SharedLink, request: HttpServletRequest): OgMetadata {
        val content = gitService.readFile(link.space, link.filePath) ?: return OgMetadata(null, null, null)
        val ext = link.filePath.substringAfterLast('.', "").lowercase()
        val isMarkdown = ext in listOf("md", "markdown")
        val isHtml = ext in listOf("html", "htm")

        val title = when {
            isMarkdown -> Regex("^#\\s+(.+)$", RegexOption.MULTILINE).find(content)?.groupValues?.get(1)?.trim()
            isHtml -> Regex("<h1[^>]*>(.*?)</h1>", RegexOption.IGNORE_CASE).find(content)?.groupValues?.get(1)
                ?.replace(Regex("<[^>]+>"), "")?.decodeHtmlEntities()?.trim()
            else -> null
        }

        val description = when {
            isMarkdown -> extractMarkdownDescription(content)
            isHtml -> extractHtmlDescription(content)
            else -> null
        }

        val scheme = request.getHeader("X-Forwarded-Proto") ?: request.scheme
        val host = request.getHeader("X-Forwarded-Host") ?: request.getHeader("Host") ?: request.serverName
        val apiBase = "$scheme://$host/api/shared/${link.token}"

        // Check if there's any image at all (including base64)
        val hasImage = when {
            isMarkdown -> Regex("!\\[.*?]\\(.+?\\)").containsMatchIn(content)
            isHtml -> Regex("<img[^>]+src=[\"'][^\"']+[\"']", RegexOption.IGNORE_CASE).containsMatchIn(content)
            else -> false
        }
        val imageUrl = if (hasImage) "$apiBase/og-image" else null

        return OgMetadata(title, description, imageUrl)
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

        val contentType = probeContentType(resolved)
        val extension = resolved.fileName.toString().substringAfterLast('.', "").lowercase()
        val isHtml = contentType.startsWith("text/html") || extension == "html" || extension == "htm"

        val cachePolicy = if (contentType.startsWith("image/") || contentType.startsWith("font/")) {
            CacheControl.maxAge(1, TimeUnit.HOURS).cachePublic()
        } else {
            CacheControl.noCache()
        }

        if (isHtml) {
            val html = Files.readString(resolved)
            val injected = injectBaseTag(html, assetBaseHref(link.token, link.filePath))
            return ResponseEntity.ok()
                .contentType(MediaType.TEXT_HTML)
                .cacheControl(cachePolicy)
                .body(injected.toByteArray(Charsets.UTF_8))
        }

        val bytes = Files.readAllBytes(resolved)
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
        val rawPath = if (request.requestURI.startsWith(basePath)) {
            request.requestURI.substring(basePath.length)
        } else {
            return ResponseEntity.badRequest().build()
        }
        val relativePath = URLDecoder.decode(rawPath, StandardCharsets.UTF_8)

        // Paths here are relative to the space repository, the same convention
        // the signed-in `/api/spaces/{id}/files/**` endpoint uses. That is what
        // lets a document reference an asset above its own folder at all — a
        // path relative to the share would have no way to express it, since the
        // browser collapses `..` out of the URL before the request is sent.
        val repoPath = gitService.getRepoPath(link.space.id!!).normalize()
        val resolved = repoPath.resolve(relativePath).normalize()

        // Path traversal protection: must stay within the repo
        if (!resolved.startsWith(repoPath)) {
            return ResponseEntity.badRequest().build()
        }

        // For folder shares, the shared folder subtree is served outright; for
        // file shares, the shared file's own directory, so its companion assets
        // (JS, CSS, images) inherit access.
        val allowedRoot = if (link.shareType == ShareType.FOLDER) {
            if (link.filePath.isNotBlank()) repoPath.resolve(link.filePath).normalize() else repoPath
        } else {
            (repoPath.resolve(link.filePath).parent ?: repoPath).normalize()
        }
        val sharedFile = if (link.shareType == ShareType.FILE) repoPath.resolve(link.filePath).normalize() else null
        // Outside that scope, only static assets the shared content actually
        // references are served — a stylesheet or logo kept in a sibling
        // `assets/` folder, not everything else in the space.
        if (!resolved.startsWith(allowedRoot) &&
            !shareAssetResolver.allowsOutsideAsset(link.token, repoPath, allowedRoot, sharedFile, resolved)
        ) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        if (!Files.exists(resolved) || !Files.isRegularFile(resolved)) {
            return ResponseEntity.notFound().build()
        }

        val contentType = probeContentType(resolved)
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
        val repoPath = gitService.getRepoPath(link.space.id!!).normalize()
        val folderRoot = if (link.filePath.isBlank()) repoPath else repoPath.resolve(link.filePath).normalize()
        val resolved = folderRoot.resolve(cleanSubPath).normalize()

        // Path traversal protection
        if (!resolved.startsWith(folderRoot) || !resolved.startsWith(repoPath)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        if (!Files.exists(resolved) || !Files.isRegularFile(resolved)) {
            return ResponseEntity.notFound().build()
        }

        val contentType = probeContentType(resolved)
        val extension = resolved.fileName.toString().substringAfterLast('.', "").lowercase()
        val isHtml = contentType.startsWith("text/html") || extension == "html" || extension == "htm"

        val cachePolicy = if (contentType.startsWith("image/") || contentType.startsWith("font/")) {
            CacheControl.maxAge(1, TimeUnit.HOURS).cachePublic()
        } else {
            CacheControl.noCache()
        }

        // Same preview chrome a shared single file gets: without the injected
        // base the page's relative assets would resolve against this endpoint,
        // which only reaches inside the shared folder.
        if (isHtml) {
            val html = Files.readString(resolved)
            val injected = injectBaseTag(html, assetBaseHref(link.token, repoPath.relativize(resolved).toString()))
            return ResponseEntity.ok()
                .contentType(MediaType.TEXT_HTML)
                .cacheControl(cachePolicy)
                .body(injected.toByteArray(Charsets.UTF_8))
        }

        val bytes = Files.readAllBytes(resolved)
        return ResponseEntity.ok()
            .contentType(MediaType.parseMediaType(contentType))
            .cacheControl(cachePolicy)
            .body(bytes)
    }

    @PutMapping("/{token}/state/{*path}")
    fun writeState(
        @PathVariable token: String,
        @PathVariable path: String,
        @RequestBody body: WriteStateRequest,
        request: HttpServletRequest
    ): ResponseEntity<Void> {
        val link = sharedLinkService.findActiveByToken(token)
            ?: return ResponseEntity.status(HttpStatus.NOT_FOUND).build()

        if (!checkAccess(link, request)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()
        }

        val cleanPath = path.trimStart('/')

        if (!cleanPath.endsWith(".json")) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        if (link.writableScopes.none { scope -> cleanPath == scope || cleanPath.startsWith("$scope/") }) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val repoPath = gitService.getRepoPath(link.space.id!!)
        val resolved = repoPath.resolve(cleanPath).normalize()

        if (!resolved.startsWith(repoPath.normalize())) {
            return ResponseEntity.badRequest().build()
        }

        val written = gitService.writeFile(link.space, cleanPath, body.content)
        if (!written) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build()
        }

        try {
            gitService.commitAndPush(
                link.space,
                "state: update ${cleanPath.substringAfterLast('/')} via share link",
                "DocuVault State",
                "state@docuvault"
            )
        } catch (_: Exception) {
            // Write succeeded locally; commit failure is non-fatal
        }

        return ResponseEntity.noContent().build()
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

        val spaceName = link.space.name
        val scheme = request.getHeader("X-Forwarded-Proto") ?: request.scheme
        val host = request.getHeader("X-Forwarded-Host") ?: request.getHeader("Host") ?: request.serverName
        val shareUrl = "$scheme://$host/share/$token"
        val apiBase = "$scheme://$host/api/shared/$token"

        val ogMeta = extractOgMetadata(link, request)
        val title = ogMeta.title ?: link.filePath.substringAfterLast('/').substringBeforeLast('.')
        val ogTitle = "$title — $spaceName"
        val description = ogMeta.description ?: "$title - shared from $spaceName on DocuVault"

        // Render content as HTML for SSR
        val content = if (link.shareType == ShareType.FILE && !link.isPasswordProtected()) {
            gitService.readFile(link.space, link.filePath)
        } else null

        val ext = link.filePath.substringAfterLast('.', "").lowercase()
        val fileDir = link.filePath.substringBeforeLast('/', "")

        val renderedBody = when {
            ext in listOf("md", "markdown") && content != null -> {
                val parser = Parser.builder().build()
                val document = parser.parse(content)
                var html = HtmlRenderer.builder().build().render(document)
                html = html.replace(Regex("(<img[^>]+src=\")(?!https?://|/api/)([^\"]+)(\")", RegexOption.IGNORE_CASE)) { match ->
                    val src = match.groupValues[2]
                    val resolved = if (fileDir.isNotEmpty()) "$fileDir/$src" else src
                    val normalized = Path.of(resolved).normalize().toString()
                    "${match.groupValues[1]}$apiBase/files/$normalized${match.groupValues[3]}"
                }
                html
            }
            ext in listOf("html", "htm") && content != null -> content
            else -> "<p><a href=\"$shareUrl\">Open in DocuVault</a></p>"
        }

        val escapedTitle = escapeHtml(ogTitle)
        val escapedDesc = escapeHtml(description)
        val twitterCard = if (ogMeta.imageUrl != null) "summary_large_image" else "summary"
        val imageMetaTags = if (ogMeta.imageUrl != null) """
                <meta property="og:image" content="${ogMeta.imageUrl}">
                <meta name="twitter:image" content="${ogMeta.imageUrl}">
        """.trimIndent() else ""

        val html = """
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="utf-8">
                <title>$escapedTitle</title>
                <meta name="description" content="$escapedDesc">
                <meta property="og:title" content="$escapedTitle">
                <meta property="og:description" content="$escapedDesc">
                <meta property="og:type" content="article">
                <meta property="og:url" content="$shareUrl">
                <meta property="og:site_name" content="DocuVault">
                $imageMetaTags
                <meta name="twitter:card" content="$twitterCard">
                <meta name="twitter:title" content="$escapedTitle">
                <meta name="twitter:description" content="$escapedDesc">
                <meta http-equiv="refresh" content="0;url=$shareUrl">
                <style>body{max-width:800px;margin:40px auto;padding:0 20px;font-family:system-ui,sans-serif;color:#333;line-height:1.6}img{max-width:100%;height:auto}</style>
            </head>
            <body>
                $renderedBody
            </body>
            </html>
        """.trimIndent()

        return ResponseEntity.ok()
            .contentType(MediaType.TEXT_HTML)
            .body(html)
    }

    @GetMapping("/{token}/og-image")
    fun getOgImage(@PathVariable token: String): ResponseEntity<ByteArray> {
        val link = sharedLinkService.findActiveByToken(token)
            ?: return ResponseEntity.notFound().build()

        if (link.isPasswordProtected()) return ResponseEntity.notFound().build()

        val content = gitService.readFile(link.space, link.filePath)
            ?: return ResponseEntity.notFound().build()

        val ext = link.filePath.substringAfterLast('.', "").lowercase()
        val fileDir = link.filePath.substringBeforeLast('/', "")

        // Find first image src (including data: URIs)
        val imgSrc = when (ext) {
            "md", "markdown" -> Regex("!\\[.*?]\\((.+?)\\)").find(content)?.groupValues?.get(1)
            "html", "htm" -> Regex("<img[^>]+src=[\"']([^\"']+)[\"']", RegexOption.IGNORE_CASE).find(content)?.groupValues?.get(1)
            else -> null
        } ?: return ResponseEntity.notFound().build()

        // Base64 data URI — decode and serve
        if (imgSrc.startsWith("data:")) {
            val mimeMatch = Regex("data:([^;]+);base64,(.+)", RegexOption.DOT_MATCHES_ALL).find(imgSrc)
                ?: return ResponseEntity.notFound().build()
            val mimeType = mimeMatch.groupValues[1]
            val base64Data = mimeMatch.groupValues[2].replace(Regex("\\s"), "")
            val bytes = try { Base64.getDecoder().decode(base64Data) } catch (_: Exception) {
                return ResponseEntity.notFound().build()
            }
            return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(mimeType))
                .cacheControl(CacheControl.maxAge(1, TimeUnit.HOURS).cachePublic())
                .body(bytes)
        }

        // Relative file path — serve from repo
        if (!imgSrc.startsWith("http://") && !imgSrc.startsWith("https://")) {
            val resolved = if (fileDir.isNotEmpty()) "$fileDir/$imgSrc" else imgSrc
            val normalized = Path.of(resolved).normalize().toString()
            val repoPath = gitService.getRepoPath(link.space.id!!)
            val filePath = repoPath.resolve(normalized).normalize()
            if (!filePath.startsWith(repoPath.normalize()) || !Files.exists(filePath)) {
                return ResponseEntity.notFound().build()
            }
            val mimeType = Files.probeContentType(filePath) ?: "image/png"
            return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(mimeType))
                .cacheControl(CacheControl.maxAge(1, TimeUnit.HOURS).cachePublic())
                .body(Files.readAllBytes(filePath))
        }

        // External URL — redirect
        return ResponseEntity.status(HttpStatus.FOUND)
            .header("Location", imgSrc)
            .build()
    }

    private fun extractMarkdownDescription(content: String): String? {
        // Skip headings, blank lines, images, and metadata — find first text paragraph
        val lines = content.lines()
        val paragraph = StringBuilder()
        var inParagraph = false
        for (line in lines) {
            val trimmed = line.trim()
            if (trimmed.isEmpty()) {
                if (inParagraph) break
                continue
            }
            if (trimmed.startsWith("#") || trimmed.startsWith("![") || trimmed.startsWith("---") || trimmed.startsWith("```")) {
                if (inParagraph) break
                continue
            }
            // Strip inline markdown formatting
            paragraph.append(if (inParagraph) " " else "").append(trimmed)
            inParagraph = true
        }
        if (paragraph.isEmpty()) return null
        val text = paragraph.toString()
            .replace(Regex("\\*\\*(.+?)\\*\\*"), "$1")
            .replace(Regex("\\*(.+?)\\*"), "$1")
            .replace(Regex("\\[(.+?)]\\(.+?\\)"), "$1")
            .replace(Regex("`(.+?)`"), "$1")
        return if (text.length > 300) text.substring(0, 297) + "..." else text
    }

    private fun extractHtmlDescription(content: String): String? {
        // Strip everything inside <head>, <script>, <style> tags first
        val bodyContent = content
            .replace(Regex("<head[^>]*>.*?</head>", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL)), "")
            .replace(Regex("<script[^>]*>.*?</script>", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL)), "")
            .replace(Regex("<style[^>]*>.*?</style>", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL)), "")

        // Try <p> tags first, then fall back to any text-bearing element
        val match = Regex("<p[^>]*>(.*?)</p>", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL))
            .find(bodyContent)
        val text = match?.groupValues?.get(1)
            ?.replace(Regex("<[^>]+>"), "")
            ?.replace(Regex("\\s+"), " ")
            ?.decodeHtmlEntities()
            ?.trim()
            ?.takeIf { it.length > 20 }
            // Fall back: strip all tags and take the first meaningful chunk of text
            ?: bodyContent.replace(Regex("<[^>]+>"), " ")
                .replace(Regex("\\s+"), " ")
                .decodeHtmlEntities()
                .trim()
                .takeIf { it.length > 20 }
            ?: return null

        return if (text.length > 300) text.substring(0, 297) + "..." else text
    }

    private fun String.decodeHtmlEntities(): String = this
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&mdash;", "—")
        .replace("&ndash;", "–")
        .replace("&nbsp;", " ")

    private fun escapeHtml(text: String): String = text
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;")

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

    private fun injectBaseTag(html: String, baseHref: String): String =
        HtmlPreviewInjection.inject(html, baseHref)

    /** Where a shared document's relative references resolve to. */
    private fun assetBaseHref(token: String, repoRelativePath: String): String =
        HtmlPreviewInjection.baseHref("/api/shared/$token/files", repoRelativePath)

    private fun getContentType(extension: String): String = when (extension.lowercase()) {
        "md" -> "text/markdown"
        "html", "htm" -> "text/html"
        "pdf" -> "application/pdf"
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "gif" -> "image/gif"
        "svg" -> "image/svg+xml"
        "webp" -> "image/webp"
        "js", "mjs" -> "application/javascript"
        "css" -> "text/css"
        "json" -> "application/json"
        "txt" -> "text/plain"
        "xml" -> "application/xml"
        "woff" -> "font/woff"
        "woff2" -> "font/woff2"
        "ttf" -> "font/ttf"
        else -> "application/octet-stream"
    }

    // --- Annotation endpoints for shared links ---

    @GetMapping("/{token}/annotations")
    fun getAnnotations(
        @PathVariable token: String,
        @RequestParam filePath: String,
        request: HttpServletRequest
    ): ResponseEntity<List<AnnotationDto>> {
        val link = sharedLinkService.findActiveByToken(token)
            ?: return ResponseEntity.status(HttpStatus.NOT_FOUND).build()

        if (link.isPasswordProtected() && !checkAccess(link, request)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()
        }

        val annotations = annotationService.getAnnotations(link.space.id!!, filePath)
        return ResponseEntity.ok(annotations)
    }

    @PostMapping("/{token}/annotations")
    fun createAnnotation(
        @PathVariable token: String,
        @RequestParam filePath: String,
        @RequestBody request: CreateAnnotationRequest,
        httpRequest: HttpServletRequest
    ): ResponseEntity<AnnotationDto> {
        val link = sharedLinkService.findActiveByToken(token)
            ?: return ResponseEntity.status(HttpStatus.NOT_FOUND).build()

        if (link.accessLevel != AccessLevel.COMMENT) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        if (link.isPasswordProtected() && !checkAccess(link, httpRequest)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()
        }

        val authorName = request.authorName
            ?: return ResponseEntity.badRequest().build()

        val parent = request.parentId?.let { parentId ->
            annotationService.findById(parentId)
                ?: return ResponseEntity.badRequest().build()
        }

        val annotation = annotationService.createAnnotation(
            space = link.space,
            filePath = filePath,
            user = null,
            authorName = authorName,
            body = request.body,
            anchor = if (parent == null) request.anchor else null,
            parent = parent,
            docHash = if (parent == null) request.docHash else null
        )

        return ResponseEntity.status(HttpStatus.CREATED).body(annotation.toDto())
    }

    /**
     * Cache where a comment currently lands, for readers coming in through a
     * share link. Available on view-only links too: re-anchoring is not
     * commenting, and a document read only through a public link would
     * otherwise never have its anchors refreshed at all.
     */
    @PatchMapping("/{token}/annotations/{annotationId}/anchor")
    fun updatePublicAnchor(
        @PathVariable token: String,
        @PathVariable annotationId: UUID,
        @RequestBody request: UpdateAnchorRequest,
        httpRequest: HttpServletRequest
    ): ResponseEntity<AnnotationDto> {
        val link = sharedLinkService.findActiveByToken(token)
            ?: return ResponseEntity.status(HttpStatus.NOT_FOUND).build()

        if (link.isPasswordProtected() && !checkAccess(link, httpRequest)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()
        }

        val annotation = annotationService.findById(annotationId)
            ?: return ResponseEntity.notFound().build()
        if (annotation.space.id != link.space.id) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val updated = annotationService.updateAnchor(
            annotationId, request.anchorCurrent, request.anchorState, request.docHash
        ) ?: return ResponseEntity.badRequest().build()

        return ResponseEntity.ok(updated.toDto())
    }

    @PatchMapping("/{token}/annotations/{annotationId}/resolve")
    fun resolvePublicAnnotation(
        @PathVariable token: String,
        @PathVariable annotationId: UUID,
        httpRequest: HttpServletRequest
    ): ResponseEntity<AnnotationDto> {
        val link = sharedLinkService.findActiveByToken(token)
            ?: return ResponseEntity.status(HttpStatus.NOT_FOUND).build()

        if (link.accessLevel != AccessLevel.COMMENT) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        if (link.isPasswordProtected() && !checkAccess(link, httpRequest)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()
        }

        val annotation = annotationService.findById(annotationId)
            ?: return ResponseEntity.notFound().build()

        if (annotation.space.id != link.space.id) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        // Anonymous users can only resolve annotations without an internal user
        if (annotation.user != null) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val updated = if (annotation.resolved) {
            annotationService.unresolveAnnotation(annotationId)
        } else {
            annotationService.resolveAnonymous(annotationId)
        } ?: return ResponseEntity.notFound().build()

        return ResponseEntity.ok(updated.toDto())
    }

    @DeleteMapping("/{token}/annotations/{annotationId}")
    fun deletePublicAnnotation(
        @PathVariable token: String,
        @PathVariable annotationId: UUID,
        httpRequest: HttpServletRequest
    ): ResponseEntity<Void> {
        val link = sharedLinkService.findActiveByToken(token)
            ?: return ResponseEntity.status(HttpStatus.NOT_FOUND).build()

        if (link.accessLevel != AccessLevel.COMMENT) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        if (link.isPasswordProtected() && !checkAccess(link, httpRequest)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()
        }

        val annotation = annotationService.findById(annotationId)
            ?: return ResponseEntity.notFound().build()

        if (annotation.space.id != link.space.id) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        // Anonymous users can only delete annotations without a user (anonymous ones)
        if (annotation.user != null) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        annotationService.deleteAnnotation(annotationId)
        return ResponseEntity.noContent().build()
    }

    private fun probeContentType(path: Path): String {
        val extension = path.fileName.toString().substringAfterLast('.', "")
        val byExtension = getContentType(extension)
        if (byExtension != "application/octet-stream") return byExtension
        return Files.probeContentType(path) ?: "application/octet-stream"
    }
}
