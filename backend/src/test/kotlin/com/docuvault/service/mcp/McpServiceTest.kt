package com.docuvault.service.mcp

import com.docuvault.domain.user.User
import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.mockito.stubbing.Answer
import java.util.*

class McpServiceTest {

    private val objectMapper = ObjectMapper()
    // A default answer instead of matchers: Mockito's matchers return null, which
    // Kotlin rejects for the non-null parameters of callTool.
    private val toolService: McpToolService = mock(McpToolService::class.java, Answer { invocation ->
        when (invocation.method.name) {
            "listTools" -> listOf(ToolDescriptor("list_spaces", "d", mapOf("type" to "object")))
            "callTool" -> when (invocation.arguments[1] as String) {
                "nope" -> throw McpInvalidParamsException("Unknown tool: nope")
                else -> mapOf("content" to listOf(mapOf("type" to "text", "text" to "DocuVault API 404: not found")), "isError" to true)
            }
            else -> null
        }
    })
    private val service = McpService(toolService, objectMapper, "https://docs.example.com/")
    private val ctx = McpContext(User(id = UUID.randomUUID(), email = "a@b.c", passwordHash = "x", name = "A"), "Bearer dvo_x")

    private fun request(json: String) = service.handle(objectMapper.readTree(json), ctx)

    @Test
    fun `initialize echoes a supported protocol version and falls back to the newest otherwise`() {
        val echoed = request("""{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}""")!!
        assertEquals("2025-03-26", echoed["result"]["protocolVersion"].asText())
        assertTrue(echoed["result"]["capabilities"].has("tools"))
        assertEquals("docuvault", echoed["result"]["serverInfo"]["name"].asText())
        assertTrue(echoed["result"]["instructions"].asText().contains("https://docs.example.com/spaces/"))

        val fallback = request("""{"jsonrpc":"2.0","id":"x","method":"initialize","params":{"protocolVersion":"1999-01-01"}}""")!!
        assertEquals("2025-06-18", fallback["result"]["protocolVersion"].asText())
        assertEquals("x", fallback["id"].asText())
    }

    @Test
    fun `ping answers an empty result and notifications get no answer`() {
        val pong = request("""{"jsonrpc":"2.0","id":2,"method":"ping"}""")!!
        assertEquals(0, pong["result"].size())
        assertNull(request("""{"jsonrpc":"2.0","method":"notifications/initialized"}"""))
    }

    @Test
    fun `unknown methods and unknown tools are json-rpc errors, a failing tool is a result`() {
        val unknown = request("""{"jsonrpc":"2.0","id":3,"method":"resources/list"}""")!!
        assertEquals(-32601, unknown["error"]["code"].asInt())

        val badTool = request("""{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"nope","arguments":{}}}""")!!
        assertEquals(-32602, badTool["error"]["code"].asInt())

        val failed = request("""{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"read_document","arguments":{"spaceId":"s","path":"p"}}}""")!!
        assertTrue(failed["result"]["isError"].asBoolean())
        assertTrue(failed["result"]["content"][0]["text"].asText().contains("404"))
    }

    @Test
    fun `tools list is delegated and a batch answers only the requests in it`() {
        val list = request("""{"jsonrpc":"2.0","id":6,"method":"tools/list"}""")!!
        assertEquals("list_spaces", list["result"]["tools"][0]["name"].asText())

        val batch = request("""[{"jsonrpc":"2.0","id":7,"method":"ping"},{"jsonrpc":"2.0","method":"notifications/initialized"}]""")!!
        assertTrue(batch.isArray)
        assertEquals(1, batch.size())
        assertEquals(7, batch[0]["id"].asInt())
    }
}
