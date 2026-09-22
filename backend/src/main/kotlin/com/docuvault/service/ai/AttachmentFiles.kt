package com.docuvault.service.ai

import com.docuvault.domain.ai.AttachmentKind
import org.apache.pdfbox.Loader
import org.apache.pdfbox.pdmodel.encryption.InvalidPasswordException
import org.apache.pdfbox.rendering.ImageType
import org.apache.pdfbox.rendering.PDFRenderer
import org.apache.pdfbox.text.PDFTextStripper
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import javax.imageio.ImageIO

/** What a file turned out to be, judged by its bytes rather than by what the browser claimed. */
data class DetectedFile(val kind: AttachmentKind, val contentType: String)

/** The readable part of a PDF: its text, and the pages that had none rendered as images. */
data class PdfContent(val text: String, val pageCount: Int, val renderedPages: List<ByteArray>)

class UnsupportedAttachmentException(message: String) : RuntimeException(message)

/** Recognising and reading the files people attach. No Spring, so it can be tested on its own. */
object AttachmentFiles {
    private val TEXT_EXTENSIONS = mapOf(
        "txt" to "text/plain",
        "md" to "text/markdown",
        "markdown" to "text/markdown",
        "csv" to "text/csv",
        "tsv" to "text/tab-separated-values"
    )

    /** A page with less text than this is a scan (or a photo) and goes to the model as an image. */
    private const val SCANNED_PAGE_CHARS = 40
    private const val MAX_RENDERED_PAGES = 10
    private const val RENDER_DPI = 110f
    const val MAX_TEXT_CHARS = 200_000

    fun detect(fileName: String, bytes: ByteArray): DetectedFile {
        if (bytes.isEmpty()) throw UnsupportedAttachmentException("$fileName is empty")
        imageType(bytes)?.let { return DetectedFile(AttachmentKind.IMAGE, it) }
        if (startsWith(bytes, "%PDF-".toByteArray())) return DetectedFile(AttachmentKind.PDF, "application/pdf")

        val extension = fileName.substringAfterLast('.', "").lowercase()
        TEXT_EXTENSIONS[extension]?.let { type ->
            if (decodeUtf8(bytes) != null) return DetectedFile(AttachmentKind.TEXT, type)
            throw UnsupportedAttachmentException("$fileName is not readable text (UTF-8 expected)")
        }
        if (extension == "heic" || extension == "heif") {
            throw UnsupportedAttachmentException("$fileName is a HEIC photo. Export it as JPEG, or pick it through the photo library so the phone converts it.")
        }
        throw UnsupportedAttachmentException("$fileName is not a supported file. Photos (JPG, PNG, WebP, GIF), PDFs and text, Markdown or CSV files work.")
    }

    /** Strict UTF-8, so a binary file renamed to .txt is refused instead of sent as garbage. */
    fun decodeUtf8(bytes: ByteArray): String? {
        if (bytes.any { it == 0.toByte() }) return null
        return try {
            Charsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes))
                .toString()
                .removePrefix("﻿")
        } catch (e: CharacterCodingException) {
            null
        }
    }

    fun readPdf(fileName: String, bytes: ByteArray): PdfContent {
        val document = try {
            Loader.loadPDF(bytes)
        } catch (e: InvalidPasswordException) {
            throw UnsupportedAttachmentException("$fileName is password protected")
        } catch (e: Exception) {
            throw UnsupportedAttachmentException("$fileName could not be read as a PDF")
        }
        document.use { pdf ->
            val stripper = PDFTextStripper()
            val renderer = PDFRenderer(pdf)
            val text = StringBuilder()
            val rendered = mutableListOf<ByteArray>()
            for (page in 1..pdf.numberOfPages) {
                stripper.startPage = page
                stripper.endPage = page
                val pageText = stripper.getText(pdf).trim()
                if (pageText.length >= SCANNED_PAGE_CHARS) {
                    if (text.length < MAX_TEXT_CHARS) text.append("--- Page $page ---\n").append(pageText).append("\n\n")
                } else if (rendered.size < MAX_RENDERED_PAGES) {
                    text.append("--- Page $page: scanned, see image ${rendered.size + 1} ---\n\n")
                    rendered += png(renderer, page - 1)
                } else {
                    text.append("--- Page $page: scanned, not included (only the first $MAX_RENDERED_PAGES scanned pages are read) ---\n\n")
                }
            }
            return PdfContent(text.toString().take(MAX_TEXT_CHARS).trim(), pdf.numberOfPages, rendered)
        }
    }

    private fun png(renderer: PDFRenderer, pageIndex: Int): ByteArray {
        val image = renderer.renderImageWithDPI(pageIndex, RENDER_DPI, ImageType.RGB)
        return ByteArrayOutputStream().use { out ->
            ImageIO.write(image, "png", out)
            out.toByteArray()
        }
    }

    private fun imageType(bytes: ByteArray): String? = when {
        startsWith(bytes, byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte())) -> "image/jpeg"
        startsWith(bytes, byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)) -> "image/png"
        startsWith(bytes, "GIF87a".toByteArray()) || startsWith(bytes, "GIF89a".toByteArray()) -> "image/gif"
        bytes.size > 12 && startsWith(bytes, "RIFF".toByteArray()) &&
            String(bytes, 8, 4, Charsets.US_ASCII) == "WEBP" -> "image/webp"
        else -> null
    }

    private fun startsWith(bytes: ByteArray, prefix: ByteArray): Boolean =
        bytes.size >= prefix.size && prefix.indices.all { bytes[it] == prefix[it] }
}
