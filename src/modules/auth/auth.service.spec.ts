import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS_CLIENT } from '../telemetry/redis.provider';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: { user: { findUnique: jest.fn() } },
        },
        { provide: SessionService, useValue: { create: jest.fn() } },
        {
          provide: REDIS_CLIENT,
          useValue: {
            set: jest.fn(),
            get: jest.fn(),
            del: jest.fn(),
            ttl: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
