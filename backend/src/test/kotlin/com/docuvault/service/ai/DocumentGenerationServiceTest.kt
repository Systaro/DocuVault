package com.docuvault.service.ai

import com.docuvault.config.OpenAIProvider
import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock

/**
 * The model names the file, so its name is outside input that ends up as a
 * path in the space: it has to stay one segment and never replace a file.
 */
class DocumentGenerationServiceTest {

    private val service = DocumentGenerationService(mock(OpenAIProvider::class.java), ObjectMapper())

    @Test
    fun `reads title, file name and content`() {
        val result = service.parseReply("""{"title": "Kickoff Nord", "fileName": "2026-10-01 Kickoff", "content": "# Kickoff\n\nText"}""")
        result as DocumentGenerationResult.Success
        assertEquals("Kickoff Nord", result.title)
        assertEquals("2026-10-01 Kickoff", result.fileName)
        assertEquals("# Kickoff\n\nText\n", result.content)
    }

    @Test
    fun `falls back to the title when the file name is unusable`() {
        val result = service.parseReply("""{"title": "Gesprächsnotiz", "fileName": "../..", "content": "x"}""")
        assertEquals("Gesprächsnotiz", (result as DocumentGenerationResult.Success).fileName)
    }

    @Test
    fun `an empty document or unreadable reply fails`() {
        assertTrue(service.parseReply("""{"title": "A", "fileName": "a", "content": "  "}""") is DocumentGenerationResult.Failed)
        assertTrue(service.parseReply("not json") is DocumentGenerationResult.Failed)
    }

    @Test
    fun `file names stay a single segment`() {
        assertEquals("notes-evil", service.sanitizeFileName("../notes/evil.md")?.trimStart('.', '-'))
        assertEquals("a-b", service.sanitizeFileName("a\\b"))
        assertEquals("Übergabe Protokoll", service.sanitizeFileName("  Übergabe   Protokoll.html "))
        assertNull(service.sanitizeFileName("..."))
        assertNull(service.sanitizeFileName(null))
    }

    @Test
    fun `a taken name gets a counter instead of overwriting`() {
        val taken = setOf("Partner/notes.md", "Partner/notes-2.md")
        assertEquals("Partner/notes-3.md", service.freePath("/Partner/", "notes", DocumentFormat.MARKDOWN) { it in taken })
        assertEquals("notes.html", service.freePath("", "notes", DocumentFormat.HTML) { false })
    }

    @Test
    fun `an HTML example yields an HTML document`() {
        assertEquals(DocumentFormat.HTML, DocumentFormat.forExample("a/profile.HTML"))
        assertEquals(DocumentFormat.MARKDOWN, DocumentFormat.forExample("a/profile.md"))
        assertEquals(DocumentFormat.MARKDOWN, DocumentFormat.forExample(null))
    }
}
