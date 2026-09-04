package com.docuvault.api.spaces

import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.PermissionService
import com.docuvault.service.StateFreezeService
import com.docuvault.service.git.GitService
import com.docuvault.service.HtmlPreviewInjection
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.CacheControl
import org.springframework.http.ContentDisposition
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.core.userdetails.UserDetails
import org.springframework.web.bind.annotation.*
import java.io.ByteArrayOutputStream
import java.net.URLDecoder
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardOpenOption
import java.util.*
import java.util.concurrent.TimeUnit
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

@RestController
@RequestMapping("/spaces/{spaceId}/files")
class SpaceFileController(
    private val spaceRepository: SpaceRepository,
    private val userRepository: UserRepository,
    private val permissionService: PermissionService,
    private val gitService: GitService,
    private val stateFreezeService: StateFreezeService
) {
    companion object {
        /** Ceiling on one media response, so a viewer never pulls a whole film into heap. */
        private const val MEDIA_CHUNK_BYTES = 2L * 1024 * 1024

        /**
         * Content types for playable media, by extension. Mapped explicitly rather
         * than probed: the runtime image ships no mime table, so probeContentType
         * answers octet-stream and browsers refuse to play it.
         */
        private val MEDIA_CONTENT_TYPES = mapOf(
            "mp4" to "video/mp4",
            "m4v" to "video/mp4",
            "mov" to "video/quicktime",
            "webm" to "video/webm",
            "ogv" to "video/ogg",
            "mp3" to "audio/mpeg",
            "m4a" to "audio/mp4",
            "wav" to "audio/wav",
            "oga" to "audio/ogg",
            "ogg" to "audio/ogg",
            "flac" to "audio/flac",
            "aac" to "audio/aac"
        )
    }

    @GetMapping("/**")
    fun getFile(
        @PathVariable spaceId: UUID,
        @RequestParam(required = false) download: Boolean?,
        @RequestParam(required = false) includeState: Boolean?,
        @AuthenticationPrincipal userDetails: UserDetails,
        request: HttpServletRequest
    ): ResponseEntity<ByteArray> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(spaceId).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!permissionService.hasAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val basePath = "/api/spaces/$spaceId/files/"
        val rawPath = if (request.requestURI.startsWith(basePath)) {
            request.requestURI.substring(basePath.length)
        } else {
            return ResponseEntity.badRequest().build()
        }
        val filePath = URLDecoder.decode(rawPath, StandardCharsets.UTF_8)

        val repoPath = gitService.getRepoPath(spaceId)
        val resolved = repoPath.resolve(filePath).normalize()

        // Path traversal protection
        if (!resolved.startsWith(repoPath.normalize())) {
            return ResponseEntity.badRequest().build()
        }

        val wantsDownload = download == true

        if (wantsDownload && Files.isDirectory(resolved)) {
            return zipDirectory(resolved, repoPath.normalize())
        }

        if (!Files.exists(resolved) || !Files.isRegularFile(resolved)) {
            return ResponseEntity.notFound().build()
        }

        val contentType = Files.probeContentType(resolved) ?: "application/octet-stream"
        val extension = filePath.substringAfterLast('.', "").lowercase()
        val isHtml = extension in listOf("html", "htm")

        // Frozen export: embed a snapshot of the referenced DocuVault state so the
        // downloaded HTML works standalone. Falls back to the raw file when the
        // HTML doesn't use the state library.
        if (isHtml && wantsDownload && includeState == true) {
            val html = Files.readString(resolved)
            val frozen = stateFreezeService.freezeHtml(html, spaceId) ?: html
            return ResponseEntity.ok()
                .contentType(MediaType.TEXT_HTML)
                .cacheControl(CacheControl.noCache())
                .header(
                    HttpHeaders.CONTENT_DISPOSITION,
                    ContentDisposition.attachment()
                        .filename(resolved.fileName.toString(), StandardCharsets.UTF_8)
                        .build()
                        .toString()
                )
                .body(frozen.toByteArray(Charsets.UTF_8))
        }

        // For HTML files, inject the annotation bridge script (not when downloading the raw file)
        if (isHtml && !wantsDownload) {
            val html = Files.readString(resolved)
            val injected = HtmlPreviewInjection.inject(
                html,
                HtmlPreviewInjection.baseHref("/api/spaces/$spaceId/files", filePath)
            )
            return ResponseEntity.ok()
                .contentType(MediaType.TEXT_HTML)
                .cacheControl(CacheControl.noCache())
                .body(injected.toByteArray(Charsets.UTF_8))
        }

        // Audio and video are served differently: a player asks for byte ranges so
        // it can start before the file has arrived and seek afterwards, and
        // reading a whole video into a ByteArray would put it in the heap once per
        // viewer. Content type is mapped explicitly because probeContentType is no
        // help — the runtime image ships no mime table, so it answers
        // octet-stream and a <video> element refuses to play it.
        val mediaType = if (wantsDownload) null else MEDIA_CONTENT_TYPES[extension]
        if (mediaType != null) {
            return serveMediaRange(resolved, mediaType, rangeHeader = request.getHeader(HttpHeaders.RANGE))
        }

        val bytes = Files.readAllBytes(resolved)

        val cachePolicy = if (contentType.startsWith("image/") || contentType.startsWith("font/")) {
            CacheControl.maxAge(1, TimeUnit.HOURS).cachePublic()
        } else {
            CacheControl.noCache()
        }

        val response = ResponseEntity.ok()
            .contentType(MediaType.parseMediaType(contentType))
            .cacheControl(cachePolicy)
        if (wantsDownload) {
            response.header(
                HttpHeaders.CONTENT_DISPOSITION,
                ContentDisposition.attachment()
                    .filename(resolved.fileName.toString(), StandardCharsets.UTF_8)
                    .build()
                    .toString()
            )
        }
        return response.body(bytes)
    }

    /**
     * Serves one slice of a media file, honouring `Range`.
     *
     * Players open a file with `Range: bytes=0-` and then re-request as the
     * viewer scrubs, so answering 206 with `Accept-Ranges` is what makes seeking
     * work at all — Safari will not start playback without it. Each response is
     * capped at [MEDIA_CHUNK_BYTES] so one viewer never pulls a whole film into
     * memory, and a request with no `Range` is answered the same way rather than
     * reading the file whole.
     */
    private fun serveMediaRange(file: Path, contentType: String, rangeHeader: String?): ResponseEntity<ByteArray> {
        val length = Files.size(file)
        if (length == 0L) return ResponseEntity.ok().contentType(MediaType.parseMediaType(contentType)).body(ByteArray(0))

        val requested = parseFirstRange(rangeHeader, length)
        val start = requested?.first ?: 0L
        if (start >= length) {
            return ResponseEntity.status(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                .header(HttpHeaders.CONTENT_RANGE, "bytes */$length")
                .build()
        }
        val requestedEnd = requested?.second ?: (length - 1)
        val end = minOf(requestedEnd, start + MEDIA_CHUNK_BYTES - 1, length - 1)
        val count = (end - start + 1).toInt()

        val bytes = ByteArray(count)
        FileChannel.open(file, StandardOpenOption.READ).use { channel ->
            val buffer = ByteBuffer.wrap(bytes)
            channel.position(start)
            while (buffer.hasRemaining() && channel.read(buffer) > 0) { /* fill */ }
        }

        return ResponseEntity.status(HttpStatus.PARTIAL_CONTENT)
            .contentType(MediaType.parseMediaType(contentType))
            .header(HttpHeaders.ACCEPT_RANGES, "bytes")
            .header(HttpHeaders.CONTENT_RANGE, "bytes $start-$end/$length")
            .cacheControl(CacheControl.maxAge(1, TimeUnit.HOURS).cachePrivate())
            .body(bytes)
    }

    /** `bytes=start-end` (either side may be absent), or null when unparseable. */
    private fun parseFirstRange(header: String?, length: Long): Pair<Long, Long>? {
        val spec = header?.trim()?.removePrefix("bytes=")?.substringBefore(',')?.trim()
        if (spec.isNullOrBlank()) return null
        val from = spec.substringBefore('-').trim()
        val to = spec.substringAfter('-').trim()
        return try {
            when {
                // "-500" means the last 500 bytes.
                from.isEmpty() && to.isNotEmpty() ->
                    (length - to.toLong()).coerceAtLeast(0L) to (length - 1)
                from.isNotEmpty() && to.isEmpty() -> from.toLong() to (length - 1)
                from.isNotEmpty() -> from.toLong() to to.toLong()
                else -> null
            }
        } catch (_: NumberFormatException) {
            null
        }
    }

    private fun zipDirectory(dir: Path, repoPath: Path): ResponseEntity<ByteArray> {
        val folderName = dir.fileName?.toString() ?: "folder"
        val output = ByteArrayOutputStream()
        ZipOutputStream(output).use { zip ->
            Files.walk(dir).use { paths ->
                paths.filter { Files.isRegularFile(it) }
                    .filter { path -> repoPath.relativize(path).none { segment -> segment.toString() == ".git" } }
                    .sorted()
                    .forEach { file ->
                        zip.putNextEntry(ZipEntry("$folderName/${dir.relativize(file).joinToString("/")}"))
                        Files.copy(file, zip)
                        zip.closeEntry()
                    }
            }
        }
        return ResponseEntity.ok()
            .contentType(MediaType.parseMediaType("application/zip"))
            .header(
                HttpHeaders.CONTENT_DISPOSITION,
                ContentDisposition.attachment()
                    .filename("$folderName.zip", StandardCharsets.UTF_8)
                    .build()
                    .toString()
            )
            .cacheControl(CacheControl.noCache())
            .body(output.toByteArray())
    }

}
