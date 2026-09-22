-- Files attached to the assistant: photos, scans, PDFs and text files a user
-- sends with a question or a quick note.
--
-- The bytes live in object storage; this row keeps what the model needs
-- without reading them again (the extracted text of PDFs and text files).
-- An attachment belongs to a conversation once it was sent with a message.
-- Rows without a conversation (never sent, read into a quick note, or left
-- over from a deleted conversation) are swept after a day.

CREATE TABLE assistant_attachments (
    id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id  UUID          REFERENCES conversations(id) ON DELETE SET NULL,
    file_name        VARCHAR(255)  NOT NULL,
    content_type     VARCHAR(100)  NOT NULL,
    size_bytes       BIGINT        NOT NULL,
    -- IMAGE, PDF, TEXT
    kind             VARCHAR(10)   NOT NULL,
    storage_key      VARCHAR(255)  NOT NULL,
    -- Text of a PDF or text file, clipped; null for images.
    extracted_text   TEXT,
    -- Scanned PDF pages rendered as images, stored next to the file.
    page_images      INT           NOT NULL DEFAULT 0,
    page_count       INT,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_assistant_attachments_conversation ON assistant_attachments(conversation_id);
CREATE INDEX idx_assistant_attachments_unattached ON assistant_attachments(created_at) WHERE conversation_id IS NULL;

-- [{id, fileName, contentType, kind, sizeBytes}] on the user message that sent them.
ALTER TABLE conversation_messages ADD COLUMN attachments JSONB NOT NULL DEFAULT '[]';
