-- Teams: named groups of users, so access can be granted once per team instead
-- of once per person. A user may belong to any number of teams and inherits the
-- union of every team's space grants on top of their own direct grants.
CREATE TABLE teams (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(255) NOT NULL,
    slug        VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    color       VARCHAR(16),
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE team_memberships (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id    UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (team_id, user_id)
);

CREATE INDEX idx_team_memberships_user ON team_memberships(user_id);

-- Space grants held by a team. Mirrors space_permissions and is combined with
-- it: the effective level for a user on a space is the HIGHEST of their direct
-- grant and every grant from teams they belong to. If nothing is found at that
-- space, resolution walks up the space hierarchy exactly as before.
CREATE TABLE team_space_permissions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id          UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    space_id         UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    permission_level VARCHAR(16) NOT NULL CHECK (permission_level IN ('VIEW', 'EDIT', 'ADMIN')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (team_id, space_id)
);

CREATE INDEX idx_team_space_permissions_space ON team_space_permissions(space_id);
