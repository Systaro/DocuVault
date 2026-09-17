package com.docuvault.service.tools

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.web.client.RestClient
import org.springframework.web.util.UriUtils
import java.net.URI
import java.nio.charset.StandardCharsets

/**
 * The public REST API, called over the loopback interface with the caller's own
 * credential, so validation, permission checks and response shapes exist once,
 * in the controllers.
 */
class LoopbackApi(
    private val restClient: RestClient,
    private val objectMapper: ObjectMapper,
    private val loopbackBase: String,
    private val credential: ToolCredential
) {
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
    fun issueTransfer(spaceId: String, path: String, kind: String): JsonNode =
        call(HttpMethod.POST, "/transfers", mapOf("spaceId" to spaceId, "path" to path, "kind" to kind))
    fun putState(spaceId: String, key: String, value: String): JsonNode =
        call(HttpMethod.PUT, "/spaces/$spaceId/state/${UriUtils.encodePathSegment(key, StandardCharsets.UTF_8)}", mapOf("value" to value))

    /** Null when the document does not exist; any other failure still throws. */
    fun readDocumentOrNull(spaceId: String, path: String): JsonNode? = try {
        readDocument(spaceId, path)
    } catch (e: LoopbackStatusException) {
        if (e.status == 404) null else throw e
    }

    private fun call(method: HttpMethod, path: String, body: Any? = null): JsonNode {
        val spec = restClient.method(method)
            .uri(URI.create(loopbackBase + path))
            .header(credential.header, credential.value)
            .accept(MediaType.APPLICATION_JSON)
        if (body != null) {
            spec.contentType(MediaType.APPLICATION_JSON).body(objectMapper.writeValueAsString(body))
        }
        return spec.exchange({ _, response ->
            val text = response.body.readBytes().toString(StandardCharsets.UTF_8)
            if (response.statusCode.isError) {
                throw LoopbackStatusException(response.statusCode.value(), "DocuVault API ${response.statusCode.value()}: ${errorMessage(text)}")
            }
            if (text.isBlank()) objectMapper.nullNode() else objectMapper.readTree(text)
        }, true)
    }

    private fun errorMessage(text: String): String {
        val parsed = runCatching { objectMapper.readTree(text) }.getOrNull()
        return parsed?.text("message") ?: parsed?.text("error") ?: text.take(300).ifBlank { "request failed" }
    }

    private fun encodePath(path: String): String =
        path.split('/').joinToString("/") { UriUtils.encodePathSegment(it, StandardCharsets.UTF_8) }
}

/** A tool failure that also carries the HTTP status, for callers that treat some statuses differently. */
class LoopbackStatusException(val status: Int, message: String) : ToolException(message)
