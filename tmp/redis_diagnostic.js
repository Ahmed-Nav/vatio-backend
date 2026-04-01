const Redis = require('ioredis');
require('dotenv').config();

const config = {
    host: process.env.REDIS_HOST || 'elegant-gazelle-9710.upstash.io',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
    tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
};

async function diagnostic() {
    const redis = new Redis(config);
    console.log(`Connecting to Redis: ${config.host}...`);

    try {
        await redis.ping();
        console.log('Connected successfully.');

        let totalTime = 0;
        const iterations = 10;

        for (let i = 0; i < iterations; i++) {
            const start = Date.now();
            await redis.ping();
            const end = Date.now();
            const diff = end - start;
            console.log(`Iteration ${i + 1}: ${diff}ms`);
            totalTime += diff;
        }

        console.log(`\nAverage Latency (PING): ${totalTime / iterations}ms`);

        // Test sequential vs parallel for 2 commands (similar to ingestData)
        console.log('\nTesting Sequential (x2 commands):');
        const sStart = Date.now();
        await redis.set('test:seq:1', 'val');
        await redis.set('test:seq:2', 'val');
        const sEnd = Date.now();
        console.log(`Sequential time: ${sEnd - sStart}ms`);

        console.log('\nTesting Parallel (x2 commands):');
        const pStart = Date.now();
        await Promise.all([
            redis.set('test:par:1', 'val'),
            redis.set('test:par:2', 'val')
        ]);
        const pEnd = Date.now();
        console.log(`Parallel time: ${pEnd - pStart}ms`);

    } catch (err) {
        console.error('Redis error:', err);
    } finally {
        redis.disconnect();
    }
}

diagnostic();
