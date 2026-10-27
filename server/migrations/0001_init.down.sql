-- Reverses 0001_init.
DROP TRIGGER IF EXISTS chats_touch_updated_at ON chats;
DROP TRIGGER IF EXISTS users_touch_updated_at ON users;
DROP FUNCTION IF EXISTS touch_updated_at();

DROP TABLE IF EXISTS chat_participants;
DROP TABLE IF EXISTS chats;
DROP TABLE IF EXISTS users;
