"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowRight, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { useIncompleteUploads } from "@/lib/queries/multipart-uploads";
import { CapabilityGate } from "@/components/health/capability-gate";

interface OverviewIncompleteUploadsCardProps {
  connectionId: string;
  bucket: string;
}

export function OverviewIncompleteUploadsCard({
  connectionId,
  bucket,
}: OverviewIncompleteUploadsCardProps) {
  const { data: uploads, isLoading, isError } = useIncompleteUploads(
    connectionId,
    bucket,
  );
  const count = uploads?.length ?? 0;

  const multipartHref = `/app/buckets/${connectionId}/${encodeURIComponent(
    bucket,
  )}?tab=multipart`;

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RefreshCw className="h-5 w-5 text-muted-foreground" />
          Incomplete uploads
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col flex-1 space-y-3">
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking for incomplete uploads…
          </div>
        )}
        {isError && (
          <p className="text-sm text-muted-foreground">
            Failed to load incomplete uploads.
          </p>
        )}
        {!isLoading && !isError && count === 0 && (
          <div className="flex flex-col flex-1 items-center justify-center text-center">
            <CheckCircle2 className="h-10 w-10 text-green-500 mb-3" />
            <p className="text-sm font-semibold mb-1">All clear</p>
            <p className="text-sm text-muted-foreground mb-3">
              No incomplete uploads found.
            </p>
            <Link
              href={multipartHref}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              View uploads
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        )}
        {!isLoading && !isError && count > 0 && (
          <>
            <p className="text-sm">
              <span className="font-semibold">{count}</span> incomplete upload
              {count !== 1 ? "s" : ""}.
            </p>
            <CapabilityGate connectionId={connectionId} bucket={bucket} capability="view-multipart">
              <span className="inline-flex">
                <Link
                  href={multipartHref}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  Review uploads
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </span>
            </CapabilityGate>
          </>
        )}
      </CardContent>
    </Card>
  );
}
