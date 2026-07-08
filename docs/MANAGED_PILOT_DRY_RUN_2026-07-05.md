# controlled demonstration Dry Run - 2026-07-05

## Scope

This dry run validated the managed hosted onboarding path against the live managed stack:

- Netlify site: `https://deckplating.netlify.app`
- Netlify project: `deckplating`
- Supabase project ref: `vfjqnuwbkjdwvoaxepfi`

No GitHub, Supabase, or Netlify account creation was required for the local command path.

## Managed Host Preparation

Completed before the dry run:

- linked the repo to the live Netlify site
- confirmed the live site already used the real `deckplating` Supabase project
- set `CENTRAL_OPERATOR_PASSPHRASE_HASH` in the Netlify production environment
- deployed the current managed hosted onboarding build to production

## Defect Found And Fixed

First failure:

- operator workspace creation succeeded
- setup-code creation succeeded
- workspace activation failed in the dry-run script because the API returned the plaintext code at `setupCode.code` while the new operator console expected `code`

Fix applied and redeployed:

- `netlify/functions/api.ts` now returns both `code` and `setupCode.code`
- `src/App.tsx` now accepts either response shape

## End-To-End Result

Result: **passed after one production fix redeploy**

Verified against the live hosted app:

1. Operator login succeeded.
2. Operator organization list succeeded.
3. Workspace `managed-dry-run-20260705` existed and remained tenant-isolated.
4. Setup-code issuance succeeded.
5. Workspace activation succeeded and returned an organization-scoped admin token.
6. `GET /api/admin/settings` showed onboarding incomplete before local setup:
   - areas: `0`
   - locations: `0`
   - units: `0`
   - team members: `0`
   - organization admin configured: `true`
   - ready for check-ins: `false`
7. Local admin created:
   - 1 area
   - 1 location
   - 1 unit
   - 1 team member
8. `GET /api/admin/settings` then showed onboarding ready:
   - areas: `1`
   - locations: `1`
   - units: `1`
   - team members: `1`
   - organization admin configured: `true`
   - ready for check-ins: `true`
9. First member device registration succeeded.
10. Bootstrap succeeded with the tenant-scoped workspace context.
11. A live check-in succeeded:
    - batch id created
    - 1 check-in recorded
    - score awarded: `3`
12. Operator organization summary reflected the workspace as ready.

## Cleanup

Completed:

- revoked the two unused dry-run setup codes created during failure diagnosis

Remaining intentional state:

- the dry-run workspace `managed-dry-run-20260705` remains active
- one used setup code remains in history
- the workspace contains one non-sensitive dry-run area, location, unit, team member, device registration, and check-in

## Remaining Managed-Production Gaps

- Current note: a later hardening pass gated environment-wide admin fallback for managed workspace admin login and added audited superuser admin entry.
- Current note: a later hardening pass added operator-side suspend/reactivate/delete support.
- backup/export/delete boundaries remain future work
- the live two-workspace integration script should be run against a safe target before broader rollout
