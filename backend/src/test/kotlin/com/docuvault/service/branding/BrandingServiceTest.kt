package com.docuvault.service.branding

import com.docuvault.api.BrandingController
import com.docuvault.service.EmailLayout
import com.docuvault.service.SettingsService
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.mockito.ArgumentMatchers.any
import org.mockito.ArgumentMatchers.anyBoolean
import org.mockito.ArgumentMatchers.anyString
import org.mockito.Mockito.doAnswer
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException
import software.amazon.awssdk.services.s3.S3Client

/** Name, colour and logo uploads are admin input that ends up on every page and in every email. */
class BrandingServiceTest {

    private val stored = mutableMapOf<String, String?>()
    private val settings = mock(SettingsService::class.java).also { settings ->
        doAnswer { stored[it.getArgument(0)] }.`when`(settings).get(anyString())
        doAnswer { stored[it.getArgument<String>(0)]?.takeIf { v -> v.isNotBlank() } ?: it.getArgument(1) }
            .`when`(settings).getOrDefault(anyString(), anyString())
        doAnswer { stored[it.getArgument(0)] = it.getArgument(1); null }
            .`when`(settings).set(anyString(), any(), anyBoolean())
    }
    private val s3 = mock(S3Client::class.java)
    private val service = BrandingService(settings, s3, "space-logos", "https://docs.example/")

    private val png = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0)
    private val ico = byteArrayOf(0, 0, 1, 0, 1, 0, 16, 16)
    private val svg = "﻿  <?xml version=\"1.0\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\"/>".toByteArray()

    private fun status(block: () -> Unit) = assertThrows<ResponseStatusException>(block).statusCode

    @Test
    fun `an untouched install reports the product defaults`() {
        assertEquals(BrandingDto("DocuVault", null, null, null, null, customized = false), service.branding())
        assertEquals("#388087", service.emailPrimaryColor())
    }

    @Test
    fun `colours must be six digit hex and are stored lowercase`() {
        assertEquals("#aabbcc", service.update(null, "#AABBCC").primaryColor)
        listOf("#abc", "aabbcc", "#aabbcg", "#aabbccdd", "red").forEach {
            assertEquals(HttpStatus.BAD_REQUEST, status { service.update(null, it) }, it)
        }
        assertEquals("#aabbcc", service.primaryColor())
    }

    @Test
    fun `app names are trimmed, at most 60 characters and free of markup and control characters`() {
        assertEquals("Acme Docs", service.update("  Acme Docs ", null).appName)
        assertEquals("x".repeat(60), service.update("x".repeat(60), null).appName)
        listOf("x".repeat(61), "Acme <b>", "Acme > Docs", "Acme\nDocs", "Acme\u0007").forEach {
            assertEquals(HttpStatus.BAD_REQUEST, status { service.update(it, null) }, it)
        }
        assertEquals("x".repeat(60), service.appName())
    }

    @Test
    fun `null leaves a field alone and an empty string resets it`() {
        service.update("Acme Docs", "#112233")

        val untouched = service.update(null, null)
        assertEquals("Acme Docs", untouched.appName)
        assertEquals("#112233", untouched.primaryColor)
        assertTrue(untouched.customized)

        val reset = service.update("", "")
        assertEquals("DocuVault", reset.appName)
        assertNull(reset.primaryColor)
        assertFalse(reset.customized)
    }

    @Test
    fun `an uploaded asset gets a versioned relative url, and an absolute one for emails`() {
        val dto = service.storeAsset(BrandingAssetKind.LOGO_DARK, "image/png", png)
        val version = service.assetsVersion()

        assertEquals("/api/branding/assets/logo-dark?v=$version", dto.logoDark)
        assertNull(dto.logo)
        assertTrue(dto.customized)
        assertEquals("https://docs.example/api/branding/assets/logo-dark?v=$version", service.emailBrand().logoUrl)
        assertEquals("image/png", stored[BrandingAssetKind.LOGO_DARK.contentTypeKey])
    }

    @Test
    fun `the content decides the type, and it must match what the client claims`() {
        assertEquals(HttpStatus.BAD_REQUEST, status { service.storeAsset(BrandingAssetKind.LOGO, "image/svg+xml", png) })
        assertEquals(HttpStatus.BAD_REQUEST, status { service.storeAsset(BrandingAssetKind.LOGO, "image/png", svg) })
        assertEquals(HttpStatus.BAD_REQUEST, status { service.storeAsset(BrandingAssetKind.LOGO, "image/svg+xml", "<html><svg/></html>".toByteArray()) })

        service.storeAsset(BrandingAssetKind.LOGO, "image/svg+xml", svg)
        assertEquals("image/svg+xml", stored[BrandingAssetKind.LOGO.contentTypeKey])
        service.storeAsset(BrandingAssetKind.LOGO, "application/octet-stream", png)
        assertEquals("image/png", stored[BrandingAssetKind.LOGO.contentTypeKey])
    }

    @Test
    fun `icons are only accepted as a favicon`() {
        assertEquals(HttpStatus.BAD_REQUEST, status { service.storeAsset(BrandingAssetKind.LOGO, "image/x-icon", ico) })
        service.storeAsset(BrandingAssetKind.FAVICON, "image/vnd.microsoft.icon", ico)
        assertEquals("image/x-icon", stored[BrandingAssetKind.FAVICON.contentTypeKey])
    }

    @Test
    fun `assets over 1 MB are refused before anything is stored`() {
        val big = png + ByteArray(BrandingService.MAX_ASSET_BYTES)
        assertEquals(HttpStatus.PAYLOAD_TOO_LARGE, status { service.storeAsset(BrandingAssetKind.LOGO, "image/png", big) })
        assertNull(stored[BrandingAssetKind.LOGO.contentTypeKey])
    }

    @Test
    fun `an unknown asset kind is a 404`() {
        assertEquals(HttpStatus.NOT_FOUND, status { BrandingAssetKind.of("banner") })
    }

    @Test
    fun `a versioned asset request is cached for good, and an svg cannot run script`() {
        val branding = mock(BrandingService::class.java)
        `when`(branding.loadAsset(BrandingAssetKind.LOGO)).thenReturn(BrandingAsset(svg, "image/svg+xml", "42"))
        val controller = BrandingController(branding)

        val current = controller.getAsset("logo", "42")
        assertEquals("public, max-age=31536000, immutable", current.headers.cacheControl)
        assertEquals("\"42\"", current.headers.eTag)
        assertTrue(current.headers.getFirst("Content-Security-Policy")!!.contains("sandbox"))

        assertEquals("public, max-age=300", controller.getAsset("logo", null).headers.cacheControl)
        assertEquals(HttpStatus.NOT_FOUND, controller.getAsset("favicon", "42").statusCode)
    }

    @Test
    fun `email text stays white on the default teal and turns dark on a pale brand colour`() {
        assertEquals("#ffffff", EmailLayout.textOn(BrandingService.DEFAULT_EMAIL_COLOR))
        assertEquals("#1a1a1a", EmailLayout.textOn("#ffe066"))
    }
}
