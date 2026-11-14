package com.docuvault.service

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/**
 * The link AI clients quote to people. It has to match what the app's address bar
 * shows, so the slashes of the document path are encoded as %2F.
 */
class DocumentLinksTest {

    @Test
    fun `encodes the slashes of the document path`() {
        assertEquals(
            "https://docs.example.com/spaces/acme/website/doc?path=landing%2Findex.html",
            DocumentLinks.documentUrl("https://docs.example.com", "acme/website", "landing/index.html")
        )
    }

    @Test
    fun `encodes spaces, umlauts and characters that would end the query`() {
        assertEquals(
            "https://docs.example.com/spaces/team/handbook/doc?path=Pr%C3%BCfung%2FTeil%201%20%26%202%23neu%3F.md",
            DocumentLinks.documentUrl("https://docs.example.com/", "team/handbook", "Prüfung/Teil 1 & 2#neu?.md")
        )
    }
}
