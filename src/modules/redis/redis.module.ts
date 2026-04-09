import { Module, Global } from '@nestjs/common';
import Redis from 'ioredis';
import { getRedisConfig } from '../../config/redis.config';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
    providers: [
        {
            provide: REDIS_CLIENT,
            useFactory: () => {
                return new Redis(getRedisConfig());
            },
        },
    ],
    exports: [REDIS_CLIENT],
})
export class RedisModule { }
