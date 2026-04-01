import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

async function checkDb() {
    const prisma = new PrismaClient();

    try {
        const users = await prisma.user.findMany({
            include: { devices: true }
        });
        console.log('Users in DB:');
        users.forEach(u => {
            console.log(`- ${u.email} (ID: ${u.id}) - Devices: ${u.devices.length}`);
            u.devices.forEach(d => console.log(`  * Device ID: ${d.id}, Name: ${d.name}`));
        });

        const devices = await prisma.device.findMany();
        console.log('\nTotal Devices in DB:', devices.length);
        devices.forEach(d => console.log(`- ID: ${d.id}, OwnerID: ${d.ownerId}`));

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

checkDb();
