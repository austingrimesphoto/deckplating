# Deckplating Handoff

Branch: `main`

Current checkpoint update:

- Implemented the quality-control hardening pass for audit items `1`, `2`, `3`, `5`, and `7`.
- Added migrations for workspace-scoped app settings and operator audit events.
- Changed managed-host admin behavior so the old environment admin fallback is not accepted for workspace admin login when central operator mode is enabled.
- Added audited superuser admin entry from the operator console, scoped to one active workspace.
- Added a no-roster re-entry path so an activated workspace with no members can still open local Admin.
- Tightened offline bootstrap lookup so one workspace cannot fall back to another workspace's cached `latest` snapshot.
- Added a two-workspace live integration script for safe non-production API targets.
- Updated tenant-isolation/static checks and operator/admin docs to match the new behavior.

Current checkpoint verification:

- `npm run test:tenant-isolation` passed with 26 checks.
- `npm run typecheck` passed.
- `npm run build` passed with the existing Vite large-chunk warning.
- `npm run build --prefix setup-site` passed.
- `node --check scripts/two-workspace-integration-check.mjs` passed.
- `git diff --check` passed.
- The live two-workspace integration script was not executed because it requires a live API URL and central operator passphrase.

`git status --short` at managed-pilot administration start: clean.

What changed in this continuation session:

- Completed local implementation of **Managed Pilot Onboarding And Launch Readiness v1**.
- Tightened `src/App.tsx` activation/admin wording around approved workspace selection, one-time setup code, installation/map center, local admin passphrase, local setup, and roster creation.
- Added a low-profile `Account` > `Send feedback` link to `https://deckplatingsetup.netlify.app/#feedback`.
- Rewrote `setup-site/index.html` from self-host-first setup to managed pilot access, workspace request, user guide, and feedback.
- Added Netlify Forms request form `deckplating-workspace-request` and thank-you page `workspace-request-thanks.html`.
- Preserved feedback form `deckplating-pilot-feedback` and updated thank-you copy for manual managed-pilot review.
- Rebuilt `docs/USER_GUIDE.md` and `setup-site/user-guide.html` around concrete workflows and scrubbed demo screenshot assets.
- Updated feedback and pilot docs for managed-pilot reality:
  - `docs/MANAGED_PILOT_FEEDBACK_LOOP.md`
  - `docs/PILOT_FEEDBACK_REVIEW.md`
  - `docs/PILOT_PACKET.md`
- Added `docs/AI/NEXT_SESSION_START_HERE.md` for human/agent continuation.
- Updated `docs/ADMINISTRATOR_RUNBOOK.md` labels for `Account`, `Admin settings`, and the hide/complete onboarding checklist.

Working tree expectation after the handoff commit: clean.

No root `AGENTS.md` file was present when checked.

Changed files in this continuation:

- `src/App.tsx`
- `src/styles.css`
- `docs/ADMINISTRATOR_RUNBOOK.md`
- `docs/AI/DECKPLATING_PLAN.md`
- `docs/AI/HANDOFF.md`
- `docs/AI/NEXT_SESSION_START_HERE.md`
- `docs/MANAGED_PILOT_FEEDBACK_LOOP.md`
- `docs/PILOT_FEEDBACK_REVIEW.md`
- `docs/PILOT_PACKET.md`
- `docs/USER_GUIDE.md`
- `setup-site/README.md`
- `setup-site/index.html`
- `setup-site/user-guide.html`
- `setup-site/pilot-feedback-thanks.html`
- `setup-site/workspace-request-thanks.html`
- `setup-site/assets/screenshots/`

Verification completed before this handoff update:

- `npm run test:tenant-isolation` passed with 22 checks.
- `npm run typecheck` passed.
- `npm run build` passed.
- `npm run build --prefix setup-site` passed.
- `git diff --check` passed.

No deployment was performed in this continuation session.

Exact next task:

Review and deploy the current hardening diff only after validation passes. After deployment, run the live two-workspace integration script against a safe preview or approved production target, then continue with stale suspended/deleted workspace UX, performance review, reliability, backup/export posture, audit review surfaces, and pilot-feedback-driven feature planning.

Current readiness assessment for a real outside chaplain:

- the hosted app is now usable for a small managed pilot through Deckplating itself
- the central operator can create/delete/suspend/reactivate workspaces, issue/revoke setup codes, recover a forgotten local-admin passphrase, reset member PINs, and leave routine roster handling to the local lead
- the central operator can open an audited superuser admin session scoped to one active workspace for support and quality-control work
- the main remaining gaps before broader self-service rollout are:
  - onboarding-launch changes still need human review and production deployment
  - feedback capture still lives mostly on the setup-site form
  - stale-session UX, backup/export posture, audit review surfaces, performance, and repeated live integration coverage still need hardening
