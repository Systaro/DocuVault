package com.docuvault.office

import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component

/**
 * Where the office document server lives, seen from three sides. Editing Word
 * documents in the browser is on when the shared secret is set.
 */
@Component
class OfficeSettings(
    /** What browsers load the editor from: a path on this host ("/office") or an absolute URL. */
    @Value("\${app.office.url:/office}") url: String,
    @Value("\${app.office.jwt-secret:}") val jwtSecret: String,
    /** How the document server reaches this backend, including its /api context path. */
    @Value("\${app.office.backend-url:http://backend:7030/api}") backendUrl: String,
    /** How this backend reaches the document server; saved files are fetched from here. */
    @Value("\${app.office.internal-url:http://onlyoffice}") internalUrl: String
) {
    val url = url.trim().trimEnd('/')
    val backendUrl = backendUrl.trim().trimEnd('/')
    val internalUrl = internalUrl.trim().trimEnd('/')

    val enabled: Boolean
        get() = jwtSecret.isNotBlank() && url.isNotBlank() && backendUrl.isNotBlank() && internalUrl.isNotBlank()

    /** The path part of [url]: the document server's links carry it in front of its own paths. */
    val urlPath: String
        get() = if (url.startsWith("/")) url else java.net.URI(url).path.orEmpty().trimEnd('/')
}
