# Deckplating AI Continuity Plan

## Current Milestone

Exact current stopping point: the repository is on `main` after a successful live managed dry run against `https://deckplating.netlify.app`. The hosted app now supports protected operator workspace setup, tenant-scoped local onboarding, and first-use check-ins on the real managed stack. The user remains the system administrator during the small-command test phase.

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
- Pivoted the near-term plan toward centrally hosted managed onboarding:
  - Normal commands should visit `deckplating.netlify.app`, select or activate their command workspace, complete guided local setup, and use the app without creating GitHub, Supabase, or Netlify accounts.
  - The system administrator owns central workspace creation/approval, setup-code issuance, overhead visibility, incident response, and platform operations during the small-command test phase.
  - Local command leads own their roster, areas, locations, units, and local admin passphrase inside their tenant sandbox.
  - Self-hosted deployment remains an advanced/local-control option, no longer the primary pilot path.
- Completed the live managed pilot dry run:
  - Linked the repo to the live Netlify site `deckplating` and confirmed the real Supabase backend.
  - Enabled central operator access on production.
  - Ran workspace creation, setup-code issuance, activation, local setup, device registration, bootstrap, and one real check-in on the live hosted app.
  - Fixed and redeployed one setup-code response-shape defect found during the dry run.
  - Revoked the two unused diagnostic setup codes after validation.
  - Documented the current managed-pilot feedback loop, including the fact that feedback capture still uses the setup-site Netlify Form rather than an in-app hosted-app entry point.

In-progress step: none.

Next exact task: begin **Managed Production Guardrails v1**. Start by reading `docs/AI/DECKPLATING_PLAN.md`, `docs/AI/HANDOFF.md`, `docs/CENTRAL_OPERATOR_GUIDE.md`, `docs/CONTROLLED_WORKSPACE_ONBOARDING.md`, `docs/MANAGED_PILOT_DRY_RUN_2026-07-05.md`, `docs/MANAGED_PILOT_FEEDBACK_LOOP.md`, `netlify/functions/api.ts`, and `src/App.tsx`. Then disable or explicitly gate the environment-wide admin fallback for managed hosted production, add the smallest missing operator-side containment control for pilot support, and tighten the operator/support runbook around passphrase rotation, dry-run cleanup, live incident recovery, and managed feedback collection.

Deferred/out-of-scope items:

- Do not build unrestricted public signup.
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

The near-term normal user experience is:

1. A command chaplain or RMT leader goes to `deckplating.netlify.app`.
2. The command selects an existing approved workspace or enters a centrally issued setup code.
3. The local lead activates that command workspace and creates the local admin passphrase.
4. The guided onboarding flow prompts the lead to create roster, areas, locations, units, and initial local settings.
5. Team members open the same hosted link, choose their command workspace, select their name, enter a PIN, and use the app.
6. Normal command users never touch GitHub, Supabase, Netlify, SQL, environment variables, or terminal commands.
7. The system administrator has overhead visibility into workspace status, setup-code state, activity health, and access posture without exposing one command's data to another command.

Self-hosted deployment remains available for teams that require local control, formal handoff, separate infrastructure, or slower update adoption, but it is now the advanced path rather than the normal pilot path.

## Current Architecture Decisions

- Keep React + TypeScript + Vite frontend.
- Keep Netlify Functions API in `netlify/functions/api.ts`.
- Keep Supabase database accessed only from Netlify Functions with service-role credentials.
- Keep name + PIN + registered device-token model for the current beta, while recognizing that this must be hardened before production multi-organization use.
- Move normal onboarding into the single hosted app at `deckplating.netlify.app`.
- Treat the user as the central system administrator during the small-command test phase.
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
- Stage 2 execution remains blocked on external pilot-lead availability; this blocker is recorded in `docs/PILOT_DECISION_LOG.md`.

## Superseded Task: Self-Hosted Outside-Team Pilot Execution

Objective: this was the previous next step. It is no longer the primary path because the user wants to accelerate away from each site managing separate GitHub, Supabase, and Netlify accounts.

Historical scope:

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
- `docs/PILOT_INVITATION_MESSAGE.md`
- `docs/PILOT_FEEDBACK_TEMPLATE.md`
- `docs/PILOT_SUPPORT_PLAYBOOK.md`
- `docs/PILOT_DECISION_LOG.md`
- `docs/PILOT_CLOSEOUT_TEMPLATE.md`

Current status:

- Self-hosted pilot docs remain useful for advanced/local-control deployments.
- The managed hosted path is now the normal pilot path for approved commands.
- Managed Hosted Onboarding v1 is complete in app/API form and validated with typecheck/build.

## Completed: Managed Hosted Onboarding v1

Objective achieved: the centrally hosted Deckplating path is now usable for small-command onboarding without requiring each command to manage GitHub, Supabase, or Netlify accounts.

Implementation summary:

- Added a minimal in-app operator console so the system administrator can log in, create approved workspaces, issue setup codes, revoke unused setup codes, and see workspace readiness summaries.
- Added workspace onboarding summaries on both operator and local admin surfaces so readiness is visible without cross-tenant operational data leakage.
- Added tenant-scoped admin area creation/editing so a newly activated workspace can fully create areas, then locations, units, and team members from inside the app.
- Added a guided onboarding checklist in Admin Setup so local leads can finish passphrase, area, location, unit, and roster setup before handing the app to the rest of the command.

Changed files:

- `netlify/functions/api.ts`
- `src/App.tsx`
- `docs/AI/DECKPLATING_PLAN.md`
- `docs/AI/HANDOFF.md`

Validation completed:

- `npm run typecheck`
- `npm run build`
- `git diff --check`

## Completed: Managed Pilot Dry Run and Deployment Readiness

Objective achieved: the hosted onboarding flow now works end to end against the real managed stack at `https://deckplating.netlify.app`.

Implementation and operational summary:

- Linked the repo to the live Netlify project `deckplating` and confirmed the hosted app uses the real Supabase project `deckplating` (`vfjqnuwbkjdwvoaxepfi`).
- Enabled managed operator access on the live host by setting `CENTRAL_OPERATOR_PASSPHRASE_HASH` in Netlify production and redeploying.
- Ran the hosted flow live through operator login, workspace creation, setup-code issuance, workspace activation, local admin setup, first device registration, bootstrap, and a real check-in.
- Found one production defect: setup-code creation returned the plaintext code only at `setupCode.code` while the new operator console expected `code`.
- Fixed that contract mismatch in `netlify/functions/api.ts` and `src/App.tsx`, redeployed, reran the dry run successfully, and revoked the unused diagnostic setup codes.
- Updated the operator and onboarding docs with the exact live procedure and failure-recovery notes.

Durable dry-run record:

- `docs/MANAGED_PILOT_DRY_RUN_2026-07-05.md`

Changed files:

- `netlify/functions/api.ts`
- `src/App.tsx`
- `docs/CENTRAL_OPERATOR_GUIDE.md`
- `docs/CONTROLLED_WORKSPACE_ONBOARDING.md`
- `docs/MANAGED_PILOT_DRY_RUN_2026-07-05.md`
- `docs/AI/DECKPLATING_PLAN.md`
- `docs/AI/HANDOFF.md`

Validation and live verification completed:

- `npm run typecheck`
- `npm run build`
- `git diff --check`
- live Netlify production deploy to `https://deckplating.netlify.app`
- live managed dry run with:
  - operator login
  - workspace activation
  - onboarding summary from `not ready` to `ready`
  - first member sign-in
  - first live check-in with score `3`

## Next Task: Managed Production Guardrails v1

Objective: reduce the remaining managed-host risk before onboarding a real non-dry-run command workspace.

Scope:

- Disable or explicitly gate the environment-wide admin fallback for managed hosted production.
- Add the smallest operator-side lifecycle controls still missing for safe pilot support, starting with workspace deactivate/archive or equivalent containment.
- Tighten the operator/support runbook around passphrase rotation, dry-run cleanup, live incident recovery, and managed-pilot feedback collection.
- Keep public signup, backup/export/delete workflows, and broad service hardening out of scope for this pass.

Likely files to start with:

- `docs/AI/DECKPLATING_PLAN.md`
- `docs/AI/HANDOFF.md`
- `docs/CENTRAL_OPERATOR_GUIDE.md`
- `docs/CONTROLLED_WORKSPACE_ONBOARDING.md`
- `docs/MANAGED_PILOT_FEEDBACK_LOOP.md`
- `netlify/functions/api.ts`
- `src/App.tsx`

## Managed Distribution Roadmap

Stage 1 - Mission Board and pilot readiness:

- Objective: improve usefulness and engagement in the current single-organization beta.
- Scope: Mission Board, badges, tone-controlled Mission Briefs, offline reliability, setup docs, safe-use docs.
- Exit criteria: current app remains stable; Mission Board rewards meaningful coverage; non-technical setup docs are usable.
- Status: substantially complete for current beta.

Stage 2 - managed hosted small-command pilot:

- Objective: validate real command use through one centrally hosted app with controlled workspace onboarding.
- Scope: a small number of approved commands use `deckplating.netlify.app`; the system administrator creates/approves workspaces and monitors workspace health; local command leads complete guided setup and run normal operations inside their tenant sandbox.
- Exit criteria: at least two commands activate managed workspaces, complete local setup without GitHub/Supabase/Netlify exposure, complete real check-ins, and report whether the hosted flow is viable.
- Current next work: add the remaining managed-production guardrails, then onboard the first real pilot command workspace.

Stage 3 - managed service hardening and sustainment:

- Objective: make the centrally hosted Deckplating service durable enough to hand off to the Navy or operate with a sustainable support model.
- Scope: stronger operator console, backup/export/delete boundaries, incident response, auditability, support process, tenant-isolation integration tests, migration/rollback process, and documentation for ownership transfer.
- Exclusions: unrestricted public signup, sensitive data workflows, native port, notifications, broad analytics.
- Exit criteria: hosted workspaces operate reliably under administrator oversight, self-hosted remains available for local-control cases, and the project has a credible Navy handoff or self-sustaining operating model.

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
