import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SidebarState {
  collapsedWorkspaces: Record<string, boolean>;
  toggleWorkspace: (workspaceId: string) => void;
  isCollapsed: (workspaceId: string) => boolean;
}

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set, get) => ({
      collapsedWorkspaces: {},
      toggleWorkspace: (workspaceId: string) =>
        set((state) => ({
          collapsedWorkspaces: {
            ...state.collapsedWorkspaces,
            [workspaceId]: !state.collapsedWorkspaces[workspaceId],
          },
        })),
      isCollapsed: (workspaceId: string) =>
        !!get().collapsedWorkspaces[workspaceId],
    }),
    {
      name: "s3-sidebar",
    }
  )
);
