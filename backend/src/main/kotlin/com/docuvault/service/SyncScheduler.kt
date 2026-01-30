package com.docuvault.service

import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.service.git.GitOperationException
import com.docuvault.service.git.GitService
import org.slf4j.LoggerFactory
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Service
import java.time.Instant

@Service
class SyncScheduler(
    private val spaceRepository: SpaceRepository,
    private val gitService: GitService
) {
    private val logger = LoggerFactory.getLogger(SyncScheduler::class.java)

    @Scheduled(fixedRate = 60000) // Run every minute
    fun syncRepositories() {
        val spaces = spaceRepository.findAllWithSyncEnabled()

        for (space in spaces) {
            val lastSync = space.lastSyncedAt ?: Instant.EPOCH
            val intervalMs = space.syncIntervalMinutes * 60 * 1000L

            if (Instant.now().toEpochMilli() - lastSync.toEpochMilli() >= intervalMs) {
                try {
                    logger.info("Syncing space: ${space.name}")
                    gitService.pullChanges(space)
                    space.lastSyncedAt = Instant.now()
                    space.lastSyncError = null
                    spaceRepository.save(space)
                    logger.info("Successfully synced space: ${space.name}")
                } catch (e: GitOperationException) {
                    logger.warn("Failed to sync space '${space.name}': [${e.errorCode}] ${e.message}")
                    space.lastSyncError = e.message ?: "Sync failed"
                    spaceRepository.save(space)
                } catch (e: Exception) {
                    logger.error("Unexpected error syncing space '${space.name}': ${e.message}", e)
                    space.lastSyncError = e.message?.take(500) ?: "Unexpected sync error"
                    spaceRepository.save(space)
                }
            }
        }
    }
}
