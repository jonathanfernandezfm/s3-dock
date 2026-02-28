import { create } from "zustand";

export interface TransferItem {
  id: string;
  sourceKey: string;
  targetKey: string;
  operation: "copy" | "move";
  status: "pending" | "in-progress" | "completed" | "error";
  error?: string;
}

export interface TransferBatch {
  id: string;
  operation: "copy" | "move";
  sourceBucket: string;
  targetBucket: string;
  items: TransferItem[];
  status: "in-progress" | "completed" | "error";
  startedAt: Date;
  completedAt?: Date;
  error?: string;
}

interface TransferState {
  batches: TransferBatch[];
  addBatch: (batch: Omit<TransferBatch, "id" | "startedAt" | "status">) => string;
  updateBatchStatus: (
    batchId: string,
    status: TransferBatch["status"],
    completedAt?: Date,
    error?: string
  ) => void;
  updateItemStatus: (
    batchId: string,
    itemId: string,
    status: TransferItem["status"],
    error?: string
  ) => void;
  removeBatch: (batchId: string) => void;
  clearCompletedBatches: () => void;
}

export const useTransferStore = create<TransferState>((set) => ({
  batches: [],

  addBatch: (batch) => {
    const id = `transfer-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    set((state) => ({
      batches: [
        ...state.batches,
        {
          ...batch,
          id,
          status: "in-progress",
          startedAt: new Date(),
        },
      ],
    }));
    return id;
  },

  updateBatchStatus: (batchId, status, completedAt, error) => {
    set((state) => ({
      batches: state.batches.map((batch) =>
        batch.id === batchId
          ? { ...batch, status, completedAt, error }
          : batch
      ),
    }));
  },

  updateItemStatus: (batchId, itemId, status, error) => {
    set((state) => ({
      batches: state.batches.map((batch) =>
        batch.id === batchId
          ? {
              ...batch,
              items: batch.items.map((item) =>
                item.id === itemId
                  ? { ...item, status, error }
                  : item
              ),
            }
          : batch
      ),
    }));
  },

  removeBatch: (batchId) => {
    set((state) => ({
      batches: state.batches.filter((batch) => batch.id !== batchId),
    }));
  },

  clearCompletedBatches: () => {
    set((state) => ({
      batches: state.batches.filter((batch) => batch.status === "in-progress"),
    }));
  },
}));
