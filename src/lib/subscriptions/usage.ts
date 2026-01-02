import prisma from "@/lib/db/prisma";

function getMonthStart(): Date {
  const date = new Date();
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date;
}

/**
 * Record upload usage
 */
export async function recordUpload(
  userId: string,
  bytes: number
): Promise<void> {
  const month = getMonthStart();

  await prisma.usageRecord.upsert({
    where: {
      userId_month: { userId, month },
    },
    create: {
      userId,
      month,
      uploadBytes: BigInt(bytes),
      operationCount: 1,
    },
    update: {
      uploadBytes: { increment: BigInt(bytes) },
      operationCount: { increment: 1 },
    },
  });
}

/**
 * Record download usage
 */
export async function recordDownload(
  userId: string,
  bytes: number
): Promise<void> {
  const month = getMonthStart();

  await prisma.usageRecord.upsert({
    where: {
      userId_month: { userId, month },
    },
    create: {
      userId,
      month,
      downloadBytes: BigInt(bytes),
      operationCount: 1,
    },
    update: {
      downloadBytes: { increment: BigInt(bytes) },
      operationCount: { increment: 1 },
    },
  });
}

/**
 * Increment operation count
 */
export async function recordOperation(userId: string): Promise<void> {
  const month = getMonthStart();

  await prisma.usageRecord.upsert({
    where: {
      userId_month: { userId, month },
    },
    create: {
      userId,
      month,
      operationCount: 1,
    },
    update: {
      operationCount: { increment: 1 },
    },
  });
}

/**
 * Get current month usage
 */
export async function getMonthlyUsage(userId: string) {
  const month = getMonthStart();

  const usage = await prisma.usageRecord.findUnique({
    where: {
      userId_month: { userId, month },
    },
  });

  return {
    uploadBytes: Number(usage?.uploadBytes ?? BigInt(0)),
    downloadBytes: Number(usage?.downloadBytes ?? BigInt(0)),
    operationCount: usage?.operationCount ?? 0,
  };
}
