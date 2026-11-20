package com.docuvault.live

import java.io.ByteArrayOutputStream

/**
 * Reads and writes the awareness updates of y-protocols: who is in a document and
 * where their cursor is. Wire format (lib0 encoding):
 *
 *     varUint count, then per client: varUint clientId, varUint clock, varString stateJson
 *
 * The server decodes them so the identity in a state is the one it verified, not
 * whatever name a client chose to send.
 */
object AwarenessCodec {

    data class Entry(val clientId: Long, val clock: Long, val stateJson: String)

    class MalformedAwarenessException(message: String) : RuntimeException(message)

    fun decode(bytes: ByteArray): List<Entry> {
        val reader = Reader(bytes)
        val count = reader.varUint()
        if (count > MAX_ENTRIES) throw MalformedAwarenessException("Too many awareness entries: $count")
        val entries = (0 until count).map {
            Entry(clientId = reader.varUint(), clock = reader.varUint(), stateJson = reader.varString())
        }
        if (!reader.atEnd()) throw MalformedAwarenessException("Trailing bytes in awareness update")
        return entries
    }

    fun encode(entries: List<Entry>): ByteArray {
        val out = ByteArrayOutputStream()
        writeVarUint(out, entries.size.toLong())
        for (entry in entries) {
            writeVarUint(out, entry.clientId)
            writeVarUint(out, entry.clock)
            val text = entry.stateJson.toByteArray(Charsets.UTF_8)
            writeVarUint(out, text.size.toLong())
            out.write(text)
        }
        return out.toByteArray()
    }

    private fun writeVarUint(out: ByteArrayOutputStream, value: Long) {
        require(value >= 0) { "varUint must not be negative" }
        var num = value
        while (num > 0x7F) {
            out.write(((num and 0x7F) or 0x80).toInt())
            num = num ushr 7
        }
        out.write(num.toInt())
    }

    private class Reader(private val bytes: ByteArray) {
        private var pos = 0

        fun atEnd() = pos == bytes.size

        fun varUint(): Long {
            var num = 0L
            var shift = 0
            while (true) {
                if (pos >= bytes.size) throw MalformedAwarenessException("Truncated varUint")
                val b = bytes[pos++].toInt() and 0xFF
                num = num or ((b and 0x7F).toLong() shl shift)
                if (b < 0x80) return num
                shift += 7
                // Client ids are uint32 and clocks fit well within this; anything longer is not ours.
                if (shift > 49) throw MalformedAwarenessException("varUint too long")
            }
        }

        fun varString(): String {
            val length = varUint()
            if (length > bytes.size - pos) throw MalformedAwarenessException("Truncated string")
            val text = String(bytes, pos, length.toInt(), Charsets.UTF_8)
            pos += length.toInt()
            return text
        }
    }

    private const val MAX_ENTRIES = 64L
}
