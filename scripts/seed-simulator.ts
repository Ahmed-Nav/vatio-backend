import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Starting Seed...');

    const adminEmail = 'admin@vatio.io';
    const hashedPassword = await bcrypt.hash('admin@123', 10);
    const adminUser = await prisma.user.upsert({
        where: { email: adminEmail },
        update: {
            password: hashedPassword,
        },
        create: {
            email: adminEmail,
            name: 'Admin User',
            password: hashedPassword,
            role: 'admin',
        },
    });
    console.log(`✅ Admin User created/found: ${adminUser.email} (ID: ${adminUser.id})`);

    // 2. Reassign all existing devices to this admin and delete other users
    await prisma.device.updateMany({
        data: { ownerId: adminUser.id },
    });
    console.log('✅ Reassigned all existing devices to admin.');

    await prisma.device.deleteMany({
        where: { id: { in: ['SIM-002', 'SIM-003'] } },
    });
    console.log('✅ Removed SIM-002 and SIM-003.');
    
    await prisma.user.deleteMany({
        where: {
            id: { not: adminUser.id },
        },
    });
    console.log('✅ Removed all other users.');

    // 3. Ensure the SIM devices exist and are assigned to admin
    const deviceIds = ['SIM-001'];
    
    for (const deviceId of deviceIds) {
        const device = await prisma.device.upsert({
            where: { id: deviceId },
            update: {},
            create: {
                id: deviceId,
                name: `Vatio Simulator - ${deviceId}`,
                location: 'Local Simulator',
                type: '3-Phase Meter',
                ownerId: adminUser.id,
                status: 'active',
                hwVersion: 'V2.0',
                fwVersion: 'S.1.0'
            },
        });
        console.log(`✅ Device created/found: ${device.id}`);
    }

    console.log('✨ Seed Finished!');
}

main()
    .catch((e) => {
        console.error('❌ Seed failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
