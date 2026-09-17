# Space Inbox — Feature Specification

## Overview

Space Inbox is a frictionless drop zone per space where team members can dump unstructured notes. AI automatically suggests where each note belongs in the documentation, and one-click filing merges it into the right document. The goal: eliminate the "I don't know where to put this" excuse for undocumented knowledge.

---

## Core Concepts

### Note
A freeform rich-text entry posted to a space's inbox. Notes have no required structure. Content can include formatted text, lists, code snippets, and attachments. Notes pass through three states:

- **UNSORTED** — just arrived, waiting for triage
- **FILED** — merged into a document (audit trail kept)
- **DISMISSED** — manually discarded

### AI Suggestion
When a note is created (or on demand), the AI analyses the space's document tree and the note content to produce a suggestion:
- Target destination (existing document or new document to create)
- Merged document content (full-file replacement showing how the note integrates)
- Confidence score (0–1)
- Explanation of the routing decision

Suggestions with confidence < 0.60 always show the UI prompt regardless of auto-file settings.

### Routing Rule
A saved rule that matches notes by content pattern and automatically routes them. Rules are space-level and come in two types:

| Type | Condition example | Meaning |
|------|-------------------|---------|
| CATEGORY | `meeting notes` | Keyword/category match (case-insensitive) |
| PATTERN | `#incident` | Hashtag or regex pattern match |

Each rule specifies an action (append to existing doc, or create new doc), a target path, and whether to auto-file without prompting.

---

## User Flows

### Quick Capture (Global)
1. User clicks **Quick Note** in the top nav, or picks "Quick note" in the command palette (Cmd+K).
2. User writes the note, or records it with the microphone button.
3. With AI, **Find a place** suggests the space (among spaces the user can write to), gives a reason and lists the tasks the note names. Without AI the space is picked by hand.
4. User checks the space and the tasks and clicks **Save to inbox**. The note lands in that space's inbox as UNSORTED, and the ticked tasks are created with the note as their source.

Details: [Assistant](assistant.md#quick-note).

### Triage (Unsorted Tab)
1. User opens **Inbox** from the space sidebar (badge shows unsorted count)
2. Split view: note list on left, AI suggestion panel on right
3. Selecting a note loads the suggestion (if not already generated, triggers AI call)
4. AI panel shows:
   - Suggested destination (breadcrumb path)
   - Confidence indicator
   - Explanation
   - Diff preview button (red/green diff of existing doc vs merged content)
5. Actions available:
   - **File here** — accepts suggestion, writes merged content, marks note FILED
   - **File somewhere else** — opens destination picker, then writes
   - **Dismiss** — discards the note (DISMISSED state)
   - **Don't ask next time** — creates a routing rule + files immediately

### Diff Preview
Before accepting, user can click **Preview changes** to see a popup with:
- Red lines (content removed from the original)
- Green lines (content the AI is adding)
- Summary of additions/deletions count
- **Accept changes** button applies the full merged document to the file

### Filed Tab
Shows all previously filed notes with:
- Author avatar + name + timestamp
- Content preview (2 lines)
- Filed-to destination (clickable link)
- Filed by: person's name -or- "Auto-filed by rule" label
- Link icon to open the target document

### Auto-filing Rules (Space Settings)
Under **Space Settings → Auto-filing Rules**:
- List of existing rules (category and pattern tabs)
- Toggle per rule to enable/disable auto-file
- Create / edit / delete rules
- Each rule shows: condition, target doc path, auto-file toggle, description

---

## Data Model

### `inbox_notes`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| space_id | UUID FK → spaces | |
| author_id | UUID FK → users | |
| content | TEXT | Rich text (HTML) |
| status | VARCHAR | UNSORTED \| FILED \| DISMISSED |
| ai_suggestion | TEXT | JSON blob (see below) |
| filed_to_document_path | VARCHAR | Set when filed |
| filed_by_id | UUID FK → users | Null if auto-filed |
| auto_filed | BOOLEAN | True if filed by a routing rule |
| applied_rule_id | UUID FK → routing_rules | Set when auto-filed |
| created_at | TIMESTAMPTZ | |
| filed_at | TIMESTAMPTZ | |

### `routing_rules`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| space_id | UUID FK → spaces | |
| type | VARCHAR | CATEGORY \| PATTERN |
| condition | VARCHAR | Keyword or pattern string |
| action_type | VARCHAR | APPEND_TO_DOCUMENT \| CREATE_DOCUMENT |
| target_document_path | VARCHAR | For APPEND action |
| target_group_path | VARCHAR | For CREATE action |
| auto_file | BOOLEAN | Skip UI prompt when true (and confidence ≥ 0.60) |
| description | VARCHAR | Human-readable label |
| created_at | TIMESTAMPTZ | |

### AI Suggestion JSON Schema

```json
{
  "action": "APPEND_TO_DOCUMENT | CREATE_DOCUMENT",
  "documentPath": "path/to/existing/doc.md",
  "newDocumentPath": "path/for/new/doc.md",
  "newDocumentTitle": "New Document Title",
  "groupPath": "parent/group",
  "confidence": 0.85,
  "explanation": "This note describes a deployment procedure...",
  "mergedContent": "# Full merged document text...",
  "originalContent": "# Original document text..."
}
```

---

## REST API

Base URL: `/api/spaces/{spaceId}/inbox`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/notes` | List notes (query param: `status=UNSORTED\|FILED\|DISMISSED`) |
| POST | `/notes` | Create a new note |
| GET | `/notes/{noteId}` | Get single note |
| POST | `/notes/{noteId}/suggest` | Trigger AI suggestion generation |
| POST | `/notes/{noteId}/file` | File note (body: `{ documentPath, mergedContent, createNew, newPath, newTitle }`) |
| POST | `/notes/{noteId}/dismiss` | Dismiss a note |
| GET | `/count` | Get unsorted count (used for badge) |
| GET | `/rules` | List routing rules |
| POST | `/rules` | Create routing rule |
| PUT | `/rules/{ruleId}` | Update routing rule |
| DELETE | `/rules/{ruleId}` | Delete routing rule |

---

## Permissions

| Action | Required level |
|--------|---------------|
| View inbox / read notes | VIEW |
| Create notes (capture) | EDIT |
| File / dismiss notes | EDIT |
| Manage routing rules | ADMIN |

---

## AI Integration

The AI suggestion is a single OpenAI chat completion call. The prompt includes:
1. Space name and description
2. Full document path list with titles
3. Note content (stripped of HTML for the prompt, but original HTML preserved for filing)
4. Existing routing rules (as hints)

The model returns a structured JSON response with action, destination, merged content, and confidence.

For the merge step, the full current document content is included in the prompt, and the model returns the complete merged document. The diff is computed client-side (Myers diff on the returned `originalContent` vs `mergedContent`).

If OpenAI is not configured, suggestion generation returns an appropriate message instead of calling the API.

---

## Frontend Components

| Component | File | Description |
|-----------|------|-------------|
| `InboxComponent` | `features/inbox/inbox.component.ts` | Main inbox view (unsorted + filed tabs) |
| `QuickCaptureModalComponent` | `features/inbox/quick-capture-modal.component.ts` | Global capture modal |
| `InboxService` | `core/api/inbox.service.ts` | HTTP client for inbox API |

### Route additions
`inbox` child route added to all three space path levels (`:path1`, `:path1/:path2`, `:path1/:path2/:path3`).

### Sidebar modification
`space.component.ts` — Inbox nav item added to sidebar nav below AI Chat. Badge shows unsorted count, refreshed on space load.

### Layout modification
`layout.component.ts` — **Quick Note** button added to `header-actions`. Clicking opens `QuickCaptureModalComponent` (rendered via signal).

### Settings modification
`space-settings.component.ts` — **Auto-filing Rules** section added at the bottom (visible to ADMIN users only).
