import { create } from "zustand";

export type PaletteIntent =
  | { kind: "create-connection"; workspaceId?: string }
  | { kind: "create-team" }
  | { kind: "create-bucket"; connectionId: string }
  | {
      kind: "create-folder";
      connectionId: string;
      bucket: string;
      path: string;
    }
  | {
      kind: "open-preview";
      connectionId: string;
      bucket: string;
      key: string;
    };

interface PaletteIntentState {
  open: boolean;
  openPalette: () => void;
  closePalette: () => void;
  togglePalette: () => void;
  intent: PaletteIntent | null;
  requestIntent: (intent: PaletteIntent) => void;
  consumeIntent: () => PaletteIntent | null;
}

export const usePaletteIntentStore = create<PaletteIntentState>((set, get) => ({
  open: false,
  openPalette: () => set({ open: true }),
  closePalette: () => set({ open: false }),
  togglePalette: () => set((s) => ({ open: !s.open })),
  intent: null,
  requestIntent: (intent) => set({ intent }),
  consumeIntent: () => {
    const current = get().intent;
    if (current) set({ intent: null });
    return current;
  },
}));
