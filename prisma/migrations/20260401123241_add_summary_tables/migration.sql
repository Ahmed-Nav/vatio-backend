-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "type" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "hw_version" TEXT,
    "fw_version" TEXT,
    "last_seen" TIMESTAMP(3),
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Telemetry" (
    "id" BIGSERIAL NOT NULL,
    "deviceId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data" JSONB,
    "voltage" DOUBLE PRECISION,
    "voltage2" DOUBLE PRECISION,
    "voltage3" DOUBLE PRECISION,
    "vAvgLN" DOUBLE PRECISION,
    "vL12" DOUBLE PRECISION,
    "vL23" DOUBLE PRECISION,
    "vL31" DOUBLE PRECISION,
    "vAvgLL" DOUBLE PRECISION,
    "current" DOUBLE PRECISION,
    "current2" DOUBLE PRECISION,
    "current3" DOUBLE PRECISION,
    "iAvg" DOUBLE PRECISION,
    "power" DOUBLE PRECISION,
    "power1" DOUBLE PRECISION,
    "power2" DOUBLE PRECISION,
    "power3" DOUBLE PRECISION,
    "kva" DOUBLE PRECISION,
    "kva1" DOUBLE PRECISION,
    "kva2" DOUBLE PRECISION,
    "kva3" DOUBLE PRECISION,
    "kvar" DOUBLE PRECISION,
    "kvar1" DOUBLE PRECISION,
    "kvar2" DOUBLE PRECISION,
    "kvar3" DOUBLE PRECISION,
    "pf1" DOUBLE PRECISION,
    "pf2" DOUBLE PRECISION,
    "pf3" DOUBLE PRECISION,
    "pfAvg" DOUBLE PRECISION,
    "energyExport" DOUBLE PRECISION,
    "impkwh" DOUBLE PRECISION,
    "localTime" TEXT,
    "energyNet" DOUBLE PRECISION,
    "energyTotal" DOUBLE PRECISION,
    "energyKVAh" DOUBLE PRECISION,
    "energyImpKVArh" DOUBLE PRECISION,
    "energyExpKVArh" DOUBLE PRECISION,
    "frequency" DOUBLE PRECISION,
    "vthdL1" DOUBLE PRECISION,
    "vthdL2" DOUBLE PRECISION,
    "vthdL3" DOUBLE PRECISION,
    "ithdL1" DOUBLE PRECISION,
    "ithdL2" DOUBLE PRECISION,
    "ithdL3" DOUBLE PRECISION,
    "temp" DOUBLE PRECISION,
    "status" INTEGER,

    CONSTRAINT "Telemetry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "message" TEXT NOT NULL,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HourlyDeviceStats" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "avgVoltage" DOUBLE PRECISION,
    "avgCurrent" DOUBLE PRECISION,
    "avgPower" DOUBLE PRECISION,
    "avgPF" DOUBLE PRECISION,
    "avgFreq" DOUBLE PRECISION,
    "minVoltage" DOUBLE PRECISION,
    "maxVoltage" DOUBLE PRECISION,
    "minCurrent" DOUBLE PRECISION,
    "maxCurrent" DOUBLE PRECISION,
    "minPower" DOUBLE PRECISION,
    "maxPower" DOUBLE PRECISION,
    "energyImport" DOUBLE PRECISION,
    "energyExport" DOUBLE PRECISION,

    CONSTRAINT "HourlyDeviceStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyDeviceStats" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "avgVoltage" DOUBLE PRECISION,
    "avgCurrent" DOUBLE PRECISION,
    "avgPower" DOUBLE PRECISION,
    "energyImport" DOUBLE PRECISION,
    "energyExport" DOUBLE PRECISION,

    CONSTRAINT "DailyDeviceStats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Device_last_seen_idx" ON "Device"("last_seen");

-- CreateIndex
CREATE INDEX "Telemetry_deviceId_timestamp_idx" ON "Telemetry"("deviceId", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "Alert_deviceId_idx" ON "Alert"("deviceId");

-- CreateIndex
CREATE INDEX "HourlyDeviceStats_timestamp_idx" ON "HourlyDeviceStats"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "HourlyDeviceStats_deviceId_timestamp_key" ON "HourlyDeviceStats"("deviceId", "timestamp");

-- CreateIndex
CREATE INDEX "DailyDeviceStats_timestamp_idx" ON "DailyDeviceStats"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "DailyDeviceStats_deviceId_timestamp_key" ON "DailyDeviceStats"("deviceId", "timestamp");

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Telemetry" ADD CONSTRAINT "Telemetry_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HourlyDeviceStats" ADD CONSTRAINT "HourlyDeviceStats_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyDeviceStats" ADD CONSTRAINT "DailyDeviceStats_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
