const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function test() {
    try {
        const res = await prisma.$queryRawUnsafe('SHOW timezone');
        console.log("DB Timezone:", res);
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}
test();
