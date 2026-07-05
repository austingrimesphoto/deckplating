# Deckplating Handoff

Branch: `main`

`git status --short` at tenant-isolation handoff start: clean.

What changed in this handoff session:

- Completed `Tenant-isolation hardening and test harness`.
- Hardened `netlify/functions/api.ts` with organization-scoped related-ID validators, safe scoped not-found behavior, and admin mutation checks for replacement units, edited team members, admin actors, location areas, assigned units, and unit locations.
- Changed PIN hashing to include organization context while preserving a legacy beta hash upgrade path after successful PIN use.
- Partitioned offline pending-batch reads, indicator updates, sync replay, and identity-change blocking by organization and team member.
- Added `scripts/tenant-isolation-check.mjs`, wired as `npm run test:tenant-isolation`.
- Added `docs/AI/TENANT_ISOLATION_REVIEW.md` with route-by-route scope source notes and harness limits.
- Updated `docs/AI/DECKPLATING_PLAN.md` and this handoff to mark the milestone complete and name the next task.
- No migrations, deployments, external service changes, dependency changes, or production-data access occurred.

Working tree expectation after the handoff commit: clean.

No root `AGENTS.md` file was present when checked.

Changed files in the milestone:

- `netlify/functions/api.ts`
- `src/App.tsx`
- `src/offline.ts`
- `package.json`
- `scripts/tenant-isolation-check.mjs`
- `docs/AI/TENANT_ISOLATION_REVIEW.md`
- `docs/AI/DECKPLATING_PLAN.md`
- `docs/AI/HANDOFF.md`

Verification completed before this handoff update:

- `npm run test:tenant-isolation` passed with 17 checks.
- `npm run typecheck` passed.
- `npm run build` passed. Vite emitted the existing large-chunk warning, but the build completed successfully.
- `git diff --check` passed.

Harness limit:

The tenant-isolation harness is static/contract-oriented. It verifies the presence of route guards, organization-scoped query/update patterns, related-ID validators, setup-code protections, operator hash omissions, organization-scoped check-in batch idempotency schema support, and offline organization filters. It does not replace a future live database integration suite that seeds two organizations and executes HTTP requests against Netlify Functions.

Smallest relevant verification command for this handoff/docs update:

```bash
git diff --check
```

Exact next task:

Follow `docs/AI/DECKPLATING_PLAN.md`, section `Next Task: Stage 2 Outside-Team Pilot Validation Preparation`. Start by reading `docs/AI/DECKPLATING_PLAN.md`, `docs/AI/HANDOFF.md`, `docs/PILOT_PACKET.md`, `docs/PILOT_READINESS_GUIDE.md`, `docs/PILOT_FEEDBACK_TEMPLATE.md`, and `docs/PILOT_SUPPORT_PLAYBOOK.md`. Then update only the pilot packet/checklist material needed for two outside RMTs to run a 2-4 week validation and report setup, offline behavior, check-in reliability, admin workflow, reporting, safe-use clarity, and critical blockers. Do not build new product features.
