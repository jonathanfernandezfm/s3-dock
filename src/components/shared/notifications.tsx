"use client";

import {
  useNotificationStore,
  Notification,
  NotificationType,
} from "@/lib/stores/notification-store";
import {
  X,
  Check,
  AlertCircle,
  Loader2,
  Copy,
  Move,
  Trash2,
  Upload,
  FolderPlus,
  Download,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";

function getIcon(type: NotificationType, status: Notification["status"]) {
  if (status === "in-progress") {
    return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
  }
  if (status === "error") {
    return <AlertCircle className="h-4 w-4 text-destructive" />;
  }

  // Completed status - show type-specific icon
  const iconMap: Record<NotificationType, React.ReactNode> = {
    copy: <Copy className="h-4 w-4 text-green-500" />,
    move: <Move className="h-4 w-4 text-green-500" />,
    delete: <Trash2 className="h-4 w-4 text-green-500" />,
    upload: <Upload className="h-4 w-4 text-green-500" />,
    folder: <FolderPlus className="h-4 w-4 text-green-500" />,
    download: <Download className="h-4 w-4 text-green-500" />,
    info: <Check className="h-4 w-4 text-green-500" />,
    error: <AlertCircle className="h-4 w-4 text-destructive" />,
  };

  return iconMap[type] || <Check className="h-4 w-4 text-green-500" />;
}

function NotificationItem({ notification }: { notification: Notification }) {
  const { removeNotification } = useNotificationStore();

  return (
    <div className="flex items-start gap-3 p-3 bg-card border rounded-lg shadow-sm">
      <div className="mt-0.5">{getIcon(notification.type, notification.status)}</div>

      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{notification.title}</div>

        {notification.description && (
          <div className="text-xs text-muted-foreground mt-0.5 truncate">
            {notification.description}
          </div>
        )}

        {notification.status === "in-progress" && (
          <div className="mt-2">
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-300 animate-pulse"
                style={{ width: "100%" }}
              />
            </div>
          </div>
        )}

        {notification.status === "error" && notification.error && (
          <div
            className="text-sm text-destructive mt-1.5 break-words"
            title={notification.error}
          >
            {notification.error}
          </div>
        )}
      </div>

      {notification.status !== "in-progress" && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={() => removeNotification(notification.id)}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

export function Notifications() {
  const notifications = useNotificationStore((state) => state.notifications);
  const clearCompleted = useNotificationStore((state) => state.clearCompleted);

  if (notifications.length === 0) return null;

  const hasCompleted = notifications.some((n) => n.status !== "in-progress");

  return (
    <div className="fixed bottom-4 right-4 z-50 w-96 space-y-2">
      {hasCompleted && (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7"
            onClick={clearCompleted}
          >
            Clear completed
          </Button>
        </div>
      )}

      <div className="space-y-2 max-h-80 overflow-y-auto">
        {notifications.map((notification) => (
          <NotificationItem key={notification.id} notification={notification} />
        ))}
      </div>
    </div>
  );
}
