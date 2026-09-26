package com.docuvault.api

import com.docuvault.service.branding.BrandingAssetKind
import com.docuvault.service.branding.BrandingDto
import com.docuvault.service.branding.BrandingService
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.web.bind.annotation.*
import org.springframework.web.multipart.MultipartFile

/**
 * The install's brand. Reading it is public — the login page, public shares
 * and email clients have no session — changing it is for super admins.
 */
@RestController
@RequestMapping("/branding")
class BrandingController(private val brandingService: BrandingService) {

    @GetMapping
    fun get(): BrandingDto = brandingService.branding()

    @PutMapping
    @PreAuthorize("hasRole('SUPER_ADMIN')")
    fun update(@RequestBody request: UpdateBrandingRequest): BrandingDto =
        brandingService.update(request.appName, request.primaryColor)

    @PostMapping("/assets/{kind}", consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    @PreAuthorize("hasRole('SUPER_ADMIN')")
    fun uploadAsset(@PathVariable kind: String, @RequestParam("file") file: MultipartFile): BrandingDto =
        brandingService.storeAsset(BrandingAssetKind.of(kind), file.contentType, file.bytes)

    @DeleteMapping("/assets/{kind}")
    @PreAuthorize("hasRole('SUPER_ADMIN')")
    fun deleteAsset(@PathVariable kind: String): BrandingDto =
        brandingService.deleteAsset(BrandingAssetKind.of(kind))

    /**
     * A request carrying the current version (`?v=`) can be cached for good,
     * because the URL changes with every upload; anything else only briefly.
     * Spring answers a matching If-None-Match with 304 from the ETag.
     */
    @GetMapping("/assets/{kind}")
    fun getAsset(
        @PathVariable kind: String,
        @RequestParam("v", required = false) version: String?
    ): ResponseEntity<ByteArray> {
        val asset = brandingService.loadAsset(BrandingAssetKind.of(kind))
            ?: return ResponseEntity.notFound().build()
        val headers = HttpHeaders().apply {
            cacheControl = if (version == asset.version) "public, max-age=31536000, immutable" else "public, max-age=300"
            eTag = "\"${asset.version}\""
            // Opened directly, an SVG is a document; this keeps any script in it from running.
            if (asset.contentType == "image/svg+xml") {
                set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
            }
        }
        return ResponseEntity.ok()
            .headers(headers)
            .contentType(MediaType.parseMediaType(asset.contentType))
            .body(asset.bytes)
    }
}

/** Per field: null leaves it unchanged, "" resets it to the default. See [BrandingService.update]. */
data class UpdateBrandingRequest(
    val appName: String? = null,
    val primaryColor: String? = null
)
