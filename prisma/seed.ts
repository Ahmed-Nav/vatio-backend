import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';
import * as bcrypt from 'bcrypt';

// 1. Initialize the Postgres Pool
const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });

// 2. Wrap it in the Prisma Adapter
const adapter = new PrismaPg(pool);

// 3. Initialize Prisma 7 Client with the adapter
const prisma = new PrismaClient({ adapter });

async function main() {
    const hashedPassword = await bcrypt.hash('admin@123', 10);

    const user = await prisma.user.upsert({
        where: { email: 'admin@vatio.com' },
        update: {},
        create: {
            email: 'admin@vatio.com',
            name: 'Vatio Admin',
            password: hashedPassword,
        },
    });

    await prisma.device.upsert({
        where: { id: 'DEV-001' },
        update: {},
        create: {
            id: 'DEV-001',
            name: 'Solar Panel Array A',
            location: 'Rooftop A',
            type: 'solar',
            ownerId: user.id,
        },
    });

    await prisma.device.upsert({
        where: { id: 'DEV-002' },
        update: {},
        create: {
            id: 'DEV-002',
            name: 'Solar Panel Array B',
            location: 'Rooftop B',
            type: 'solar',
            ownerId: user.id,
        },
    });

    console.log('Seed completed: User, DEV-001, and DEV-002 created.');

    // -----------------------------------------------------------
    // TimescaleDB Setup (gracefully skips if extension unavailable)
    // -----------------------------------------------------------
    const pgPool = new Pool({ connectionString });
    const client = await pgPool.connect();
    try {
        // 1. Enable TimescaleDB extension
        await client.query(`CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE`);

        // 2. Convert Telemetry table to a hypertable partitioned by timestamp
        await client.query(`
            SELECT create_hypertable('"Telemetry"', 'timestamp',
                if_not_exists => TRUE,
                migrate_data => TRUE
            )
        `);

        // 3. Enable compression on the hypertable, segmented by deviceId
        await client.query(`
            ALTER TABLE "Telemetry" SET (
                timescaledb.compress,
                timescaledb.compress_segmentby = '"deviceId"'
            )
        `);

        // 4. Add automatic compression policy: compress chunks older than 7 days
        await client.query(`
            SELECT add_compression_policy('"Telemetry"', INTERVAL '7 days',
                if_not_exists => TRUE
            )
        `);

        console.log('TimescaleDB: Hypertable + compression policy configured successfully.');
    } catch (e) {
        console.warn('TimescaleDB setup skipped (extension not available):', e.message);
    } finally {
        client.release();
        await pgPool.end();
    }
}

main()
    .catch((e) => console.error(e))
    .finally(async () => await prisma.$disconnect());