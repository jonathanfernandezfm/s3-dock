import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Tab {
  id: string;
  type: "buckets" | "browser";
  connectionId?: string;
  connectionName?: string;
  bucket?: string;
  path: string;
}

interface TabState {
  tabs: Tab[];
  activeTabId: string | null;
  addTab: (tab: Omit<Tab, "id">) => string;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTabPath: (id: string, path: string) => void;
  updateTabBucket: (id: string, connectionId: string, connectionName: string, bucket: string) => void;
  resetTabToBuckets: (id: string) => void;
}

function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

export const useTabStore = create<TabState>()(
  persist(
    (set, get) => ({
      tabs: [{ id: "default", type: "buckets", path: "" }],
      activeTabId: "default",

      addTab: (tab) => {
        const id = generateId();
        const newTab: Tab = { ...tab, id };
        set((state) => ({
          tabs: [...state.tabs, newTab],
          activeTabId: id,
        }));
        return id;
      },

      removeTab: (id) => {
        const { tabs, activeTabId } = get();
        if (tabs.length <= 1) return;

        const tabIndex = tabs.findIndex((t) => t.id === id);
        const newTabs = tabs.filter((t) => t.id !== id);

        let newActiveId = activeTabId;
        if (activeTabId === id) {
          // Switch to adjacent tab
          const newIndex = Math.min(tabIndex, newTabs.length - 1);
          newActiveId = newTabs[newIndex].id;
        }

        set({ tabs: newTabs, activeTabId: newActiveId });
      },

      setActiveTab: (id) => {
        set({ activeTabId: id });
      },

      updateTabPath: (id, path) => {
        set((state) => ({
          tabs: state.tabs.map((t) => (t.id === id ? { ...t, path } : t)),
        }));
      },

      updateTabBucket: (id, connectionId, connectionName, bucket) => {
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === id
              ? { ...t, type: "browser", connectionId, connectionName, bucket, path: "" }
              : t
          ),
        }));
      },

      resetTabToBuckets: (id) => {
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === id
              ? { id: t.id, type: "buckets", path: "" }
              : t
          ),
        }));
      },
    }),
    {
      name: "s3-tabs",
    }
  )
);
