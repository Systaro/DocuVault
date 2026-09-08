package com.docuvault.service

import org.slf4j.LoggerFactory
import org.springframework.http.MediaType
import org.springframework.http.client.SimpleClientHttpRequestFactory
import org.springframework.stereotype.Service
import org.springframework.web.client.RestClient
import java.time.Duration

/**
 * Turns a document's HTML into a PDF using an external renderer.
 *
 * The renderer is **optional and configured per install** (`pdf.render-url`,
 * `pdf.api-key`). DocuVault is self-hosted by other people, so no particular
 * service is baked in: with nothing configured the frontend falls back to the
 * browser's print dialog and this service is never called.
 *
 * It lives on the server for one reason above all: the API key. A key shipped
 * to the browser is a key given to everyone who opens the network tab.
 */
@Service
class PdfRenderService(
    private val settingsService: SettingsService
) {
    private val log = LoggerFactory.getLogger(PdfRenderService::class.java)

    private val client: RestClient by lazy {
        // Rendering a long document takes seconds; a renderer that has gone away
        // must not hold a request thread until something else times out.
        val factory = SimpleClientHttpRequestFactory().apply {
            setConnectTimeout(CONNECT_TIMEOUT)
            setReadTimeout(READ_TIMEOUT)
        }
        RestClient.builder().requestFactory(factory).build()
    }

    fun isConfigured(): Boolean = settingsService.isPdfConfigured()

    /**
     * @return the PDF bytes, or null if the renderer is unconfigured or refused.
     *         Callers turn null into a plain "not available" rather than a 500 —
     *         a failed PDF is a papercut, not an outage.
     */
    fun render(html: String, dpi: Int = 150): ByteArray? {
        val url = settingsService.getPdfRenderUrl()
        if (url.isBlank()) return null
        val apiKey = settingsService.getPdfApiKey()

        return try {
            client.post()
                .uri(url)
                .contentType(MediaType.APPLICATION_JSON)
                .accept(MediaType.APPLICATION_PDF, MediaType.ALL)
                .apply { if (apiKey.isNotBlank()) header("X-API-Key", apiKey) }
                .body(mapOf("html" to html, "options" to mapOf("dpi" to dpi)))
                .retrieve()
                .body(ByteArray::class.java)
                ?.takeIf { it.isNotEmpty() }
        } catch (e: Exception) {
            // The key must never reach the log, so only the message is kept.
            log.warn("PDF render failed via {}: {}", url, e.message)
            null
        }
    }

    companion object {
        private val CONNECT_TIMEOUT: Duration = Duration.ofSeconds(5)
        private val READ_TIMEOUT: Duration = Duration.ofSeconds(60)
    }
}
