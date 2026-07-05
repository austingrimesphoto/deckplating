# Deckplating Handoff

Branch: `main`

`git status --short` at managed hosted onboarding start: clean.

What changed in this handoff session:

- Completed Managed Hosted Onboarding v1 in the app and API.
- Added a minimal in-app operator console for protected workspace creation, setup-code issuance, setup-code revocation, and readiness visibility.
- Added workspace onboarding summaries for both the operator view and local admin view.
- Added tenant-scoped admin area creation/editing so a newly activated workspace can complete areas, locations, units, and team-member setup entirely inside the app.
- Added a guided onboarding checklist in Admin Setup to show remaining local setup work before wider sign-in.
- Updated the durable plan to mark this milestone complete and point the next work at a real managed dry run.

Working tree expectation after the handoff commit: clean.

No root `AGENTS.md` file was present when checked.

Changed files in the milestone:

- `netlify/functions/api.ts`
- `src/App.tsx`
- `docs/AI/DECKPLATING_PLAN.md`
- `docs/AI/HANDOFF.md`

Verification completed before this handoff update:

- `npm run typecheck` passed.
- `npm run build` passed.
- `git diff --check` passed.

Smallest relevant verification command for docs-only follow-up edits:

```bash
git diff --check
```

Exact next task:

Follow `docs/AI/DECKPLATING_PLAN.md`, section `Next Task: Managed Pilot Dry Run and Deployment Readiness`. Run one real managed dry run through operator login, workspace creation, setup-code issuance, workspace activation, local admin setup, and first member sign-in; fix only the defects uncovered by that dry run; then update the operator/onboarding docs with the exact live procedure and failure-recovery notes.
