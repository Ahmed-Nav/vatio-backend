import { PrismaClient } from '@prisma/client';

async function main() {
    const prisma = new PrismaClient();
    try {
        const user = await prisma.user.findFirst();
        console.log('User model exists');
        console.log('User fields:', Object.keys(user || {}));
    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        await prisma.$disconnect();
    }
}

main();
