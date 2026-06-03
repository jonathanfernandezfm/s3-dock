import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface RecentLocation {
  connectionId: string;
  connectionName: string;
  bucket: string;
  path: string;
  visitedAt: number;
}

interface RecentLocationsState {
  recents: RecentLocation[];
  pushRecent: (entry: Omit<RecentLocation, "visitedAt">) => void;
  clearRecents: () => void;
}

const MAX_RECENTS = 10;

export const useRecentLocationsStore = create<RecentLocationsState>()(
  persist(
    (set) => ({
      recents: [],
      pushRecent: (entry) =>
        set((state) => {
          const filtered = state.recents.filter(
            (r) =>
              !(
                r.connectionId === entry.connectionId &&
                r.bucket === entry.bucket &&
                r.path === entry.path
              )
          );
          const next = [{ ...entry, visitedAt: Date.now() }, ...filtered].slice(
            0,
            MAX_RECENTS
          );
          return { recents: next };
        }),
      clearRecents: () => set({ recents: [] }),
    }),
    { name: "s3-recent-locations" }
  )
);
