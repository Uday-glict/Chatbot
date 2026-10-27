import { conflict, unauthorized } from '../errors';
import { isUniqueViolation } from '../db/pool';
import { UserRepository } from '../repositories/userRepository';
import type { User } from '../types/domain';
import { hashPassword, verifyPassword } from './password';
import { signToken } from './token';

export interface AuthResult {
  user: User;
  token: string;
}

export interface SignupInput {
  name: string;
  email: string;
  password: string;
}

export class AuthService {
  constructor(
    private readonly users: () => UserRepository,
    private readonly costRounds: number,
  ) {}

  async signup(input: SignupInput): Promise<AuthResult> {
    const passwordHash = await hashPassword(input.password, this.costRounds);
    try {
      const user = await this.users().create({
        name: input.name.trim(),
        email: input.email.trim().toLowerCase(),
        passwordHash,
      });
      return { user, token: signToken(user.id) };
    } catch (err) {
      // Race with a concurrent signup on the same email surfaces as 23505.
      if (isUniqueViolation(err)) {
        throw conflict('An account with this email already exists');
      }
      throw err;
    }
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const found = await this.users().findByEmail(email.trim());
    // Identical message for unknown email and bad password: no enumeration.
    if (!found) throw unauthorized('Invalid email or password');
    const ok = await verifyPassword(password, found.passwordHash);
    if (!ok) throw unauthorized('Invalid email or password');
    return { user: found.user, token: signToken(found.user.id) };
  }
}
