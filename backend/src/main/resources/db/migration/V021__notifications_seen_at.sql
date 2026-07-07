-- In-app notification feed: track when the user last opened the bell so we
-- can badge only changes newer than that.
ALTER TABLE users ADD COLUMN notifications_seen_at TIMESTAMPTZ;
