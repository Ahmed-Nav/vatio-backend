import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, HttpException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS_CLIENT } from '../telemetry/redis.provider';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { AuditService } from '../audit/audit.service';

describe('AuthService', () => {
  let service: AuthService;
  const prisma = { user: { findUnique: jest.fn(), update: jest.fn() } };
  const sessions = { create: jest.fn(), revokeOthers: jest.fn() };
  const audit = { record: jest.fn() };
  const multi = { incr: jest.fn().mockReturnThis(), expire: jest.fn().mockReturnThis(), exec: jest.fn() };
  const redis = { set: jest.fn(), get: jest.fn(), del: jest.fn(), ttl: jest.fn(), multi: jest.fn(() => multi) };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: SessionService, useValue: sessions },
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('changePassword', () => {
    it('rejects a wrong current password and counts the failed attempt', async () => {
      redis.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', password: await bcrypt.hash('right-password', 4) });

      await expect(service.changePassword('u1', 'wrong-password', 'brand-new-pass')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(multi.incr).toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('blocks further attempts after 5 failures', async () => {
      redis.get.mockResolvedValue('5');
      await expect(service.changePassword('u1', 'x', 'brand-new-pass')).rejects.toBeInstanceOf(HttpException);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('updates the password and signs out the other sessions only', async () => {
      redis.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', password: await bcrypt.hash('old-password', 4) });

      await service.changePassword('u1', 'old-password', 'brand-new-pass', 'tok');

      expect(prisma.user.update).toHaveBeenCalled();
      expect(sessions.revokeOthers).toHaveBeenCalledWith('u1', 'tok');
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.change_password' }));
    });
  });
});
