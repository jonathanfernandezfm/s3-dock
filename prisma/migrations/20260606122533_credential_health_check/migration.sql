-- CreateTable
CREATE TABLE "connection_health_checks" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "connectivity" TEXT NOT NULL,

    CONSTRAINT "connection_health_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connection_permission_checks" (
    "id" TEXT NOT NULL,
    "healthCheckId" TEXT NOT NULL,
    "probeKey" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "errorCode" TEXT,
    "durationMs" INTEGER NOT NULL,

    CONSTRAINT "connection_permission_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bucket_health_checks" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "connectivity" TEXT NOT NULL,

    CONSTRAINT "bucket_health_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bucket_permission_checks" (
    "id" TEXT NOT NULL,
    "healthCheckId" TEXT NOT NULL,
    "probeKey" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "errorCode" TEXT,
    "durationMs" INTEGER NOT NULL,

    CONSTRAINT "bucket_permission_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "connection_health_checks_connectionId_key" ON "connection_health_checks"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "connection_permission_checks_healthCheckId_probeKey_key" ON "connection_permission_checks"("healthCheckId", "probeKey");

-- CreateIndex
CREATE INDEX "bucket_health_checks_connectionId_idx" ON "bucket_health_checks"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "bucket_health_checks_connectionId_bucket_key" ON "bucket_health_checks"("connectionId", "bucket");

-- CreateIndex
CREATE UNIQUE INDEX "bucket_permission_checks_healthCheckId_probeKey_key" ON "bucket_permission_checks"("healthCheckId", "probeKey");

-- AddForeignKey
ALTER TABLE "connection_health_checks" ADD CONSTRAINT "connection_health_checks_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connection_permission_checks" ADD CONSTRAINT "connection_permission_checks_healthCheckId_fkey" FOREIGN KEY ("healthCheckId") REFERENCES "connection_health_checks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bucket_health_checks" ADD CONSTRAINT "bucket_health_checks_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bucket_permission_checks" ADD CONSTRAINT "bucket_permission_checks_healthCheckId_fkey" FOREIGN KEY ("healthCheckId") REFERENCES "bucket_health_checks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
