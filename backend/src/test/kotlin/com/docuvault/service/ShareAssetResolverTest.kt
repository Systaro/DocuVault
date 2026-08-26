package com.docuvault.service

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import java.util.UUID

class ShareAssetResolverTest {

    private val resolver = ShareAssetResolver()

    @TempDir
    lateinit var repo: Path

    /** A fresh key per case — the resolver caches its reference graph per share. */
    private fun key() = UUID.randomUUID().toString()

    private fun write(relativePath: String, content: String): Path {
        val file = repo.resolve(relativePath)
        Files.createDirectories(file.parent)
        Files.writeString(file, content)
        return file
    }

    @BeforeEach
    fun layout() {
        // designs/
        //   assets/{styles.css,logo.png,scripts.js,fonts/body.woff2}
        //   glaeubiger-portal/forderungen.html   <- what gets shared
        //   rechnungen.html
        //   secrets/private.png
        write("designs/assets/styles.css", "@font-face{src:url(fonts/body.woff2)}")
        write("designs/assets/fonts/body.woff2", "font")
        write("designs/assets/logo.png", "png")
        write("designs/assets/scripts.js", "console.log('hi')")
        write("designs/rechnungen.html", "<html><body>invoices</body></html>")
        write("designs/secrets/private.png", "png")
        write(
            "designs/glaeubiger-portal/forderungen.html",
            """
            <html><head>
              <link rel="stylesheet" href="../assets/styles.css">
            </head><body>
              <img src="../assets/logo.png">
              <a href="../rechnungen.html">Rechnungen</a>
              <script src="../assets/scripts.js"></script>
            </body></html>
            """.trimIndent()
        )
    }

    private fun allows(target: String, shared: String, isFolder: Boolean): Boolean {
        val sharedPath = repo.resolve(shared)
        val allowedRoot = if (isFolder) sharedPath else sharedPath.parent
        return resolver.allowsOutsideAsset(
            cacheKey = key(),
            repoRoot = repo,
            allowedRoot = allowedRoot,
            sharedFile = if (isFolder) null else sharedPath,
            target = repo.resolve(target)
        )
    }

    @Test
    fun `serves a stylesheet referenced above the shared folder`() {
        assertTrue(allows("designs/assets/styles.css", "designs/glaeubiger-portal", isFolder = true))
    }

    @Test
    fun `serves images and scripts the shared page references`() {
        assertTrue(allows("designs/assets/logo.png", "designs/glaeubiger-portal", isFolder = true))
        assertTrue(allows("designs/assets/scripts.js", "designs/glaeubiger-portal", isFolder = true))
    }

    @Test
    fun `follows references through the stylesheet to its font`() {
        assertTrue(allows("designs/assets/fonts/body.woff2", "designs/glaeubiger-portal", isFolder = true))
    }

    @Test
    fun `refuses a file nothing in the share references`() {
        assertFalse(allows("designs/secrets/private.png", "designs/glaeubiger-portal", isFolder = true))
    }

    @Test
    fun `refuses a linked page outside the share`() {
        // Referenced, but a document — following the link would hand out a page
        // that was never shared.
        assertFalse(allows("designs/rechnungen.html", "designs/glaeubiger-portal", isFolder = true))
    }

    @Test
    fun `a shared single file brings its own referenced assets`() {
        assertTrue(allows("designs/assets/styles.css", "designs/glaeubiger-portal/forderungen.html", isFolder = false))
        assertFalse(allows("designs/secrets/private.png", "designs/glaeubiger-portal/forderungen.html", isFolder = false))
    }

    @Test
    fun `serves an image a shared markdown document points to`() {
        write(
            "designs/glaeubiger-portal/notizen.md",
            """
            # Notizen

            ![oben](../assets/logo.png)
            [Rechnungen](../rechnungen.html)
            """.trimIndent()
        )
        assertTrue(allows("designs/assets/logo.png", "designs/glaeubiger-portal/notizen.md", isFolder = false))
        assertFalse(allows("designs/rechnungen.html", "designs/glaeubiger-portal/notizen.md", isFolder = false))
    }

    @Test
    fun `refuses to leave the repository`() {
        val outside = Files.createTempDirectory("outside").resolve("styles.css")
        Files.writeString(outside, "body{}")
        write(
            "designs/glaeubiger-portal/escape.html",
            """<link rel="stylesheet" href="../../../${outside.parent.fileName}/styles.css">"""
        )
        assertFalse(
            resolver.allowsOutsideAsset(
                cacheKey = key(),
                repoRoot = repo,
                allowedRoot = repo.resolve("designs/glaeubiger-portal"),
                sharedFile = null,
                target = outside
            )
        )
    }

    @Test
    fun `ignores absolute and data references`() {
        write(
            "designs/glaeubiger-portal/external.html",
            """
            <img src="https://example.com/assets/logo.png">
            <img src="data:image/png;base64,AAAA">
            <link rel="stylesheet" href="/designs/assets/styles.css">
            """.trimIndent()
        )
        // The stylesheet stays reachable through forderungen.html, but nothing
        // in this file contributes a repository path.
        assertFalse(allows("designs/assets/logo.png", "designs/glaeubiger-portal/external.html", isFolder = false))
    }

    @Test
    fun `resolves references that carry a query string or fragment`() {
        write(
            "designs/glaeubiger-portal/versioned.html",
            """<link rel="stylesheet" href="../assets/styles.css?v=3">"""
        )
        assertTrue(allows("designs/assets/styles.css", "designs/glaeubiger-portal/versioned.html", isFolder = false))
    }
}
