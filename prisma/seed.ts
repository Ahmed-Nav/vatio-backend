import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import 'dotenv/config';
import * as bcrypt from 'bcrypt';

// Initialize Prisma Client using native connection
const prisma = new PrismaClient();

async function main() {
    const hashedPassword = await bcrypt.hash('admin@123', 10);

    // @ts-ignore
    const user = await prisma.user.upsert({
        where: { email: 'admin@vatio.io' },
        update: { password: hashedPassword },
        create: {
            email: 'admin@vatio.io',
            name: 'Vatio Admin',
            password: hashedPassword,
        },
    });

    await prisma.device.upsert({
        where: { id: 'SIM-001' },
        update: {},
        create: {
            id: 'SIM-001',
            name: 'Simulator 1 (AC Main)',
            location: 'Factory Floor A',
            type: 'meter',
            owner: { connect: { id: user.id } },
        },
    });

    await prisma.device.upsert({
        where: { id: 'SIM-001' },
        update: {},
        create: {
            id: 'SIM-001',
            name: 'Simulator 1 (AC Main)',
            location: 'Factory Floor A',
            type: 'meter',
            owner: { connect: { id: user.id } },
        },
    });

    console.log('Seed completed: User and SIM-001 created.');

    // -----------------------------------------------------------
    // TimescaleDB Setup (gracefully skips if extension unavailable)
    // -----------------------------------------------------------
    const connectionString = process.env.DATABASE_URL;
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