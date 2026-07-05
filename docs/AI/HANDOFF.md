# Deckplating Handoff

Branch: `main`

`git status --short` at managed-hosting pivot start: clean.

What changed in this handoff session:

- Reworked the plan around a single centrally hosted `deckplating.netlify.app` service.
- Superseded the self-hosted outside-team pilot as the normal next path; self-hosting remains an advanced/local-control option.
- Recorded the user as the near-term system administrator for small-command managed testing.
- Updated managed distribution docs so normal commands activate approved tenant workspaces and complete guided onboarding without GitHub, Supabase, or Netlify exposure.
- Preserved the requirement for system administrator overhead visibility without cross-tenant data exposure.
- No product code, migrations, deployments, external service changes, dependency changes, or production-data access occurred.

Working tree expectation after the handoff commit: clean.

No root `AGENTS.md` file was present when checked.

Changed files in the milestone:

- `docs/AI/DECKPLATING_PLAN.md`
- `docs/AI/HANDOFF.md`
- `docs/MANAGED_DISTRIBUTION_PLAN.md`
- `docs/MANAGED_DISTRIBUTION_ROADMAP.md`
- `docs/CONTROLLED_WORKSPACE_ONBOARDING.md`
- `docs/CENTRAL_OPERATOR_GUIDE.md`

Verification completed before this handoff update:

- `git diff --check` passed.

Smallest relevant verification command for this handoff/docs update:

```bash
git diff --check
```

Exact next task:

Follow `docs/AI/DECKPLATING_PLAN.md`, section `Next Task: Managed Hosted Onboarding v1`. Start by reading `docs/AI/DECKPLATING_PLAN.md`, `docs/AI/HANDOFF.md`, `docs/MANAGED_DISTRIBUTION_PLAN.md`, `docs/MANAGED_DISTRIBUTION_ROADMAP.md`, `docs/CONTROLLED_WORKSPACE_ONBOARDING.md`, `docs/CENTRAL_OPERATOR_GUIDE.md`, `netlify/functions/api.ts`, `src/App.tsx`, `src/offline.ts`, and `src/types.ts`. Then implement the smallest guided hosted path where a system administrator can create/approve a command workspace, issue or manage a setup code, and a local lead can visit `deckplating.netlify.app`, activate that workspace, create team members/locations/units, and start using the app without GitHub/Supabase/Netlify exposure. Do not build unrestricted public signup.
