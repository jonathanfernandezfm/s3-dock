"use client";

import { useTabStore } from "@/lib/stores/tab-store";
import { BucketList } from "@/components/buckets/bucket-list";
import { FileBrowser } from "@/components/browser/file-browser";

export function TabContent() {
  const { tabs, activeTabId, updateTabPath, updateTabBucket, resetTabToBuckets } = useTabStore();
  const activeTab = tabs.find((t) => t.id === activeTabId);

  if (!activeTab) {
    return null;
  }

  const handleOpenBucket = (connectionId: string, connectionName: string, bucketName: string) => {
    updateTabBucket(activeTab.id, connectionId, connectionName, bucketName);
  };

  const handleGoHome = () => {
    resetTabToBuckets(activeTab.id);
  };

  if (activeTab.type === "buckets") {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Buckets</h1>
        <BucketList onOpenBucket={handleOpenBucket} />
      </div>
    );
  }

  if (activeTab.type === "browser" && activeTab.connectionId && activeTab.bucket) {
    const pathArray = activeTab.path
      ? activeTab.path.split("/").filter(Boolean)
      : [];

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">File Browser</h1>
          {activeTab.connectionName && (
            <span className="text-sm text-muted-foreground">
              ({activeTab.connectionName})
            </span>
          )}
        </div>
        <FileBrowser
          connectionId={activeTab.connectionId}
          bucket={activeTab.bucket}
          path={pathArray}
          onNavigate={(newPath) => updateTabPath(activeTab.id, newPath)}
          onGoHome={handleGoHome}
        />
      </div>
    );
  }

  return null;
}
