package com.docuvault.service.meeting

import com.docuvault.api.meetings.MeetingInviteDto
import org.slf4j.LoggerFactory
import org.springframework.http.MediaType
import org.springframework.stereotype.Service
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter
import java.io.IOException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Holds the live Server-Sent-Events connections that watch meeting activity in a
 * space and fans out invite updates to them. Connections are kept in memory, so
 * this only fans out within a single backend instance — fine for the
 * single-instance deployments DocuVault runs today.
 */
@Service
class MeetingStreamService {
    private val logger = LoggerFactory.getLogger(MeetingStreamService::class.java)

    /** Active emitters keyed by space id. */
    private val emitters = ConcurrentHashMap<UUID, CopyOnWriteArrayList<SseEmitter>>()

    /** Registers a new browser connection watching [spaceId]'s meeting activity. */
    fun subscribe(spaceId: UUID): SseEmitter {
        val emitter = SseEmitter(STREAM_TIMEOUT_MS)
        val list = emitters.computeIfAbsent(spaceId) { CopyOnWriteArrayList() }
        list.add(emitter)

        emitter.onCompletion { remove(spaceId, emitter) }
        emitter.onTimeout {
            emitter.complete()
            remove(spaceId, emitter)
        }
        emitter.onError { remove(spaceId, emitter) }

        // Open the stream immediately so the client's onopen fires and proxies
        // don't sit waiting for the first byte.
        try {
            emitter.send(SseEmitter.event().comment("connected"))
        } catch (e: IOException) {
            remove(spaceId, emitter)
        }
        return emitter
    }

    /** Pushes an updated invite to every browser watching its space. */
    fun publish(spaceId: UUID, invite: MeetingInviteDto) {
        val list = emitters[spaceId] ?: return
        list.forEach { emitter ->
            try {
                emitter.send(
                    SseEmitter.event().name("invite").data(invite, MediaType.APPLICATION_JSON)
                )
            } catch (e: Exception) {
                // Client went away between the registry check and the send.
                remove(spaceId, emitter)
            }
        }
    }

    private fun remove(spaceId: UUID, emitter: SseEmitter) {
        emitters[spaceId]?.let { list ->
            list.remove(emitter)
            if (list.isEmpty()) emitters.remove(spaceId, list)
        }
    }

    companion object {
        /** Browsers reconnect automatically; recycle idle streams after 30 min. */
        private const val STREAM_TIMEOUT_MS = 30L * 60 * 1000
    }
}
