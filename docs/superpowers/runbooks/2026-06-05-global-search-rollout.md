# Global Search — Rollout Runbook

## Required env vars

Add to the deploy environment (and local `.env.local`):

- `SEARCH_INDEX_ENABLED=true` — master kill switch. Off means all new code is dormant.
- `INTERNAL_API_TOKEN=<64-char hex>` — generate with `openssl rand -hex 32`. Used to auth `/api/internal/*` routes from the cron service and from self-refire calls.

## Cron configuration

Configure your scheduler (Vercel Cron / external uptime monitor / pg_cron) to hit:

```
POST /api/internal/reconcile
Header: x-internal-token: <INTERNAL_API_TOKEN>
Cadence: every 5 minutes
```

This is the sole external trigger. It rescues stuck jobs and queues fresh reconciles per connection (throttled to 60-min per connection).

## Rollout sequence

1. Deploy with `SEARCH_INDEX_ENABLED=false`. Migrations apply; tables exist but no code reads/writes them.
2. Verify the deploy is healthy (existing routes unchanged in behavior).
3. Flip `SEARCH_INDEX_ENABLED=true`. Write-through helpers start populating the index for new app mutations.
4. Configure the cron to hit `/api/internal/reconcile`. Reconcile starts picking up the backfilled INITIAL jobs gradually.
5. Monitor:
   - `SELECT status, COUNT(*) FROM crawl_jobs GROUP BY status;`
   - Logs for `[search-index]` and `[search]` lines.
6. Test the palette manually with a PRO account.

## Team workspace backfill (manual)

The migration backfills jobs only for personal-workspace connections. After deploy, run for team workspaces:

```sql
INSERT INTO "crawl_jobs" (id, "connectionId", kind, status, "bucketsRemaining", "objectsIndexed", "createdAt")
SELECT gen_random_uuid()::text, c.id, 'INITIAL', 'PENDING', '{}'::text[], 0, NOW()
FROM connections c
JOIN workspaces w ON w.id = c."workspaceId"
JOIN teams t ON t.id = w."teamId"
JOIN team_members tm ON tm."teamId" = t.id
JOIN users u ON u.id = tm."userId"
LEFT JOIN subscriptions s ON s."userId" = u.id
WHERE w.type = 'TEAM'
  AND COALESCE(s.tier::text, 'FREE') IN ('PRO', 'ENTERPRISE')
  AND NOT EXISTS (
    SELECT 1 FROM "crawl_jobs" j WHERE j."connectionId" = c.id AND j.kind = 'INITIAL'
  )
GROUP BY c.id;
```

## Rollback

Flip `SEARCH_INDEX_ENABLED=false`. The palette behaves exactly as before; write-through no-ops; the search endpoint returns 404. Existing data remains in `object_index` and `crawl_jobs` — harmless and ready for re-enable.
