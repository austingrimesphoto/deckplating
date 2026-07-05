# Deckplating AI Continuity Plan

## Current Milestone

Exact current stopping point: the repository is on `main` after commit `5ea9c5a` (`Add workspace-aware entry flow`). The user approved starting the next roadmap task, `Tenant-isolation hardening and test harness`, but then explicitly stopped feature work to preserve this plan. No tenant-isolation implementation has begun.

Completed steps:

- Standardized the product name as Deckplating across app/docs where recently touched.
- Added Safe Use guidance, check-in undo/corrections, Admin Activity Log, and active-record calculations that ignore voided check-ins.
- Added offline-first visit batches, optional generic visit indicators, Deckplate Brief, PWA app-shell caching, IndexedDB cached bootstrap, and queued visit sync.
- Applied migrations `003`, `005`, and `006` to the connected Supabase project in prior steps; no migration is currently pending from this handoff task.
- Implemented Mission Board v0.4 with meaningful-coverage scoring display, computed badges, tone-controlled Mission Brief nudges, and managed-distribution planning docs.
- Added multi-site foundation migration `005` with `organizations` and `organization_id` on current organization-owned tables.
- Added organization admin/setup-code migration `006`.
- Added protected central-operator API groundwork for approved workspace and setup-code creation.
- Added workspace-aware entry flow: workspace slug resolution, setup-code activation UI, workspace-specific roster loading, device registration, admin login, and workspace-keyed offline bootstrap cache.

In-progress step: only plan/handoff preservation in `docs/AI`. No product code work is in progress.

Next exact task: implement **Tenant-isolation hardening and test harness**. Start by reading `docs/MULTI_TENANT_SECURITY_CHECKLIST.md`, `netlify/functions/api.ts`, `src/App.tsx`, `src/offline.ts`, and this plan. Then add focused automated or scriptable checks proving one workspace cannot read, mutate, or infer another workspace's data through the API. Do not replan the roadmap.

Deferred/out-of-scope items:

- Do not build unrestricted public signup.
- Do not build a polished central operator console yet.
- Do not port to another platform.
- Do not add enterprise identity, Supabase Auth, SMS, email, browser push notifications, analytics expansion, AI-generated live content, or native app-store packaging.
- Do not add CUI, classified, counseling case management, official-record, free-text counseling/referral, or sensitive personal-data workflows.
- Do not deploy, change Netlify settings, alter production environment variables, or access production data unless explicitly requested.
- Do not apply new migrations unless the user explicitly asks after reviewing SQL.

Relevant constraints that must not be violated:

- Normal users must not need GitHub, Supabase, Netlify, SQL, environment variables, or terminal knowledge in the future managed flow.
- Self-hosted template users remain supported as an advanced/local-control option.
- Setup codes are controlled, one-time, centrally issued, and stored only as hashes.
- Central operator access is disabled unless `CENTRAL_OPERATOR_PASSPHRASE_HASH` is configured.
- Organization scope must come from trusted server-side session context after login, not from client-provided IDs on protected data routes.
- Every organization-owned query and mutation must filter by `organization_id`.
- Every mutation that references IDs must verify all referenced records belong to the same organization.
- Service-role Supabase access stays inside Netlify Functions only.
- RLS remains enabled as defense in depth even though functions use service role.
- PINs, admin passphrases, service-role keys, and setup codes must not be stored in browser storage.
- Offline IndexedDB data must be scoped by organization and team member.
- Existing offline sync, check-in, undo, coverage, map, Mission Board, reports, admin correction, and safe-use behavior must remain intact.

## Product Direction

Deckplating is a mobile-first, offline-capable PWA for Religious Ministry Teams to track unclassified, non-sensitive ministry coverage by location and unit. It is a coverage-awareness tool only. It must not become a counseling record, case-management system, official system of record, or CUI/classified system.

The future normal user experience is:

1. A command chaplain or RMT leader receives one managed Deckplating link.
2. A central operator has already approved and created the workspace.
3. The local lead activates that workspace using a one-time setup code.
4. The local lead creates roster, areas, locations, units, and local admin access.
5. Team members open one link, select their name, enter a PIN, and use the app.
6. Normal users never touch GitHub, Supabase, Netlify, SQL, environment variables, or terminal commands.

Self-hosted deployment remains available for teams that require local control, but it should become the advanced path rather than the normal distribution model.

## Current Architecture Decisions

- Keep React + TypeScript + Vite frontend.
- Keep Netlify Functions API in `netlify/functions/api.ts`.
- Keep Supabase database accessed only from Netlify Functions with service-role credentials.
- Keep name + PIN + registered device-token model for the current beta, while recognizing that this must be hardened before production multi-organization use.
- Keep PWA/offline approach using service worker plus IndexedDB.
- Keep current check-ins as the source records for coverage, scoring, leaderboard, activity log, reports, and corrections.
- Keep stored `score_awarded` behavior; do not recompute historical scores casually.
- Do not use Supabase Auth yet.
- Do not add a large state-management framework.
- Do not cache authenticated API responses in service-worker Cache Storage.

## Implemented Migration Sequence

The intended setup order is:

1. `supabase/migrations/001_initial_schema.sql`
2. `supabase/migrations/002_checkin_corrections.sql`
3. `supabase/migrations/003_offline_batches_outcomes_and_hardening.sql`
4. `supabase/migrations/004_mission_board_settings.sql`
5. `supabase/migrations/005_multi_site_foundation.sql`
6. `supabase/migrations/006_org_admin_and_invitations.sql`
7. `supabase/seed.sql`

Migration `005` adds:

- `organizations`
- default organization `00000000-0000-4000-8000-000000000001`
- `organization_id` on `areas`, `team_members`, `devices`, `locations`, `units`, `checkins`, `checkin_batches`, and `app_settings`
- organization-scoped indexes and uniqueness constraints where applicable

Migration `006` adds:

- `organization_admin_credentials`
- `organization_setup_codes`
- RLS enabled on both tables
- indexes for active credentials and unused setup codes

## Current API Groundwork

Public/setup routes now include:

- `GET /api/workspaces/resolve`
- `POST /api/workspaces/activate`
- `GET /api/team-members`
- `POST /api/device/register`

Central-operator routes now include:

- `POST /api/operator/login`
- `GET /api/operator/organizations`
- `POST /api/operator/organizations`
- `POST /api/operator/organizations/:id/setup-codes`
- `POST /api/operator/setup-codes/:id/revoke`

Admin/session routes remain:

- `POST /api/admin/login`
- `POST /api/admin/organization-admin/passphrase`
- normal admin location/unit/member/settings/activity routes

Current behavior:

- Workspace links may use `?workspace=workspace-slug`.
- The selected workspace is stored locally as `deckplate.workspace`.
- Device identity is stored locally as `deckplate.identity`.
- Admin token remains in `sessionStorage` as `deckplate.admin`.
- Workspace-specific bootstrap snapshots are saved in IndexedDB using organization-specific keys, with legacy `latest` fallback still present.

## Next Task: Tenant-Isolation Hardening And Test Harness

Objective: prove and harden that organization/workspace boundaries are enforced before managed multi-organization pilots progress.

Scope:

- Review every API route in `netlify/functions/api.ts`.
- Identify how organization scope is derived for each route.
- For protected user/admin routes, ensure organization scope comes from the signed session token, not from request body/query values.
- For public setup routes, allow client-provided workspace identifiers only where necessary and validate them carefully.
- Ensure every select/update/insert/delete for organization-owned tables is scoped by `organization_id`.
- Ensure every mutation referencing related IDs validates those records inside the same organization before writing.
- Ensure errors do not reveal whether another workspace's UUID exists.
- Add a focused test harness or scriptable checks for cross-workspace isolation.
- Document the test harness and its limits.

Likely files to start with:

- `docs/MULTI_TENANT_SECURITY_CHECKLIST.md`
- `netlify/functions/api.ts`
- `src/App.tsx`
- `src/offline.ts`
- `src/types.ts`
- `package.json` if a new test script is needed
- possibly `scripts/` for a small local test harness

Acceptance criteria:

- There is a route-by-route isolation review captured in code comments, tests, or docs.
- Automated or scriptable checks cover at least:
  - workspace A user token cannot load workspace B bootstrap/dashboard/leaderboard data
  - workspace A admin token cannot load or mutate workspace B locations, units, members, check-ins, settings, or activity log
  - check-in creation rejects unit/location IDs from another workspace
  - check-in batch idempotency cannot return another workspace's batch
  - indicator update cannot update another workspace's batch
  - undo cannot void another workspace's check-ins
  - admin correction cannot alter another workspace's check-ins, units, members, or locations
  - device registration only registers against the selected active workspace
  - identity change cannot cross workspaces
  - setup-code activation cannot activate an expired, used, revoked, or wrong-hash code
  - operator routes require central operator token and never return setup-code hashes or admin credential hashes
- `npm run typecheck`, `npm run build`, and `git diff --check` pass.
- Do not apply migrations or touch external services unless separately requested.

Potential implementation approach:

- First make a table of routes and organization-scope source.
- Add small helpers if needed to reduce mistakes:
  - organization-scoped ID validators
  - safe not-found response for cross-org UUIDs
  - consistent organization-aware update/select wrappers
- Add tests at the API level if practical without production data.
- If a full local DB test harness is too heavy, add a scriptable static/contract check plus documented manual API checks, but prefer executable checks where feasible.
- Do not install dependencies unless needed and approved.

## Managed Distribution Roadmap

Stage 1 - Mission Board and pilot readiness:

- Objective: improve usefulness and engagement in the current single-organization beta.
- Scope: Mission Board, badges, tone-controlled Mission Briefs, offline reliability, setup docs, safe-use docs.
- Exit criteria: current app remains stable; Mission Board rewards meaningful coverage; non-technical setup docs are usable.
- Status: substantially complete for current beta.

Stage 2 - outside-team pilot validation:

- Objective: validate real RMT use before full centralized multi-tenancy.
- Scope: at least two outside RMTs use current app for 2-4 weeks; collect feedback on setup, offline behavior, check-in reliability, admin workflow, and reporting.
- Exit criteria: two outside teams complete pilot; critical blockers are documented or fixed; evidence supports centralized hosting as the right adoption path.
- Current next work: tenant-isolation hardening before managed pilots progress.

Stage 3 - managed multi-organization service:

- Objective: centrally hosted Deckplating with controlled organization onboarding.
- Scope: full organization scoping, invitation/setup flow, organization admin model, central operator console, tenant-isolation tests, migration strategy, controlled rollout.
- Exclusions: unrestricted public signup, sensitive data workflows, native port, notifications, broad analytics.
- Exit criteria: tenant-isolation tests pass, pilot workspaces can be created without developer setup by local users, self-hosted remains available, rollback/incident response plans exist.

## Known Security Work Still Required

- PIN hashing currently needs organization context before production multi-organization use.
- Environment-wide admin fallback must be disabled before managed production; it may remain only for self-hosted/default-organization beta compatibility.
- Organization-aware session refresh behavior needs hardening.
- Offline pending batches must be reviewed for organization partitioning and identity-change blocking across organizations.
- Backup/export/delete boundaries must become organization-specific.
- Tenant-isolation tests must pass before a managed pilot with real outside teams.

## Validation Pattern For Future Changes

Default validation before commit:

```bash
npm run typecheck
npm run build
git diff --check
```

Use smaller validation only for docs-only changes:

```bash
git diff --check
```

Do not run migrations, deploy, alter Netlify/Supabase settings, or access production data unless the user explicitly asks for that action.
