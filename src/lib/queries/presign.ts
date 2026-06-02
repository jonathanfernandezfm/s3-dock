import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "./keys";

export function usePresignedUrls(
  connectionId: string,
  bucket: string,
  keys: string[]
): Record<string, string> {
  const sortedKeys = [...keys].sort();

  const { data } = useQuery({
    queryKey: queryKeys.presign.batch(connectionId, bucket, sortedKeys),
    enabled: keys.length > 0,
    staleTime: 50 * 60 * 1000,
    queryFn: async () => {
      const response = await fetch("/api/objects/presign-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId, bucket, keys: sortedKeys }),
      });

      if (!response.ok) {
        throw new Error(
          `Failed to fetch presigned URLs: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json();
      return data.urls as Record<string, string>;
    },
  });

  return data ?? {};
}
