-- Tasks: something someone has to do, in a space, optionally with an owner and a date.
--
-- Kept in the database rather than as files in Git: status changes all the
-- time, and a commit per checkbox would bury the document history.

CREATE TABLE tasks (
    id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id      UUID          NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    title         VARCHAR(500)  NOT NULL,
    description   TEXT,
    -- SUGGESTED (proposed by the meeting bot or capture, waiting for its creator
    -- to confirm), OPEN, IN_PROGRESS, DONE
    status        VARCHAR(20)   NOT NULL DEFAULT 'OPEN',
    -- LOW, NORMAL, HIGH; null when nobody said
    priority      VARCHAR(10),
    assignee_id   UUID          REFERENCES users(id) ON DELETE SET NULL,
    due_date      DATE,
    created_by    UUID          REFERENCES users(id) ON DELETE SET NULL,
    -- When and by whom the current assignee was set, for the notification feed.
    assigned_at   TIMESTAMPTZ,
    assigned_by   UUID          REFERENCES users(id) ON DELETE SET NULL,
    -- Where the task came from: DOCUMENT (source_id = path), INBOX_NOTE,
    -- MEETING (source_id = the inbox note holding the meeting note), CONVERSATION
    source_type   VARCHAR(20),
    source_id     TEXT,
    source_label  VARCHAR(500),
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    done_at       TIMESTAMPTZ
);

CREATE INDEX idx_tasks_assignee_status ON tasks(assignee_id, status);
CREATE INDEX idx_tasks_space_status ON tasks(space_id, status);
CREATE INDEX idx_tasks_created_by_status ON tasks(created_by, status);
CREATE INDEX idx_tasks_source ON tasks(source_type, source_id);

-- Tasks the assistant created while answering, shown under its message.
ALTER TABLE conversation_messages ADD COLUMN created_tasks JSONB NOT NULL DEFAULT '[]';
