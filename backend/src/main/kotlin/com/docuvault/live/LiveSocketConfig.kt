package com.docuvault.live

import com.docuvault.config.AllowedOrigins
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.stereotype.Component
import org.springframework.web.socket.CloseStatus
import org.springframework.web.socket.TextMessage
import org.springframework.web.socket.WebSocketSession
import org.springframework.web.socket.config.annotation.EnableWebSocket
import org.springframework.web.socket.config.annotation.WebSocketConfigurer
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator
import org.springframework.web.socket.handler.TextWebSocketHandler
import org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean

/** The live socket at `/api/live`, open to the same origins as the API. */
@Configuration
@EnableWebSocket
class LiveSocketConfig(
    private val handler: LiveSocketHandler,
    private val allowedOrigins: AllowedOrigins
) : WebSocketConfigurer {

    override fun registerWebSocketHandlers(registry: WebSocketHandlerRegistry) {
        registry.addHandler(handler, "/live").setAllowedOrigins(*allowedOrigins.list.toTypedArray())
    }

    @Bean
    fun liveSocketContainer(): ServletServerContainerFactoryBean = ServletServerContainerFactoryBean().apply {
        // A whole document's state arrives in one message when a tab seeds it.
        setMaxTextMessageBufferSize(LiveHub.MAX_UPDATE_CHARS + 64 * 1024)
        // Tabs ping every 25 seconds; one that stays silent longer is gone.
        setMaxSessionIdleTimeout(IDLE_TIMEOUT_MS)
    }

    private companion object {
        const val IDLE_TIMEOUT_MS = 75_000L
    }
}

@Component
class LiveSocketHandler(private val hub: LiveHub) : TextWebSocketHandler() {

    override fun afterConnectionEstablished(session: WebSocketSession) {
        // Sends come from several threads (relays, saves, presence); the decorator
        // serializes them and drops a tab whose buffer runs over instead of blocking.
        hub.connect(session, ConcurrentWebSocketSessionDecorator(session, SEND_TIME_LIMIT_MS, SEND_BUFFER_LIMIT))
    }

    override fun handleTextMessage(session: WebSocketSession, message: TextMessage) {
        hub.handle(session.id, message.payload)
    }

    override fun afterConnectionClosed(session: WebSocketSession, status: CloseStatus) {
        hub.disconnect(session.id)
    }

    override fun handleTransportError(session: WebSocketSession, exception: Throwable) {
        hub.disconnect(session.id)
    }

    private companion object {
        const val SEND_TIME_LIMIT_MS = 10_000
        const val SEND_BUFFER_LIMIT = 8 * 1024 * 1024
    }
}
