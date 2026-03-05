import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config'; // Ensure env vars are loaded

// 1. Initialize the Postgres Pool
const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });

// 2. Wrap it in the Prisma Adapter
const adapter = new PrismaPg(pool);

// 3. Initialize Prisma 7 Client with the adapter
const prisma = new PrismaClient({ adapter });

async function main() {
    const user = await prisma.user.upsert({
        where: { email: 'admin@vatio.com' },
        update: {},
        create: {
            email: 'admin@vatio.com',
            name: 'Vatio Admin',
            password: 'admin@123'
        },
    });

    await prisma.device.upsert({
        where: { id: 'DEV-001' },
        update: {},
        create: {
            id: 'DEV-001',
            name: 'Solar Panel Array A',
            ownerId: user.id,
        },
    });

    console.log('Seed completed: User and DEV-001 created.');
}

main()
    .catch((e) => console.error(e))
    .finally(async () => await prisma.$disconnect());