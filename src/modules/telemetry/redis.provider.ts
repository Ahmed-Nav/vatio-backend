import Redis from 'ioredis';
import { getRedisConfig } from '../../config/redis.config';

export const REDIS_CLIENT = 'REDIS_CLIENT';

export const RedisProvider = {
    provide: REDIS_CLIENT,
    useFactory: () => {
        return new Redis(getRedisConfig());
    },
};