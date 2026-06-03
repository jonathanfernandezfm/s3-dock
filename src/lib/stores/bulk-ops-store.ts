import { create } from "zustand";

export type BulkOpKind = "rename" | "tag" | "delete";
export type BulkOpDialog = "rename" | "tag" | "delete" | null;

export interface BulkOpFailure {
  key: string;
  error: string;
}

export interface BulkOpProgress {
  kind: BulkOpKind;
  paneId: string;
  total: number;
  completed: number;
  currentKey: string | null;
  failures: BulkOpFailure[];
  cancelRequested: boolean;
  finishedAt: Date | null;
}

interface BulkOpsState {
  dialog: BulkOpDialog;
  dialogPaneId: string | null;
  progress: BulkOpProgress | null;

  openDialog: (kind: BulkOpDialog, paneId: string) => void;
  closeDialog: () => void;

  startProgress: (kind: BulkOpKind, paneId: string, total: number) => void;
  setCurrentKey: (key: string | null) => void;
  recordSuccess: () => void;
  recordFailure: (failure: BulkOpFailure) => void;
  requestCancel: () => void;
  finishProgress: () => void;
  dismissProgress: () => void;
}

export const useBulkOpsStore = create<BulkOpsState>((set) => ({
  dialog: null,
  dialogPaneId: null,
  progress: null,

  openDialog: (kind, paneId) => set({ dialog: kind, dialogPaneId: paneId }),
  closeDialog: () => set({ dialog: null, dialogPaneId: null }),

  startProgress: (kind, paneId, total) =>
    set({
      dialog: null,
      dialogPaneId: null,
      progress: {
        kind,
        paneId,
        total,
        completed: 0,
        currentKey: null,
        failures: [],
        cancelRequested: false,
        finishedAt: null,
      },
    }),
  setCurrentKey: (key) =>
    set((state) =>
      state.progress ? { progress: { ...state.progress, currentKey: key } } : state
    ),
  recordSuccess: () =>
    set((state) =>
      state.progress
        ? { progress: { ...state.progress, completed: state.progress.completed + 1 } }
        : state
    ),
  recordFailure: (failure) =>
    set((state) =>
      state.progress
        ? {
            progress: {
              ...state.progress,
              completed: state.progress.completed + 1,
              failures: [...state.progress.failures, failure],
            },
          }
        : state
    ),
  requestCancel: () =>
    set((state) =>
      state.progress ? { progress: { ...state.progress, cancelRequested: true } } : state
    ),
  finishProgress: () =>
    set((state) =>
      state.progress
        ? { progress: { ...state.progress, currentKey: null, finishedAt: new Date() } }
        : state
    ),
  dismissProgress: () => set({ progress: null }),
}));
