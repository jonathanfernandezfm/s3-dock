import { create } from "zustand";

export type NotificationType = "copy" | "move" | "delete" | "upload" | "folder" | "download" | "info" | "error";
export type NotificationStatus = "in-progress" | "completed" | "error";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  description?: string;
  status: NotificationStatus;
  error?: string;
  createdAt: Date;
  completedAt?: Date;
}

interface NotificationState {
  notifications: Notification[];
  addNotification: (notification: Omit<Notification, "id" | "createdAt">) => string;
  updateNotification: (
    id: string,
    updates: Partial<Pick<Notification, "status" | "error" | "completedAt" | "title" | "description">>
  ) => void;
  removeNotification: (id: string) => void;
  clearCompleted: () => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],

  addNotification: (notification) => {
    const id = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    set((state) => ({
      notifications: [
        {
          ...notification,
          id,
          createdAt: new Date(),
        },
        ...state.notifications,
      ],
    }));
    return id;
  },

  updateNotification: (id, updates) => {
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id ? { ...n, ...updates } : n
      ),
    }));
  },

  removeNotification: (id) => {
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    }));
  },

  clearCompleted: () => {
    set((state) => ({
      notifications: state.notifications.filter((n) => n.status === "in-progress"),
    }));
  },
}));

// Helper function to create notifications easily (similar to toast API)
export function notify(
  type: NotificationType,
  title: string,
  description?: string,
  status: NotificationStatus = "completed"
) {
  const id = useNotificationStore.getState().addNotification({
    type,
    title,
    description,
    status,
  });

  return {
    id,
    update: (updates: Partial<Pick<Notification, "status" | "error" | "completedAt" | "title" | "description">>) =>
      useNotificationStore.getState().updateNotification(id, updates),
    dismiss: () => useNotificationStore.getState().removeNotification(id),
  };
}
