package com.docuvault.service.ai

import com.aallam.openai.api.chat.ChatMessage
import com.aallam.openai.api.chat.ChatRole
import com.aallam.openai.api.chat.ImagePart
import com.aallam.openai.api.chat.TextPart
import kotlinx.serialization.json.Json
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * openai-kotlin 3.7.0 and 3.7.1 sent image parts as type "image", which the API
 * rejects; photos only reach the model from 3.7.2 on. Guards against a downgrade.
 */
class ImagePartWireFormatTest {
    @Test
    fun `image parts go to OpenAI as image_url`() {
        val message = ChatMessage(role = ChatRole.User, content = listOf(TextPart("What is on this note?"), ImagePart("data:image/png;base64,AAAA", "high")))
        val json = Json.encodeToString(ChatMessage.serializer(), message)
        assertTrue(json.contains("\"type\":\"image_url\""), json)
    }
}
