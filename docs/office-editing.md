# Editing Word documents

Word documents (`.docx`) can be edited in the browser, alone or together, in an
[ONLYOFFICE](https://www.onlyoffice.com) document server that runs next to the
app. The file stays in the space's Git repository: every save is a commit, so
it shows up in the document's version history and can be restored from there.

This is optional. Without a document server, Word documents are shown read-only
as before, with their version history.

## Using it

Open a Word document and click **Edit**. The office editor opens in place of the
rendered pages and works on the file itself, so the document keeps its own
formatting rather than going through a conversion.

- **Together.** Everyone who clicks Edit on the same file joins the same session
  and sees the others' changes and cursors as they type. The document's top bar
  and the space sidebar show them as editing.
- **Saving.** **Ctrl+S** (or the save icon) saves a version right away.
  **Done** saves and closes, and the page then shows the saved document. If you
  just close the tab, the file is saved about ten seconds after the last editor
  has left.
- **Commits.** Each save is one commit, "Edit <file> in the office editor",
  under the name of whoever changed the document last. A save that changes
  nothing is not committed.

Editing is offered to everyone who may write to the space, and not on phones:
the free edition of the document server only views documents in its mobile
editor.

Only `.docx` is editable. Older `.doc` files and other formats stay read-only,
since the editor would save them as `.docx`.

## Setting it up

The product compose file has the document server as an optional service.

1. Generate a secret and put it in `.env`:
   ```bash
   echo "OFFICE_JWT_SECRET=$(openssl rand -hex 32)" >> .env
   ```
2. Run `./deploy.sh`. With `OFFICE_JWT_SECRET` set it starts the `onlyoffice`
   service (image `onlyoffice/documentserver`, pinned by `OFFICE_VERSION`).

The server needs about 2 GB of RAM on top of the rest. Its first start takes a
minute or two; the Edit button works once it answers.

How the parts find each other (the defaults fit the product compose file):

| Variable | Default | What it is |
|---|---|---|
| `OFFICE_JWT_SECRET` | empty: off | Shared secret; the document server's `JWT_SECRET` must be the same |
| `OFFICE_URL` | `/office` | Where browsers load the editor. The frontend container forwards `/office/` to the `onlyoffice` service |
| `OFFICE_BACKEND_URL` | `http://backend:7030/api` | How the document server reaches the backend to fetch the file and report saves |
| `OFFICE_INTERNAL_URL` | `http://onlyoffice` | How the backend reaches the document server to fetch a saved file and to ask for a save |

With your own reverse proxy in front of the frontend container nothing changes:
`/office/` arrives there like every other path. The WebSocket upgrade must pass
through, as for [live collaboration](live-collaboration.md).

### Local development

The dev server forwards `/office/` to port 8070 (`frontend/proxy.conf.json`).
Start a document server there and point the backend at it:

```bash
docker run -d --rm --name docuvault-onlyoffice -p 8070:80 \
  -e JWT_SECRET=dev-office-secret -e ALLOW_PRIVATE_IP_ADDRESS=true \
  --add-host=host.docker.internal:host-gateway onlyoffice/documentserver:10.0.0

OFFICE_JWT_SECRET=dev-office-secret \
OFFICE_BACKEND_URL=http://host.docker.internal:7030/api \
OFFICE_INTERNAL_URL=http://localhost:8070 \
./gradlew bootRun
```

## How it works

1. **Edit** asks the backend for an editor configuration, signed with the shared
   secret. It names the file by a download link and a callback link, both
   signed, and carries a document key.
2. The document server fetches the file through the download link and opens it.
   Everyone with the same key shares one session.
3. On a save the document server calls the callback link. The backend checks the
   call's signature, checks that the editor named in it may still write to the
   space, fetches the saved file from the document server, compares it with the
   file in the space and writes and commits it when it differs.
4. **Done** asks the document server to save now (its command service) and
   waits for that save before closing the editor.

The document key derives from the file's content. While a session is open,
saves made from inside it keep its key, so latecomers join the people already
editing rather than starting a second session. That bookkeeping is in the
backend's memory, like the live collaboration rooms: run one backend instance.

## Limits

- The free Community edition of ONLYOFFICE Docs has no mobile web editor, and
  each commit names only the last editor, even when several people changed the
  document in that session.
- A Word file changed outside the editor while a session is open (an upload, a
  restore, a push to the repository) is overwritten by the session's next save.
  Git keeps both versions, so the outside change can be restored from the
  version history.
- A backend restart forgets which sessions are open. Saves still arrive, but
  someone who joins right after a restart may end up in a separate session if
  the file was saved in between.

ONLYOFFICE Docs Community is licensed under the AGPL v3 with additional terms;
the integration runs the unmodified image and talks to it over its documented
API.
