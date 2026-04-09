const { Client } = require('pg');
const bcrypt = require('bcrypt');
require('dotenv').config();

async function seedRaw() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL
    });

    try {
        await client.connect();
        
        const adminId = '66fce60c-71bc-40b6-af92-71a243142a32';
        const email = 'admin@vatio.in';
        const hashedPassword = await bcrypt.hash('password@123', 10);
        
        console.log(`Checking/Creating user: ${email}`);
        
        const res = await client.query('SELECT id FROM "User" WHERE email = $1', [email]);
        
        if (res.rows.length === 0) {
            await client.query(
                'INSERT INTO "User" (id, email, name, password, role, "createdAt") VALUES ($1, $2, $3, $4, $5, NOW())',
                [adminId, email, 'Vatio Admin', hashedPassword, 'admin']
            );
            console.log(`User ${email} created with ID: ${adminId}`);
        } else {
            await client.query('UPDATE "User" SET password = $1 WHERE email = $2', [hashedPassword, email]);
            console.log(`User ${email} password updated.`);
        }
        
    } catch (e) {
        console.error('Error seeding:', e);
    } finally {

        await client.end();
    }
}

seedRaw();
