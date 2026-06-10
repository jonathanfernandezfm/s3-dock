import { BrowserRedirect } from "@/components/tabs/browser-redirect";

interface BrowserPageProps {
  params: Promise<{
    connectionId: string;
    bucket: string;
    path?: string[];
  }>;
}

export default async function BrowserPage({ params }: BrowserPageProps) {
  const { connectionId, bucket, path } = await params;

  return <BrowserRedirect connectionId={connectionId} bucket={bucket} path={path} />;
}
