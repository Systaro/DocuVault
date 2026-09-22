package com.docuvault.api

import jakarta.annotation.PreDestroy
import jakarta.servlet.http.HttpServletResponse
import org.slf4j.LoggerFactory
import org.springframework.http.MediaType
import org.springframework.stereotype.Component
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter
import java.io.IOException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Runs long work off the request thread and streams what it reports as
 * server-sent events — an assistant answer, the progress of a move. The work gets
 * its own pool: it can take tens of seconds and must occupy neither request
 * threads nor the @Async pool.
 *
 * Sends never throw. Once the client is gone they are dropped and the work runs to
 * its end, because a move or an answer stopped half-way leaves things worse than
 * one finished unseen. A periodic comment keeps proxies with idle timeouts from
 * cutting a stream that is quiet for a while.
 */
@Component
class EventStreams {

    private val logger = LoggerFactory.getLogger(EventStreams::class.java)

    private val workers = Executors.newCachedThreadPool { runnable ->
        Thread(runnable, "event-stream").apply { isDaemon = true }
    }
    private val heartbeats = Executors.newSingleThreadScheduledExecutor { runnable ->
        Thread(runnable, "event-stream-heartbeat").apply { isDaemon = true }
    }

    @PreDestroy
    fun shutdown() {
        workers.shutdownNow()
        heartbeats.shutdownNow()
    }

    /**
     * Opens a stream on [response] and runs [work] with it on a worker thread; the
     * stream completes when [work] returns. [work] reports its own failures as
     * events; anything it lets escape is logged and ends the stream with a generic
     * `error` event.
     */
    fun open(response: HttpServletResponse, timeoutMs: Long, work: (EventStream) -> Unit): SseEmitter {
        // nginx would otherwise hold the events back until the buffer fills.
        response.setHeader("X-Accel-Buffering", "no")
        response.setHeader("Cache-Control", "no-cache")

        val emitter = SseEmitter(timeoutMs)
        val stream = EventStream(emitter)
        val heartbeat = heartbeats.scheduleAtFixedRate(
            { stream.comment("keep-alive") }, HEARTBEAT_SECONDS, HEARTBEAT_SECONDS, TimeUnit.SECONDS
        )
        workers.execute {
            try {
                work(stream)
            } catch (e: Exception) {
                logger.error("Streamed work failed", e)
                stream.send("error", mapOf("message" to "Something went wrong on the server."))
            } finally {
                heartbeat.cancel(false)
                stream.complete()
            }
        }
        return emitter
    }

    companion object {
        private const val HEARTBEAT_SECONDS = 15L
    }
}

/** One open stream. Every send is a no-op once the client has gone. */
class EventStream internal constructor(private val emitter: SseEmitter) {

    private val open = AtomicBoolean(true)

    init {
        emitter.onCompletion { open.set(false) }
        emitter.onTimeout { open.set(false) }
        emitter.onError { open.set(false) }
    }

    /** An `event: [name]` with [data] as its JSON payload. */
    fun send(name: String, data: Any) = send(SseEmitter.event().name(name).data(data, MediaType.APPLICATION_JSON))

    internal fun comment(text: String) = send(SseEmitter.event().comment(text))

    internal fun complete() {
        if (open.getAndSet(false)) emitter.complete()
    }

    private fun send(event: SseEmitter.SseEventBuilder) {
        if (!open.get()) return
        try {
            synchronized(emitter) { emitter.send(event) }
        } catch (e: IOException) {
            open.set(false)
        } catch (e: IllegalStateException) {
            open.set(false)
        }
    }
}
