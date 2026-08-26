package com.docuvault.service

import org.springframework.stereotype.Service
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.ConcurrentHashMap

/**
 * Decides whether a share link may serve a file that lies *outside* its own
 * scope — outside the shared folder, or outside the shared file's directory.
 *
 * A shared HTML page is rarely self-contained: design mockups and exported
 * reports keep their stylesheet, scripts, logo and fonts in a sibling
 * `assets/` folder one level up, so `<link href="../assets/styles.css">`
 * points above whatever was shared. Refusing those requests renders the page
 * unstyled; serving anything in the repository would turn a link to one folder
 * into read access to the whole space.
 *
 * The middle ground: follow the references. Starting from the shared content,
 * every `href` / `src` / `url()` / `![](…)` is resolved and followed
 * transitively through HTML, markdown, CSS and JS. A file outside the share is served only if the shared
 * content actually asks for it *and* it is a static asset — a stylesheet,
 * script, image, font or data file. Documents (`.html`, `.md`) outside the
 * share stay out of reach, so a link to a neighbouring page does not quietly
 * widen what the token grants.
 */
@Service
class ShareAssetResolver {

    companion object {
        /** Types served from outside the share when referenced. Never `.html`/`.md`. */
        private val SERVABLE_EXTENSIONS = setOf(
            "css", "js", "mjs", "cjs", "json",
            "png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "ico", "bmp",
            "woff", "woff2", "ttf", "otf", "eot",
            "mp4", "webm", "ogg", "mp3", "wav"
        )

        /** Types whose own references are followed. */
        private val WALKABLE_EXTENSIONS = setOf("html", "htm", "css", "js", "mjs", "cjs", "md", "markdown")

        private const val MAX_FILES_WALKED = 300
        private const val MAX_ENTRY_POINTS = 200
        private const val MAX_FILE_BYTES = 2L * 1024 * 1024
        private const val CACHE_TTL_MS = 60_000L
        private const val MAX_CACHE_ENTRIES = 500

        private val HTML_ATTRIBUTE = Regex("""\b(?:src|href)\s*=\s*["']([^"']+)["']""", RegexOption.IGNORE_CASE)
        private val HTML_SRCSET = Regex("""\bsrcset\s*=\s*["']([^"']+)["']""", RegexOption.IGNORE_CASE)
        private val CSS_URL = Regex("""url\(\s*["']?([^"')]+)""", RegexOption.IGNORE_CASE)
        private val CSS_IMPORT = Regex("""@import\s+(?:url\()?\s*["']([^"']+)["']""", RegexOption.IGNORE_CASE)
        private val JS_MODULE = Regex("""(?:import|from|require)\s*\(?\s*["']([^"']+)["']""")
        private val JS_ASSET_LITERAL = Regex("""["']([^"'\s]+\.(?:css|js|mjs|json|png|jpe?g|gif|svg|webp|woff2?))["']""", RegexOption.IGNORE_CASE)
        private val MARKDOWN_INLINE = Regex("""!?\[[^\]]*]\(\s*<?([^)>\s]+)""")
        private val MARKDOWN_REFERENCE = Regex("""^\s*\[[^\]]+]:\s*<?(\S+?)>?\s*$""", RegexOption.MULTILINE)
        private val SCHEME_PREFIX = Regex("^[a-zA-Z][a-zA-Z0-9+.-]*:")
    }

    private data class CachedGraph(val computedAt: Long, val allowed: Set<Path>)

    private val cache = ConcurrentHashMap<String, CachedGraph>()

    /**
     * True when [target] sits outside the share but is referenced by it.
     *
     * @param cacheKey identifies the share; the reference graph is cached
     *   under it for a minute so one page load does not re-walk the folder.
     * @param repoRoot the space's repository — nothing above it is ever served.
     * @param allowedRoot the shared folder, or the shared file's directory.
     * @param sharedFile the shared file for a file share, `null` for a folder
     *   share (whose entry points are the documents in the folder itself).
     */
    fun allowsOutsideAsset(
        cacheKey: String,
        repoRoot: Path,
        allowedRoot: Path,
        sharedFile: Path?,
        target: Path
    ): Boolean {
        val normalized = target.normalize()
        if (!normalized.startsWith(repoRoot.normalize())) return false
        if (extensionOf(normalized) !in SERVABLE_EXTENSIONS) return false

        val cached = cache[cacheKey]
        if (cached != null && System.currentTimeMillis() - cached.computedAt < CACHE_TTL_MS) {
            return normalized in cached.allowed
        }

        val allowed = walkReferences(repoRoot.normalize(), allowedRoot.normalize(), sharedFile?.normalize())
        if (cache.size > MAX_CACHE_ENTRIES) cache.clear()
        cache[cacheKey] = CachedGraph(System.currentTimeMillis(), allowed)
        return normalized in allowed
    }

    /** Drops the cached graph for a share — used when its scope changes. */
    fun invalidate(cacheKey: String) {
        cache.remove(cacheKey)
    }

    private fun walkReferences(repoRoot: Path, allowedRoot: Path, sharedFile: Path?): Set<Path> {
        val queue = ArrayDeque(entryPoints(allowedRoot, sharedFile))
        val visited = HashSet<Path>()
        val allowed = HashSet<Path>()

        while (queue.isNotEmpty() && visited.size < MAX_FILES_WALKED) {
            val file = queue.removeFirst()
            if (!visited.add(file)) continue

            val dir = file.parent ?: repoRoot
            for (reference in extractReferences(file)) {
                val resolved = try {
                    dir.resolve(reference).normalize()
                } catch (_: Exception) {
                    continue
                }
                if (!resolved.startsWith(repoRoot)) continue
                if (!Files.isRegularFile(resolved)) continue

                if (!resolved.startsWith(allowedRoot)) {
                    if (extensionOf(resolved) !in SERVABLE_EXTENSIONS) continue
                    allowed.add(resolved)
                }
                if (extensionOf(resolved) in WALKABLE_EXTENSIONS) queue.add(resolved)
            }
        }
        return allowed
    }

    private fun entryPoints(allowedRoot: Path, sharedFile: Path?): List<Path> {
        if (sharedFile != null) {
            return if (Files.isRegularFile(sharedFile)) listOf(sharedFile) else emptyList()
        }
        if (!Files.isDirectory(allowedRoot)) return emptyList()
        return try {
            Files.walk(allowedRoot).use { stream ->
                stream.filter { Files.isRegularFile(it) && extensionOf(it) in WALKABLE_EXTENSIONS }
                    .limit(MAX_ENTRY_POINTS.toLong())
                    .toList()
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun extractReferences(file: Path): List<String> {
        val extension = extensionOf(file)
        if (extension !in WALKABLE_EXTENSIONS) return emptyList()
        val text = try {
            if (Files.size(file) > MAX_FILE_BYTES) return emptyList()
            Files.readString(file)
        } catch (_: Exception) {
            return emptyList()
        }

        val raw = when (extension) {
            "html", "htm" ->
                HTML_ATTRIBUTE.findAll(text).map { it.groupValues[1] }.toList() +
                    HTML_SRCSET.findAll(text).flatMap { candidatesFromSrcset(it.groupValues[1]) }.toList() +
                    CSS_URL.findAll(text).map { it.groupValues[1] }.toList()
            "css" ->
                CSS_URL.findAll(text).map { it.groupValues[1] }.toList() +
                    CSS_IMPORT.findAll(text).map { it.groupValues[1] }.toList()
            // Markdown embeds HTML freely, so its attributes count too.
            "md", "markdown" ->
                MARKDOWN_INLINE.findAll(text).map { it.groupValues[1] }.toList() +
                    MARKDOWN_REFERENCE.findAll(text).map { it.groupValues[1] }.toList() +
                    HTML_ATTRIBUTE.findAll(text).map { it.groupValues[1] }.toList()
            else ->
                JS_MODULE.findAll(text).map { it.groupValues[1] }.toList() +
                    JS_ASSET_LITERAL.findAll(text).map { it.groupValues[1] }.toList()
        }

        return raw.mapNotNull { cleanReference(it) }.distinct()
    }

    private fun candidatesFromSrcset(value: String): List<String> =
        value.split(',').mapNotNull { it.trim().split(Regex("\\s+")).firstOrNull()?.takeIf(String::isNotBlank) }

    /**
     * Turns a raw attribute value into a repository-relative path, or `null`
     * when it does not address a file in the repository at all (absolute URLs,
     * data URIs, in-page anchors).
     */
    private fun cleanReference(reference: String): String? {
        val trimmed = reference.trim()
        if (trimmed.isEmpty() || trimmed.startsWith("#")) return null
        if (SCHEME_PREFIX.containsMatchIn(trimmed)) return null

        // A root-absolute reference ("/assets/x.css") resolves against the site
        // root in the browser, never against the space, so the share could not
        // serve it even if it were allowed here.
        if (trimmed.startsWith("/")) return null

        val relative = trimmed.substringBefore('#').substringBefore('?')
        if (relative.isEmpty()) return null

        return try {
            URLDecoder.decode(relative.replace("+", "%2B"), StandardCharsets.UTF_8)
        } catch (_: Exception) {
            relative
        }
    }

    private fun extensionOf(path: Path): String =
        path.fileName?.toString()?.substringAfterLast('.', "")?.lowercase() ?: ""
}
