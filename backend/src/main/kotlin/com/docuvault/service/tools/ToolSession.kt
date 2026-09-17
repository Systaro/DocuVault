package com.docuvault.service.tools

import com.fasterxml.jackson.databind.JsonNode
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.HttpHeaders
import org.springframework.web.util.UriUtils
import java.nio.charset.StandardCharsets
import java.util.*

/**
 * The credential a tool call replays against the REST API: the MCP client's
 * bearer token, or the browser session cookie of someone using the in-app
 * assistant. Either way permissions are checked by the controllers, once.
 */
data class ToolCredential(val header: String, val value: String) {
    companion object {
        fun authorization(value: String) = ToolCredential(HttpHeaders.AUTHORIZATION, value)

        /** Native apps send a bearer token, the web app its session cookie. */
        fun of(request: HttpServletRequest): ToolCredential? =
            request.getHeader(HttpHeaders.AUTHORIZATION)?.let { authorization(it) }
                ?: request.getHeader(HttpHeaders.COOKIE)?.let { ToolCredential(HttpHeaders.COOKIE, it) }
    }
}

/**
 * Where tools may reach. An MCP client works across every space its credential
 * can read; a conversation is pinned to one space, and for a group to the
 * repositories inside it that the user can read.
 */
sealed interface ToolScope {
    data object Unrestricted : ToolScope

    data class Conversation(
        val spaceId: String,
        val spaceName: String,
        val repositoryIds: Set<String>,
        /** Recorded as the source of tasks the assistant creates. */
        val conversationId: String? = null
    ) : ToolScope {
        /** A single repository needs no space argument; a group has to be told which one. */
        val defaultSpaceId: String? get() = repositoryIds.singleOrNull()
    }
}

/** A tool ran and failed; the message goes back to the model so it can react. */
open class ToolException(message: String) : RuntimeException(message)

data class ToolSource(val spaceId: String, val path: String, val title: String?)

data class ToolTask(val id: String, val spaceId: String, val title: String)

data class ToolProposal(
    val id: UUID,
    val spaceId: String,
    val path: String,
    val summary: String,
    val oldText: String,
    val newText: String,
    val contextBefore: String,
    val contextAfter: String
)

/** What a run did besides answering, collected for the in-app assistant. MCP ignores it. */
class ToolEffects {
    val sources = LinkedHashMap<String, ToolSource>()
    val created = mutableListOf<ToolSource>()
    val proposals = mutableListOf<ToolProposal>()
    val createdTasks = mutableListOf<ToolTask>()

    fun read(source: ToolSource) {
        sources.putIfAbsent("${source.spaceId}:${source.path}", source)
    }
}

/** Per-run state: the API bound to the caller, the scope, and the space list fetched at most once. */
class ToolSession(
    val api: LoopbackApi,
    val scope: ToolScope,
    private val publicUrl: String
) {
    val effects = ToolEffects()
    val spaces: List<JsonNode> by lazy { api.listSpaces() }

    fun resolveSpaceId(input: String?): String {
        val scope = scope
        if (input.isNullOrBlank()) {
            if (scope is ToolScope.Conversation) {
                return scope.defaultSpaceId ?: throw ToolException(
                    "This conversation covers several repositories. Pass spaceId, one of: " +
                        scope.repositoryIds.joinToString(", ") { id -> spaceLabel(id) }
                )
            }
            throw ToolException("Missing required argument: spaceId")
        }
        val id = if (UUID_REGEX.matches(input)) input else {
            spaces.firstOrNull { it.text("fullPath") == input || it.text("slug") == input || it.text("name") == input }
                ?.text("id")
                ?: throw ToolException("Unknown space \"$input\". Use list_spaces to see the available spaces.")
        }
        if (scope is ToolScope.Conversation && id !in scope.repositoryIds) {
            throw ToolException("\"$input\" is outside this conversation, which is limited to ${scope.spaceName}.")
        }
        return id
    }

    fun spaceFullPath(spaceId: String): String? = spaces.firstOrNull { it.text("id") == spaceId }?.text("fullPath")

    fun documentUrl(spaceFullPath: String, docPath: String): String =
        "${publicUrl.trimEnd('/')}/spaces/$spaceFullPath/doc?path=${UriUtils.encodeQueryParam(docPath, StandardCharsets.UTF_8)}"

    fun urlLine(spaceId: String, docPath: String): String =
        spaceFullPath(spaceId)?.let { "\nURL: ${documentUrl(it, docPath)}" } ?: ""

    private fun spaceLabel(id: String): String =
        spaces.firstOrNull { it.text("id") == id }?.let { "${it.text("fullPath")} [$id]" } ?: id

    companion object {
        private val UUID_REGEX = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", RegexOption.IGNORE_CASE)
    }
}

internal fun JsonNode.text(field: String): String? = get(field)?.takeIf { !it.isNull }?.asText()
