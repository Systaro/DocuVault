package com.docuvault.service.tools

import com.docuvault.service.DocumentPatchService
import com.docuvault.service.PatchOperation
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ObjectNode
import org.springframework.beans.factory.annotation.Value
import org.springframework.http.client.JdkClientHttpRequestFactory
import org.springframework.stereotype.Service
import org.springframework.web.client.RestClient
import java.util.*

/**
 * Every tool DocuVault offers a model, in one place. MCP clients get the full
 * set across all their spaces; the in-app assistant gets the reading tools plus
 * its own writing tools, pinned to one conversation's space.
 *
 * Handlers call the REST API over loopback with the caller's credential (see
 * [LoopbackApi]), so neither caller can do anything its user could not do by hand.
 */
@Service
class ToolRegistry(
    private val objectMapper: ObjectMapper,
    private val documentPatchService: DocumentPatchService,
    @Value("\${server.port}") serverPort: Int,
    @Value("\${server.servlet.context-path:}") contextPath: String,
    @Value("\${app.public-url}") publicUrl: String
) {
    enum class Audience { MCP, CONVERSATION, BOTH }

    class ToolDef(
        val name: String,
        val description: String,
        val inputSchema: Map<String, Any>,
        val audience: Audience = Audience.MCP,
        val handler: (ToolSession, ObjectNode) -> String
    )

    companion object {
        private val BINARY_EXTENSIONS = setOf(
            "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "tiff", "tif",
            "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf"
        )
        private const val CONVERSATION_SPACE =
            "Optional: the space (ID, full path or name). Defaults to the conversation's space; " +
                "required only when the conversation covers several repositories."
        private const val CONTEXT_LINES = 3
    }

    private val publicBase = publicUrl.trimEnd('/')
    private val loopbackBase = "http://127.0.0.1:$serverPort${contextPath.trimEnd('/')}"

    // The JDK client: the default HttpURLConnection factory cannot send PATCH.
    private val restClient = RestClient.builder().requestFactory(JdkClientHttpRequestFactory()).build()

    fun session(credential: ToolCredential, scope: ToolScope): ToolSession =
        ToolSession(LoopbackApi(restClient, objectMapper, loopbackBase, credential), scope, publicBase)

    fun mcpTools(): List<ToolDef> = tools.filter { it.audience != Audience.CONVERSATION }

    fun mcpTool(name: String): ToolDef? = mcpTools().firstOrNull { it.name == name }

    /** The assistant's tools, with the space argument made optional since a conversation already has one. */
    fun conversationTools(): List<ToolDef> = conversationToolList

    fun conversationTool(name: String): ToolDef? = conversationToolList.firstOrNull { it.name == name }

    fun spaceCatalog(session: ToolSession): String = buildSpaceCatalog(session.spaces)

    /**
     * A repo-relative path, or null if it tries to escape the space or names
     * nothing. Mirrors the upload endpoint's sanitising so the assistant cannot
     * reach anywhere a person could not.
     */
    internal fun sanitizeDocumentPath(raw: String): String? {
        val cleaned = raw.replace('\\', '/')
            .split('/')
            .map { it.trim() }
            .filter { it.isNotEmpty() && it != "." && it != ".." && !it.endsWith(":") }
            .joinToString("/")
        if (cleaned.isBlank() || cleaned.startsWith(".")) return null
        // Default to Markdown rather than writing an extensionless file.
        return if (cleaned.substringAfterLast('/').contains('.')) cleaned else "$cleaned.md"
    }

    /**
     * The proposal for replacing [oldText] with [newText] in [content], or the
     * reason it cannot be applied. Uses the same matching as the PATCH endpoint
     * that will later apply it, so a proposal that is shown can also be applied.
     */
    internal fun buildProposal(
        spaceId: String,
        path: String,
        content: String,
        oldText: String,
        newText: String,
        summary: String
    ): ToolProposal {
        val result = documentPatchService.apply(content, listOf(PatchOperation(op = "replace", oldText = oldText, newText = newText)))
        if (result is DocumentPatchService.Result.Failed) {
            throw ToolException("Cannot propose this edit: ${result.message}")
        }
        val start = content.indexOf(oldText)
        val before = content.substring(0, start).split('\n').dropLast(1).takeLast(CONTEXT_LINES).joinToString("\n")
        val after = content.substring(start + oldText.length).split('\n').drop(1).take(CONTEXT_LINES).joinToString("\n")
        return ToolProposal(UUID.randomUUID(), spaceId, path, summary, oldText, newText, before, after)
    }

    private fun sharedTool(
        name: String,
        description: String,
        inputSchema: Map<String, Any>,
        handler: (ToolSession, ObjectNode) -> String
    ) = ToolDef(name, description, inputSchema, Audience.BOTH, handler)

    // ---- Tools -----------------------------------------------------------------------

    private val tools: List<ToolDef> = listOf(
        sharedTool(
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
                ?: (s.scope as? ToolScope.Conversation)?.spaceId
            val results = s.api.searchSemantic(mapOf("query" to query, "spaceId" to spaceId, "limit" to limit))
            if (results.isEmpty) "No results found."
            else results.mapIndexed { i, r ->
                val fullPath = r.text("spaceFullPath")
                val docPath = r.text("documentPath") ?: ""
                r.text("spaceId")?.takeIf { docPath.isNotEmpty() }?.let { s.effects.found(ToolSource(it, docPath, r.text("documentTitle"))) }
                val header = if (fullPath != null) {
                    "[${i + 1}] ${r.text("documentTitle")} ($fullPath/$docPath)\nURL: ${s.documentUrl(fullPath, docPath)}"
                } else {
                    "[${i + 1}] ${r.text("documentTitle")} ($docPath)"
                }
                "$header\n${r.text("content") ?: ""}"
            }.joinToString("\n\n---\n\n")
        },

        sharedTool(
            "search_by_keyword",
            "Full-text keyword search across document titles and paths in DocuVault. Each result includes a direct DocuVault URL the user can open in the app (no share link needed).",
            schema(
                "query" to str("The keyword or phrase to search for"),
                "limit" to int("Maximum number of results (default 20)"),
                required = listOf("query")
            )
        ) { s, a ->
            val results = s.api.searchKeyword(a.requiredString("query"), a.optionalInt("limit", 20))
                .filter { r -> (s.scope as? ToolScope.Conversation)?.repositoryIds?.contains(r.text("spaceId")) ?: true }
            if (results.isEmpty()) "No results found."
            else results.mapIndexed { i, r ->
                val fullPath = r.text("spaceFullPath") ?: ""
                val docPath = r.text("documentPath") ?: ""
                r.text("spaceId")?.takeIf { docPath.isNotEmpty() }?.let { s.effects.found(ToolSource(it, docPath, r.text("documentTitle"))) }
                val snippet = r.text("snippet")?.let { "\n  Preview: $it" } ?: ""
                "[${i + 1}] ${r.text("documentTitle")}\n  Space: ${r.text("spaceName")} ($fullPath)\n  Path: $docPath\n  URL: ${s.documentUrl(fullPath, docPath)}\n  Updated: ${r.text("updatedAt")}$snippet"
            }.joinToString("\n\n")
        },

        ToolDef(
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

        sharedTool(
            "list_documents",
            "List all documents in a documentation space as a full recursive file tree.",
            schema("spaceId" to str("The space (ID, full path or name)"), required = listOf("spaceId"))
        ) { s, a ->
            val tree = s.api.fileTree(s.resolveSpaceId(a.optionalString("spaceId")))
            if (tree.isEmpty) "No documents in this space." else formatTree(tree, 0)
        },

        sharedTool(
            "list_directory",
            "List the contents of a directory (or the root) in a DocuVault space, one level deep, like running ls on a folder. Use it to explore a space or a subfolder before reading or editing documents.",
            schema(
                "spaceId" to str("The space (ID, full path or name)"),
                "path" to str("Directory path to list (e.g. \"docs/\" or \"guides/api\"). Omit or pass \"/\" for the root."),
                required = listOf("spaceId")
            )
        ) { s, a ->
            val spaceId = s.resolveSpaceId(a.optionalString("spaceId"))
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
                    ?: throw ToolException("Directory not found: \"$normalised\". Use list_directory without a path to see the root.")
                if (!found.isDirectory()) {
                    throw ToolException("\"$normalised\" is a file, not a directory. Use read_document to read its content.")
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

        sharedTool(
            "read_document",
            "Read the full content of a document. Returns the content together with a contentHash (SHA-256) to pass to edit_document, insert_in_document or update_document so a concurrent change is detected.",
            schema(
                "spaceId" to str("The space (ID, full path or name)"),
                "path" to str("The file path within the space (e.g. \"docs/getting-started.md\")"),
                required = listOf("spaceId", "path")
            )
        ) { s, a ->
            val spaceId = s.resolveSpaceId(a.optionalString("spaceId"))
            val path = a.requiredString("path")
            if (isBinary(path)) {
                throw ToolException("\"$path\" is a binary file and cannot be read as text. Use download_file to fetch it, or share_document to create a link.")
            }
            val doc = s.api.readDocument(spaceId, path)
            val docPath = doc.text("path") ?: path
            s.effects.read(ToolSource(spaceId, docPath, doc.text("title")))
            "# ${doc.text("title")}\nPath: $docPath${s.urlLine(spaceId, docPath)}\ncontentHash: ${doc.text("contentHash")}\n\n${doc.text("content") ?: ""}"
        },

        ToolDef(
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
            val spaceId = s.resolveSpaceId(a.optionalString("spaceId"))
            val path = a.requiredString("path")
            if (isBinary(path)) throw ToolException("Binary files (images, PDF, Office) need upload_file, which transfers the bytes directly instead of through the conversation.")
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

        ToolDef(
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
            val spaceId = s.resolveSpaceId(a.optionalString("spaceId"))
            val path = a.requiredString("path")
            if (isBinary(path)) throw ToolException("Binary files (images, PDF, Office) need upload_file, which transfers the bytes directly instead of through the conversation.")
            a.optionalString("content_hash")?.let { expected ->
                val current = s.api.readDocument(spaceId, path).text("contentHash")
                if (current != expected) {
                    throw ToolException("Conflict: the document was modified since you last read it.\nCurrent hash: $current\nYour hash:    $expected\n\nRead the document again and reapply your changes.")
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

        ToolDef(
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
                s.resolveSpaceId(a.optionalString("spaceId")), a.requiredString("path"),
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

        ToolDef(
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
                throw ToolException("Anchor text is required when position is \"$position\".")
            }
            val operation = mutableMapOf<String, Any?>("op" to "insert", "content" to a.requiredString("content"))
            when (position) {
                "start" -> operation["after"] = "START"
                "end" -> operation["after"] = "END"
                "after" -> operation["after"] = anchor
                "before" -> operation["before"] = anchor
                else -> throw ToolException("position must be one of after, before, start, end")
            }
            val autoCommit = a.optionalBoolean("auto_commit", false)
            val result = s.api.patchDocument(
                s.resolveSpaceId(a.optionalString("spaceId")), a.requiredString("path"),
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

        ToolDef(
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
                s.resolveSpaceId(a.optionalString("spaceId")),
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
                "URL: $publicBase/share/${link.text("token")}",
                "Type: ${link.text("shareType")}",
                "Path: ${link.text("filePath")}",
                "Password protected: ${if (link.get("hasPassword")?.asBoolean() == true) "Yes" else "No"}",
                "Expires: ${link.text("expiresAt") ?: "Never"}"
            ).joinToString("\n")
        },

        ToolDef(
            "upload_file",
            """Upload a local file (image, PDF, Office document, or any text file) into a space. Two steps: this tool returns a one-time upload URL, then you run the printed curl command in the shell so the bytes go from disk to DocuVault directly without passing through the conversation. The file is committed to Git right away and an existing file at that path is replaced.""",
            schema(
                "spaceId" to str("The space (ID, full path or name)"),
                "path" to str("Target path within the space including the filename (e.g. \"assets/diagram.png\")"),
                "localPath" to str("Absolute path of the local file, only used to pre-fill the curl command"),
                required = listOf("spaceId", "path")
            )
        ) { s, a ->
            val ticket = s.api.issueTransfer(s.resolveSpaceId(a.optionalString("spaceId")), a.requiredString("path"), "upload")
            val local = a.optionalString("localPath") ?: "/absolute/path/to/local-file"
            """Upload ticket ready (valid ${ticket.get("expiresInSeconds")?.asLong()?.div(60)} minutes, single use). Run ONE of these in the shell:

macOS / Linux / Git Bash:
curl -sS -T "$local" -H "Content-Type: application/octet-stream" "${ticket.text("url")}"

Windows PowerShell (plain "curl" there is an alias for Invoke-WebRequest; curl.exe also works):
Invoke-WebRequest -Method Put -InFile "$local" -ContentType "application/octet-stream" -Uri "${ticket.text("url")}" | Select-Object -ExpandProperty Content

It answers with JSON (path, name, size, url) once the file is stored and committed to ${ticket.text("path")}. If it answers with an error, read the message: a 404 means the ticket expired or was already used, so call upload_file again."""
        },

        ToolDef(
            "download_file",
            """Download a file from a space to the local disk, including binary files. Two steps: this tool returns a one-time download URL, then you run the printed curl command in the shell. For reading a text document's content, read_document is simpler.""",
            schema(
                "spaceId" to str("The space (ID, full path or name)"),
                "path" to str("The file path within the space"),
                "saveTo" to str("Absolute local path to save to, only used to pre-fill the curl command"),
                required = listOf("spaceId", "path")
            )
        ) { s, a ->
            val path = a.requiredString("path")
            val ticket = s.api.issueTransfer(s.resolveSpaceId(a.optionalString("spaceId")), path, "download")
            val local = a.optionalString("saveTo") ?: "/absolute/path/to/${path.substringAfterLast('/')}"
            """Download ticket ready (valid ${ticket.get("expiresInSeconds")?.asLong()?.div(60)} minutes, single use). Run ONE of these in the shell:

macOS / Linux / Git Bash:
curl -sS -f -o "$local" "${ticket.text("url")}"

Windows PowerShell:
Invoke-WebRequest -Uri "${ticket.text("url")}" -OutFile "$local"

A 404 means the ticket expired or was already used; call download_file again."""
        },

        ToolDef(
            "list_space_state",
            "List the DocuVault state keys of a space. State buckets are JSON objects persisted by HTML files hosted in DocuVault via the DocuVault State Library (interactive dashboards, forms, checklists). Use get_space_state to read one.",
            schema("spaceId" to str("The space (ID, full path or name)"), required = listOf("spaceId"))
        ) { s, a ->
            val entries = s.api.listState(s.resolveSpaceId(a.optionalString("spaceId")))
            if (entries.isEmpty) "No state keys in this space."
            else "${entries.size()} state key${if (entries.size() != 1) "s" else ""}:\n" +
                entries.joinToString("\n") { "- ${it.text("key")} (updated ${it.text("updatedAt")})" }
        },

        ToolDef(
            "get_space_state",
            "Read a DocuVault state bucket: the JSON an HTML file in the space persists via the DocuVault State Library. The key matches the \"key\" in the file's DocuVaultState.init() call.",
            schema(
                "spaceId" to str("The space (ID, full path or name)"),
                "key" to str("The state key (as used in DocuVaultState.init)"),
                required = listOf("spaceId", "key")
            )
        ) { s, a ->
            val entry = s.api.getState(s.resolveSpaceId(a.optionalString("spaceId")), a.requiredString("key"))
            "Key: ${entry.text("key")}\nUpdated: ${entry.text("updatedAt")}\n\n${entry.text("value") ?: ""}"
        },

        ToolDef(
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
                ?: throw ToolException("The value is not valid JSON. Pass the full state as a serialised JSON object.")
            if (!parsed.isObject) throw ToolException("The value must be a JSON object (e.g. {\"field\": \"data\"}), not an array or primitive.")
            val entry = s.api.putState(s.resolveSpaceId(a.optionalString("spaceId")), a.requiredString("key"), value)
            "State saved.\nKey: ${entry.text("key")}\nUpdated: ${entry.text("updatedAt")}"
        },

        // ---- Tasks ------------------------------------------------------------------

        sharedTool(
            "list_tasks",
            "List tasks. With assigned_to_me, the open tasks assigned to the user and suggestions waiting for them to confirm, across spaces. Otherwise the tasks of one space, optionally filtered by status.",
            schema(
                "spaceId" to str("The space (ID, full path or name). Not needed with assigned_to_me."),
                "assigned_to_me" to bool("List the user's own tasks instead of a space's (default false)"),
                "status" to enumStr("Only tasks with this status", listOf("OPEN", "IN_PROGRESS", "DONE")),
                required = listOf()
            )
        ) { s, a ->
            val scope = s.scope as? ToolScope.Conversation
            if (a.optionalBoolean("assigned_to_me", false)) {
                val mine = s.api.myTasks()
                val inScope = { t: JsonNode -> scope == null || t.text("spaceId") in scope.repositoryIds }
                val assigned = mine.get("assigned").filter(inScope)
                val toConfirm = mine.get("toConfirm").filter(inScope)
                buildString {
                    append(if (assigned.isEmpty()) "No open tasks are assigned to you." else "Assigned to you:\n" + assigned.joinToString("\n") { formatTask(it) })
                    if (toConfirm.isNotEmpty()) append("\n\nSuggested, waiting for you to confirm:\n" + toConfirm.joinToString("\n") { formatTask(it) })
                }
            } else {
                val spaceId = s.resolveSpaceId(a.optionalString("spaceId"))
                val tasks = s.api.spaceTasks(spaceId, a.optionalString("status")).toList()
                if (tasks.isEmpty()) "No tasks." else tasks.joinToString("\n") { formatTask(it) }
            }
        },

        sharedTool(
            "create_task",
            "Create a task in a space. Use it when the user asks for a task or a to-do. The assignee must be a member of the space; give their name or email.",
            schema(
                "spaceId" to str("The space (ID, full path or name)"),
                "title" to str("What has to be done, as a short imperative sentence"),
                "description" to str("Optional details"),
                "assignee" to str("Optional: name or email of the member who should do it"),
                "due_date" to str("Optional due date, YYYY-MM-DD"),
                "priority" to enumStr("Optional priority", listOf("LOW", "NORMAL", "HIGH")),
                required = listOf("spaceId", "title")
            )
        ) { s, a ->
            val spaceId = s.resolveSpaceId(a.optionalString("spaceId"))
            val scope = s.scope as? ToolScope.Conversation
            val task = s.api.createTask(
                spaceId,
                mapOf(
                    "title" to a.requiredString("title"),
                    "description" to a.optionalString("description"),
                    "assigneeId" to a.optionalString("assignee")?.let { resolveAssignee(s, spaceId, it) },
                    "dueDate" to a.optionalString("due_date")?.let { parseDate(it) },
                    "priority" to a.optionalString("priority"),
                    "sourceType" to scope?.conversationId?.let { "CONVERSATION" },
                    "sourceId" to scope?.conversationId,
                    "sourceLabel" to scope?.conversationId?.let { "Assistant conversation" }
                )
            )
            s.effects.createdTasks += ToolTask(task.text("id")!!, spaceId, task.text("title") ?: "")
            "Created the task.\n${formatTask(task)}"
        },

        sharedTool(
            "update_task",
            "Change a task: its status (e.g. mark it done), title, assignee or due date. Get the task id from list_tasks.",
            schema(
                "task_id" to str("The task id"),
                "status" to enumStr("New status", listOf("OPEN", "IN_PROGRESS", "DONE")),
                "title" to str("New title"),
                "assignee" to str("Name or email of the new assignee"),
                "due_date" to str("New due date, YYYY-MM-DD"),
                "clear_assignee" to bool("Remove the assignee"),
                "clear_due_date" to bool("Remove the due date"),
                required = listOf("task_id")
            )
        ) { s, a ->
            val current = s.api.getTask(a.requiredString("task_id"))
            val spaceId = current.text("spaceId")!!
            val scope = s.scope as? ToolScope.Conversation
            if (scope != null && spaceId !in scope.repositoryIds) {
                throw ToolException("That task is outside this conversation, which is limited to ${scope.spaceName}.")
            }
            val task = s.api.patchTask(
                current.text("id")!!,
                mapOf(
                    "status" to a.optionalString("status"),
                    "title" to a.optionalString("title"),
                    "assigneeId" to a.optionalString("assignee")?.let { resolveAssignee(s, spaceId, it) },
                    "dueDate" to a.optionalString("due_date")?.let { parseDate(it) },
                    "clearAssignee" to a.optionalBoolean("clear_assignee", false),
                    "clearDueDate" to a.optionalBoolean("clear_due_date", false)
                )
            )
            "Updated the task.\n${formatTask(task)}"
        },

        // ---- Conversation only: the assistant writes new documents directly and
        // proposes changes to existing ones for the user to apply.

        ToolDef(
            "create_document",
            "Create a new document in the conversation's space and commit it. Use this whenever the user asks for a new document; never claim to have created one without calling it. Fails if the path already exists: existing documents are changed with propose_edit.",
            schema(
                "spaceId" to str(CONVERSATION_SPACE),
                "path" to str("Repository-relative path including folders and extension, e.g. 'guides/setup.md'. Use an existing folder where one fits."),
                "title" to str("Human-readable document title."),
                "content" to str("Full document body in Markdown."),
                required = listOf("path", "content")
            ),
            Audience.CONVERSATION
        ) { s, a ->
            val spaceId = s.resolveSpaceId(a.optionalString("spaceId"))
            val rawPath = a.optionalString("path").orEmpty()
            val path = sanitizeDocumentPath(rawPath)
                ?: throw ToolException("Refused: '$rawPath' is not a valid path inside this space.")
            if (isBinary(path)) throw ToolException("Refused: binary files cannot be created here.")
            val content = a.optionalString("content").orEmpty()
            if (content.isBlank()) throw ToolException("Refused: the document content was empty.")
            if (s.api.readDocumentOrNull(spaceId, path) != null) {
                throw ToolException("Refused: '$path' already exists. Use propose_edit to change it, or choose a different name.")
            }
            val doc = s.api.createDocument(
                spaceId,
                mapOf(
                    "path" to path,
                    "content" to content,
                    "title" to a.optionalString("title"),
                    "autoCommit" to true,
                    "commitMessage" to "Create $path via AI assistant"
                )
            )
            val docPath = doc.text("path") ?: path
            val source = ToolSource(spaceId, docPath, doc.text("title"))
            s.effects.created += source
            s.effects.read(source)
            "Created '$docPath' and committed it.${s.urlLine(spaceId, docPath)}"
        },

        ToolDef(
            "propose_edit",
            """Propose a change to an existing document. Nothing is written: the user sees the change and applies or discards it.

WORKFLOW: call read_document first, then copy old_text exactly from its content (whitespace and line breaks included). old_text must occur exactly once. One call per coherent change; call again for another.""",
            schema(
                "spaceId" to str(CONVERSATION_SPACE),
                "path" to str("The document path within the space"),
                "old_text" to str("The exact text to replace, copied from read_document. Include enough context to be unique."),
                "new_text" to str("The replacement text. May be empty to delete old_text."),
                "summary" to str("One short sentence describing the change, shown to the user."),
                required = listOf("path", "old_text", "new_text", "summary")
            ),
            Audience.CONVERSATION
        ) { s, a ->
            val spaceId = s.resolveSpaceId(a.optionalString("spaceId"))
            val path = a.requiredString("path")
            val oldText = a.requiredString("old_text")
            val newText = a.get("new_text")?.takeIf { !it.isNull }?.asText() ?: ""
            if (oldText == newText) throw ToolException("old_text and new_text are identical, so there is nothing to change.")
            val doc = s.api.readDocumentOrNull(spaceId, path)
                ?: throw ToolException("'$path' does not exist. Use create_document for a new document.")
            val docPath = doc.text("path") ?: path
            val proposal = buildProposal(spaceId, docPath, doc.text("content") ?: "", oldText, newText, a.requiredString("summary"))
            s.effects.proposals += proposal
            s.effects.read(ToolSource(spaceId, docPath, doc.text("title")))
            "Proposed a change to '$docPath'. It is NOT applied: the user reviews it and applies or discards it. Tell them it is waiting for them."
        },

        ToolDef(
            "save_attachment",
            "Keep a file the user attached to this conversation (a photo, scan, PDF or text file) in the space, as the original file, and commit it. Only when the user asks to keep or file it. To keep a transcription or summary instead, use create_document.",
            schema(
                "attachment_id" to str("The attachment_id listed for the file"),
                "spaceId" to str(CONVERSATION_SPACE),
                "path" to str("Target path including the file name, e.g. 'notes/2026-09-18-whiteboard.jpg'. Defaults to attachments/<file name>."),
                required = listOf("attachment_id")
            ),
            Audience.CONVERSATION
        ) { s, a ->
            val spaceId = s.resolveSpaceId(a.optionalString("spaceId"))
            val saved = s.api.saveAttachment(a.requiredString("attachment_id"), mapOf("spaceId" to spaceId, "path" to a.optionalString("path")))
            val path = saved.text("path")!!
            val source = ToolSource(spaceId, path, saved.text("name"))
            s.effects.created += source
            "Saved '$path' in the space and committed it.${s.urlLine(spaceId, path)}"
        },
    )

    private val conversationToolList: List<ToolDef> = tools
        .filter { it.audience != Audience.MCP }
        .map { tool ->
            if (tool.audience == Audience.CONVERSATION) tool
            else ToolDef(tool.name, tool.description, optionalSpace(tool.inputSchema), tool.audience, tool.handler)
        }

    @Suppress("UNCHECKED_CAST")
    private fun optionalSpace(schema: Map<String, Any>): Map<String, Any> {
        val properties = LinkedHashMap(schema["properties"] as Map<String, Any>)
        if (!properties.containsKey("spaceId")) return schema
        properties["spaceId"] = str(CONVERSATION_SPACE)
        val required = (schema["required"] as List<String>).filter { it != "spaceId" }
        return linkedMapOf("type" to "object", "properties" to properties, "required" to required)
    }

    // ---- Helpers ---------------------------------------------------------------------

    private fun formatTask(task: JsonNode): String = buildString {
        append("- [${task.text("status")}] ${task.text("title")} (id: ${task.text("id")}; space: ${task.text("spaceName")}")
        task.get("assignee")?.takeIf { !it.isNull }?.let { append("; assignee: ${it.text("name")}") }
        task.text("dueDate")?.let { append("; due: $it") }
        task.text("priority")?.let { append("; priority: $it") }
        append(")")
    }

    /** A member by exact name or email, or by a first name only one member has. */
    private fun resolveAssignee(s: ToolSession, spaceId: String, wanted: String): String {
        val members = s.api.taskAssignees(spaceId).toList()
        val needle = wanted.trim().lowercase()
        val match = members.firstOrNull { it.text("name")?.lowercase() == needle || it.text("email")?.lowercase() == needle }
            ?: members.filter { it.text("name")?.substringBefore(' ')?.lowercase() == needle }.singleOrNull()
        return match?.text("id") ?: throw ToolException(
            "No single member of this space matches \"$wanted\". Members: " +
                members.joinToString(", ") { "${it.text("name")} <${it.text("email")}>" }
        )
    }

    private fun parseDate(value: String): String =
        runCatching { java.time.LocalDate.parse(value.trim()).toString() }.getOrElse {
            throw ToolException("\"$value\" is not a date in the form YYYY-MM-DD.")
        }

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

    /** The tree endpoint flags folders with `isDirectory`, there is no `type` field. */
    private fun JsonNode.isDirectory(): Boolean = get("isDirectory")?.asBoolean() == true

    private fun ObjectNode.requiredString(name: String): String =
        get(name)?.takeIf { !it.isNull }?.asText()?.takeIf { it.isNotBlank() }
            ?: throw ToolException("Missing required argument: $name")

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
