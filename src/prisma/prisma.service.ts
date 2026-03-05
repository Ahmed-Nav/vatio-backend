import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(PrismaService.name);
    private pool: Pool;

    constructor() {
        // 1. Initialize the raw Postgres connection pool
        const connectionString = process.env.DATABASE_URL;
        const pool = new Pool({ connectionString });

        // 2. Wrap it in the Prisma 7 adapter
        const adapter = new PrismaPg(pool);

        // 3. Pass the adapter to the PrismaClient constructor
        super({ adapter });
        this.pool = pool;
    }

    async onModuleInit() {
        await this.$connect();
        this.logger.log('Connected to PostgreSQL Database via Prisma 7');
    }

    async onModuleDestroy() {
        await this.$disconnect();
        await this.pool.end();
    }
}