# Live collaboration

Several people can read and edit the same Markdown document at the same time.
Everyone sees who else is there and where, and edits appear for the others as
they are typed. The file in the space's Git repository stays the source of
truth: the live state only lives as long as somebody is editing.

## What you see

- **Who is in a document.** Avatars in the document's top bar: everyone reading
  or editing it besides you. A pencil badge marks the people editing. The
  tooltip says where they are ("Bob · editing · Installation"), and a click
  takes you there: to their cursor in the editor, or to the heading they are
  reading.
- **Who is where while reading.** The "On this page" outline shows small avatars
  next to the heading each person is reading or writing under.
- **Cursors.** In the editor, the others' cursors and selections are drawn in
  their colour with their name on top.
- **Who is online in a space.** The sidebar's *Members* strip says how many
  people are online and marks them with a green dot; expanded, it lists what each
  of them is doing ("Editing Team handbook"). The file tree shows avatars on the
  documents people are in, and a dot on a collapsed folder that contains one.
- **Live reading.** A document open in read mode updates in place when someone
  saves it, and stays on the passage you were reading.

Names come from the server, not from the browser: a client cannot show itself
under somebody else's name.

## Editing together

Clicking **Edit** on a Markdown document joins the people already editing it.
The first editor fills the shared copy from the file; everyone after that gets
the shared copy, including what has not been saved yet. Edits merge
character by character (a CRDT, [Yjs](https://yjs.dev)), so two people typing in
the same paragraph do not overwrite each other. Undo only undoes your own edits.

**Saving.** One editor at a time, the *leader*, autosaves the shared copy for
everyone, two seconds after the last change, through the same minimal-diff save
as before (untouched blocks keep their original formatting). When the leader
leaves, the next editor takes over. **Save / Done** still works for anyone: it
saves the shared state and, in a Git-synced space, commits it. When the last
editor leaves a Git-synced space with autosaved but uncommitted changes, the
server commits them.

**Changes from outside.** When the file is written while people edit it (an AI
agent over MCP, *Edit via AI*, a restore from the version history, a save from
somebody whose browser could not connect), the leader merges the new file into
the shared copy block by block: paragraphs changed only outside take the outside
version, paragraphs changed only in the editor keep the editor's version, and
where both changed the same paragraph the live edit is kept with the outside
version right after it. The title merges the same way. Everyone gets a short
notice.

**Connection drops.** Editing continues offline; the status reads *Offline ·
reconnecting*. After the connection is back (also after a server restart) the
offline edits merge in. Only if the document was changed elsewhere in the
meantime *and* nobody kept the shared copy alive can offline edits not be merged;
the editor then says so and shows the current version.

If the live connection cannot be opened at all (a proxy that blocks
WebSockets), the editor works as before: alone, saving on its own.

## Reading zoom and position

- **Text size in read mode.** The `− 100% +` control in the lower left enlarges or
  shrinks the text of Markdown documents and Word files; Ctrl/⌘ + scroll wheel
  (or a trackpad pinch) does the same. Lines rewrap within the page. The level
  is remembered per browser.
- **Reload keeps your place.** Reloading the page puts you back on the passage
  you were reading (or editing), per browser tab.

## For operators

- The live channel is a WebSocket at `/api/live`. The bundled nginx forwards it;
  with your own reverse proxy, allow the WebSocket upgrade on `/api/` and an idle
  timeout above 30 seconds (clients ping every 25).
- Rooms are held in the backend's memory. Run **one backend instance** per
  installation (as the rest of DocuVault assumes too). A restart drops the rooms;
  open editors reconnect and rebuild them without losing edits.
- AI agents see presence through the MCP tool `list_active_users`, and their
  writes reach open editors as described above.
