# Deckplating Handoff

Branch: `main`

`git status --short` at managed pilot dry-run start: clean.

What changed in this handoff session:

- Completed the real managed dry run against `https://deckplating.netlify.app`.
- Linked the repo to the live Netlify site `deckplating` and confirmed the live backend was the real Supabase project `deckplating` (`vfjqnuwbkjdwvoaxepfi`).
- Enabled central operator access on the live host by setting `CENTRAL_OPERATOR_PASSPHRASE_HASH` in Netlify production and redeploying.
- Ran the hosted flow live through operator login, workspace creation, setup-code issuance, workspace activation, local admin setup, first device registration, bootstrap, and a real check-in.
- Found and fixed one production defect: setup-code creation returned the plaintext code at `setupCode.code` while the new operator console expected `code`.
- Redeployed the fix, reran the live dry run successfully, and revoked the two unused diagnostic setup codes.
- Added a durable dry-run record and updated the operator/onboarding docs with exact live procedure and failure-recovery notes.
- Updated the durable plan to mark the dry-run milestone complete and move the next work to managed-production guardrails.

Working tree expectation after the handoff commit: clean.

No root `AGENTS.md` file was present when checked.

Changed files in the milestone:

- `netlify/functions/api.ts`
- `src/App.tsx`
- `docs/CENTRAL_OPERATOR_GUIDE.md`
- `docs/CONTROLLED_WORKSPACE_ONBOARDING.md`
- `docs/MANAGED_PILOT_DRY_RUN_2026-07-05.md`
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

Follow `docs/AI/DECKPLATING_PLAN.md`, section `Next Task: Managed Production Guardrails v1`. Disable or explicitly gate the environment-wide admin fallback for managed hosted production, add the smallest missing operator-side containment control for pilot support, and tighten the operator/support runbook around passphrase rotation, dry-run cleanup, and live incident recovery.
