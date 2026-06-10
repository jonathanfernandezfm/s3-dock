import { Suspense } from "react";
import { ConnectionDetailTabs } from "@/components/connections/connection-detail-tabs";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ConnectionDetailPage({ params }: PageProps) {
  const { id } = await params;

  return (
    <Suspense fallback={null}>
      <ConnectionDetailTabs connectionId={id} />
    </Suspense>
  );
}
