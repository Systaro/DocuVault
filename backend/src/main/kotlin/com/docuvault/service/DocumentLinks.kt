package com.docuvault.service

import org.springframework.web.util.UriUtils
import java.nio.charset.StandardCharsets

/**
 * The web UI's deep link to a document, written the way the app's own address bar
 * writes it: the document path is a query parameter with every slash encoded as %2F
 * (`/spaces/team/handbook/doc?path=guides%2Fsetup.md`).
 *
 * AI clients quote these links verbatim from tool results, so they must look exactly
 * like the link a person copies out of the browser.
 */
object DocumentLinks {
    fun documentUrl(baseUrl: String, spaceFullPath: String, docPath: String): String =
        "${baseUrl.trimEnd('/')}/spaces/$spaceFullPath/doc?path=${UriUtils.encode(docPath, StandardCharsets.UTF_8)}"
}
