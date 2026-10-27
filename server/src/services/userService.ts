import { forbidden, notFound } from '../errors';
import type { UserRepository } from '../repositories/userRepository';
import type { PublicUser, User } from '../types/domain';

export interface SearchParams {
  query: string;
  limit: number;
  offset: number;
  excludeUserId: string;
}

export class UserService {
  constructor(private readonly users: () => UserRepository) {}

  async me(userId: string): Promise<User> {
    const user = await this.users().findById(userId);
    if (!user) throw notFound('User not found');
    return user;
  }

  /**
   * Excludes the caller by default, returns only id/name/email, and is
   * page-bounded by the caller-provided limit (validated at the boundary).
   */
  async search(params: SearchParams): Promise<PublicUser[]> {
    return this.users().search({
      query: params.query,
      excludeUserId: params.excludeUserId,
      limit: params.limit,
      offset: params.offset,
    });
  }

  /** Guards: requested user id must equal the authenticated user id. */
  assertSelf(authUserId: string, requestedUserId: string): void {
    if (authUserId !== requestedUserId) {
      throw forbidden('You may only access your own data');
    }
  }
}
