-- Cached AI translations of documents.
-- One row per (document, target language); re-translated and overwritten when the
-- source content changes (tracked via source_content_hash). Invisible to Git —
-- the source-of-truth document stays in its original language.
CREATE TABLE document_translations (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id         UUID         NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    target_language     VARCHAR(8)   NOT NULL,
    source_content_hash VARCHAR(64)  NOT NULL,
    translated_content  TEXT         NOT NULL,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (document_id, target_language)
);

CREATE INDEX idx_document_translations_lookup ON document_translations(document_id, target_language);
