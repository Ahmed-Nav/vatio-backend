import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';

describe('AuthController', () => {
  let controller: AuthController;
  const authService = {
    login: jest.fn(),
    verifyOtp: jest.fn(),
  };
  const sessions = {
    getCsrfToken: jest.fn(),
    revoke: jest.fn(),
    revokeAll: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: SessionService, useValue: sessions },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('sets the opaque session cookie and keeps its value out of the response', async () => {
    authService.verifyOtp.mockResolvedValueOnce({
      sessionToken: 'opaque-token',
      csrfToken: 'csrf-token',
      expiresAt: '2026-10-11T00:00:00.000Z',
      user: { id: 'user-1', email: 'admin@vatio.com', role: 'admin' },
    });
    const reply = { setCookie: jest.fn() };

    const response = await controller.verifyOtp(
      { email: 'admin@vatio.com', otp: '1234' },
      { headers: { 'user-agent': 'jest' } },
      reply as never,
    );

    expect(reply.setCookie).toHaveBeenCalledWith(
      'vatio_session',
      'opaque-token',
      expect.objectContaining({ httpOnly: true, sameSite: 'strict' }),
    );
    expect(response).not.toHaveProperty('sessionToken');
    expect(response).toMatchObject({ csrfToken: 'csrf-token' });
  });
});
