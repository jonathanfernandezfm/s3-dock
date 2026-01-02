import prisma from "./prisma";
import type { Connection } from "@/generated/prisma/client";

export type ConnectionInput = {
  name?: string | null;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
};

export type ConnectionUpdate = Partial<ConnectionInput>;

/**
 * Get all connections for a user
 */
export async function getConnectionsByUserId(
  userId: string
): Promise<Connection[]> {
  return prisma.connection.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Get a connection by ID, ensuring it belongs to the user
 */
export async function getConnectionById(
  id: string,
  userId: string
): Promise<Connection | null> {
  return prisma.connection.findFirst({
    where: { id, userId },
  });
}

/**
 * Create a new connection for a user
 */
export async function createConnection(
  userId: string,
  data: ConnectionInput
): Promise<Connection> {
  return prisma.connection.create({
    data: {
      userId,
      name: data.name,
      endpoint: data.endpoint,
      region: data.region,
      accessKeyId: data.accessKeyId,
      secretAccessKey: data.secretAccessKey,
      forcePathStyle: data.forcePathStyle ?? true,
    },
  });
}

/**
 * Update a connection, ensuring it belongs to the user
 */
export async function updateConnection(
  id: string,
  userId: string,
  data: ConnectionUpdate
): Promise<Connection | null> {
  const connection = await prisma.connection.findFirst({
    where: { id, userId },
  });

  if (!connection) {
    return null;
  }

  return prisma.connection.update({
    where: { id },
    data,
  });
}

/**
 * Delete a connection, ensuring it belongs to the user
 */
export async function deleteConnection(
  id: string,
  userId: string
): Promise<Connection | null> {
  const connection = await prisma.connection.findFirst({
    where: { id, userId },
  });

  if (!connection) {
    return null;
  }

  return prisma.connection.delete({
    where: { id },
  });
}
