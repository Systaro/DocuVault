-- Conversations with the in-app assistant, replacing chat_history.
--
-- chat_history kept every message of a conversation in one JSONB array, which
-- could not be searched sensibly, had nowhere to keep what the assistant did
-- (tool calls, proposed edits) and had to be rewritten whole on every message.

CREATE TABLE conversations (
    id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    space_id      UUID          NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    -- Set when the conversation is about one document rather than the whole space.
    document_path TEXT,
    title         VARCHAR(255)  NOT NULL,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conversations_user_updated ON conversations(user_id, updated_at DESC);

CREATE TABLE conversation_messages (
    id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID          NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            VARCHAR(20)   NOT NULL,
    content         TEXT          NOT NULL,
    -- [{spaceId, path, title}]
    sources         JSONB         NOT NULL DEFAULT '[]',
    -- [{name, label, ok}]: what the assistant looked up or changed on the way
    tool_calls      JSONB         NOT NULL DEFAULT '[]',
    -- [{spaceId, path, title}]: documents the assistant created
    created_documents JSONB       NOT NULL DEFAULT '[]',
    -- [{id, spaceId, path, summary, oldText, newText, contextBefore, contextAfter, status, error}]
    proposals       JSONB         NOT NULL DEFAULT '[]',
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conversation_messages_conversation ON conversation_messages(conversation_id, created_at);

-- Carry existing history over. A conversation without a space cannot be
-- scoped any more and is dropped; there is no UI that could show it.
INSERT INTO conversations (id, user_id, space_id, title, created_at, updated_at)
SELECT id, user_id, space_id,
       COALESCE(NULLIF(TRIM(title), ''), 'Conversation'),
       COALESCE(created_at, NOW()),
       COALESCE(updated_at, created_at, NOW())
FROM chat_history
WHERE user_id IS NOT NULL AND space_id IS NOT NULL;

-- Old sources were bare paths inside the conversation's space. The timestamp
-- was written by Jackson either as epoch seconds or as an ISO string; when it
-- is missing, the array position keeps the order.
INSERT INTO conversation_messages (conversation_id, role, content, sources, created_at)
SELECT h.id,
       CASE WHEN m.value->>'role' = 'user' THEN 'user' ELSE 'assistant' END,
       COALESCE(m.value->>'content', ''),
       COALESCE(
           (SELECT jsonb_agg(jsonb_build_object('spaceId', h.space_id, 'path', src, 'title', NULL))
              FROM jsonb_array_elements_text(
                   CASE WHEN jsonb_typeof(m.value->'sources') = 'array' THEN m.value->'sources' ELSE '[]'::jsonb END
              ) AS src),
           '[]'::jsonb),
       CASE jsonb_typeof(m.value->'timestamp')
           WHEN 'number' THEN to_timestamp((m.value->>'timestamp')::double precision)
           WHEN 'string' THEN (m.value->>'timestamp')::timestamptz
           ELSE COALESCE(h.created_at, NOW()) + (m.ordinality * INTERVAL '1 millisecond')
       END
FROM chat_history h
CROSS JOIN LATERAL jsonb_array_elements(h.messages) WITH ORDINALITY AS m(value, ordinality)
WHERE h.user_id IS NOT NULL AND h.space_id IS NOT NULL;

DROP TABLE chat_history;
