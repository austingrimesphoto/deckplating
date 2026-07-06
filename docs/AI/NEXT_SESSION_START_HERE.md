# Next Session Start Here

Use this as the first human/agent handoff page for Deckplating managed pilot work.

## Current Anchor

- Current commit at session start: `7a84f16a97fae5c4af3e8583da811deb2dd91533`
- Branch: `main`
- Last known status before onboarding-launch edits: clean working tree, local `main` ahead of `origin/main` by 10 commits
- Production app: `https://deckplating.netlify.app`
- Setup/support site: `https://deckplatingsetup.netlify.app`
- Live operator entry: `https://deckplating.netlify.app/?operator=1`

## Secret And Data Boundary

Do not print, paste, commit, expose, screenshot, or store:

- plaintext passphrases
- hashes
- setup codes
- service-role keys
- Netlify or Supabase secrets
- production data
- real pilot names, sensitive locations, or operational details

Use only non-sensitive demo data in docs, screenshots, test forms, and examples.

## Current Production Capabilities

The central operator can:

- create workspaces
- delete workspaces and their data
- suspend workspaces
- reactivate workspaces
- issue one-time setup codes
- revoke unused setup codes
- recover a local admin passphrase by setting a temporary replacement
- reset a member PIN and revoke that member's devices
- enter System Administration from `Account` when an operator token exists, or directly with `?operator=1`

Local workspace admins can:

- set/rotate the local admin passphrase from `Admin settings`
- create areas, locations, units, and team members
- hide or complete the onboarding checklist
- reset local member PINs and revoke devices
- correct or void check-ins from Activity Log

## Next Work Queue

1. Review the onboarding-launch diff for confusing pilot wording, Netlify Forms attributes, secret leakage, workspace isolation, and auth boundary regressions.
2. If accepted, deploy `deckplating.netlify.app` and `deckplatingsetup.netlify.app` using the commands below.
3. Onboard the first RMT pilot through workspace request, manual approval, setup-code activation, local setup, and feedback.
4. Return to backend hardening: managed-host admin fallback, stale suspended/deleted workspace UX, live two-organization integration tests, performance review, and reliability.
5. Plan new feature work from actual pilot feedback, not speculation.

## Verification Commands

Run these before commit or deploy:

```bash
npm run test:tenant-isolation
npm run typecheck
npm run build
git diff --check
```

For setup-site-only edits, also run:

```bash
npm run build --prefix setup-site
```

## Deployment Commands

Deploy only after reviewed changes pass verification and the diff has been checked for secrets and auth/workspace boundary regressions.

App production deploy from the root repo linked to `deckplating`:

```bash
npm run build
netlify deploy --prod --dir=dist
```

Setup-site production deploy from the setup-site Netlify project linked to `deckplatingsetup`:

```bash
npm run build --prefix setup-site
netlify deploy --prod --dir=setup-site/dist
```

Do not deploy, change Netlify settings, alter Supabase, or inspect production data unless that deployment/operations step is explicitly requested and the reviewed changes have passed.
