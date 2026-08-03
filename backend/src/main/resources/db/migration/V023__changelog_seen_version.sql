-- What's-new dialog: remember the newest release whose notes a user has already
-- acknowledged, so only entries published after that are shown on next login.
-- NULL means the user has never seen the dialog.
ALTER TABLE users ADD COLUMN changelog_seen_version VARCHAR(32);
