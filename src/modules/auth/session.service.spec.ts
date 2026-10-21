import type Redis from 'ioredis';
import { SessionService } from './session.service';

class RedisFake {
  readonly values = new Map<string, string>();
  readonly sets = new Map<string, Set<string>>();
  private queued: Array<() => void> = [];

  get(key: string) {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  set(key: string, value: string) {
    this.values.set(key, value);
    return Promise.resolve('OK');
  }

  del(key: string) {
    return Promise.resolve(this.values.delete(key) ? 1 : 0);
  }

  smembers(key: string) {
    return Promise.resolve([...(this.sets.get(key) ?? [])]);
  }

  multi() {
    this.queued = [];
    const chain = {
      set: (key: string, value: string) => {
        this.queued.push(() => this.values.set(key, value));
        return chain;
      },
      sadd: (key: string, value: string) => {
        this.queued.push(() => {
          const members = this.sets.get(key) ?? new Set<string>();
          members.add(value);
          this.sets.set(key, members);
        });
        return chain;
      },
      expire: () => chain,
      del: (key: string) => {
        this.queued.push(() => {
          this.values.delete(key);
          this.sets.delete(key);
        });
        return chain;
      },
      srem: (key: string, value: string) => {
        this.queued.push(() => this.sets.get(key)?.delete(value));
        return chain;
      },
      exec: () => {
        this.queued.forEach((operation) => operation());
        this.queued = [];
        return Promise.resolve([]);
      },
    };
    return chain;
  }
}

describe('SessionService', () => {
  let redis: RedisFake;
  let service: SessionService;

  beforeEach(() => {
    process.env.SESSION_SECRET = 'test-session-secret';
    redis = new RedisFake();
    service = new SessionService(redis as unknown as Redis);
  });

  it('creates and validates an opaque session with a matching CSRF token', async () => {
    const created = await service.create({
      userId: 'user-1',
      email: 'admin@vatio.com',
      name: 'Admin',
      role: 'admin',
    });

    expect(created.token).toBeTruthy();
    expect([...redis.values.keys()].join(' ')).not.toContain(created.token);
    expect(
      service.validateCsrfToken(created.record.sessionId, created.csrfToken),
    ).toBe(true);
    expect(
      service.validateCsrfToken(created.record.sessionId, 'wrong-token'),
    ).toBe(false);
    await expect(service.validate(created.token, false)).resolves.toMatchObject(
      {
        user: { userId: 'user-1', role: 'admin' },
      },
    );
  });

  it('revokes one session without affecting another session', async () => {
    const user = {
      userId: 'user-1',
      email: 'admin@vatio.com',
      name: 'Admin',
      role: 'admin',
    };
    const first = await service.create(user);
    const second = await service.create(user);

    await service.revoke(first.token);

    await expect(service.validate(first.token, false)).resolves.toBeNull();
    await expect(service.validate(second.token, false)).resolves.not.toBeNull();
  });

  it('revokes all sessions for a user', async () => {
    const user = {
      userId: 'user-1',
      email: 'admin@vatio.com',
      name: 'Admin',
      role: 'admin',
    };
    const first = await service.create(user);
    const second = await service.create(user);

    await service.revokeAll(user.userId);

    await expect(service.validate(first.token, false)).resolves.toBeNull();
    await expect(service.validate(second.token, false)).resolves.toBeNull();
  });
});
