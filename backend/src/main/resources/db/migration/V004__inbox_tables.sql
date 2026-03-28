-- Routing rules for inbox auto-filing
CREATE TABLE IF NOT EXISTS routing_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL,
    condition VARCHAR(500) NOT NULL,
    action_type VARCHAR(50) NOT NULL DEFAULT 'APPEND_TO_DOCUMENT',
    target_document_path VARCHAR(1000),
    target_group_path VARCHAR(500),
    auto_file BOOLEAN NOT NULL DEFAULT false,
    description VARCHAR(500),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_routing_rules_space_id ON routing_rules(space_id);

-- Inbox notes
CREATE TABLE IF NOT EXISTS inbox_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'UNSORTED',
    ai_suggestion TEXT,
    filed_to_document_path VARCHAR(1000),
    filed_by_id UUID REFERENCES users(id),
    auto_filed BOOLEAN NOT NULL DEFAULT false,
    applied_rule_id UUID REFERENCES routing_rules(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    filed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_inbox_notes_space_id_status ON inbox_notes(space_id, status);
