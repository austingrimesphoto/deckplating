# Large-workspace reads

Deckplating does not assume that PostgREST will return an entire table in one response. The managed API uses 500-row keyset pages, ordered by an immutable primary key, for coverage inputs, rosters, mapping data, operator workspace lists, and every table in the operator safe export. A page is accepted only when cursors are strictly increasing and unique; malformed page boundaries fail the request instead of returning a partial result.

The safe export remains a single downloadable JSON response at the public API boundary, but its database reads are paged to completion. The export includes `pagination.complete: true` only after every page succeeds. It continues to exclude PIN/passphrase/setup-code hashes, setup-code plaintext, device rows and device identifiers, service credentials, and detailed sensitive records.

## Read inventory

| API surface | Potentially large source | Strategy |
| --- | --- | --- |
| `/team-members`, `/bootstrap` | active roster | keyset pages by member ID |
| `/dashboard`, `/coverage-detail`, `/nearby-locations` | areas, active units, latest visits | keyset pages by area/unit ID and paged latest-visit RPC |
| `/leaderboard` | period check-ins and first visits | SQL/RPC aggregation; no raw history result set |
| `/reports/indicators` | batches and check-ins | SQL/RPC aggregation, then keyset pages by grouped location key |
| `/admin/locations` | mapping and roster tables | keyset pages by primary key |
| `/admin/checkins` | activity records | bounded page/scan with explicit metadata |
| `/operator/organizations` | workspaces and setup-code summaries | keyset pages by primary key |
| `/operator/workspace-requests` | request queue | bounded page with exact count |
| `/operator/audit-events` | audit records | bounded page/scan with explicit metadata |
| `/operator/organizations/:id/export` | every safe-export table | keyset pages to completion before response |

Single-record credential, device, mutation-validation, and onboarding-summary reads are constrained by unique keys, request limits, `head: true` counts, or an explicit one-row limit and cannot cross the service row cap.

## Aggregates

Raw check-in histories are not loaded to calculate totals:

- `get_leaderboard_period` performs member, distinct-unit, first-visit, active-day, recovery, and coverage-sweep aggregation in PostgreSQL and returns one JSON value.
- `get_indicator_report_page` groups visits by resolved location in PostgreSQL and keyset-pages the grouped rows.
- `get_latest_active_checkins_page` returns one latest active visit per unit and keyset-pages by `unit_id`.

All three functions require an organization ID, apply that predicate inside the function, revoke execution from `public`, `anon`, and `authenticated`, and grant execution only to `service_role`.

## Intentional bounds

- Coverage detail returns at most 100 recent check-ins and reports `page.hasMore` and `page.truncated`.
- Operator audit search scans at most 1,000 newest events and reports `page.scanLimit` and `page.truncated`.
- Admin activity searches that need mapped area or text filtering scan at most 2,000 newest matching base records and report `page.scanLimit` and `page.truncated`.
- Workspace request and ordinary admin activity pages are capped at 250 returned rows and include exact or best-available totals plus `hasMore`.

These bounds protect function memory and response size. Clients must present the truncation state rather than treating a bounded scan as an exhaustive result.

## Query plans and operations

Expected plans begin with organization-scoped index scans:

- Latest coverage uses `idx_checkins_org_unit_active_latest`, followed by `DISTINCT ON (unit_id)` and a 500-row limit.
- Period aggregates use `idx_checkins_org_active_time_unit_member` or `idx_checkins_org_active_time` for the organization/time range, then hash/group aggregates over only that workspace.
- Indicator aggregation joins batches through the organization-scoped batch/check-in indexes, groups once per batch, then once per location.
- Ordinary table pagination uses primary-key range scans with the organization predicate.

After materially changing check-in volume or PostgreSQL statistics, run `ANALYZE` and inspect representative production-shaped calls with `EXPLAIN (ANALYZE, BUFFERS)` in a safe non-production copy. Investigate plans that start with an unqualified sequential scan of `checkins`, spill aggregate sorts to disk, or lose the organization predicate. The database behavior suite seeds 1,205 records and verifies complete, duplicate-free coverage pages and complete leaderboard/indicator totals.
