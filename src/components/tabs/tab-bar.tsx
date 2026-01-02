"use client";

import { useTabStore, Tab } from "@/lib/stores/tab-store";
import { Button } from "@/components/ui/button";
import { X, Plus, FolderOpen, Database } from "lucide-react";
import { cn } from "@/lib/utils";

function TabItem({ tab, isActive }: { tab: Tab; isActive: boolean }) {
  const { setActiveTab, removeTab, tabs } = useTabStore();

  const getTabLabel = () => {
    if (tab.type === "buckets") {
      return "Buckets";
    }
    if (tab.bucket) {
      const pathDisplay = tab.path ? `/${tab.path.replace(/\/$/, "")}` : "";
      return `${tab.bucket}${pathDisplay}`;
    }
    return "Browser";
  };

  const getTabIcon = () => {
    if (tab.type === "buckets") {
      return <Database className="h-3.5 w-3.5" />;
    }
    return <FolderOpen className="h-3.5 w-3.5" />;
  };

  return (
    <div
      className={cn(
        "group relative flex items-center gap-2.5 px-4 py-2.5 cursor-pointer transition-all min-w-0 max-w-[350px] rounded-t-lg mx-0.5 mt-2",
        isActive
          ? "bg-background shadow-sm border border-b-0 border-border"
          : "bg-muted/40 hover:bg-muted/70"
      )}
      onClick={() => setActiveTab(tab.id)}
    >
      {isActive && (
        <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-full" />
      )}
      <span className="text-muted-foreground flex-shrink-0">{getTabIcon()}</span>
      <span className="text-sm truncate flex-1" title={getTabLabel()}>
        {getTabLabel()}
      </span>
      {tabs.length > 1 && (
        <button
          className={cn(
            "p-1 rounded-md hover:bg-accent transition-opacity flex-shrink-0",
            isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}
          onClick={(e) => {
            e.stopPropagation();
            removeTab(tab.id);
          }}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export function TabBar() {
  const { tabs, activeTabId, addTab } = useTabStore();

  const handleAddTab = () => {
    addTab({ type: "buckets", path: "" });
  };

  return (
    <div className="flex items-end border-b bg-muted/20 px-2">
      <div className="flex items-end overflow-x-auto">
        {tabs.map((tab) => (
          <TabItem key={tab.id} tab={tab} isActive={tab.id === activeTabId} />
        ))}
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 mt-2 mb-0.5 ml-1 rounded-lg"
          onClick={handleAddTab}
          title="New tab"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
