# Version History & Time Capsule

Every document in DocuVault carries a full version history. Open it via the
document's **⋮ action menu → Version history**.

## How it works

- **Git-connected spaces** — the history is the Git history of the file. Every
  save in the editor is a commit, and commits pushed from outside DocuVault
  show up here too.
- **Local spaces (no Git remote)** — DocuVault transparently versions the
  space in a local repository on the server. The first change after this
  feature landed snapshots the pre-existing content as a *baseline* version,
  so nothing starts from zero. No setup required.

Uploads, renames, deletions and folder operations are versioned as well.

## Topbar: creator & last editor

The document topbar (breadcrumb row) shows who created the document and who
last edited it, each with date and time, taken from the document's version
track. The **History** button next to it opens the version history panel
directly. Documents without any versions yet (e.g. never saved) show nothing.

## Moved and renamed documents

A move is a single commit that adds the new path and removes the old one, so a
naive lookup would report whoever reorganised the space as the document's
author. History therefore **follows renames**:

- **Within a space** the version track continues across the rename, so the
  creator, the full list of versions and every old version's content stay
  reachable under the new path. Versions from before the move are read under
  the path they had at the time — the API handles that, callers pass the
  current path.
- **Across spaces** the target repository is a different one and its history
  starts at the arrival commit. The move therefore records who originally
  created each document, and the topbar shows that instead of the mover. The
  *version list* in the new space still starts at the arrival — the earlier
  versions live in the source space's repository.

Every move and rename is also recorded so that **links to the old path keep
working**: opening a URL whose document has since moved forwards to its new
location (in whichever space it now lives) and says so, rather than offering
to create a new document at the old path. Chains and folder moves resolve too
— a document moved twice, or one that travelled inside a renamed folder, still
forwards. Forwarding respects permissions: it only points you somewhere you
are allowed to look.

## The panel

The **Version history** panel lists every version of the current document,
newest first, with timestamp, author and change message. The topmost entry is
the live document (marked **Current**).

## Diff viewer

Every entry in the panel has a **± button** (visible on hover) that shows what
that version changed in the document: a line-by-line diff with additions in
green and removals in red. While viewing a version in the time capsule you can
also toggle between **Show document** and **Show changes**.

## Time capsule

Click any older version to view the document exactly as it was at that point
in time. The view is read-only and marked with a banner.

- **Back to current** returns to the live document.
- **Restore this version** (editors and up) writes the old content back as a
  **new** version on top of the history. Nothing is ever rewound or deleted —
  a restore is itself just another change, so you can always restore forward
  again if you change your mind.

## API

- `GET /api/spaces/{spaceId}/document-history?path=…` — version list
- `GET /api/spaces/{spaceId}/document-history/meta?path=…` — creator (first commit) and last editor (newest commit)
- `GET /api/spaces/{spaceId}/document-history/content?path=…&sha=…` — content at a version
- `GET /api/spaces/{spaceId}/document-history/diff?path=…&sha=…` — unified diff of what that version changed
- `POST /api/spaces/{spaceId}/document-history/restore` (`{path, sha}`) — restore

Reading history requires view access to the space; restoring requires edit
access.
