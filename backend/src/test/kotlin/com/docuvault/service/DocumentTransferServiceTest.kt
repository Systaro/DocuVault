package com.docuvault.service

import com.docuvault.domain.space.Space
import com.docuvault.domain.user.User
import com.docuvault.infrastructure.repository.DocumentRepository
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.service.embedding.EmbeddingService
import com.docuvault.service.git.GitService
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.mockito.Mockito.mock
import java.nio.file.Path
import java.util.*

/**
 * The progress a move reports. The dialog sizes its bar from the planned step
 * count, so a plan that disagrees with the steps actually taken leaves the bar
 * stuck short of the end — or overflowing it.
 */
class DocumentTransferServiceTest {

    @TempDir
    lateinit var reposDir: Path

    private val gitService by lazy { GitService(reposDir.toString(), mock(SettingsService::class.java)) }
    private val documentRepository = mock(DocumentRepository::class.java)

    private val service by lazy {
        DocumentTransferService(
            gitService = gitService,
            documentRepository = documentRepository,
            annotationService = mock(AnnotationService::class.java),
            documentPersistService = DocumentPersistService(
                documentRepository, mock(SpaceRepository::class.java), gitService, mock(EmbeddingService::class.java)
            ),
            documentLineageService = mock(DocumentLineageService::class.java)
        )
    }

    private val user = User(email = "tester@example.com", passwordHash = "", name = "Tester")

    private fun space(name: String) = Space(
        id = UUID.randomUUID(),
        name = name,
        slug = name.lowercase(),
        createdBy = mock(User::class.java)
    )

    /** A space holding `notes/one.md` and `notes/two.md`, committed. */
    private fun spaceWithNotes(name: String): Space {
        val space = space(name)
        gitService.writeFile(space, "notes/one.md", "one\n")
        gitService.writeFile(space, "notes/two.md", "two\n")
        gitService.commitAndPush(space, "Add notes", "Tester", "tester@example.com")
        return space
    }

    private fun assertEndsOnLastStep(updates: List<ProgressUpdate>) {
        assertTrue(updates.map { it.steps }.distinct().size == 1, "the step count must not change: $updates")
        assertEquals(updates.last().steps, updates.last().step, "the last update must be the last planned step")
    }

    @Test
    fun `a move within a space reports every planned step`() {
        val space = spaceWithNotes("Handbook")
        val updates = mutableListOf<ProgressUpdate>()

        val result = service.transfer(space, "notes", space, "archive", TransferMode.MOVE, user) { updates += it }

        assertTrue(result is TransferResult.Ok, "$result")
        assertEquals(
            listOf(
                "Copying files", "Updating the file index", "Removing the originals",
                "Recording the new location", "Saving to Git"
            ),
            updates.map { it.label }.distinct()
        )
        assertEndsOnLastStep(updates)
        val copied = updates.last { it.label == "Copying files" }
        assertEquals(2 to 2, copied.done to copied.total)

        assertTrue(gitService.regularFileExists(space, "archive/notes/one.md"))
        assertFalse(gitService.itemExists(space, "notes"))
        assertEquals(emptyList<String>(), gitService.getUncommittedFiles(space.id!!))
    }

    @Test
    fun `a copy into another space commits there and names it`() {
        val source = spaceWithNotes("Handbook")
        val target = space("Archive")
        val updates = mutableListOf<ProgressUpdate>()

        val result = service.transfer(source, "notes", target, "", TransferMode.COPY, user) { updates += it }

        assertTrue(result is TransferResult.Ok, "$result")
        assertEquals(
            listOf("Copying files", "Updating the file index", "Saving to Git in Archive"),
            updates.map { it.label }.distinct()
        )
        assertEndsOnLastStep(updates)
        assertTrue(gitService.regularFileExists(target, "notes/two.md"))
        assertTrue(gitService.regularFileExists(source, "notes/two.md"), "a copy leaves the original")
    }

    @Test
    fun `a rename reports every planned step and commits`() {
        val space = spaceWithNotes("Handbook")
        val updates = mutableListOf<ProgressUpdate>()

        assertTrue(service.rename(space, "notes", "archive/notes", user) { updates += it })

        assertEquals(listOf("Moving", "Updating the file index", "Saving to Git"), updates.map { it.label }.distinct())
        assertEndsOnLastStep(updates)
        assertTrue(gitService.regularFileExists(space, "archive/notes/one.md"))
        assertEquals(emptyList<String>(), gitService.getUncommittedFiles(space.id!!))
    }

    @Test
    fun `progress keeps going when the plan was one step short`() {
        val updates = mutableListOf<ProgressUpdate>()
        val progress = OperationProgress(steps = 1) { updates += it }

        progress.next("First")
        progress.next("Second")

        assertEquals(listOf(1 to 1, 2 to 2), updates.map { it.step to it.steps })
    }
}
