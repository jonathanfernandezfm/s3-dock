-- CreateTable
CREATE TABLE "bookmarks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "prefix" TEXT,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookmarks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bookmarks_userId_connectionId_idx" ON "bookmarks"("userId", "connectionId");

-- CreateIndex
CREATE INDEX "bookmarks_userId_connectionId_bucket_idx" ON "bookmarks"("userId", "connectionId", "bucket");

-- CreateIndex
CREATE UNIQUE INDEX "bookmarks_userId_connectionId_bucket_prefix_key" ON "bookmarks"("userId", "connectionId", "bucket", "prefix");

-- AddForeignKey
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
