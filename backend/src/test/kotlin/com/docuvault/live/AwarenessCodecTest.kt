package com.docuvault.live

import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

/** The awareness wire format must match y-protocols byte for byte, or cursors vanish. */
class AwarenessCodecTest {

    @Test
    fun `encodes the way y-protocols does`() {
        // count 1, clientId 300 (0xAC 0x02), clock 5, then the JSON state "{}"
        val expected = byteArrayOf(1, 0xAC.toByte(), 0x02, 5, 2, '{'.code.toByte(), '}'.code.toByte())
        assertArrayEquals(expected, AwarenessCodec.encode(listOf(AwarenessCodec.Entry(300, 5, "{}"))))
    }

    @Test
    fun `decodes what it encodes, including large client ids and non-ASCII names`() {
        val entries = listOf(
            AwarenessCodec.Entry(4_294_967_295, 1, """{"user":{"name":"Jürgen Übel"}}"""),
            AwarenessCodec.Entry(1, 0, "null")
        )
        assertEquals(entries, AwarenessCodec.decode(AwarenessCodec.encode(entries)))
    }

    @Test
    fun `rejects truncated input`() {
        val bytes = AwarenessCodec.encode(listOf(AwarenessCodec.Entry(300, 5, "{\"a\":1}")))
        assertThrows<AwarenessCodec.MalformedAwarenessException> { AwarenessCodec.decode(bytes.copyOf(bytes.size - 2)) }
    }
}
