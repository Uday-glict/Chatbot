-- 0001_init: core identity, chat metadata and membership tables.

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  email         text NOT NULL CHECK (position('@' in email) > 1 AND char_length(email) <= 254),
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive unique login identifier (email is the unique login key).
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));
CREATE INDEX users_name_lower_idx ON users (lower(name));

CREATE TABLE chats (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_type      text NOT NULL CHECK (chat_type IN ('direct', 'group')),
  name           text CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 120),
  created_by     uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  -- Sorted unordered pair for direct chats only; NULL for groups.
  direct_user_a  uuid REFERENCES users (id) ON DELETE CASCADE,
  direct_user_b  uuid REFERENCES users (id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chats_shape CHECK (
    (chat_type = 'direct'
      AND name IS NULL
      AND direct_user_a IS NOT NULL
      AND direct_user_b IS NOT NULL
      AND direct_user_a < direct_user_b)
    OR (chat_type = 'group'
      AND name IS NOT NULL
      AND direct_user_a IS NULL
      AND direct_user_b IS NULL)
  )
);

-- Database-level guarantee that the same unordered pair maps to one direct chat,
-- including under concurrent creation (the second INSERT blocks, then fails).
CREATE UNIQUE INDEX chats_direct_pair_key
  ON chats (direct_user_a, direct_user_b)
  WHERE direct_user_a IS NOT NULL;

CREATE INDEX chats_created_by_idx ON chats (created_by);

CREATE TABLE chat_participants (
  chat_id   uuid NOT NULL REFERENCES chats (id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role      text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);

CREATE INDEX chat_participants_user_idx ON chat_participants (user_id);

-- Keep updated_at truthful without relying on application code.
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_touch_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER chats_touch_updated_at
  BEFORE UPDATE ON chats
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
