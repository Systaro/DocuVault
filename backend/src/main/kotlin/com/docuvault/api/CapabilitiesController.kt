package com.docuvault.api

import com.docuvault.config.OpenAIProvider
import com.docuvault.service.PdfRenderService
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping("/capabilities")
class CapabilitiesController(
    private val openAIProvider: OpenAIProvider,
    private val pdfRenderService: PdfRenderService
) {
    @GetMapping
    fun get(): CapabilitiesResponse {
        val aiEnabled = openAIProvider.isConfigured()
        return CapabilitiesResponse(
            ai = AiCapabilities(
                enabled = aiEnabled,
                chat = aiEnabled,
                inbox = aiEnabled
            ),
            // False means the client keeps using the browser's print dialog.
            pdfRenderer = pdfRenderService.isConfigured()
        )
    }
}

data class CapabilitiesResponse(val ai: AiCapabilities, val pdfRenderer: Boolean = false)
data class AiCapabilities(
    val enabled: Boolean,
    val chat: Boolean,
    val inbox: Boolean
)
