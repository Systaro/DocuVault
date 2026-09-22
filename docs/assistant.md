# Assistant: Ask, Quick Note, Drafts

DocuVault's AI features share one entry point. People ask questions about their documentation and find their conversations again, capture notes without first deciding where they go, and let the assistant write status reports and protocols from what happened in a space.

All of it needs an OpenAI API key (Admin > Settings > AI). Without a key the UI hides these features, and Quick Note falls back to picking the space by hand.

## Ask

`/ask` lists every conversation of the signed-in user, whatever space it is about, with search, rename and delete. A conversation starts from:

- the ask box on the dashboard,
- the command palette (Cmd+K or Ctrl+K), which also finds documents and spaces,
- the Ask link in a space's sidebar (the space is preselected),
- the AI button in the editor (the conversation is about that one document).

A new conversation is pinned to one space, or to one document of a repository. For a group it covers every repository in the group the user can read.

The ask box is one line: the space with its logo (a folder tile for a group, the first letter where there is no logo), the question, a paperclip for files, the microphone and send. The space list opens above everything else on the page and can be searched. An animated coloured edge marks the box as the assistant; it brightens on focus, while files are dragged over it and while an answer is written, and stands still for people who reduce motion.

### How an answer is made

1. The question goes to `POST /api/ai/conversations/turns`. The answer streams back as server-sent events: `conversation`, `status`, `tool`, `delta`, `reset`, `error` and `done`.
2. The prompt contains an overview of the space, the passages semantic search finds for the question, and, for a document conversation, the document itself.
3. The model can search, list and read documents with tools, create documents, propose edits and manage tasks.
4. The stored answer keeps its sources, the tool steps, created documents and tasks, and proposed edits.

Old `/spaces/.../chat` links redirect to `/ask` with the space chosen.

### Writing

- **New documents** are created and committed right away (`create_document`). It never overwrites an existing file.
- **Changes to existing documents** are only proposed (`propose_edit`). The answer shows the changed lines with some context. Apply sends the change through the document PATCH endpoint as the user who clicks, so edit access, exact-text matching and the commit are that endpoint's. If the text changed in the meantime, Apply fails and says so. A proposal can be applied or discarded once.
- **Save as document** turns any answer into a document. The content can be edited before saving, and a leading heading becomes the title.

Users without edit access get no writing tools.

### One tool registry for MCP and the assistant

`ToolRegistry` holds every tool DocuVault offers a model. MCP clients (`/api/mcp`) get the full set across all their spaces. The assistant gets the reading tools, the task tools and its own `create_document` and `propose_edit`, limited to the conversation's space.

Handlers call the REST API over loopback with the caller's credential: the MCP bearer token, or the browser's session cookie for the assistant. Permission checks therefore live only in the controllers.

### Files

Photos, scans, PDFs and text files go with a question: by the paperclip, by dropping them on the ask box, or by pasting a screenshot. Up to ten per message, 20 MB each.

- Each file uploads as soon as it is added (`POST /api/ai/attachments`), so sending is instant. Large photos are scaled down in the browser to 2400 px on the long edge first.
- The server decides by the bytes, not the name: JPEG, PNG, WebP and GIF images, PDFs, and UTF-8 text with the extension `.txt`, `.md`, `.csv` or `.tsv`. HEIC photos are refused with a hint; iPhones convert them when the photo is picked from the library.
- Images go to the model as images, so handwriting, whiteboards and printed pages are read by the chat model itself; there is no separate OCR. A PDF contributes its text (PDFBox); pages without text count as scans and go along as page images, the first ten of them. Text files go as text.
- A message may be files alone. The assistant then says what each file is, transcribes handwriting and offers what to do next.
- Files belong to the conversation, not to the space. They show as thumbnails on the question and stay available to follow-up questions (up to 16 images per request, newest first). They reach a space only when the user asks: `save_attachment` commits the original file (never over an existing one), `create_document` keeps a transcription.
- A file is visible to its uploader only (`GET /api/ai/attachments/{id}/content`, 404 for anyone else).

### Access

- A conversation is visible only to its owner. Someone else's conversation answers 404, also when continued.
- A space the user cannot read answers 404 before anything is stored or sent to the model.
- Group spaces expand only to the repositories the user can read (`PermissionService.readableRepositoryIds`). The same applies to `/api/ai/search` and `/api/search/semantic`.

## Quick Note

Quick Note (header button, or "Save as a quick note" in the command palette) starts with the note, not with a space:

1. Write the note, record it with the microphone button, or add a photo of a handwritten note, a scan or a file (button, drop or paste). Files are read into the note text as soon as they are uploaded (`POST /api/ai/attachments/read`): handwriting is transcribed faithfully in its own language, crossed-out words stay crossed out, unreadable ones are marked. The files themselves are not kept with the note.
2. **Find a place** calls `POST /api/capture/suggest`. It considers only spaces the user can write to. The model sees them together with existing documents that resemble the note, and answers with a space, a reason and the tasks the note names ("me" and member names are resolved, relative dates too). A space it names outside the candidates is ignored. Nothing is saved at this step.
3. The dialog shows the suggested space, which can be changed, and the tasks as checkboxes.
4. **Save to inbox** creates the note in that space's inbox and the ticked tasks with the note as their source.

## Voice input

The microphone button in Quick Note and in the ask box records in the browser and sends the recording to `POST /api/ai/transcribe`, which uses `openai.transcription-model` (default `gpt-4o-transcribe`, environment `OPENAI_TRANSCRIPTION_MODEL`). Recordings stop after three minutes, and uploads are limited to 25 MB. `/api/capabilities` reports `ai.voice`.

## Drafts

**Write a draft** (Ask page, or the command palette) starts a conversation whose first answer is written from a space's material over the last 7, 14 or 30 days:

- inbox notes and meeting notes, as plain text,
- open tasks and tasks done in the period, with owner, due date and origin,
- documents changed in the period.

Templates: status report, meeting protocol, or something the user describes. The drafting turn has no writing tools and answers with the draft only; the user edits it with follow-up messages or in Save as document.

## Operations

- **Models:** `openai.chat-model` (default `gpt-5.5`) answers, suggests places and writes drafts. `openai.transcription-model` handles voice.
- **Streaming behind nginx:** the turn response sets `X-Accel-Buffering: no` and sends a keep-alive comment every 15 seconds, so proxies with a 60 second idle timeout do not cut the stream while the model works.
- **Streaming refused:** if OpenAI refuses to stream for the configured model, the turn falls back to a single response.
- **Tables:** `conversations` and `conversation_messages` (V028, which migrated `chat_history`), `conversation_messages.created_tasks` (V029), `assistant_attachments` and `conversation_messages.attachments` (V030).
- **Files:** stored in MinIO in the bucket `minio.attachments-bucket` (default `assistant-attachments`, environment `MINIO_ATTACHMENTS_BUCKET`), created on start like the logo bucket. Files that were never sent, were only read into a quick note, or lost their conversation are removed after a day (hourly sweep).
- **Client library:** images need openai-kotlin 3.7.2 or later; 3.7.0 and 3.7.1 send image parts with a type the API rejects (`ImagePartWireFormatTest`).
