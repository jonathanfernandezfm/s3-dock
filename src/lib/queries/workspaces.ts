"use client";

import { useQuery } from "@tanstack/react-query";

export interface WorkspaceSummary {
  id: string;
  type: "PERSONAL" | "TEAM";
  name: string;
  role: "ADMIN" | "VIEWER";
}

export const workspaceKeys = {
  all: ["workspaces"] as const,
  list: () => [...workspaceKeys.all, "list"] as const,
};

async function fetchWorkspaces(): Promise<WorkspaceSummary[]> {
  const response = await fetch("/api/workspaces");

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to fetch workspaces");
  }

  return response.json();
}

export function useWorkspaces() {
  return useQuery({
    queryKey: workspaceKeys.list(),
    queryFn: fetchWorkspaces,
  });
}
