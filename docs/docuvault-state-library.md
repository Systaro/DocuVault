# DocuVault State Library

A generic, reusable JS library that allows static HTML files hosted in DocuVault to read and persist state via the DocuVault Space State API — stored database-backed per space, no Git commits involved.

## Problem

DocuVault renders static HTML files. HTML alone cannot write to the filesystem or persist state across devices. However, DocuVault itself is a backend with a REST API. The state library bridges this gap: interactive HTML (dashboards, forms, checklists) reads and saves its data through the API.

## Approach

A single shared JS file (`assets/docuvault-state.js`, shipped with the frontend) is included by any HTML file that wants persistent state. Each file declares its configuration explicitly via an init script. The library handles auth, loading, and saving — the HTML author only deals with `get`/`set`/`save`.

State lives in the `space_state` table (one row per space + key), served by
`GET/PUT/DELETE /api/spaces/{spaceId}/state/{key}` and listed by
`GET /api/spaces/{spaceId}/state`. Reading requires space access; writing requires edit access. A dedicated space token (`ROLE_SPACE_STATE`) can also be baked into the init config for tokenless-feeling forms.

## Why Explicit Config (Not Auto-Discovery)

The URL pattern differs between a regular authenticated view and a share URL:

- Authenticated: `/spaces/{spaceId}/documents/...`
- Share link: `/shared/{token}/content`

Auto-discovering the spaceId from `window.location` would require two different parsing strategies and break silently when the URL structure changes. Explicit config is always correct regardless of how the file is served.

## Usage

Each HTML file that wants persistent state includes:

```html
<script src="/assets/docuvault-state.js"></script>
<script>
  DocuVaultState.init({
    spaceId: 'a4100e58-e5ec-4cb3-a304-5d04d963dc47',
    key: 'pilot-verantwortlichkeiten'   // arbitrary identifier for this state bucket
  });
</script>
```

Then anywhere in the HTML:

```js
const state = await DocuVaultState.ready();

// Read a value
state.get('assignee_hosting');

// Write a value (in memory)
state.set('assignee_hosting', 'Anna');

// Persist to DocuVault
await state.save();
```

## Auth

- On first `save()`, the user is prompted for their DocuVault API token
- The token is stored in `localStorage` (device-local — auth only, not data)
- Subsequent saves are silent
- Token can be revoked/changed at any time via the DocuVault token settings
- Alternatively, pass `token` in the init config (e.g. a space state token) to skip the prompt entirely

## API

### `DocuVaultState.init(config)`

Must be called once before `ready()`. Config shape:

| Field | Type | Description |
|-------|------|-------------|
| `spaceId` | `string` | DocuVault space ID |
| `key` | `string` | Identifier for this state bucket (e.g. `'my-form'`) |
| `token` | `string` (optional) | API token to use instead of prompting/localStorage |

### `DocuVaultState.ready() → Promise<state>`

Returns a promise that resolves once the state has been loaded from the API. Returns a state handle.

### `state.get(key) → any` / `state.getAll() → object`

Returns the current in-memory value for `key`, or a shallow copy of the full state object.

### `state.set(key, value)` / `state.remove(key)`

Mutates the in-memory state. Does not persist until `save()` is called.

### `state.save() → Promise<void>`

PUTs the full state JSON to the Space State API. Prompts for an API token on first call if not already stored.

## Frozen Exports (Download With State)

HTML files that use the state library can be exported **with the current state embedded** — a snapshot "frozen" at the moment of export:

- **UI:** the editor's *Download file* action and the file tree's *Download* item detect state usage and offer a choice: *With frozen state* or *Without state*.
- **API:** `GET /api/spaces/{spaceId}/files/{path}?download=true&includeState=true`.

A frozen export is fully standalone: the backend parses the `DocuVaultState.init()` key(s), snapshots the current state, removes the `docuvault-state.js` script tag, and injects a self-contained shim exposing the same `DocuVaultState` API. The file then works offline / outside DocuVault:

- `ready()`, `get`, `getAll`, `set`, `remove` behave as usual (in-memory)
- `save()` rejects with a "frozen export from `<timestamp>`" error — the copy is read-only by design
- `DocuVaultState.frozen === true` and `DocuVaultState.frozenAt` let the HTML detect the frozen mode and e.g. hide save buttons

Downloading *without* state returns the raw file unchanged; it loads live state again when hosted in DocuVault.

## MCP Access

AI agents can read and maintain state buckets through the `@systaro/docuvault-mcp` server, gated by the same space permissions as the web UI:

| Tool | Description |
|------|-------------|
| `list_space_state` | List all state keys of a space (requires space access) |
| `get_space_state` | Read a bucket's JSON data (requires space access) |
| `set_space_state` | Full-replace a bucket's JSON (requires edit access; read + merge first) |

The `key` matches whatever the HTML file passes to `DocuVaultState.init()`.

## Implementation Notes

- Backend: `SpaceStateController` (REST), `SpaceState` entity (`space_state` table, migration `V005`), `StateFreezeService` (frozen export shim)
- Frontend: `assets/docuvault-state.js` (the library), `StateExportService` + `ExportStateDialogComponent` (export UI)
- Values are stored as opaque JSON strings; the library and the freeze shim both degrade invalid/missing state to `{}`
- CORS is already configured on the DocuVault backend for its own origin
