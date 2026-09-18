package com.docuvault.service

/** One reading of a progress bar: step [step] of [steps] is under way, [done] of [total] items through it. */
data class ProgressUpdate(
    val step: Int,
    val steps: Int,
    val label: String,
    /** Items finished in this step; 0 of 0 for a step that has nothing to count. */
    val done: Int,
    val total: Int
)

/**
 * Progress of a long file operation, reported step by step so the UI can draw a
 * real bar rather than a spinner. The number of steps is fixed before the work
 * starts, so the bar never runs backwards; a step that works through files counts
 * them, a Git step only says that it began.
 *
 * Never throws: a miscounted plan only makes the bar less accurate, it must not
 * abort a move half-way. Also keeps the time each step took, because [summary]
 * in the log is what answers "why was that move slow?".
 */
class OperationProgress(
    private var steps: Int,
    private val listener: (ProgressUpdate) -> Unit
) {
    private var step = 0
    private var label = ""
    private var total = 0
    private var done = 0
    private var lastSentAt = 0L
    private val startedAt = System.nanoTime()
    private var stepStartedAt = startedAt
    private val durations = mutableListOf<Pair<String, Long>>()

    /** Starts the next step; [total] is how many items it will count through, 0 for none. */
    fun next(label: String, total: Int = 0) {
        endStep()
        step++
        steps = maxOf(steps, step)
        this.label = label
        this.total = total
        done = 0
        stepStartedAt = System.nanoTime()
        send()
    }

    /** One more item of the current step is through. Throttled, except for the last one. */
    fun advance() {
        done++
        if (done >= total || (System.nanoTime() - lastSentAt) / 1_000_000 >= SEND_INTERVAL_MS) send()
    }

    /** Ends the last step and describes where the time went, e.g. "Copying files 120 ms, … (1840 ms)". */
    fun summary(): String {
        endStep()
        val total = (System.nanoTime() - startedAt) / 1_000_000
        return durations.joinToString(", ") { (name, ms) -> "$name $ms ms" } + " ($total ms)"
    }

    private fun endStep() {
        if (step > 0 && durations.size < step) {
            durations += label to (System.nanoTime() - stepStartedAt) / 1_000_000
        }
    }

    private fun send() {
        lastSentAt = System.nanoTime()
        listener(ProgressUpdate(step, steps, label, done, total))
    }

    companion object {
        /** Often enough for a smooth bar, rare enough not to flood the stream with a big folder. */
        private const val SEND_INTERVAL_MS = 100L
    }
}
