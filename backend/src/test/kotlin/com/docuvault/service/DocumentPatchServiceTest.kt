package com.docuvault.service

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.fail
import org.junit.jupiter.api.Test

class DocumentPatchServiceTest {

    private val service = DocumentPatchService()

    private val page = """
        <div class="card">
          <h2>Keine laufende Arbeit</h2>
        </div>
        <div class="card no-bg">
          <h2>BE/FEv1.4-MAG</h2>
        </div>
    """.trimIndent()

    private fun applied(content: String, vararg ops: PatchOperation): String =
        when (val result = service.apply(content, ops.toList())) {
            is DocumentPatchService.Result.Applied -> result.content
            is DocumentPatchService.Result.Failed -> fail("expected the patch to apply, got ${result.error}: ${result.message}")
        }

    private fun failed(content: String, vararg ops: PatchOperation): DocumentPatchService.Result.Failed =
        when (val result = service.apply(content, ops.toList())) {
            is DocumentPatchService.Result.Failed -> result
            is DocumentPatchService.Result.Applied -> fail("expected the patch to be rejected, but it applied")
        }

    @Test
    fun `replaces a unique passage and leaves the rest byte-identical`() {
        val result = applied(
            page,
            PatchOperation(op = "replace", oldText = "<div class=\"card no-bg\">", newText = "<div class=\"card\">")
        )

        assertEquals(page.replace("<div class=\"card no-bg\">", "<div class=\"card\">"), result)
    }

    @Test
    fun `refuses an anchor that is not in the document`() {
        val failure = failed(
            page,
            PatchOperation(op = "replace", oldText = "<div class=\"karte\">", newText = "x")
        )

        assertEquals("TEXT_NOT_FOUND", failure.error)
        assertEquals(0, failure.operationIndex)
    }

    @Test
    fun `refuses an anchor that matches twice, and reports how often`() {
        val failure = failed(
            page,
            PatchOperation(op = "replace", oldText = "  <h2>", newText = "  <h3>")
        )

        assertEquals("AMBIGUOUS_MATCH", failure.error)
        assertEquals(2, failure.occurrences)
    }

    @Test
    fun `replaceAll is how you ask for every occurrence`() {
        val result = applied(
            page,
            PatchOperation(op = "replace", oldText = "<h2>", newText = "<h3>", replaceAll = true)
        )

        assertEquals(2, Regex("<h3>").findAll(result).count())
    }

    @Test
    fun `operations apply in order, so a later one sees the earlier edit`() {
        val result = applied(
            "one two",
            PatchOperation(op = "replace", oldText = "one", newText = "three"),
            PatchOperation(op = "replace", oldText = "three two", newText = "done")
        )

        assertEquals("done", result)
    }

    @Test
    fun `a failing operation leaves the document untouched`() {
        val failure = failed(
            page,
            PatchOperation(op = "replace", oldText = "no-bg", newText = ""),
            PatchOperation(op = "replace", oldText = "not there", newText = "x")
        )

        // The caller gets no content back at all — nothing partial is ever written.
        assertEquals("TEXT_NOT_FOUND", failure.error)
        assertEquals(1, failure.operationIndex)
    }

    @Test
    fun `insert places text at the anchor, at the start or at the end`() {
        assertEquals("ab", applied("b", PatchOperation(op = "insert", content = "a", after = "START")))
        assertEquals("ab", applied("a", PatchOperation(op = "insert", content = "b", after = "END")))
        assertEquals("ab", applied("a", PatchOperation(op = "insert", content = "b")))
        assertEquals("abc", applied("ac", PatchOperation(op = "insert", content = "b", after = "a")))
        assertEquals("abc", applied("ac", PatchOperation(op = "insert", content = "b", before = "c")))
    }

    @Test
    fun `rejects malformed and unknown operations`() {
        assertEquals("INVALID_OPERATION", failed(page, PatchOperation(op = "replace", oldText = "x")).error)
        assertEquals(
            "INVALID_OPERATION",
            failed(page, PatchOperation(op = "replace", oldText = "x", newText = "x")).error
        )
        assertEquals("INVALID_OPERATION", failed(page, PatchOperation(op = "insert")).error)
        assertEquals("INVALID_OPERATION", failed(page, PatchOperation(op = "delete", oldText = "x")).error)
    }

    @Test
    fun `rejects an empty batch and one that is too long`() {
        assertEquals("INVALID_REQUEST", failed(page).error)

        val tooMany = List(DocumentPatchService.MAX_OPERATIONS + 1) {
            PatchOperation(op = "replace", oldText = "a", newText = "b")
        }
        assertEquals("INVALID_REQUEST", failed(page, *tooMany.toTypedArray()).error)
    }
}
