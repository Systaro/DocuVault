package com.docuvault.service

import com.docuvault.domain.space.Document
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
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.mockito.ArgumentMatchers.any
import org.mockito.ArgumentMatchers.anyString
import org.mockito.Mockito.doAnswer
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest
import java.util.*

/**
 * Files moved or deleted outside the app (in a clone, in GitLab's UI, by an
 * agent) used to leave their document row behind, so search kept offering dead
 * paths and listed a moved document once per path it had ever had.
 */
class SyncSchedulerPruneTest {

    private val spaceRepository = mock(SpaceRepository::class.java)
    private val gitService = mock(GitService::class.java)
    private val gitConflictService = mock(GitConflictService::class.java)
    private val gitDiffService = mock(GitDiffService::class.java)
    private val documentRepository = mock(DocumentRepository::class.java)
    private val documentEmbeddingRepository = mock(DocumentEmbeddingRepository::class.java)
    private val embeddingService = mock(EmbeddingService::class.java)
    private val changeNotificationService = mock(ChangeNotificationService::class.java)

    private val scheduler = SyncScheduler(
        spaceRepository, gitService, gitConflictService, gitDiffService,
        documentRepository, documentEmbeddingRepository, embeddingService,
        changeNotificationService
    )

    private val space = Space(
        id = UUID.randomUUID(),
        name = "Product Handbook",
        slug = "product-handbook",
        createdBy = mock(User::class.java)
    )

    /** Paths handed to deleteAll, recorded instead of hitting a repository. */
    private val prunedPaths = mutableListOf<String>()

    /**
     * Mockito matchers return null, which Kotlin rejects when the stubbed
     * parameter is a non-null type. Erasure makes this cast a no-op, so the
     * null reaches Mockito untouched.
     */
    @Suppress("UNCHECKED_CAST")
    private fun <T> anyArg(): T = any<T>() as T

    @BeforeEach
    fun recordDeletes() {
        doAnswer { invocation ->
            invocation.getArgument<Iterable<Document>>(0).forEach { prunedPaths.add(it.path) }
            null
        }.`when`(documentRepository).deleteAll(anyArg<Iterable<Document>>())
    }

    private fun sha256(content: String): String =
        MessageDigest.getInstance("SHA-256")
            .digest(content.toByteArray())
            .joinToString("") { "%02x".format(it) }

    private fun document(path: String, content: String? = null) = Document(
        id = UUID.randomUUID(),
        space = space,
        path = path,
        title = path.substringAfterLast('/'),
        contentHash = content?.let { sha256(it) }
    )

    /** Points the mocked GitService at a real directory so path checks hit disk. */
    private fun useRepo(repoPath: Path) {
        `when`(gitService.getRepoPath(space.id!!)).thenReturn(repoPath)
        `when`(gitService.regularFileExists(anyArg(), anyString())).thenAnswer { invocation ->
            Files.isRegularFile(repoPath.resolve(invocation.getArgument<String>(1)))
        }
    }

    private fun write(repoPath: Path, relative: String, content: String) {
        val target = repoPath.resolve(relative)
        Files.createDirectories(target.parent)
        Files.writeString(target, content)
    }

    /** An already-embedded, unchanged document so indexing skips it entirely. */
    private fun stubUnchanged(doc: Document) {
        `when`(documentRepository.findBySpaceIdAndPath(space.id!!, doc.path)).thenReturn(doc)
        `when`(documentEmbeddingRepository.existsByDocumentId(doc.id!!)).thenReturn(true)
    }

    @Test
    fun `drops rows whose file left the working tree and keeps the rest`(@TempDir repoPath: Path) {
        write(repoPath, "subprojects/core/api-docs/partner-api.md", "# Partner System API")
        write(repoPath, "assets/theme.css", "body { color: red }")
        useRepo(repoPath)

        val moved = document("api-docs/partner-api.md")
        val deleted = document("designs/old-concept.html")
        val kept = document("subprojects/core/api-docs/partner-api.md", "# Partner System API")
        // A stylesheet the indexer never walks — it must survive the prune.
        val nonIndexable = document("assets/theme.css")

        `when`(documentRepository.findBySpaceId(space.id!!))
            .thenReturn(listOf(moved, deleted, kept, nonIndexable))
        stubUnchanged(kept)

        scheduler.indexDocuments(space)

        assertEquals(
            listOf("api-docs/partner-api.md", "designs/old-concept.html"),
            prunedPaths.sorted()
        )
    }

    @Test
    fun `reports pruned rows as changed files`(@TempDir repoPath: Path) {
        write(repoPath, "current.md", "# Current")
        useRepo(repoPath)

        val kept = document("current.md", "# Current")
        `when`(documentRepository.findBySpaceId(space.id!!))
            .thenReturn(listOf(kept, document("gone.md"), document("also-gone.md")))
        stubUnchanged(kept)

        // current.md is unchanged, so the count is purely the two pruned rows.
        assertEquals(2, scheduler.indexDocuments(space))
    }

    @Test
    fun `leaves the index alone when the working tree is empty`(@TempDir repoPath: Path) {
        useRepo(repoPath)

        `when`(documentRepository.findBySpaceId(space.id!!))
            .thenReturn(listOf(document("README.md"), document("guide.md")))

        assertEquals(0, scheduler.indexDocuments(space))
        assertTrue(prunedPaths.isEmpty(), "a broken clone must not wipe the index")
    }

    @Test
    fun `does not delete when every stored path still resolves`(@TempDir repoPath: Path) {
        write(repoPath, "README.md", "# Readme")
        useRepo(repoPath)

        val readme = document("README.md", "# Readme")
        `when`(documentRepository.findBySpaceId(space.id!!)).thenReturn(listOf(readme))
        stubUnchanged(readme)

        scheduler.indexDocuments(space)

        assertTrue(prunedPaths.isEmpty())
    }
}
