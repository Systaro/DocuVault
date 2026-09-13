package com.docuvault.service.mcp

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ObjectNode
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.http.client.JdkClientHttpRequestFactory
import org.springframework.stereotype.Service
import org.springframework.web.client.RestClient
import org.springframework.web.util.UriUtils
import java.net.URI
import java.nio.charset.StandardCharsets
import java.util.*

data class ToolDescriptor(val name: String, val description: String, val inputSchema: Map<String, Any>)

private class Tool(
    val name: String,
    val description: String,
    val inputSchema: Map<String, Any>,
    val handler: (McpToolService.ToolSession, ObjectNode) -> String
)

/**
 * The MCP tools. Each handler calls the public REST API over the loopback
 * interface with the caller's own credential, so validation, permission checks
 * and response shapes exist once, in the controllers.
 */
@Service
class McpToolService(
    private val objectMapper: ObjectMapper,
    @Value("\${server.port}") serverPort: Int,
    @Value("\${server.servlet.context-path:}") contextPath: String,
    @Value("\${app.public-url}") publicUrl: String
) {
    companion object {
        private val UUID_REGEX = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", RegexOption.IGNORE_CASE)
        private val BINARY_EXTENSIONS = setOf(
            "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "tiff", "tif",
            "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf"
        )
    }

    private val logger = LoggerFactory.getLogger(McpToolService::class.java)
    private val baseUrl = publicUrl.trimEnd('/')
    private val loopbackBase = "http://127.0.0.1:$serverPort${contextPath.trimEnd('/')}"

    // The JDK client: the default HttpURLConnection factory cannot send PATCH.
    private val restClient = RestClient.builder().requestFactory(JdkClientHttpRequestFactory()).build()

    // ---- Loopback API client -----------------------------------------------------

    inner class Api(private val authorization: String) {
        fun listSpaces(): List<JsonNode> = call(HttpMethod.GET, "/spaces").toList()
        fun fileTree(spaceId: String): JsonNode = call(HttpMethod.GET, "/spaces/$spaceId/documents/tree")
        fun readDocument(spaceId: String, path: String): JsonNode =
            call(HttpMethod.GET, "/spaces/$spaceId/documents/${encodePath(path)}")
        fun createDocument(spaceId: String, body: Map<String, Any?>): JsonNode =
            call(HttpMethod.POST, "/spaces/$spaceId/documents", body)
        fun updateDocument(spaceId: String, path: String, body: Map<String, Any?>): JsonNode =
            call(HttpMethod.PUT, "/spaces/$spaceId/documents/${encodePath(path)}", body)
        fun patchDocument(spaceId: String, path: String, body: Map<String, Any?>): JsonNode =
            call(HttpMethod.PATCH, "/spaces/$spaceId/documents/${encodePath(path)}", body)
        fun createShareLink(spaceId: String, body: Map<String, Any?>): JsonNode =
            call(HttpMethod.POST, "/spaces/$spaceId/shares", body)
        fun searchKeyword(query: String, limit: Int): JsonNode =
            call(HttpMethod.GET, "/search?q=${UriUtils.encodeQueryParam(query, StandardCharsets.UTF_8)}&limit=$limit")
        fun searchSemantic(body: Map<String, Any?>): JsonNode = call(HttpMethod.POST, "/search/semantic", body)
        fun listState(spaceId: String): JsonNode = call(HttpMethod.GET, "/spaces/$spaceId/state")
        fun getState(spaceId: String, key: String): JsonNode =
            call(HttpMethod.GET, "/spaces/$spaceId/state/${UriUtils.encodePathSegment(key, StandardCharsets.UTF_8)}")
        fun putState(spaceId: String, key: String, value: String): JsonNode =
            call(HttpMethod.PUT, "/spaces/$spaceId/state/${UriUtils.encodePathSegment(key, StandardCharsets.UTF_8)}", mapOf("value" to value))

        private fun call(method: HttpMethod, path: String, body: Any? = null): JsonNode {
            val spec = restClient.method(method)
                .uri(URI.create(loopbackBase + path))
                .header(HttpHeaders.AUTHORIZATION, authorization)
                .accept(MediaType.APPLICATION_JSON)
            if (body != null) {
                spec.contentType(MediaType.APPLICATION_JSON).body(objectMapper.writeValueAsString(body))
            }
            return spec.exchange({ _, response ->
                val text = response.body.readBytes().toString(StandardCharsets.UTF_8)
                if (response.statusCode.isError) {
                    throw McpToolException("DocuVault API ${response.statusCode.value()}: ${errorMessage(text)}")
                }
                if (text.isBlank()) objectMapper.nullNode() else objectMapper.readTree(text)
            }, true)
        }

        private fun errorMessage(text: String): String {
            val parsed = runCatching { objectMapper.readTree(text) }.getOrNull()
            return parsed?.text("message") ?: parsed?.text("error") ?: text.take(300).ifBlank { "request failed" }
        }
    }

    /** Per-call state: the API bound to the caller and the space list, fetched at most once. */
    inner class ToolSession(ctx: McpContext) {
        val api = Api(ctx.authorizationHeader)
        val spaces: List<JsonNode> by lazy { api.listSpaces() }

        fun resolveSpaceId(input: String): String {
            if (UUID_REGEX.matches(input)) return input
            return spaces.firstOrNull { it.text("fullPath") == input || it.text("slug") == input || it.text("name") == input }
                ?.text("id")
                ?: throw McpToolException("Unknown space \"$input\". Use list_spaces to see the available spaces.")
        }

        fun spaceFullPath(spaceId: String): String? = spaces.firstOrNull { it.text("id") == spaceId }?.text("fullPath")

        fun documentUrl(spaceFullPath: String, docPath: String): String =
            "$baseUrl/spaces/$spaceFullPath/doc?path=${UriUtils.encodeQueryParam(docPath, StandardCharsets.UTF_8)}"

        fun urlLine(spaceId: String, docPath: String): String =
            spaceFullPath(spaceId)?.let { "\nURL: ${documentUrl(it, docPath)}" } ?: ""
    }

    // ---- Public surface ------------------------------------------------------------

    fun listTools(ctx: McpContext): List<ToolDescriptor> {
        val catalog = runCatching { buildSpaceCatalog(ToolSession(ctx).spaces) }.getOrDefault("")
        return tools.map { tool ->
            val description = if (tool.name == "search_documentation") tool.description + catalog else tool.description
            ToolDescriptor(tool.name, description, tool.inputSchema)
        }
    }

    fun callTool(ctx: McpContext, name: String, arguments: ObjectNode): Map<String, Any> {
        val tool = toolsByName[name] ?: throw McpInvalidParamsException("Unknown tool: $name")
        return try {
            textResult(tool.handler(ToolSession(ctx), arguments), isError = false)
        } catch (e: McpToolException) {
            textResult(e.message ?: "Tool failed", isError = true)
        } catch (e: Exception) {
            logger.warn("MCP tool $name failed for ${ctx.user.email}: ${e.message}", e)
            textResult("Tool failed: ${e.message}", isError = true)
        }
    }

    private fun textResult(text: String, isError: Boolean): Map<String, Any> =
        mapOf("content" to listOf(mapOf("type" to "text", "text" to text)), "isError" to isError)

    // ---- Tools -----------------------------------------------------------------------

    private val tools: List<Tool> = listOf(
        Tool(
            "search_documentation",
            "Semantic vector search across all accessible DocuVault documentation. Returns relevant document chunks ranked by similarity. Each result includes a direct DocuVault URL; give it to the user to open the document in the app (they are already authenticated, no share link needed).",
            schema(
                "query" to str("The search query: a question or topic description"),
                "spaceId" to str("Optional: limit the search to one space (ID, full path or name)"),
                "limit" to int("Maximum number of results (default 10)"),
                required = listOf("query")
            )
        ) { s, a ->
            val query = a.requiredString("query")
            val limit = a.optionalInt("limit", 10)
            val spaceId = a.optionalString("spaceId")?.let { s.resolveSpaceId(it) }
            val results = s.api.searchSemantic(mapOf("query" to query, "spaceId" to spaceId, "limit" to limit))
            if (results.isEmpty) "No results found."
            else results.mapIndexed { i, r ->
                val fullPath = r.text("spaceFullPath")
                val docPath = r.text("documentPath") ?: ""
                val header = if (fullPath != null) {
                    "[${i + 1}] ${r.text("documentTitle")} ($fullPath/$docPath)\nURL: ${s.documentUrl(fullPath, docPath)}"
                } else {
                    "[${i + 1}] ${r.text("documentTitle")} ($docPath)"
                }
                "$header\n${r.text("content") ?: ""}"
            }.joinToString("\n\n---\n\n")
        },

        Tool(
            "search_by_keyword",
            "Full-text keyword search across document titles and paths in DocuVault. Each result includes a direct DocuVault URL the user can open in the app (no share link needed).",
            schema(
                "query" to str("The keyword or phrase to search for"),
                "limit" to int("Maximum number of results (default 20)"),
                required = listOf("query")
            )
        ) { s, a ->
            val results = s.api.searchKeyword(a.requiredString("query"), a.optionalInt("limit", 20))
            if (results.isEmpty) "No results found."
            else results.mapIndexed { i, r ->
                val fullPath = r.text("spaceFullPath") ?: ""
                val docPath = r.text("documentPath") ?: ""
                val snippet = r.text("snippet")?.let { "\n  Preview: $it" } ?: ""
                "[${i + 1}] ${r.text("documentTitle")}\n  Space: ${r.text("spaceName")} ($fullPath)\n  Path: $docPath\n  URL: ${s.documentUrl(fullPath, docPath)}\n  Updated: ${r.text("updatedAt")}$snippet"
            }.joinToString("\n\n")
        },

        Tool(
            "list_spaces",
            "List all documentation spaces accessible to the authenticated user, with ID, path and document count.",
            schema()
        ) { s, _ ->
            val spaces = s.api.listSpaces()
            if (spaces.isEmpty()) "No spaces accessible."
            else spaces.joinToString("\n\n") { sp ->
                buildString {
                    append("${sp.text("name")} (${sp.text("type")})\n  ID: ${sp.text("id")}\n  Path: ${sp.text("fullPath")}")
                    sp.text("description")?.takeIf { it.isNotBlank() }?.let { append("\n  Description: $it") }
                    sp.get("documentCount")?.takeIf { it.isNumber }?.let { append("\n  Documents: ${it.asLong()}") }
                }
            }
        },

        Tool(
            "list_documents",
            "List all documents in a documentation space as a full recursive file tree.",
            schema("spaceId" to str("The space (ID, full path or name)"), required = listOf("spaceId"))
        ) { s, a ->
            val tree = s.api.fileTree(s.resolveSpaceId(a.requiredString("spaceId")))
            if (tree.isEmpty) "No documents in this space." else formatTree(tree, 0)
        },

        Tool(
            "list_directory",
            "List the contents of a directory (or the root) in a DocuVault space, one level deep, like running ls on a folder. Use it to explore a space or a subfolder before reading or editing documents.",
            schema(
                "spaceId" to str("The space (ID, full path or name)"),
                "path" to str("Directory path to list (e.g. \"docs/\" or \"guides/api\"). Omit or pass \"/\" for the root."),
                required = listOf("spaceId")
            )
        ) { s, a ->
            val spaceId = s.resolveSpaceId(a.requiredString("spaceId"))
            val tree = s.api.fileTree(spaceId)
            val spaceName = s.spaces.firstOrNull { it.text("id") == spaceId }?.text("name") ?: spaceId
            val normalised = (a.optionalString("path") ?: "").trim('/')
            val entries: List<JsonNode>
            val displayPath: String
            if (normalised.isEmpty()) {
                entries = tree.toList()
                displayPath = "/"
            } else {
                val found = findSubtree(tree.toList(), normalised.split('/'))
                    ?: throw McpToolException("Directory not found: \"$normalised\". Use list_directory without a path to see the root.")
                if (!found.isDirectory()) {
                    throw McpToolException("\"$normalised\" is a file, not a directory. Use read_document to read its content.")
                }
                entries = found.get("children")?.toList() ?: emptyList()
                displayPath = "$normalised/"
            }
            if (entries.isEmpty()) "$displayPath is empty."
            else {
                val dirs = entries.filter { it.isDirectory() }.sortedBy { it.text("name") }
                val files = entries.filter { !it.isDirectory() }.sortedBy { it.text("name") }
                val lines = mutableListOf("Contents of $displayPath in $spaceName", "")
                dirs.forEach { d ->
                    val count = d.get("children")?.size() ?: 0
                    lines += "  ${d.text("name")}/  ($count item${if (count != 1) "s" else ""})"
                }
                files.forEach { f -> lines += "  ${f.text("name")}" }
                lines += ""
                lines += "${dirs.size} director${if (dirs.size != 1) "ies" else "y"}, ${files.size} file${if (files.size != 1) "s" else ""}"
                lines.joinToString("\n")
            }
        },

        Tool(
            "read_document",
            "Read the full content of a document. Returns the content together with a contentHash (SHA-256) to pass to edit_document, insert_in_document or update_document so a concurrent change is detected.",
            schema(
                "spaceId" to str("The space (ID, full path or name)"),
                "path" to str("The file path within the space (e.g. \"docs/getting-started.md\")"),
                required = listOf("spaceId", "path")
            )
        ) { s, a ->
            val spaceId = s.resolveSpaceId(a.requiredString("spaceId"))
            val path = a.requiredString("path")
            if (isBinary(path)) {
                throw McpToolException("\"$path\" is a binary file and cannot be read as text. Open it in DocuVault or use share_document to create a link.")
            }
            val doc = s.api.readDocument(spaceId, path)
            val docPath = doc.text("path") ?: path
            "# ${doc.text("title")}\nPath: $docPath${s.urlLine(spaceId, docPath)}\ncontentHash: ${doc.text("contentHash")}\n\n${doc.text("content") ?: ""}"
        },

        Tool(
            "create_document",
            "Create a new text document in a space (Markdown, HTML, CSS, JS, JSON, YAML, XML, SVG, TXT, CSV). The file lands in the space's working copy; pass auto_commit=true to commit and push it to Git in the same step. Binary files cannot be created here.",
            schema(
                "spaceId" to str("The space (ID, full path or name)"),
                "path" to str("File path within the space (e.g. \"docs/setup-guide.md\")"),
                "content" to str("The full document content"),
                "title" to str("Optional title. If omitted, extracted from the first heading or the filename."),
                "auto_commit" to bool("If true, commit and push to Git after creating (default false)"),
                "commit_message" to str("Git commit message. Used only when auto_commit is true."),
                required = listOf("spaceId", "path", "content")
            )
        ) { s, a ->
            val spaceId = s.resolveSpaceId(a.requiredString("spaceId"))
            val path = a.requiredString("path")
            if (isBinary(path)) throw McpToolException("Binary files (images, PDF, Office) cannot be created through this server. Upload them in DocuVault.")
            val autoCommit = a.optionalBoolean("auto_commit", false)
            val doc = s.api.createDocument(
                spaceId,
                mapOf(
                    "path" to path,
                    "content" to a.requiredString("content"),
                    "title" to a.optionalString("title"),
                    "autoCommit" to autoCommit,
                    "commitMessage" to a.optionalString("commit_message")
                )
            )
            val docPath = doc.text("path") ?: path
            "Document created successfully.\nPath: $docPath\nTitle: ${doc.text("title")}${s.urlLine(spaceId, docPath)}\nHash: ${doc.text("contentHash")}" +
                if (autoCommit) "\nChanges committed and pushed to Git." else "\n\nNote: saved to the working copy only. Pass auto_commit=true (here or on a later edit) or push via the UI to publish it to Git."
        },

        Tool(
            "update_document",
            "Fully replace an existing text document's content. For small changes prefer edit_document or insert_in_document, which leave the rest of the document untouched byte for byte.",
            schema(
                "spaceId" to str("The space (ID, full path or name)"),
                "path" to str("The file path within the space (e.g. \"docs/setup-guide.md\")"),
                "content" to str("The full replacement content"),
                "title" to str("Optional new title. If omitted, extracted from the first heading or the filename."),
                "content_hash" to str("SHA-256 hash from read_document. If provided, the update is rejected when the document changed since you read it."),
                "auto_commit" to bool("If true, commit and push to Git after updating (default false)"),
                "commit_message" to str("Git commit message. Used only when auto_commit is true."),
                required = listOf("spaceId", "path", "content")
            )
        ) { s, a ->
            val spaceId = s.resolveSpaceId(a.requiredString("spaceId"))
            val path = a.requiredString("path")
            if (isBinary(path)) throw McpToolException("Binary files (images, PDF, Office) cannot be replaced through this server. Upload them in DocuVault.")
            a.optionalString("content_hash")?.let { expected ->
                val current = s.api.readDocument(spaceId, path).text("contentHash")
                if (current != expected) {
                    throw McpToolException("Conflict: the document was modified since you last read it.\nCurrent hash: $current\nYour hash:    $expected\n\nRead the document again and reapply your changes.")
                }
            }
            val autoCommit = a.optionalBoolean("auto_commit", false)
            val doc = s.api.updateDocument(
                spaceId, path,
                mapOf(
                    "content" to a.requiredString("content"),
                    "title" to a.optionalString("title"),
                    "autoCommit" to autoCommit,
                    "commitMessage" to a.optionalString("commit_message")
                )
            )
            val docPath = doc.text("path") ?: path
            "Document updated successfully.\nPath: $docPath\nTitle: ${doc.text("title")}${s.urlLine(spaceId, docPath)}\nNew hash: ${doc.text("contentHash")}" +
                if (autoCommit) "\nChanges committed and pushed to Git." else ""
        },

        Tool(
            "edit_document",
            """Edit an existing document with an exact find-and-replace. Only the matched text changes; everything else is preserved byte for byte.

WORKFLOW: call read_document first to see the current content and get the contentHash, then pass that hash here.

RULES:
- old_text must match character for character (whitespace, newlines, indentation included)
- old_text must occur exactly once unless replace_all is true
- If old_text is not found or ambiguous, nothing is changed
- Copy old_text from the read_document output; do not retype it""",
            schema(
                "spaceId" to str("The space (ID, full path or name)"),
                "path" to str("The file path within the space"),
                "old_text" to str("The exact text to find. Include enough context to make it unique."),
                "new_text" to str("The replacement text. Must differ from old_text."),
                "replace_all" to bool("Replace every occurrence instead of requiring a unique match (default false)"),
                "content_hash" to str("SHA-256 hash from read_document (optimistic locking)"),
                "auto_commit" to bool("If true, commit and push to Git after editing (default false)"),
                "commit_message" to str("Git commit message. Used only when auto_commit is true."),
                required = listOf("spaceId", "path", "old_text", "new_text")
            )
        ) { s, a ->
            val autoCommit = a.optionalBoolean("auto_commit", false)
            val result = s.api.patchDocument(
                s.resolveSpaceId(a.requiredString("spaceId")), a.requiredString("path"),
                mapOf(
                    "operations" to listOf(
                        mapOf(
                            "op" to "replace",
                            "oldText" to a.requiredString("old_text"),
                            "newText" to a.requiredString("new_text"),
                            "replaceAll" to a.optionalBoolean("replace_all", false)
                        )
                    ),
                    "contentHash" to a.optionalString("content_hash"),
                    "autoCommit" to autoCommit,
                    "commitMessage" to a.optionalString("commit_message")
                )
            )
            "Document edited successfully.\nPath: ${result.text("path")}\nNew hash: ${result.text("contentHash")}" +
                if (autoCommit) "\nChanges committed and pushed to Git." else ""
        },

        Tool(
            "insert_in_document",
            """Insert new content into an existing document at a specific location without touching the existing content.

WORKFLOW: call read_document first to find the exact anchor text and get the contentHash.

RULES:
- For "after" or "before", the anchor must be an exact match from the document
- Use "end" to append, "start" to prepend
- If the anchor is not found, nothing is changed""",
            schema(
                "spaceId" to str("The space (ID, full path or name)"),
                "path" to str("The file path within the space"),
                "content" to str("The content to insert"),
                "position" to enumStr("Where to insert relative to the anchor; \"start\"/\"end\" for the document boundaries", listOf("after", "before", "start", "end")),
                "anchor" to str("The exact text to insert before/after. Required for \"after\" and \"before\"."),
                "content_hash" to str("SHA-256 hash from read_document (optimistic locking)"),
                "auto_commit" to bool("If true, commit and push to Git after inserting (default false)"),
                "commit_message" to str("Git commit message. Used only when auto_commit is true."),
                required = listOf("spaceId", "path", "content", "position")
            )
        ) { s, a ->
            val position = a.requiredString("position")
            val anchor = a.optionalString("anchor")
            if ((position == "after" || position == "before") && anchor == null) {
                throw McpToolException("Anchor text is required when position is \"$position\".")
            }
            val operation = mutableMapOf<String, Any?>("op" to "insert", "content" to a.requiredString("content"))
            when (position) {
                "start" -> operation["after"] = "START"
                "end" -> operation["after"] = "END"
                "after" -> operation["after"] = anchor
                "before" -> operation["before"] = anchor
                else -> throw McpToolException("position must be one of after, before, start, end")
            }
            val autoCommit = a.optionalBoolean("auto_commit", false)
            val result = s.api.patchDocument(
                s.resolveSpaceId(a.requiredString("spaceId")), a.requiredString("path"),
                mapOf(
                    "operations" to listOf(operation),
                    "contentHash" to a.optionalString("content_hash"),
                    "autoCommit" to autoCommit,
                    "commitMessage" to a.optionalString("commit_message")
                )
            )
            "Content inserted successfully.\nPath: ${result.text("path")}\nNew hash: ${result.text("contentHash")}" +
                if (autoCommit) "\nChanges committed and pushed to Git." else ""
        },

        Tool(
            "share_document",
            "Create a public share link for a file or folder in a space. Anyone with the URL can view the content (optionally behind a password, optionally expiring).",
            schema(
                "spaceId" to str("The space (ID, full path or name)"),
                "path" to str("The file or folder path within the space (e.g. \"docs/setup-guide.md\" or \"docs/\")"),
                "shareType" to enumStr("Share a single file (FILE, default) or an entire folder tree (FOLDER)", listOf("FILE", "FOLDER")),
                "password" to str("Optional password viewers must enter"),
                "expiresInDays" to int("Optional number of days until the link expires"),
                required = listOf("spaceId", "path")
            )
        ) { s, a ->
            val link = s.api.createShareLink(
                s.resolveSpaceId(a.requiredString("spaceId")),
                mapOf(
                    "filePath" to a.requiredString("path"),
                    "shareType" to (a.optionalString("shareType") ?: "FILE"),
                    "password" to a.optionalString("password"),
                    "expiresInDays" to a.get("expiresInDays")?.takeIf { it.isNumber }?.asInt()
                )
            )
            listOf(
                "Share link created successfully.",
                "",
                "URL: $baseUrl/share/${link.text("token")}",
                "Type: ${link.text("shareType")}",
                "Path: ${link.text("filePath")}",
                "Password protected: ${if (link.get("hasPassword")?.asBoolean() == true) "Yes" else "No"}",
                "Expires: ${link.text("expiresAt") ?: "Never"}"
            ).joinToString("\n")
        },

        Tool(
            "list_space_state",
            "List the DocuVault state keys of a space. State buckets are JSON objects persisted by HTML files hosted in DocuVault via the DocuVault State Library (interactive dashboards, forms, checklists). Use get_space_state to read one.",
            schema("spaceId" to str("The space (ID, full path or name)"), required = listOf("spaceId"))
        ) { s, a ->
            val entries = s.api.listState(s.resolveSpaceId(a.requiredString("spaceId")))
            if (entries.isEmpty) "No state keys in this space."
            else "${entries.size()} state key${if (entries.size() != 1) "s" else ""}:\n" +
                entries.joinToString("\n") { "- ${it.text("key")} (updated ${it.text("updatedAt")})" }
        },

        Tool(
            "get_space_state",
            "Read a DocuVault state bucket: the JSON an HTML file in the space persists via the DocuVault State Library. The key matches the \"key\" in the file's DocuVaultState.init() call.",
            schema(
                "spaceId" to str("The space (ID, full path or name)"),
                "key" to str("The state key (as used in DocuVaultState.init)"),
                required = listOf("spaceId", "key")
            )
        ) { s, a ->
            val entry = s.api.getState(s.resolveSpaceId(a.requiredString("spaceId")), a.requiredString("key"))
            "Key: ${entry.text("key")}\nUpdated: ${entry.text("updatedAt")}\n\n${entry.text("value") ?: ""}"
        },

        Tool(
            "set_space_state",
            "Write a DocuVault state bucket (full replace). The value must be a JSON object serialised as a string, the same shape the owning HTML file saves. Read the current value with get_space_state first and merge; a partial value wipes the rest of the bucket. Requires edit access.",
            schema(
                "spaceId" to str("The space (ID, full path or name)"),
                "key" to str("The state key (as used in DocuVaultState.init)"),
                "value" to str("The full state as a JSON object string, e.g. '{\"assignee\":\"Anna\"}'"),
                required = listOf("spaceId", "key", "value")
            )
        ) { s, a ->
            val value = a.requiredString("value")
            val parsed = runCatching { objectMapper.readTree(value) }.getOrNull()
                ?: throw McpToolException("The value is not valid JSON. Pass the full state as a serialised JSON object.")
            if (!parsed.isObject) throw McpToolException("The value must be a JSON object (e.g. {\"field\": \"data\"}), not an array or primitive.")
            val entry = s.api.putState(s.resolveSpaceId(a.requiredString("spaceId")), a.requiredString("key"), value)
            "State saved.\nKey: ${entry.text("key")}\nUpdated: ${entry.text("updatedAt")}"
        }
    )

    private val toolsByName = tools.associateBy { it.name }

    // ---- Helpers ---------------------------------------------------------------------

    private fun buildSpaceCatalog(spaces: List<JsonNode>): String {
        val repoSpaces = spaces.filter { it.text("type") == "REPOSITORY" }
        if (repoSpaces.isEmpty()) return ""
        val lines = repoSpaces.map { sp ->
            val docs = sp.get("documentCount")?.takeIf { it.isNumber }?.let { " (${it.asLong()} docs)" } ?: ""
            val desc = sp.text("description")?.takeIf { it.isNotBlank() }?.let { " - $it" } ?: ""
            "  - ${sp.text("name")}$docs$desc [spaceId: ${sp.text("id")}]"
        }
        return "\n\nAvailable documentation spaces:\n${lines.joinToString("\n")}\n\nWhen the user asks about any of these projects or related topics, use this tool to find relevant documentation."
    }

    private fun isBinary(path: String): Boolean = path.substringAfterLast('.', "").lowercase() in BINARY_EXTENSIONS

    private fun encodePath(path: String): String =
        path.split('/').joinToString("/") { UriUtils.encodePathSegment(it, StandardCharsets.UTF_8) }

    private fun findSubtree(entries: List<JsonNode>, segments: List<String>): JsonNode? {
        val match = entries.firstOrNull { it.text("name") == segments.first() } ?: return null
        if (segments.size == 1) return match
        return findSubtree(match.get("children")?.toList() ?: emptyList(), segments.drop(1))
    }

    private fun formatTree(entries: JsonNode, depth: Int): String =
        entries.joinToString("\n") { entry ->
            val indent = "  ".repeat(depth)
            val suffix = if (entry.isDirectory()) "/" else ""
            val children = entry.get("children")
            val line = "$indent${entry.text("name")}$suffix"
            if (children != null && children.size() > 0) line + "\n" + formatTree(children, depth + 1) else line
        }

    private fun JsonNode.text(field: String): String? = get(field)?.takeIf { !it.isNull }?.asText()

    /** The tree endpoint flags folders with `isDirectory`, there is no `type` field. */
    private fun JsonNode.isDirectory(): Boolean = get("isDirectory")?.asBoolean() == true

    private fun ObjectNode.requiredString(name: String): String =
        get(name)?.takeIf { !it.isNull }?.asText()?.takeIf { it.isNotBlank() }
            ?: throw McpToolException("Missing required argument: $name")

    private fun ObjectNode.optionalString(name: String): String? =
        get(name)?.takeIf { !it.isNull }?.asText()?.takeIf { it.isNotEmpty() }

    private fun ObjectNode.optionalInt(name: String, default: Int): Int =
        get(name)?.takeIf { it.isNumber }?.asInt() ?: default

    private fun ObjectNode.optionalBoolean(name: String, default: Boolean): Boolean =
        get(name)?.takeIf { it.isBoolean }?.asBoolean() ?: default

    // JSON Schema builders
    private fun schema(vararg properties: Pair<String, Map<String, Any>>, required: List<String> = emptyList()): Map<String, Any> =
        linkedMapOf("type" to "object", "properties" to properties.toMap(LinkedHashMap()), "required" to required)

    private fun str(description: String): Map<String, Any> = mapOf("type" to "string", "description" to description)
    private fun int(description: String): Map<String, Any> = mapOf("type" to "integer", "description" to description)
    private fun bool(description: String): Map<String, Any> = mapOf("type" to "boolean", "description" to description)
    private fun enumStr(description: String, values: List<String>): Map<String, Any> =
        mapOf("type" to "string", "enum" to values, "description" to description)
}
