"use client";

import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConnections } from "@/lib/queries/connections";
import { useAllBuckets } from "@/lib/queries/buckets";
import { useTeams } from "@/lib/queries/teams";
import { queryKeys } from "@/lib/queries/keys";
import { useLayoutStore } from "@/lib/stores/layout-store";
import { useRecentLocationsStore, type RecentLocation } from "@/lib/stores/recent-locations-store";
import type { S3Object } from "@/types";

export interface ConnectionItem {
  connectionId: string;
  name: string;
  endpoint: string;
}

export interface BucketItem {
  connectionId: string;
  connectionName: string;
  bucket: string;
}

export interface FolderItem {
  connectionId: string;
  bucket: string;
  key: string;
  label: string;
  parentPath: string;
}

export interface TeamItem {
  teamId: string;
  name: string;
  slug?: string | null;
}

export interface PaletteItems {
  recents: RecentLocation[];
  connections: ConnectionItem[];
  buckets: BucketItem[];
  folders: FolderItem[];
  teams: TeamItem[];
  isFoldersTruncated: boolean;
  activeBucket: { connectionId: string; bucket: string; path: string } | null;
}

export function usePaletteItems(): PaletteItems {
  const queryClient = useQueryClient();

  const { data: connectionsData = [] } = useConnections();
  const { groups } = useAllBuckets();
  const { data: teamsData = [] } = useTeams();
  const recents = useRecentLocationsStore((state) => state.recents);
  const { panes, focusedPaneId } = useLayoutStore();

  return useMemo(() => {
    const connectionIds = new Set(connectionsData.map((c) => c.id));

    const filteredRecents = recents.filter((r) => connectionIds.has(r.connectionId));

    const connections: ConnectionItem[] = connectionsData.map((c) => ({
      connectionId: c.id,
      name: c.name || c.endpoint,
      endpoint: c.endpoint,
    }));

    const buckets: BucketItem[] = groups.flatMap((g) =>
      g.buckets.map((b) => ({
        connectionId: g.connection.id,
        connectionName: g.connection.name || g.connection.endpoint,
        bucket: b.name,
      }))
    );

    const teams: TeamItem[] = teamsData.map((t) => ({
      teamId: t.id,
      name: t.name,
      slug: t.slug,
    }));

    const paneId = focusedPaneId ?? Object.keys(panes)[0] ?? null;
    const pane = paneId ? panes[paneId] : null;
    const activeTab = pane?.tabs.find((t) => t.id === pane.activeTabId) ?? null;

    let folders: FolderItem[] = [];
    let isFoldersTruncated = false;
    let activeBucket: PaletteItems["activeBucket"] = null;

    if (
      activeTab &&
      activeTab.type === "browser" &&
      activeTab.connectionId &&
      activeTab.bucket
    ) {
      const pathArray = activeTab.path
        ? activeTab.path.split("/").filter(Boolean)
        : [];
      const currentPath = pathArray.length > 0 ? pathArray.join("/") + "/" : "";

      activeBucket = {
        connectionId: activeTab.connectionId,
        bucket: activeTab.bucket,
        path: currentPath,
      };

      const cached = queryClient.getQueryData<{
        objects: S3Object[];
        isTruncated: boolean;
      }>(queryKeys.objects.list(activeTab.connectionId, activeTab.bucket, currentPath));

      if (cached) {
        folders = cached.objects
          .filter((obj) => obj.isFolder)
          .map((obj) => ({
            connectionId: activeTab.connectionId!,
            bucket: activeTab.bucket!,
            key: obj.key,
            label: obj.key.slice(currentPath.length).replace(/\/$/, ""),
            parentPath: currentPath,
          }));
        isFoldersTruncated = cached.isTruncated;
      }
    }

    return {
      recents: filteredRecents,
      connections,
      buckets,
      folders,
      teams,
      isFoldersTruncated,
      activeBucket,
    };
  }, [connectionsData, groups, teamsData, recents, panes, focusedPaneId, queryClient]);
}
