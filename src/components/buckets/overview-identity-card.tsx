"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Database } from "lucide-react";
import { formatDate } from "@/lib/utils";
import type { ConnectionResponse } from "@/lib/queries/connections";
import type { S3Bucket } from "@/types";

interface OverviewIdentityCardProps {
  bucket: string;
  connection: ConnectionResponse | undefined;
  bucketMeta: S3Bucket | undefined;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 py-1.5">
      <dt className="text-xs uppercase tracking-wider text-muted-foreground w-32 shrink-0">
        {label}
      </dt>
      <dd className="text-sm min-w-0 flex-1 truncate">{value}</dd>
    </div>
  );
}

export function OverviewIdentityCard({
  bucket,
  connection,
  bucketMeta,
}: OverviewIdentityCardProps) {
  const connectionLabel =
    connection?.name || connection?.endpoint || "Unknown connection";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5 text-muted-foreground" />
          <span className="font-mono truncate">{bucket}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl>
          <Row
            label="Connection"
            value={
              connection ? (
                <Link
                  href={`/connections#connection-${connection.id}`}
                  className="hover:underline"
                >
                  {connectionLabel}
                </Link>
              ) : (
                <span className="text-muted-foreground">—</span>
              )
            }
          />
          <Row
            label="Region"
            value={
              connection?.region ? (
                connection.region
              ) : (
                <span className="text-muted-foreground">Unknown</span>
              )
            }
          />
          <Row
            label="Endpoint"
            value={
              connection?.endpoint ? (
                <span className="font-mono text-xs">{connection.endpoint}</span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )
            }
          />
          <Row
            label="Created"
            value={
              bucketMeta?.creationDate ? (
                formatDate(bucketMeta.creationDate)
              ) : (
                <span className="text-muted-foreground">Unknown</span>
              )
            }
          />
        </dl>
      </CardContent>
    </Card>
  );
}
