-- A conversation without a space asks across every repository its user can read.
ALTER TABLE conversations ALTER COLUMN space_id DROP NOT NULL;
