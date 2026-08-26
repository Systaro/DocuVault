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
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
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
