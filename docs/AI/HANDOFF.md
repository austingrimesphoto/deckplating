# Deckplating Handoff

Branch: `main`

`git status --short` at managed-pilot administration start: clean.

What changed in this handoff session:

- Completed **Managed Pilot Administration v1** for `https://deckplating.netlify.app`.
- Added `scripts/bootstrap-central-operator.sh` so the central operator passphrase can be securely bootstrapped or rotated from the linked repo without printing the plaintext passphrase or its SHA-256 hash.
- Added operator workspace lifecycle controls in `netlify/functions/api.ts` and `src/App.tsx`:
  - suspend workspace
  - reactivate workspace
  - emergency local-admin passphrase recovery
- Bound user and admin sessions to live workspace state so suspended workspaces block:
  - workspace resolution
  - setup activation
  - device registration
  - existing member/admin sessions
- Added local-admin `Reset PIN and revoke devices` for same-workspace roster members.
- Made `System Administration` reachable from normal `Settings` and reliable via `?operator=1` without clearing the normal stored user identity.
- Added `docs/ADMINISTRATOR_RUNBOOK.md`.
- Updated `scripts/tenant-isolation-check.mjs` for the new authorization and inactive-workspace guarantees.
- Updated the durable plan to mark the pilot-administration milestone complete and move the next work to managed self-service hardening.

Working tree expectation after the handoff commit: clean.

No root `AGENTS.md` file was present when checked.

Changed files in the milestone:

- `netlify/functions/api.ts`
- `src/App.tsx`
- `scripts/bootstrap-central-operator.sh`
- `scripts/tenant-isolation-check.mjs`
- `docs/ADMINISTRATOR_RUNBOOK.md`
- `docs/AI/DECKPLATING_PLAN.md`
- `docs/AI/HANDOFF.md`

Verification completed before this handoff update:

- `npm run typecheck` passed.
- `npm run build` passed.
- `git diff --check` passed.
- live Netlify production deploy succeeded.
- live managed dry run succeeded end to end after one fix redeploy.

Smallest relevant verification command for docs-only follow-up edits:

```bash
git diff --check
```

Exact next task:

Follow `docs/AI/DECKPLATING_PLAN.md`, section `Next exact task`. Start by reading the current plan, handoff, runbook, operator guide, onboarding doc, `netlify/functions/api.ts`, `src/App.tsx`, and `scripts/tenant-isolation-check.mjs`. Then explicitly gate or remove the environment-wide admin fallback for managed hosted production, tighten suspended-workspace UX around stale cached sessions, and add only the smallest remaining safeguards needed before broader managed self-service.

Current readiness assessment for a real outside chaplain:

- the hosted app is now usable for a small managed pilot through Deckplating itself
- the central operator can create a workspace, issue/revoke setup codes, suspend/reactivate a pilot, recover a forgotten local-admin passphrase, and leave routine roster/PIN handling to the local lead
- the main remaining gaps before broader self-service rollout are:
  - managed-host admin fallback guardrails
  - cleaner stale-session UX when a workspace is suspended
  - feedback capture still lives on the setup-site form rather than inside `deckplating.netlify.app`
