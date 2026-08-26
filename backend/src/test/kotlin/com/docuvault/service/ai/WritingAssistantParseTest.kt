package com.docuvault.service.ai

import com.docuvault.config.OpenAIProvider
import com.docuvault.service.DocumentPatchService
import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assertions.fail
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock

/**
 * The model's patch reply is the one place where an outside system's output
 * decides what gets written to a file, so every shape it plausibly returns has
 * to land somewhere deliberate — applied, retried, or handed to the rewrite.
 */
class WritingAssistantParseTest {

    private val service = WritingAssistantService(
        mock(OpenAIProvider::class.java),
        DocumentPatchService(),
        ObjectMapper()
    )

    private fun operationsOf(reply: WritingAssistantService.PatchReply): WritingAssistantService.PatchReply.Operations =
        reply as? WritingAssistantService.PatchReply.Operations
            ?: fail("expected operations, got ${reply::class.simpleName}")

    private inline fun <reified T> assertReply(reply: WritingAssistantService.PatchReply) {
        assertTrue(reply is T, "expected ${T::class.simpleName}, got ${reply::class.simpleName}")
    }

    @Test
    fun `reads the documented shape`() {
        val reply = """
            {"operations": [
              {"op": "replace", "oldText": "<div class=\"card no-bg\">", "newText": "<div class=\"card\">"},
              {"op": "insert", "content": "<hr>", "after": "</header>"}
            ]}
        """.trimIndent()

        val parsed = operationsOf(service.parseOperations(reply))

        assertEquals(2, parsed.operations.size)
        assertEquals("replace", parsed.operations[0].op)
        assertEquals("<div class=\"card no-bg\">", parsed.operations[0].oldText)
        assertEquals("</header>", parsed.operations[1].after)
    }

    @Test
    fun `accepts a bare array from a model that dropped the wrapper`() {
        val parsed = operationsOf(service.parseOperations("""[{"op": "replace", "oldText": "a", "newText": "b"}]"""))

        assertEquals(1, parsed.operations.size)
    }

    @Test
    fun `unwraps a fenced reply`() {
        val reply = "```json\n{\"operations\": [{\"op\": \"replace\", \"oldText\": \"a\", \"newText\": \"b\"}]}\n```"

        operationsOf(service.parseOperations(reply))
    }

    @Test
    fun `an empty operations list means the instruction needs the whole file`() {
        assertReply<WritingAssistantService.PatchReply.NotApplicable>(service.parseOperations("""{"operations": []}"""))
    }

    @Test
    fun `prose, broken JSON and a missing operations key are all unusable`() {
        assertReply<WritingAssistantService.PatchReply.Unparseable>(service.parseOperations("Sure! I fixed the backgrounds for you."))
        assertReply<WritingAssistantService.PatchReply.Unparseable>(service.parseOperations("""{"operations": [{"op": "replace","""))
        assertReply<WritingAssistantService.PatchReply.Unparseable>(service.parseOperations("""{"edits": [{"op": "replace"}]}"""))
    }

    @Test
    fun `entries without an op are dropped rather than applied blindly`() {
        assertReply<WritingAssistantService.PatchReply.Unparseable>(service.parseOperations("""{"operations": [{"oldText": "a", "newText": "b"}]}"""))
    }

    @Test
    fun `replaceAll defaults to false when the model omits it`() {
        val parsed = operationsOf(service.parseOperations("""{"operations": [{"op": "replace", "oldText": "a", "newText": "b"}]}"""))

        assertEquals(false, parsed.operations[0].replaceAll)
    }
}
