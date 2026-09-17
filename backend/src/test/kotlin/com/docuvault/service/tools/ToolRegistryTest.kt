package com.docuvault.service.tools

import com.docuvault.service.DocumentPatchService
import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.mockito.Mockito.mock
import org.mockito.Mockito.verifyNoInteractions
import org.mockito.Mockito.`when`

/**
 * The guarantees that hold whatever a model decides to call: a conversation
 * cannot reach outside its space, the assistant cannot write outside a space or
 * over an existing file, and a proposal is only offered when it can be applied.
 */
class ToolRegistryTest {

    private val objectMapper = ObjectMapper()
    private val registry = ToolRegistry(objectMapper, DocumentPatchService(), 7030, "/api", "https://docs.example")
    private val api = mock(LoopbackApi::class.java)

    private fun session(scope: ToolScope) = ToolSession(api, scope, "https://docs.example")

    private val repoA = "11111111-1111-1111-1111-111111111111"
    private val repoB = "22222222-2222-2222-2222-222222222222"
    private val outside = "33333333-3333-3333-3333-333333333333"

    // --- scope ----------------------------------------------------------------

    @Test
    fun `a single-repository conversation needs no space argument`() {
        val scope = ToolScope.Conversation(repoA, "Docs", setOf(repoA))
        assertEquals(repoA, session(scope).resolveSpaceId(null))
    }

    @Test
    fun `a conversation cannot reach a space outside its scope`() {
        val scope = ToolScope.Conversation(repoA, "Docs", setOf(repoA))
        val error = assertThrows<ToolException> { session(scope).resolveSpaceId(outside) }
        assertTrue(error.message!!.contains("outside this conversation"), error.message)
    }

    @Test
    fun `a group conversation has to be told which repository`() {
        `when`(api.listSpaces()).thenReturn(emptyList())
        val scope = ToolScope.Conversation("group", "Acme", setOf(repoA, repoB))
        assertThrows<ToolException> { session(scope).resolveSpaceId(null) }
        assertEquals(repoB, session(scope).resolveSpaceId(repoB))
    }

    @Test
    fun `MCP keeps spaceId required while the conversation makes it optional`() {
        val mcpRead = registry.mcpTool("read_document")!!
        val chatRead = registry.conversationTool("read_document")!!
        assertTrue((mcpRead.inputSchema["required"] as List<*>).contains("spaceId"))
        assertFalse((chatRead.inputSchema["required"] as List<*>).contains("spaceId"))
    }

    @Test
    fun `MCP does not get the conversation-only tools and keeps its own writers`() {
        val mcpNames = registry.mcpTools().map { it.name }
        assertFalse("propose_edit" in mcpNames)
        assertTrue("update_document" in mcpNames && "upload_file" in mcpNames)
        val chatNames = registry.conversationTools().map { it.name }
        assertFalse("update_document" in chatNames || "upload_file" in chatNames)
        assertTrue("propose_edit" in chatNames && "create_document" in chatNames)
    }

    // --- creating ---------------------------------------------------------------

    @Test
    fun `refuses to create over an existing document`() {
        val scope = ToolScope.Conversation(repoA, "Docs", setOf(repoA))
        `when`(api.readDocumentOrNull(repoA, "docs/existing.md")).thenReturn(objectMapper.createObjectNode())
        val args = objectMapper.createObjectNode().put("path", "docs/existing.md").put("content", "# x")

        val error = assertThrows<ToolException> { registry.conversationTool("create_document")!!.handler(session(scope), args) }

        assertTrue(error.message!!.startsWith("Refused"), error.message)
    }

    @Test
    fun `refuses empty content without touching the API`() {
        val scope = ToolScope.Conversation(repoA, "Docs", setOf(repoA))
        val args = objectMapper.createObjectNode().put("path", "docs/empty.md").put("content", "   ")

        assertThrows<ToolException> { registry.conversationTool("create_document")!!.handler(session(scope), args) }
        verifyNoInteractions(api)
    }

    @Test
    fun `keeps a normal path and adds a markdown extension when missing`() {
        assertEquals("a/b/c.md", registry.sanitizeDocumentPath("a/b/c.md"))
        assertEquals("notes/plan.md", registry.sanitizeDocumentPath("notes/plan"))
    }

    @Test
    fun `strips traversal, drive letters and backslashes instead of escaping the space`() {
        assertEquals("etc/passwd.md", registry.sanitizeDocumentPath("../../etc/passwd"))
        assertEquals("Users/x/note.md", registry.sanitizeDocumentPath("C:\\Users\\x\\note.md"))
    }

    @Test
    fun `rejects a path that names nothing or a hidden file`() {
        assertNull(registry.sanitizeDocumentPath("../.."))
        assertNull(registry.sanitizeDocumentPath(".env"))
    }

    // --- proposing ---------------------------------------------------------------

    @Test
    fun `a proposal carries the surrounding lines for review`() {
        val content = "one\ntwo\nthree\nPAPAYA\nfour\nfive\nsix\nseven"

        val proposal = registry.buildProposal(repoA, "fruit.md", content, "PAPAYA", "MANGO", "Rename the fruit")

        assertEquals("one\ntwo\nthree", proposal.contextBefore)
        assertEquals("four\nfive\nsix", proposal.contextAfter)
        assertEquals("MANGO", proposal.newText)
    }

    @Test
    fun `text that is missing or ambiguous is not proposed`() {
        assertThrows<ToolException> { registry.buildProposal(repoA, "f.md", "apple", "PAPAYA", "MANGO", "x") }
        assertThrows<ToolException> { registry.buildProposal(repoA, "f.md", "kiwi kiwi", "kiwi", "MANGO", "x") }
    }
}
