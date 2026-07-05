# Deckplating AI Continuity Plan

## Current Milestone

Exact current stopping point: the repository is on `main` with `Stage 2 outside-team pilot validation preparation` implemented in the pilot documentation set. The only remaining work in this session is preserving the updated plan/handoff, verifying the docs diff, and committing this documentation milestone. Do not begin a new product feature in this handoff.

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
- Completed tenant-isolation hardening and test harness:
  - Added organization-scoped related-ID validators and safe scoped not-found behavior in `netlify/functions/api.ts`.
  - Hardened admin correction, location, unit, and team-member mutations so referenced records must belong to the admin token organization.
  - Moved PIN hashing to include organization context while preserving a legacy beta hash upgrade path on successful PIN use.
  - Partitioned offline pending-batch reads, sync replay, indicator updates, and identity-change blocking by organization and team member.
  - Added `scripts/tenant-isolation-check.mjs` and `npm run test:tenant-isolation`.
  - Added `docs/AI/TENANT_ISOLATION_REVIEW.md` with a route-by-route scope review and harness limits.
- Completed Stage 2 outside-team pilot validation preparation:
  - Updated `docs/PILOT_PACKET.md` for two outside-team pilots, explicit feedback checkpoints, timeline, and stop conditions tied to adoption blockers.
  - Updated `docs/PILOT_READINESS_GUIDE.md` with a readiness gate, evidence to collect, and clearer pre-call ownership questions.
  - Updated `docs/PILOT_FEEDBACK_TEMPLATE.md` to capture setup versus closeout checkpoints, admin/reporting usability, safe-use clarity, and critical blockers.
  - Updated `docs/PILOT_SUPPORT_PLAYBOOK.md` to emphasize bounded support, adoption blockers, evidence capture, and local-owner usability for admin and reports.

In-progress step: only plan/handoff preservation in `docs/AI` and the milestone commit. No product feature work is in progress.

Next exact task: begin **Stage 2 outside-team pilot execution and evidence collection**. Start by reading `docs/AI/DECKPLATING_PLAN.md`, `docs/AI/HANDOFF.md`, `docs/PILOT_PACKET.md`, `docs/PILOT_READINESS_GUIDE.md`, `docs/PILOT_FEEDBACK_TEMPLATE.md`, `docs/PILOT_SUPPORT_PLAYBOOK.md`, `docs/PILOT_DECISION_LOG.md`, and `docs/PILOT_CLOSEOUT_TEMPLATE.md`. Then recruit or line up two outside RMT pilot leads, run the setup/support cadence, collect the setup and closeout feedback artifacts, and log blockers without starting unrelated product work.

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

## Completed Task: Tenant-Isolation Hardening And Test Harness

Objective: prove and harden that organization/workspace boundaries are enforced before managed multi-organization pilots progress.

Completed scope:

- Review every API route in `netlify/functions/api.ts`.
- Identify how organization scope is derived for each route.
- For protected user/admin routes, ensure organization scope comes from the signed session token, not from request body/query values.
- For public setup routes, allow client-provided workspace identifiers only where necessary and validate them carefully.
- Ensure every select/update/insert/delete for organization-owned tables is scoped by `organization_id`.
- Ensure every mutation referencing related IDs validates those records inside the same organization before writing.
- Ensure errors do not reveal whether another workspace's UUID exists.
- Add a focused test harness or scriptable checks for cross-workspace isolation.
- Document the test harness and its limits.

Changed files:

- `netlify/functions/api.ts`
- `src/App.tsx`
- `src/offline.ts`
- `package.json`
- `scripts/tenant-isolation-check.mjs`
- `docs/AI/TENANT_ISOLATION_REVIEW.md`
- `docs/AI/DECKPLATING_PLAN.md`
- `docs/AI/HANDOFF.md`

Verification results:

- `npm run test:tenant-isolation` passed with 17 checks.
- `npm run typecheck` passed.
- `npm run build` passed. Vite emitted the existing large-chunk warning, but the build completed successfully.
- `git diff --check` passed.
- No migrations were added or applied.
- No deployment, Netlify/Supabase settings, external services, or production data were touched.

Harness limits:

The tenant-isolation harness is a static/contract check. It verifies that the route guards, scoped query/update calls, related-ID validators, setup-code protections, operator hash omissions, schema support for organization-scoped check-in batch idempotency, and offline organization filters are present in the code. It does not replace a future live database integration suite that seeds two organizations and executes HTTP requests against Netlify Functions.

## Completed Task: Stage 2 Outside-Team Pilot Validation Preparation

Objective: prepare the pilot materials and feedback loop for at least two outside RMTs to validate real use before full centralized multi-tenancy work continues.

Completed scope:

- Review the existing pilot packet, readiness guide, feedback template, support playbook, and this plan.
- Update only the pilot documentation needed for a 2-4 week outside-team validation.
- Ensure the packet asks for feedback on setup, offline behavior, check-in reliability, admin workflow, reporting, safe-use clarity, and any critical blockers.
- Do not build new product features, deploy, alter external services, apply migrations, or access production data as part of this preparation task.

Changed files:

- `docs/PILOT_PACKET.md`
- `docs/PILOT_READINESS_GUIDE.md`
- `docs/PILOT_FEEDBACK_TEMPLATE.md`
- `docs/PILOT_SUPPORT_PLAYBOOK.md`
- `docs/AI/DECKPLATING_PLAN.md`
- `docs/AI/HANDOFF.md`

Verification results:

- `git diff --check` passed.
- No product code, migrations, deployments, Netlify settings, Supabase settings, or production data were touched.

## Next Task: Stage 2 Outside-Team Pilot Execution And Evidence Collection

Objective: run the first two outside-team pilots, capture real-use evidence, and document blockers clearly enough to decide whether broader self-hosted beta use or more product hardening should come next.

Scope:

- Identify two outside RMT leads willing to run a 2-4 week pilot.
- Send the current pilot packet and confirm account ownership, safe-use understanding, and feedback checkpoints.
- Run the setup-call and weekly follow-up cadence from the support playbook.
- Collect at least one setup feedback artifact and one closeout artifact per team.
- Log blockers, adoption risks, and go/no-go outcomes in the pilot decision workflow.
- Do not start unrelated feature work during pilot execution unless a true blocker requires a targeted fix and is explicitly approved.

Likely files to start with:

- `docs/AI/DECKPLATING_PLAN.md`
- `docs/AI/HANDOFF.md`
- `docs/PILOT_PACKET.md`
- `docs/PILOT_READINESS_GUIDE.md`
- `docs/PILOT_FEEDBACK_TEMPLATE.md`
- `docs/PILOT_SUPPORT_PLAYBOOK.md`
- `docs/PILOT_DECISION_LOG.md`
- `docs/PILOT_CLOSEOUT_TEMPLATE.md`

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
- Current next work: execute the first two outside-team pilots and collect evidence.

Stage 3 - managed multi-organization service:

- Objective: centrally hosted Deckplating with controlled organization onboarding.
- Scope: full organization scoping, invitation/setup flow, organization admin model, central operator console, tenant-isolation tests, migration strategy, controlled rollout.
- Exclusions: unrestricted public signup, sensitive data workflows, native port, notifications, broad analytics.
- Exit criteria: tenant-isolation tests pass, pilot workspaces can be created without developer setup by local users, self-hosted remains available, rollback/incident response plans exist.

## Known Security Work Still Required

- PIN hashing includes organization context, with a legacy beta hash upgrade path on successful PIN use.
- Environment-wide admin fallback must be disabled before managed production; it may remain only for self-hosted/default-organization beta compatibility.
- Organization-aware session refresh behavior needs hardening.
- Offline pending batches are partitioned for active sync/count/indicator paths by organization and team member; a future IndexedDB schema migration can add a dedicated organization index if volume requires it.
- Backup/export/delete boundaries must become organization-specific.
- The static tenant-isolation harness passes; a future live two-organization API integration suite is still recommended before production managed scale.

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
