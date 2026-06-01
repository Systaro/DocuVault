-- Spoken language for a meeting invite. The bot pins this on the speech-to-text
-- call (and writes the meeting note in it) so Whisper no longer misdetects the
-- language on short utterances. Existing rows default to German.
ALTER TABLE meeting_invites
    ADD COLUMN IF NOT EXISTS language VARCHAR(10) NOT NULL DEFAULT 'de';
