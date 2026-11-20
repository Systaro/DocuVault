package com.docuvault.api

import com.docuvault.config.OpenAIProvider
import com.docuvault.office.OfficeSettings
import com.docuvault.service.PdfRenderService
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping("/capabilities")
class CapabilitiesController(
    private val openAIProvider: OpenAIProvider,
    private val pdfRenderService: PdfRenderService,
    private val officeSettings: OfficeSettings
) {
    @GetMapping
    fun get(): CapabilitiesResponse {
        val aiEnabled = openAIProvider.isConfigured()
        return CapabilitiesResponse(
            ai = AiCapabilities(
                enabled = aiEnabled,
                chat = aiEnabled,
                inbox = aiEnabled,
                voice = aiEnabled
            ),
            // False means the client keeps using the browser's print dialog.
            pdfRenderer = pdfRenderService.isConfigured(),
            office = OfficeCapabilities(
                enabled = officeSettings.enabled,
                url = officeSettings.url.takeIf { officeSettings.enabled }
            )
        )
    }
}

data class CapabilitiesResponse(
    val ai: AiCapabilities,
    val pdfRenderer: Boolean = false,
    val office: OfficeCapabilities = OfficeCapabilities(false, null)
)

/** Word documents can be edited in the browser; [url] is where the editor's script lives. */
data class OfficeCapabilities(val enabled: Boolean, val url: String?)
data class AiCapabilities(
    val enabled: Boolean,
    val chat: Boolean,
    val inbox: Boolean,
    /** Speech to text for the ask box and quick notes. */
    val voice: Boolean
)
