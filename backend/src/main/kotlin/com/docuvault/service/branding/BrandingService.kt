package com.docuvault.service.branding

import com.docuvault.service.SettingsService
import org.springframework.beans.factory.annotation.Value
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.web.server.ResponseStatusException
import software.amazon.awssdk.core.sync.RequestBody
import software.amazon.awssdk.services.s3.S3Client
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest
import software.amazon.awssdk.services.s3.model.GetObjectRequest
import software.amazon.awssdk.services.s3.model.NoSuchKeyException
import software.amazon.awssdk.services.s3.model.PutObjectRequest

/** The images an install can replace. [slug] is the URL path segment. */
enum class BrandingAssetKind(val slug: String, val allowsIco: Boolean = false) {
    /** For light backgrounds; the main logo. */
    LOGO("logo"),
    /** For dark or coloured backgrounds; clients fall back to [LOGO]. */
    LOGO_DARK("logo-dark"),
    FAVICON("favicon", allowsIco = true);

    val objectKey get() = "branding/$slug"
    /** Present only while the asset is uploaded, so reading the branding needs no MinIO round trip. */
    val contentTypeKey get() = "branding.asset.$slug.content-type"

    companion object {
        fun of(slug: String): BrandingAssetKind = entries.firstOrNull { it.slug == slug }
            ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Unknown branding asset '$slug'")
    }
}

data class BrandingDto(
    val appName: String,
    val primaryColor: String?,
    val logo: String?,
    val logoDark: String?,
    val favicon: String?,
    val customized: Boolean
)

class BrandingAsset(val bytes: ByteArray, val contentType: String, val version: String)

/** What an email needs to carry the install's brand. Resolve it once per send (or batch). */
data class EmailBrand(val appName: String, val color: String, val logoUrl: String?, val publicUrl: String) {
    val host: String get() = publicUrl.replace(Regex("^https?://"), "")
}

/**
 * Single source of the install's brand: name, primary colour and the logo /
 * favicon images. One install is one brand, so everything lives in app_settings
 * plus a `branding/` prefix in the logo bucket.
 */
@Service
class BrandingService(
    private val settingsService: SettingsService,
    private val s3Client: S3Client,
    @Value("\${minio.bucket}") private val bucket: String,
    @Value("\${app.public-url}") publicUrl: String
) {
    val publicUrl: String = publicUrl.trimEnd('/')

    companion object {
        const val DEFAULT_APP_NAME = "DocuVault"
        /** The product's dark teal; emails need a concrete colour where the UI can fall back to its palette. */
        const val DEFAULT_EMAIL_COLOR = "#388087"
        const val APP_NAME = "branding.app-name"
        const val PRIMARY_COLOR = "branding.primary-color"
        const val ASSETS_VERSION = "branding.assets-version"
        const val MAX_APP_NAME_LENGTH = 60
        const val MAX_ASSET_BYTES = 1024 * 1024

        private val COLOR_PATTERN = Regex("^#[0-9a-fA-F]{6}$")
        private const val SVG = "image/svg+xml"
        private const val ICO = "image/x-icon"

        /**
         * The image type the bytes actually are, or null for anything we don't
         * accept. The client's declared MIME type is only checked against this.
         */
        fun sniffContentType(bytes: ByteArray): String? {
            fun startsWith(vararg prefix: Int) =
                bytes.size >= prefix.size && prefix.indices.all { bytes[it] == prefix[it].toByte() }
            return when {
                startsWith(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A) -> "image/png"
                startsWith(0xFF, 0xD8, 0xFF) -> "image/jpeg"
                bytes.size >= 12 && String(bytes, 0, 4, Charsets.US_ASCII) == "RIFF" &&
                    String(bytes, 8, 4, Charsets.US_ASCII) == "WEBP" -> "image/webp"
                startsWith(0x00, 0x00, 0x01, 0x00) -> ICO
                isSvg(bytes) -> SVG
                else -> null
            }
        }

        private fun isSvg(bytes: ByteArray): Boolean {
            val text = String(bytes, Charsets.UTF_8).removePrefix("﻿").trimStart()
            return (text.startsWith("<svg") || text.startsWith("<?xml")) && text.contains("<svg")
        }

        private fun canonicalType(declared: String?): String? = when (val type = declared?.substringBefore(';')?.trim()?.lowercase()) {
            null, "", "application/octet-stream" -> null
            "image/jpg", "image/pjpeg" -> "image/jpeg"
            "image/vnd.microsoft.icon" -> ICO
            else -> type
        }
    }

    fun appName(): String = settingsService.getOrDefault(APP_NAME, DEFAULT_APP_NAME)

    /** Null means the product's default palette. */
    fun primaryColor(): String? = settingsService.get(PRIMARY_COLOR)?.takeIf { it.isNotBlank() }

    fun emailPrimaryColor(): String = primaryColor() ?: DEFAULT_EMAIL_COLOR

    fun assetsVersion(): String = settingsService.getOrDefault(ASSETS_VERSION, "0")

    fun relativeAssetUrl(kind: BrandingAssetKind): String? =
        assetContentType(kind)?.let { "/api/branding/assets/${kind.slug}?v=${assetsVersion()}" }

    /** For emails, which have no origin to resolve a relative URL against. */
    fun absoluteAssetUrl(kind: BrandingAssetKind): String? = relativeAssetUrl(kind)?.let { publicUrl + it }

    /** The email header is coloured, so only the logo meant for dark backgrounds fits there. */
    fun emailBrand(): EmailBrand =
        EmailBrand(appName(), emailPrimaryColor(), absoluteAssetUrl(BrandingAssetKind.LOGO_DARK), publicUrl)

    fun branding(): BrandingDto {
        val storedName = settingsService.get(APP_NAME)?.takeIf { it.isNotBlank() }
        val color = primaryColor()
        val logo = relativeAssetUrl(BrandingAssetKind.LOGO)
        val logoDark = relativeAssetUrl(BrandingAssetKind.LOGO_DARK)
        val favicon = relativeAssetUrl(BrandingAssetKind.FAVICON)
        return BrandingDto(
            appName = storedName ?: DEFAULT_APP_NAME,
            primaryColor = color,
            logo = logo,
            logoDark = logoDark,
            favicon = favicon,
            customized = listOf(storedName, color, logo, logoDark, favicon).any { it != null }
        )
    }

    /**
     * Partial update. Per field: null leaves it unchanged (like
     * UpdateSettingsRequest), a blank string resets it to the product default,
     * anything else is validated and stored.
     */
    fun update(appName: String?, primaryColor: String?): BrandingDto {
        val name = appName?.trim()?.let { if (it.isEmpty()) null else validAppName(it) }
        val color = primaryColor?.trim()?.let { if (it.isEmpty()) null else validColor(it) }
        if (appName != null) settingsService.set(APP_NAME, name)
        if (primaryColor != null) settingsService.set(PRIMARY_COLOR, color)
        return branding()
    }

    fun storeAsset(kind: BrandingAssetKind, declaredType: String?, bytes: ByteArray): BrandingDto {
        if (bytes.size > MAX_ASSET_BYTES) {
            throw ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "The image must be 1 MB or smaller")
        }
        val sniffed = sniffContentType(bytes)
        val allowed = sniffed != null && (sniffed != ICO || kind.allowsIco)
        if (!allowed) {
            val formats = if (kind.allowsIco) "PNG, JPEG, WebP, SVG or ICO" else "PNG, JPEG, WebP or SVG"
            throw ResponseStatusException(HttpStatus.BAD_REQUEST, "The ${kind.slug} must be a $formats image")
        }
        val declared = canonicalType(declaredType)
        if (declared != null && declared != sniffed) {
            throw ResponseStatusException(HttpStatus.BAD_REQUEST, "The file content does not match its type ($declared)")
        }

        s3Client.putObject(
            PutObjectRequest.builder().bucket(bucket).key(kind.objectKey).contentType(sniffed).build(),
            RequestBody.fromBytes(bytes)
        )
        settingsService.set(kind.contentTypeKey, sniffed)
        bumpVersion()
        return branding()
    }

    fun deleteAsset(kind: BrandingAssetKind): BrandingDto {
        s3Client.deleteObject(DeleteObjectRequest.builder().bucket(bucket).key(kind.objectKey).build())
        settingsService.set(kind.contentTypeKey, null)
        bumpVersion()
        return branding()
    }

    fun loadAsset(kind: BrandingAssetKind): BrandingAsset? {
        val contentType = assetContentType(kind) ?: return null
        val bytes = try {
            s3Client.getObject(GetObjectRequest.builder().bucket(bucket).key(kind.objectKey).build()).use { it.readAllBytes() }
        } catch (_: NoSuchKeyException) {
            return null
        }
        return BrandingAsset(bytes, contentType, assetsVersion())
    }

    private fun assetContentType(kind: BrandingAssetKind): String? =
        settingsService.get(kind.contentTypeKey)?.takeIf { it.isNotBlank() }

    private fun bumpVersion() = settingsService.set(ASSETS_VERSION, System.currentTimeMillis().toString())

    private fun validAppName(name: String): String {
        if (name.length > MAX_APP_NAME_LENGTH) {
            throw ResponseStatusException(HttpStatus.BAD_REQUEST, "The app name can be at most $MAX_APP_NAME_LENGTH characters")
        }
        if (name.any { it.isISOControl() || it == '<' || it == '>' }) {
            throw ResponseStatusException(HttpStatus.BAD_REQUEST, "The app name cannot contain control characters, '<' or '>'")
        }
        return name
    }

    private fun validColor(color: String): String {
        if (!COLOR_PATTERN.matches(color)) {
            throw ResponseStatusException(HttpStatus.BAD_REQUEST, "The primary colour must be a hex colour like #388087")
        }
        return color.lowercase()
    }
}
