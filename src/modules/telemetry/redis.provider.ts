import { Logger, Provider } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

export const RedisProvider: Provider = {
    provide: REDIS_CLIENT,
    useFactory: () => {
        const logger = new Logger('RedisProvider');
        const host = process.env.REDIS_HOST || 'localhost';

        // This will print to your terminal so we know if it's reading your .env file
        logger.log(`Connecting to Redis Stream at: ${host}`);
        return new Redis({
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379'),
            password: process.env.REDIS_PASSWORD,
            tls: host.includes('upstash.io') ? { rejectUnauthorized: false } : undefined,
        });
    },
};