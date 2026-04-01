const { Pool } = require('pg');
require('dotenv').config();

async function clean() {
    console.log('--- NUCLEAR DATABASE RESET STARTED ---');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const client = await pool.connect();
    try {
        console.log('Force-dropping the entire public schema to clear all corruption...');
        // Total Reset
        await client.query('DROP SCHEMA public CASCADE;');
        await client.query('CREATE SCHEMA public;');
        await client.query('GRANT ALL ON SCHEMA public TO public;');
        await client.query('COMMENT ON SCHEMA public IS \'standard public schema\';');
        
        console.log('--- DATABASE IS NOW 100% EMPTY AND REPAIRED ---');
    } catch (e) {
        console.error('ERROR during nuclear reset:', e.message);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

clean();
