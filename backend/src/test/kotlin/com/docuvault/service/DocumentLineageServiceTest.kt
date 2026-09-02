package com.docuvault.service

import com.docuvault.domain.space.DocumentMove
import com.docuvault.domain.space.Space
import com.docuvault.domain.user.User
import com.docuvault.infrastructure.repository.DocumentMoveRepository
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.service.git.GitDiffService
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import java.time.Instant
import java.util.*

/**
 * Forwarding an old document link. The interesting part is not the single-hop
 * case but the ones that accumulate over time: a document moved twice, a file
 * that only travelled because the folder above it moved, and nested folders
 * where the wrong record would send the reader to a path that does not exist.
 */
class DocumentLineageServiceTest {

    private val moveRepository = mock(DocumentMoveRepository::class.java)
    private val spaceRepository = mock(SpaceRepository::class.java)
    private val gitDiffService = mock(GitDiffService::class.java)

    private val service = DocumentLineageService(moveRepository, spaceRepository, gitDiffService)

    private fun space(slug: String) = Space(
        id = UUID.randomUUID(),
        name = slug,
        slug = slug,
        createdBy = mock(User::class.java)
    )

    private val handbook = space("handbook")
    private val archive = space("archive")

    /** Registers [moves] so the service sees them exactly as the repository would. */
    private fun given(vararg moves: DocumentMove) {
        for (s in listOf(handbook, archive)) {
            `when`(spaceRepository.findById(s.id!!)).thenReturn(Optional.of(s))
            val mine = moves.filter { it.sourceSpaceId == s.id }
            `when`(moveRepository.findBySourceSpaceIdAndIsDirectoryTrueOrderByMovedAtDesc(s.id!!))
                .thenReturn(mine.filter { it.isDirectory }.sortedByDescending { it.movedAt })
            for (path in mine.map { it.sourcePath }.distinct()) {
                `when`(moveRepository.findBySourceSpaceIdAndSourcePathOrderByMovedAtDesc(s.id!!, path))
                    .thenReturn(mine.filter { it.sourcePath == path }.sortedByDescending { it.movedAt })
            }
        }
    }

    private fun move(
        from: Space,
        sourcePath: String,
        to: Space,
        targetPath: String,
        isDirectory: Boolean = false,
        movedAt: Instant = Instant.now()
    ) = DocumentMove(
        sourceSpaceId = from.id!!,
        sourcePath = sourcePath,
        targetSpaceId = to.id!!,
        targetPath = targetPath,
        isDirectory = isDirectory,
        movedAt = movedAt
    )

    @Test
    fun `forwards a single rename`() {
        given(move(handbook, "docs/guide.md", handbook, "handbook/guide.md"))

        val resolved = service.resolve(handbook.id!!, "docs/guide.md")!!
        assertEquals("handbook/guide.md", resolved.path)
        assertEquals(handbook.id, resolved.spaceId)
        assertFalse(resolved.viaFolder)
    }

    @Test
    fun `follows a chain to the document's current home`() {
        given(
            move(handbook, "docs/guide.md", handbook, "handbook/guide.md"),
            move(handbook, "handbook/guide.md", archive, "guide.md")
        )

        // The link someone shared before either move still lands on the document.
        val resolved = service.resolve(handbook.id!!, "docs/guide.md")!!
        assertEquals("guide.md", resolved.path)
        assertEquals(archive.id, resolved.spaceId)
        assertEquals("archive", resolved.spaceFullPath)
    }

    @Test
    fun `a file carried along by its folder resolves through the folder record`() {
        given(move(handbook, "notes", handbook, "archive", isDirectory = true))

        val resolved = service.resolve(handbook.id!!, "notes/deep/nested.md")!!
        assertEquals("archive/deep/nested.md", resolved.path)
        assertTrue(resolved.viaFolder)
    }

    @Test
    fun `the most specific folder wins over an older, shallower one`() {
        // `docs` moved long ago; `docs/api` moved later and is where the file rode.
        given(
            move(handbook, "docs", archive, "old-docs", isDirectory = true, movedAt = Instant.parse("2026-01-01T00:00:00Z")),
            move(handbook, "docs/api", archive, "reference", isDirectory = true, movedAt = Instant.parse("2026-06-01T00:00:00Z"))
        )

        val resolved = service.resolve(handbook.id!!, "docs/api/auth.md")!!
        assertEquals(
            "reference/auth.md", resolved.path,
            "resolving through the shallower `docs` record would point at a path that never existed"
        )
    }

    @Test
    fun `an exact record beats a folder that also covers the path`() {
        given(
            move(handbook, "docs", archive, "old-docs", isDirectory = true),
            move(handbook, "docs/guide.md", archive, "guide.md")
        )

        assertEquals("guide.md", service.resolve(handbook.id!!, "docs/guide.md")!!.path)
    }

    @Test
    fun `a path nothing moved away from resolves to nothing`() {
        given()
        assertNull(service.resolve(handbook.id!!, "docs/never-moved.md"))
    }

    @Test
    fun `a move that returns a document to where it started does not loop`() {
        given(
            move(handbook, "a.md", handbook, "b.md", movedAt = Instant.parse("2026-01-01T00:00:00Z")),
            move(handbook, "b.md", handbook, "a.md", movedAt = Instant.parse("2026-02-01T00:00:00Z"))
        )

        // Must terminate rather than ping-pong; either end is a defensible answer.
        val resolved = service.resolve(handbook.id!!, "a.md")!!
        assertTrue(resolved.path in setOf("a.md", "b.md"))
    }
}
