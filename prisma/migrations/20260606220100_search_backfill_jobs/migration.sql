-- Backfill: queue an INITIAL CrawlJob for every connection in a PRO/ENTERPRISE workspace.
-- These will be picked up by the next reconcile tick.
INSERT INTO "crawl_jobs" (id, "connectionId", kind, status, "bucketsRemaining", "objectsIndexed", "createdAt")
SELECT
  gen_random_uuid()::text,
  c.id,
  'INITIAL'::"CrawlJobKind",
  'PENDING'::"CrawlJobStatus",
  '{}'::text[],
  0,
  NOW()
FROM connections c
JOIN workspaces w ON w.id = c."workspaceId"
LEFT JOIN users u ON u.id = w."userId"
LEFT JOIN subscriptions s ON s."userId" = u.id
WHERE COALESCE(s.tier::text, 'FREE') IN ('PRO', 'ENTERPRISE')
  AND NOT EXISTS (
    SELECT 1 FROM "crawl_jobs" j
    WHERE j."connectionId" = c.id AND j.kind = 'INITIAL'
  );
