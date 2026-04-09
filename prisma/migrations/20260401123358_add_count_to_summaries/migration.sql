-- AlterTable
ALTER TABLE "DailyDeviceStats" ADD COLUMN     "count" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "HourlyDeviceStats" ADD COLUMN     "count" INTEGER NOT NULL DEFAULT 1;
