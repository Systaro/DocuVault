package com.docuvault.service.mcp

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.NullNode
import com.fasterxml.jackson.databind.node.ObjectNode
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service

/**
 * JSON-RPC dispatch for the MCP endpoint. Stateless Streamable HTTP: every
 * request is one POST with one JSON answer, no session id, no server-sent
 * events. A pure tool server needs nothing more, and the client SDKs treat such
 * a server as stateless.
 */
@Service
class McpService(
    private val toolService: McpToolService,
    private val objectMapper: ObjectMapper,
    @Value("\${app.public-url}") publicUrl: String
) {
    companion object {
        /** Newest first; the requested version is echoed when we support it. */
        val SUPPORTED_PROTOCOL_VERSIONS = listOf("2025-06-18", "2025-03-26", "2024-11-05")
        const val SERVER_NAME = "docuvault"
        const val SERVER_VERSION = "2.0.0"
    }

    private val baseUrl = publicUrl.trimEnd('/')

    /** Rules no schema can express; the model reads them once per session. */
    private val instructions = """
        DocuVault is a Git-backed documentation platform. Spaces are Git repositories, documents are files inside them (Markdown, HTML, CSS, JS, JSON, YAML, ...).
        - Space arguments accept the space ID, its full path (e.g. "team/handbook") or its name; list_spaces shows all three.
        - Link to a document as $baseUrl/spaces/<space full path>/doc?path=<document path>. The document path is a query parameter, never a URL segment. Results already contain the ready-made link; quote that instead of building one.
        - create_document and update_document write to the space's working copy. Only auto_commit=true (with a commit_message) commits and pushes to Git; without it the change is visible in DocuVault but not in the repository.
        - Call read_document before edit_document or insert_in_document and pass its contentHash; the edit is rejected if the document changed in between.
        - Text documents only. Binary files (images, PDF, Office) can be listed and shared but not read or written here.
        - Every call runs as the signed-in user with that user's permissions. Deleting documents is not offered here; use the web UI.
    """.trimIndent()

    /** The response for a single message or a batch; null when nothing needs an answer (notifications). */
    fun handle(payload: JsonNode, ctx: McpContext): JsonNode? {
        if (payload.isArray) {
            val responses = payload.mapNotNull { handleMessage(it, ctx) }
            return if (responses.isEmpty()) null else objectMapper.createArrayNode().apply { addAll(responses) }
        }
        return handleMessage(payload, ctx)
    }

    fun parseError(): String =
        objectMapper.writeValueAsString(errorResponse(NullNode.instance, -32700, "Parse error: the request body is not valid JSON"))

    private fun handleMessage(message: JsonNode, ctx: McpContext): ObjectNode? {
        if (!message.isObject) return errorResponse(NullNode.instance, -32600, "Invalid request")
        val id = message.get("id")
        val method = message.get("method")?.takeIf { it.isTextual }?.asText()
        // No id: a notification (notifications/initialized, ...) or a client response. Neither gets an answer.
        if (id == null || id.isNull) return null
        if (method == null) return errorResponse(id, -32600, "Invalid request: method is required")
        val params = message.get("params")?.takeIf { it.isObject } as ObjectNode? ?: objectMapper.createObjectNode()

        return try {
            when (method) {
                "initialize" -> resultResponse(id, initialize(params))
                "ping" -> resultResponse(id, objectMapper.createObjectNode())
                "tools/list" -> resultResponse(
                    id,
                    objectMapper.createObjectNode().set("tools", objectMapper.valueToTree<JsonNode>(toolService.listTools(ctx)))
                )
                "tools/call" -> {
                    val name = params.get("name")?.takeIf { it.isTextual }?.asText()
                        ?: throw McpInvalidParamsException("tools/call requires a tool name")
                    val arguments = params.get("arguments")?.takeIf { it.isObject } as ObjectNode? ?: objectMapper.createObjectNode()
                    resultResponse(id, objectMapper.valueToTree(toolService.callTool(ctx, name, arguments)))
                }
                else -> errorResponse(id, -32601, "Method not found: $method")
            }
        } catch (e: McpInvalidParamsException) {
            errorResponse(id, -32602, e.message ?: "Invalid params")
        }
    }

    private fun initialize(params: ObjectNode): ObjectNode {
        val requested = params.get("protocolVersion")?.takeIf { it.isTextual }?.asText()
        val version = if (requested != null && requested in SUPPORTED_PROTOCOL_VERSIONS) requested else SUPPORTED_PROTOCOL_VERSIONS.first()
        return objectMapper.createObjectNode().apply {
            put("protocolVersion", version)
            set<ObjectNode>("capabilities", objectMapper.createObjectNode().set("tools", objectMapper.createObjectNode()))
            set<ObjectNode>("serverInfo", objectMapper.createObjectNode().put("name", SERVER_NAME).put("version", SERVER_VERSION))
            put("instructions", instructions)
        }
    }

    private fun resultResponse(id: JsonNode, result: JsonNode): ObjectNode =
        objectMapper.createObjectNode().apply {
            put("jsonrpc", "2.0")
            set<JsonNode>("id", id)
            set<JsonNode>("result", result)
        }

    private fun errorResponse(id: JsonNode, code: Int, message: String): ObjectNode =
        objectMapper.createObjectNode().apply {
            put("jsonrpc", "2.0")
            set<JsonNode>("id", id)
            set<ObjectNode>("error", objectMapper.createObjectNode().put("code", code).put("message", message))
        }
}
