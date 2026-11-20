package com.docuvault.office

import com.docuvault.domain.space.Space
import com.docuvault.domain.user.User
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.DocumentPersistService
import com.docuvault.service.FileUploadService
import com.docuvault.service.PermissionService
import com.docuvault.service.git.GitService
import com.docuvault.service.requireSpaceWritable
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import java.io.ByteArrayOutputStream
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets
import java.time.Duration
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.zip.ZipInputStream

/**
 * Editing Word documents in the browser with an ONLYOFFICE document server.
 *
 * The browser gets a signed editor configuration; the document server then
 * fetches the file from [fileUrl] and reports back to [callbackUrl] when there
 * is something to save (Ctrl+S, or ten seconds after the last editor left).
 * Each save is written into the space and committed like an upload, so it shows
 * up in the version history.
 *
 * Everyone editing the same file must get the same document key, or they end up
 * in separate sessions that overwrite each other. The key derives from the file's
 * content, and while a session is open, saves made from inside it (which change
 * the content) keep its key; that bookkeeping lives in memory, like the live
 * collaboration rooms.
 */
@Service
class OfficeService(
    private val settings: OfficeSettings,
    private val spaceRepository: SpaceRepository,
    private val userRepository: UserRepository,
    private val permissionService: PermissionService,
    private val fileUploadService: FileUploadService,
    private val documentPersistService: DocumentPersistService,
    private val gitService: GitService
) {
    private val logger = LoggerFactory.getLogger(OfficeService::class.java)
    private val http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build()
    private val mapper = jacksonObjectMapper()

    companion object {
        /** The formats that save back in the format they were opened in. */
        private val EDITABLE = setOf("docx")
        private val FILE_LINK_LIFETIME: Duration = Duration.ofHours(24)
        /** Same ceiling as an upload. */
        private const val MAX_SAVE_BYTES = 200L * 1024 * 1024

        fun isEditable(path: String): Boolean = path.substringAfterLast('.', "").lowercase() in EDITABLE

        /** Uncompressed size at which [sameZipContent] gives up and reports a difference. */
        private const val MAX_COMPARE_BYTES = 512L * 1024 * 1024

        /**
         * Whether two Office files hold the same parts. The document server writes
         * a new archive on every save, and at the end of a session it saves again
         * even when nothing changed since the last Ctrl+S; the bytes differ by zip
         * timestamps only, which is not worth a commit.
         */
        fun sameZipContent(a: ByteArray, b: ByteArray): Boolean {
            val left = zipEntries(a) ?: return false
            val right = zipEntries(b) ?: return false
            return left.keys == right.keys && left.all { (name, bytes) -> bytes.contentEquals(right[name]) }
        }

        private fun zipEntries(bytes: ByteArray): Map<String, ByteArray>? = try {
            val entries = mutableMapOf<String, ByteArray>()
            var total = 0L
            ZipInputStream(bytes.inputStream()).use { zip ->
                while (true) {
                    val entry = zip.nextEntry ?: break
                    if (entry.isDirectory) continue
                    val content = zip.readAllBytes()
                    total += content.size
                    if (total > MAX_COMPARE_BYTES) return null
                    entries[entry.name] = content
                }
            }
            entries.takeIf { it.isNotEmpty() }
        } catch (_: Exception) {
            null
        }
    }

    data class DocRef(val spaceId: UUID, val path: String)

    /**
     * The key of an open session and every content hash the file has had during
     * it; [saving] while a save asked for with [requestSave] has not arrived yet.
     */
    private class Session(val key: String, val hashes: MutableSet<String>) {
        @Volatile var saving = false
    }

    data class SessionState(val open: Boolean, val saving: Boolean)

    private val sessions = ConcurrentHashMap<DocRef, Session>()

    val enabled: Boolean get() = settings.enabled

    /** Whether people are still editing the file in the document server, or it has yet to save. */
    fun sessionOpen(ref: DocRef): Boolean = sessions.containsKey(ref)

    fun sessionState(ref: DocRef): SessionState =
        sessions[ref].let { SessionState(open = it != null, saving = it?.saving == true) }

    /**
     * Asks the document server to save the file now rather than when the last
     * editor has left. True when a save is on its way; false when there was
     * nothing to save or no session to save from.
     */
    fun requestSave(ref: DocRef): Boolean {
        val session = sessions[ref] ?: return false
        val command = mapOf("c" to "forcesave", "key" to session.key)
        val body = command + ("token" to OfficeJwt.sign(command, settings.jwtSecret))
        return try {
            val request = HttpRequest.newBuilder(URI("${settings.internalUrl}/command"))
                .timeout(Duration.ofSeconds(20))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)))
                .build()
            val response = http.send(request, HttpResponse.BodyHandlers.ofString())
            // 0: the save is coming; 4: nothing changed since the last save.
            val error = runCatching { mapper.readTree(response.body()).path("error").asInt(-1) }.getOrDefault(-1)
            if (error != 0 && error != 4) {
                logger.warn("Document server refused to save '{}' (HTTP {}, error {})", ref.path, response.statusCode(), error)
            }
            (error == 0).also { if (it) session.saving = true }
        } catch (e: Exception) {
            logger.warn("Asking the document server to save '{}' failed: {}", ref.path, e.message)
            false
        }
    }

    /** The configuration for `new DocsAPI.DocEditor(...)`, signed for the document server. */
    fun editorConfig(space: Space, path: String, bytes: ByteArray, user: User, dark: Boolean): Map<String, Any?> {
        val ref = DocRef(space.id!!, path)
        val name = path.substringAfterLast('/')
        val config = linkedMapOf<String, Any?>(
            "document" to mapOf(
                "fileType" to name.substringAfterLast('.').lowercase(),
                "key" to keyFor(ref, documentPersistService.hashBytes(bytes)),
                "title" to name,
                "url" to fileUrl(ref),
                "permissions" to mapOf(
                    "edit" to true,
                    "comment" to true,
                    "review" to true,
                    "download" to true,
                    "print" to true
                )
            ),
            "documentType" to "word",
            "editorConfig" to mapOf(
                "mode" to "edit",
                "lang" to "en",
                "callbackUrl" to callbackUrl(ref),
                "user" to mapOf("id" to user.id.toString(), "name" to user.name),
                "customization" to mapOf(
                    "forcesave" to true,
                    "compactHeader" to true,
                    "uiTheme" to if (dark) "theme-dark" else "theme-light"
                )
            ),
            // The mobile editor is view-only in the free edition; phones are not offered editing.
            "type" to "desktop"
        )
        config["token"] = OfficeJwt.sign(config, settings.jwtSecret)
        return config
    }

    /** The file a signed link from [fileUrl] stands for; null when the link is not ours or has expired. */
    fun fileRef(token: String): DocRef? = refFrom(token, "file")

    /**
     * Handles one call of the document server about [token]'s file. Returns the
     * `error` code to answer with: 0 when done, 1 when the server should keep the
     * changes and report a failure.
     */
    fun handleCallback(token: String, body: JsonNode, authorization: String?): Int {
        val ref = refFrom(token, "callback") ?: return 1
        val payload = verifiedPayload(body, authorization)
        if (payload == null) {
            logger.warn("Office callback for '{}' without a valid signature from the document server", ref.path)
            return 1
        }
        return when (val status = payload.path("status").asInt()) {
            2, 6 -> save(ref, payload, endsSession = status == 2)
            3, 7 -> {
                logger.warn("Office editor could not save '{}' (status {})", ref.path, status)
                if (status == 3) sessions.remove(ref) else sessions[ref]?.saving = false
                0
            }
            4 -> {
                sessions.remove(ref)
                0
            }
            else -> 0
        }
    }

    private fun save(ref: DocRef, payload: JsonNode, endsSession: Boolean): Int {
        val space = spaceRepository.findById(ref.spaceId).orElse(null) ?: return 1
        // The document server names the editor who made the last change first.
        val userId = payload.path("users").firstOrNull()?.asText()?.let { runCatching { UUID.fromString(it) }.getOrNull() }
        val user = userId?.let { userRepository.findById(it).orElse(null) }
        if (user == null || !permissionService.hasEditAccess(user.id!!, space.id!!, user.role)) {
            logger.warn("Office save of '{}' refused: editor {} may not write to the space", ref.path, userId)
            return 1
        }
        try {
            requireSpaceWritable(space)
        } catch (e: Exception) {
            logger.warn("Office save of '{}' refused: {}", ref.path, e.message)
            return 1
        }
        val bytes = payload.path("url").asText().takeIf { it.isNotBlank() }?.let { download(it) }
        if (bytes == null) {
            logger.warn("Office save of '{}' failed: the edited file could not be fetched", ref.path)
            return 1
        }
        val current = runCatching { gitService.readBinaryFile(space, ref.path) }.getOrNull()
        if (current == null || !sameZipContent(current, bytes)) {
            val stored = fileUploadService.store(space, ref.path, bytes) ?: return 1
            documentPersistService.commitIfRequested(space, true, "Edit ${stored.name} in the office editor", user)
        }

        if (endsSession) {
            sessions.remove(ref)
        } else {
            sessions[ref]?.let {
                it.hashes.add(documentPersistService.hashBytes(bytes))
                it.saving = false
            }
        }
        return 0
    }

    /** The saved file, fetched from the document server itself whatever host its link names. */
    private fun download(url: String): ByteArray? {
        val uri = runCatching { URI(url) }.getOrNull() ?: return null
        val prefix = settings.urlPath
        val path = uri.rawPath.orEmpty().let { if (prefix.isNotEmpty() && it.startsWith("$prefix/")) it.removePrefix(prefix) else it }
        val target = settings.internalUrl + path + (uri.rawQuery?.let { "?$it" } ?: "")
        return try {
            val request = HttpRequest.newBuilder(URI(target)).timeout(Duration.ofMinutes(2)).GET().build()
            val response = http.send(request, HttpResponse.BodyHandlers.ofInputStream())
            if (response.statusCode() != 200) {
                response.body().close()
                logger.warn("Document server answered {} for the saved file", response.statusCode())
                return null
            }
            response.body().use { input ->
                val out = ByteArrayOutputStream()
                val buffer = ByteArray(64 * 1024)
                var total = 0L
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    total += read
                    if (total > MAX_SAVE_BYTES) return null
                    out.write(buffer, 0, read)
                }
                out.toByteArray()
            }
        } catch (e: Exception) {
            logger.warn("Fetching the saved file from the document server failed: {}", e.message)
            null
        }
    }

    /**
     * The callback's content as signed by the document server: the body itself
     * when it carries a token, else the payload of the Authorization header.
     */
    private fun verifiedPayload(body: JsonNode, authorization: String?): JsonNode? {
        body.path("token").asText().takeIf { it.isNotBlank() }?.let { token ->
            return OfficeJwt.verify(token, settings.jwtSecret)
        }
        val bearer = authorization?.removePrefix("Bearer ")?.takeIf { it != authorization } ?: return null
        val claims = OfficeJwt.verify(bearer, settings.jwtSecret) ?: return null
        return claims.get("payload") ?: claims
    }

    private fun keyFor(ref: DocRef, contentHash: String): String =
        sessions.compute(ref) { _, open ->
            if (open != null && contentHash in open.hashes) open
            else Session(documentPersistService.hashContent("${ref.spaceId}\n${ref.path}\n$contentHash").take(40), mutableSetOf(contentHash))
        }!!.key

    private fun fileUrl(ref: DocRef): String =
        "${settings.backendUrl}/office/file?t=" + encode(signedRef(ref, "file", Instant.now().plus(FILE_LINK_LIFETIME)))

    /** No expiry: the document server calls back whenever the session ends, which may be days later. */
    private fun callbackUrl(ref: DocRef): String =
        "${settings.backendUrl}/office/callback?t=" + encode(signedRef(ref, "callback", null))

    private fun signedRef(ref: DocRef, purpose: String, expires: Instant?): String =
        OfficeJwt.sign(
            mapOf("use" to purpose, "sid" to ref.spaceId.toString(), "path" to ref.path, "exp" to expires?.epochSecond)
                .filterValues { it != null },
            settings.jwtSecret
        )

    private fun refFrom(token: String, purpose: String): DocRef? {
        val claims = OfficeJwt.verify(token, settings.jwtSecret) ?: return null
        if (claims.path("use").asText() != purpose) return null
        val spaceId = runCatching { UUID.fromString(claims.path("sid").asText()) }.getOrNull() ?: return null
        val path = claims.path("path").asText().takeIf { it.isNotBlank() } ?: return null
        return DocRef(spaceId, path)
    }

    private fun encode(value: String) = URLEncoder.encode(value, StandardCharsets.UTF_8)
}
