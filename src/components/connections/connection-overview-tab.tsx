"use client";

import { ConnectionIdentityCard } from "./connection-identity-card";
import { ConnectionPermissionsSummaryCard } from "./connection-permissions-summary-card";

interface ConnectionOverviewTabProps {
  connectionId: string;
}

export function ConnectionOverviewTab({
  connectionId,
}: ConnectionOverviewTabProps) {
  return (
    <div className="space-y-4">
      <ConnectionIdentityCard connectionId={connectionId} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ConnectionPermissionsSummaryCard connectionId={connectionId} />
      </div>
    </div>
  );
}
