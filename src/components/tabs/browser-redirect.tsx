"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTabStore } from "@/lib/stores/tab-store";
import { useConnections } from "@/lib/queries/connections";
import { Loader2 } from "lucide-react";

interface BrowserRedirectProps {
  connectionId: string;
  bucket: string;
  path?: string[];
}

export function BrowserRedirect({ connectionId, bucket, path = [] }: BrowserRedirectProps) {
  const router = useRouter();
  const { addTab, tabs, setActiveTab } = useTabStore();
  const { data: connections } = useConnections();

  useEffect(() => {
    const pathString = path.length > 0 ? path.join("/") + "/" : "";
    const connection = connections?.find((c) => c.id === connectionId);
    const connectionName = connection?.name || connection?.endpoint || "";

    // Check if a tab already exists for this bucket
    const existingTab = tabs.find(
      (t) =>
        t.type === "browser" &&
        t.connectionId === connectionId &&
        t.bucket === bucket
    );

    if (existingTab) {
      // Update the path of the existing tab and switch to it
      useTabStore.getState().updateTabPath(existingTab.id, pathString);
      setActiveTab(existingTab.id);
    } else {
      // Add a new tab
      addTab({
        type: "browser",
        connectionId,
        connectionName,
        bucket,
        path: pathString,
      });
    }

    // Redirect to buckets page where tabs are displayed
    router.replace("/buckets");
  }, [connectionId, bucket, path, connections, addTab, tabs, setActiveTab, router]);

  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}
