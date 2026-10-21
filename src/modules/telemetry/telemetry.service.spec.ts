import { Test, TestingModule } from '@nestjs/testing';
import { TelemetryService } from './telemetry.service';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS_CLIENT } from './redis.provider';

describe('TelemetryService', () => {
  let service: TelemetryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelemetryService,
        { provide: PrismaService, useValue: { device: {}, telemetry: {} } },
        { provide: REDIS_CLIENT, useValue: { xadd: jest.fn() } },
      ],
    }).compile();

    service = module.get<TelemetryService>(TelemetryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  afterEach(() => service.onModuleDestroy());
});
