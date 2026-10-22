import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DeviceService } from './device.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

describe('DeviceService', () => {
  let service: DeviceService;
  const prisma = {
    device: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
    telemetry: { deleteMany: jest.fn() },
    alert: { deleteMany: jest.fn() },
    user: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  const audit = { record: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeviceService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get<DeviceService>(DeviceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('hides a disabled device from its (non-admin) owner but not from an admin', async () => {
    prisma.device.findFirst.mockResolvedValue({ id: 'D1', enabled: false });
    await expect(service.findOne('u1', 'D1', 'user')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.findOne('admin', 'D1', 'admin')).resolves.toMatchObject({ id: 'D1' });
  });

  it('lets an admin update a device they do not own and audits the disable', async () => {
    prisma.device.findUnique.mockResolvedValue({ id: 'D1', ownerId: 'u1' });
    prisma.device.update.mockResolvedValue({ id: 'D1', enabled: false });

    await service.update('admin1', 'D1', { enabled: false });

    expect(prisma.device.update).toHaveBeenCalledWith({ where: { id: 'D1' }, data: { enabled: false } });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'device.disable' }));
  });

  it('unassigns a device with a null owner', async () => {
    prisma.device.findUnique.mockResolvedValue({ id: 'D1', ownerId: 'u1' });
    prisma.device.update.mockResolvedValue({ id: 'D1', ownerId: null });

    await service.setOwner('admin1', 'D1', null);

    expect(prisma.device.update).toHaveBeenCalledWith({ where: { id: 'D1' }, data: { ownerId: null } });
  });

  it('refuses to assign to a user that does not exist', async () => {
    prisma.device.findUnique.mockResolvedValue({ id: 'D1', ownerId: null });
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.setOwner('admin1', 'D1', 'ghost')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deletes readings and alerts before the device', async () => {
    prisma.device.findUnique.mockResolvedValue({ id: 'D1', name: 'n', ownerId: null });
    prisma.$transaction.mockResolvedValue([]);
    await service.remove('admin1', 'D1');
    expect(prisma.telemetry.deleteMany).toHaveBeenCalledWith({ where: { deviceId: 'D1' } });
    expect(prisma.alert.deleteMany).toHaveBeenCalledWith({ where: { deviceId: 'D1' } });
    expect(prisma.device.delete).toHaveBeenCalledWith({ where: { id: 'D1' } });
  });
});
