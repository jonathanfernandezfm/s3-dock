import { redirect } from "next/navigation";

export default async function BucketHealthPage({
  params,
}: {
  params: Promise<{ connectionId: string; bucket: string }>;
}) {
  const { connectionId, bucket } = await params;
  redirect(`/app/buckets/${connectionId}/${encodeURIComponent(bucket)}?tab=permissions`);
}
