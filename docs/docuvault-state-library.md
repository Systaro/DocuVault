# DocuVault State Library

A generic, reusable JS library that allows static HTML files hosted in DocuVault to read and persist state via the DocuVault API — committed back to Git as a companion JSON file.

## Problem

DocuVault renders static HTML files. HTML alone cannot write to the filesystem or persist state across devices. However, DocuVault itself is a backend with a REST API that can read and write files to Git. The state library bridges this gap.

## Approach

A single shared JS file (`assets/docuvault-state.js`) is hosted once in DocuVault. Any HTML file can include it and declare its configuration explicitly via an init script. The library handles auth, loading, and saving — the HTML author only deals with `get`/`set`/`save`.

## Why Explicit Config (Not Auto-Discovery)

The URL pattern differs between a regular authenticated view and a share URL:

- Authenticated: `/spaces/{spaceId}/documents/...`
- Share link: `/shared/{token}/content`

Auto-discovering the spaceId and file path from `window.location` would require two different parsing strategies and break silently when the URL structure changes. Explicit config is always correct regardless of how the file is served.

## Usage

Each HTML file that wants persistent state includes:

```html
<script src="/assets/docuvault-state.js"></script>
<script>
  DocuVaultState.init({
    spaceId: 'a4100e58-e5ec-4cb3-a304-5d04d963dc47',
    stateFile: 'projekt-management/pilot-verantwortlichkeiten.json'
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

// Persist to DocuVault (commits JSON to Git via autoCommit)
await state.save();
```

## Auth

- On first `save()`, the user is prompted for their DocuVault API token
- The token is stored in `localStorage` (device-local — auth only, not data)
- Subsequent saves are silent
- Token can be revoked/changed at any time via the DocuVault token settings

## File Convention

```
assets/
  docuvault-state.js                         ← shared library, uploaded once

projekt-management/
  pilot-verantwortlichkeiten.html            ← UI, includes the library
  pilot-verantwortlichkeiten.json            ← persisted state, committed to Git

any-other-module/
  some-form.html
  some-form.json                             ← same pattern, works automatically
```

The companion JSON is created on first save if it does not exist. Two HTML files can share one JSON if they represent the same dataset.

## API

### `DocuVaultState.init(config)`

Must be called once before `ready()`. Config shape:

| Field | Type | Description |
|-------|------|-------------|
| `spaceId` | `string` | DocuVault space ID |
| `stateFile` | `string` | Path to the companion JSON within the space |

### `DocuVaultState.ready() → Promise<state>`

Returns a promise that resolves once the state has been loaded from the API. Returns a state handle.

### `state.get(key) → any`

Returns the current in-memory value for `key`.

### `state.set(key, value)`

Sets `key` to `value` in memory. Does not persist until `save()` is called.

### `state.save() → Promise<void>`

PUTs the full state JSON to DocuVault with `autoCommit: true`. Prompts for API token on first call if not already stored.

## Implementation Notes

- Uses `PUT /api/spaces/{spaceId}/documents/{path}` with `autoCommit: true`
- Falls back to `POST` (create) if the companion JSON does not exist yet
- Content hash (`contentHash`) should be tracked and sent on PUT to support optimistic locking (409 triggers a re-fetch + merge prompt)
- CORS is already configured on the DocuVault backend for its own origin
