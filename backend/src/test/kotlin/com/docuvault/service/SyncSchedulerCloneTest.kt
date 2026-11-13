package com.docuvault.service

import com.docuvault.domain.space.Space
import com.docuvault.domain.user.User
import com.docuvault.infrastructure.repository.DocumentEmbeddingRepository
import com.docuvault.infrastructure.repository.DocumentRepository
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.service.embedding.EmbeddingService
import com.docuvault.service.git.GitConflictService
import com.docuvault.service.git.GitDiffService
import com.docuvault.service.git.GitService
import com.docuvault.service.notification.ChangeNotificationService
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.mockito.Mockito.mock
import org.mockito.Mockito.never
import org.mockito.Mockito.verify
import org.mockito.Mockito.`when`
import java.nio.file.Path
import java.util.*

/**
 * A new space is synced on the scheduler's next tick. When that tick landed
 * while the request that created the space was still cloning (a large
 * monorepo takes a while), the pull hit a half-written repository and flagged
 * the brand-new space as broken.
 */
class SyncSchedulerCloneTest {

    private val spaceRepository = mock(SpaceRepository::class.java)
    private val gitService = mock(GitService::class.java)

    private val scheduler = SyncScheduler(
        spaceRepository, gitService, mock(GitConflictService::class.java), mock(GitDiffService::class.java),
        mock(DocumentRepository::class.java), mock(DocumentEmbeddingRepository::class.java),
        mock(EmbeddingService::class.java), mock(ChangeNotificationService::class.java)
    )

    private val space = Space(
        id = UUID.randomUUID(),
        name = "Monorepo Docs",
        slug = "monorepo-docs",
        gitlabUrl = "https://git.example/acme/monorepo.git",
        createdBy = mock(User::class.java)
    )

    @Test
    fun `a space without a remote is never pulled, so it is not flagged as failing`() {
        val local = Space(id = UUID.randomUUID(), name = "Notes", slug = "notes", createdBy = mock(User::class.java))
        `when`(spaceRepository.findAllRepositoriesWithSyncEnabled()).thenReturn(listOf(local))

        scheduler.syncRepositories()

        verify(gitService, never()).pullChanges(local)
        verify(spaceRepository, never()).save(local)
    }

    @Test
    fun `a space that is still being cloned is left alone`() {
        `when`(spaceRepository.findAllRepositoriesWithSyncEnabled()).thenReturn(listOf(space))
        `when`(gitService.isCloning(space)).thenReturn(true)

        scheduler.syncRepositories()

        verify(gitService, never()).pullChanges(space)
        verify(spaceRepository, never()).save(space)
    }

    @Test
    fun `a space whose clone has finished is synced`(@TempDir root: Path) {
        `when`(spaceRepository.findAllRepositoriesWithSyncEnabled()).thenReturn(listOf(space))
        `when`(gitService.isCloning(space)).thenReturn(false)
        `when`(gitService.getContentRoot(space)).thenReturn(root)

        scheduler.syncRepositories()

        verify(gitService).pullChanges(space)
    }
}
