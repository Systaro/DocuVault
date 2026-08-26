package com.docuvault.service

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class HtmlPreviewInjectionTest {

    @Test
    fun `a document in a folder resolves against that folder`() {
        assertEquals(
            "/api/spaces/1/files/designs/glaeubiger-portal/",
            HtmlPreviewInjection.baseHref("/api/spaces/1/files", "designs/glaeubiger-portal/forderungen.html")
        )
    }

    @Test
    fun `a document at the repository root resolves against the endpoint itself`() {
        // Deriving the directory by cutting at the last slash returns the whole
        // filename when there is none — the base then pointed into a directory
        // named after the file, and every relative asset 404'd.
        assertEquals(
            "/api/spaces/1/files/",
            HtmlPreviewInjection.baseHref("/api/spaces/1/files", "startseite.html")
        )
    }

    @Test
    fun `a trailing slash on the endpoint does not double up`() {
        assertEquals(
            "/api/spaces/1/files/docs/",
            HtmlPreviewInjection.baseHref("/api/spaces/1/files/", "docs/page.html")
        )
    }

    @Test
    fun `directory names are encoded so the base stays a valid URL`() {
        assertEquals(
            "/api/shared/tok/files/Alte%20Entw%C3%BCrfe/",
            HtmlPreviewInjection.baseHref("/api/shared/tok/files", "Alte Entwürfe/seite.html")
        )
    }

    @Test
    fun `the base tag lands inside head, before anything that could reference an asset`() {
        val html = """<html><head><link rel="stylesheet" href="../assets/styles.css"></head><body>hi</body></html>"""

        val injected = HtmlPreviewInjection.inject(html, "/api/spaces/1/files/designs/")

        assertTrue(injected.contains("""<head><base href="/api/spaces/1/files/designs/">"""))
        assertTrue(injected.indexOf("<base") < injected.indexOf("<link"))
    }

    @Test
    fun `a fragment without a head still gets its base first`() {
        val injected = HtmlPreviewInjection.inject("<p>bare</p>", "/api/spaces/1/files/")

        assertTrue(injected.startsWith("""<base href="/api/spaces/1/files/">"""))
    }
}
