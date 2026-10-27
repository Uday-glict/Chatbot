import type { Queryable } from '../db/pool';
import type { Chat, ChatType, Participant, ParticipantRole } from '../types/domain';

interface ChatRow {
  id: string;
  chat_type: ChatType;
  name: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

interface ParticipantRow {
  chat_id: string;
  user_id: string;
  role: ParticipantRole;
  joined_at: Date;
}

function toChat(row: ChatRow): Chat {
  return {
    id: row.id,
    chatType: row.chat_type,
    name: row.name,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toParticipant(row: ParticipantRow): Participant {
  return {
    chatId: row.chat_id,
    userId: row.user_id,
    role: row.role,
    joinedAt: row.joined_at.toISOString(),
  };
}

const CHAT_COLUMNS = 'id, chat_type, name, created_by, created_at, updated_at';
const PARTICIPANT_COLUMNS = 'chat_id, user_id, role, joined_at';

export interface DirectPairInput {
  lowUserId: string;
  highUserId: string;
  createdBy: string;
}

export interface GroupMemberInput {
  userId: string;
  role: ParticipantRole;
}

export interface UserChatCursor {
  updatedAt: string;
  id: string;
}

export class ChatRepository {
  constructor(private readonly db: Queryable) {}

  async findById(chatId: string): Promise<Chat | null> {
    const { rows } = await this.db.query<ChatRow>(
      `SELECT ${CHAT_COLUMNS} FROM chats WHERE id = $1`,
      [chatId],
    );
    const row = rows[0];
    return row ? toChat(row) : null;
  }

  async findDirectByPair(lowUserId: string, highUserId: string): Promise<Chat | null> {
    const { rows } = await this.db.query<ChatRow>(
      `SELECT ${CHAT_COLUMNS} FROM chats
       WHERE chat_type = 'direct' AND direct_user_a = $1 AND direct_user_b = $2`,
      [lowUserId, highUserId],
    );
    const row = rows[0];
    return row ? toChat(row) : null;
  }

  /** Raw insert; callers handle unique_violation (23505) as "already exists". */
  async insertDirect(input: DirectPairInput): Promise<Chat> {
    const { rows } = await this.db.query<ChatRow>(
      `INSERT INTO chats (chat_type, name, created_by, direct_user_a, direct_user_b)
       VALUES ('direct', NULL, $1, $2, $3)
       RETURNING ${CHAT_COLUMNS}`,
      [input.createdBy, input.lowUserId, input.highUserId],
    );
    const row = rows[0];
    if (!row) throw new Error('direct chat insert returned no row');
    return toChat(row);
  }

  async insertGroup(name: string, createdBy: string): Promise<Chat> {
    const { rows } = await this.db.query<ChatRow>(
      `INSERT INTO chats (chat_type, name, created_by)
       VALUES ('group', $1, $2)
       RETURNING ${CHAT_COLUMNS}`,
      [name, createdBy],
    );
    const row = rows[0];
    if (!row) throw new Error('group chat insert returned no row');
    return toChat(row);
  }

  /**
   * Inserts members ignoring duplicates, so concurrent or repeated adds are
   * idempotent. Returns the rows actually written.
   */
  async insertParticipants(chatId: string, members: GroupMemberInput[]): Promise<Participant[]> {
    if (members.length === 0) return [];
    const chatIds = members.map(() => chatId);
    const userIds = members.map((m) => m.userId);
    const roles = members.map((m) => m.role);
    const { rows } = await this.db.query<ParticipantRow>(
      `INSERT INTO chat_participants (chat_id, user_id, role)
       SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::text[])
         AS t(chat_id, user_id, role)
       ON CONFLICT (chat_id, user_id) DO NOTHING
       RETURNING ${PARTICIPANT_COLUMNS}`,
      [chatIds, userIds, roles],
    );
    return rows.map(toParticipant);
  }

  async findParticipants(chatId: string): Promise<Participant[]> {
    const { rows } = await this.db.query<ParticipantRow>(
      `SELECT ${PARTICIPANT_COLUMNS} FROM chat_participants
       WHERE chat_id = $1
       ORDER BY joined_at ASC, user_id ASC`,
      [chatId],
    );
    return rows.map(toParticipant);
  }

  async findParticipant(chatId: string, userId: string): Promise<Participant | null> {
    const { rows } = await this.db.query<ParticipantRow>(
      `SELECT ${PARTICIPANT_COLUMNS} FROM chat_participants
       WHERE chat_id = $1 AND user_id = $2`,
      [chatId, userId],
    );
    const row = rows[0];
    return row ? toParticipant(row) : null;
  }

  async findParticipantsFor(chatIds: string[]): Promise<Participant[]> {
    if (chatIds.length === 0) return [];
    const { rows } = await this.db.query<ParticipantRow>(
      `SELECT ${PARTICIPANT_COLUMNS} FROM chat_participants
       WHERE chat_id = ANY($1::uuid[])
       ORDER BY joined_at ASC, user_id ASC`,
      [chatIds],
    );
    return rows.map(toParticipant);
  }

  async removeParticipant(chatId: string, userId: string): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `DELETE FROM chat_participants WHERE chat_id = $1 AND user_id = $2`,
      [chatId, userId],
    );
    return (rowCount ?? 0) > 0;
  }

  async setRole(chatId: string, userId: string, role: ParticipantRole): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `UPDATE chat_participants SET role = $3 WHERE chat_id = $1 AND user_id = $2`,
      [chatId, userId, role],
    );
    return (rowCount ?? 0) > 0;
  }

  async rename(chatId: string, name: string): Promise<Chat | null> {
    const { rows } = await this.db.query<ChatRow>(
      `UPDATE chats SET name = $2 WHERE id = $1 AND chat_type = 'group' RETURNING ${CHAT_COLUMNS}`,
      [chatId, name],
    );
    const row = rows[0];
    return row ? toChat(row) : null;
  }

  async touchChat(chatId: string): Promise<void> {
    await this.db.query(`UPDATE chats SET updated_at = now() WHERE id = $1`, [chatId]);
  }

  /**
   * Keyset pagination over the caller's chats ordered by updated_at DESC.
   * Uses the (user_id) index on chat_participants and the chats PK.
   */
  async listUserChats(
    userId: string,
    limit: number,
    cursor: UserChatCursor | null,
  ): Promise<Chat[]> {
    const { rows } = await this.db.query<ChatRow>(
      `SELECT c.id, c.chat_type, c.name, c.created_by, c.created_at, c.updated_at
       FROM chats c
       JOIN chat_participants p ON p.chat_id = c.id
       WHERE p.user_id = $1
         AND ($2::timestamptz IS NULL
           OR c.updated_at < $2::timestamptz
           OR (c.updated_at = $2::timestamptz AND c.id < $3::uuid))
       ORDER BY c.updated_at DESC, c.id DESC
       LIMIT $4`,
      [userId, cursor?.updatedAt ?? null, cursor?.id ?? null, limit],
    );
    return rows.map(toChat);
  }

  /** Counts a user's chats so callers can detect a full page. */
  async countUserChats(userId: string): Promise<number> {
    const { rows } = await this.db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM chat_participants WHERE user_id = $1`,
      [userId],
    );
    return Number(rows[0]?.count ?? 0);
  }
}
