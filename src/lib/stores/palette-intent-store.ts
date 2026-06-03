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
    };

interface PaletteIntentState {
  intent: PaletteIntent | null;
  requestIntent: (intent: PaletteIntent) => void;
  consumeIntent: () => PaletteIntent | null;
}

export const usePaletteIntentStore = create<PaletteIntentState>((set, get) => ({
  intent: null,
  requestIntent: (intent) => set({ intent }),
  consumeIntent: () => {
    const current = get().intent;
    if (current) set({ intent: null });
    return current;
  },
}));
