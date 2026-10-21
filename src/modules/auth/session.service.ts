import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../telemetry/redis.provider';
import {
  SESSION_ABSOLUTE_TTL_SECONDS,
  SESSION_IDLE_TTL_SECONDS,
  SESSION_TOUCH_INTERVAL_SECONDS,
} from './session.config';

export interface SessionUser {
  userId: string;
  email: string;
  name: string | null;
  role: string;
}

export interface SessionRecord {
  sessionId: string;
  user: SessionUser;
  createdAt: number;
  lastSeenAt: number;
  absoluteExpiresAt: number;
  userAgentHash?: string;
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private readonly csrfSecret: string;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {
    this.csrfSecret =
      process.env.SESSION_SECRET || process.env.JWT_SECRET || '';
    if (!this.csrfSecret) {
      throw new Error('SESSION_SECRET or JWT_SECRET must be configured');
    }
  }

  private hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private sessionKey(tokenHash: string) {
    return `vatio:session:${tokenHash}`;
  }

  private userSessionsKey(userId: string) {
    return `vatio:user-sessions:${userId}`;
  }

  private ttlFor(record: SessionRecord, now = Date.now()) {
    const absoluteRemaining = Math.floor(
      (record.absoluteExpiresAt - now) / 1000,
    );
    return Math.max(0, Math.min(SESSION_IDLE_TTL_SECONDS, absoluteRemaining));
  }

  getCsrfToken(sessionId: string) {
    return createHmac('sha256', this.csrfSecret)
      .update(sessionId)
      .digest('base64url');
  }

  validateCsrfToken(sessionId: string, suppliedToken?: string) {
    if (!suppliedToken) return false;
    const expected = Buffer.from(this.getCsrfToken(sessionId));
    const supplied = Buffer.from(suppliedToken);
    return (
      expected.length === supplied.length && timingSafeEqual(expected, supplied)
    );
  }

  async create(user: SessionUser, userAgent?: string) {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.hash(token);
    const now = Date.now();
    const record: SessionRecord = {
      sessionId: randomUUID(),
      user,
      createdAt: now,
      lastSeenAt: now,
      absoluteExpiresAt: now + SESSION_ABSOLUTE_TTL_SECONDS * 1000,
      userAgentHash: userAgent ? this.hash(userAgent) : undefined,
    };
    const ttl = this.ttlFor(record, now);
    const userKey = this.userSessionsKey(user.userId);

    await this.redis
      .multi()
      .set(this.sessionKey(tokenHash), JSON.stringify(record), 'EX', ttl)
      .sadd(userKey, tokenHash)
      .expire(userKey, SESSION_ABSOLUTE_TTL_SECONDS)
      .exec();

    this.logger.log(`Session created for user ${user.userId}`);
    return {
      token,
      record,
      csrfToken: this.getCsrfToken(record.sessionId),
    };
  }

  async validate(token?: string, touch = true): Promise<SessionRecord | null> {
    if (!token) return null;
    const tokenHash = this.hash(token);
    const key = this.sessionKey(tokenHash);
    const raw = await this.redis.get(key);
    if (!raw) return null;

    let record: SessionRecord;
    try {
      record = JSON.parse(raw) as SessionRecord;
    } catch {
      await this.redis.del(key);
      return null;
    }

    const now = Date.now();
    if (
      now >= record.absoluteExpiresAt ||
      now - record.lastSeenAt >= SESSION_IDLE_TTL_SECONDS * 1000
    ) {
      await this.revokeByHash(tokenHash, record.user.userId);
      return null;
    }

    if (
      touch &&
      now - record.lastSeenAt >= SESSION_TOUCH_INTERVAL_SECONDS * 1000
    ) {
      record.lastSeenAt = now;
      const ttl = this.ttlFor(record, now);
      if (ttl <= 0) {
        await this.revokeByHash(tokenHash, record.user.userId);
        return null;
      }
      await this.redis.set(key, JSON.stringify(record), 'EX', ttl);
    }

    return record;
  }

  private async revokeByHash(tokenHash: string, userId: string) {
    await this.redis
      .multi()
      .del(this.sessionKey(tokenHash))
      .srem(this.userSessionsKey(userId), tokenHash)
      .exec();
  }

  async revoke(token?: string) {
    if (!token) return;
    const tokenHash = this.hash(token);
    const raw = await this.redis.get(this.sessionKey(tokenHash));
    if (!raw) return;
    try {
      const record = JSON.parse(raw) as SessionRecord;
      await this.revokeByHash(tokenHash, record.user.userId);
      this.logger.log(`Session revoked for user ${record.user.userId}`);
    } catch {
      await this.redis.del(this.sessionKey(tokenHash));
    }
  }

  async revokeAll(userId: string) {
    const userKey = this.userSessionsKey(userId);
    const hashes = await this.redis.smembers(userKey);
    const pipeline = this.redis.multi();
    hashes.forEach((tokenHash) => pipeline.del(this.sessionKey(tokenHash)));
    pipeline.del(userKey);
    await pipeline.exec();
    this.logger.log(`All sessions revoked for user ${userId}`);
  }
}
