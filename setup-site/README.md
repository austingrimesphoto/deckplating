# Deckplating Setup Site

This folder is a separate static support site for managed Deckplating pilots.

Primary public URL:

```text
https://deckplatingsetup.netlify.app
```

Primary app URL:

```text
https://deckplating.netlify.app
```

## Current Purpose

The setup site now supports the centrally managed pilot flow:

- explain that pilots use `deckplating.netlify.app`
- collect workspace/account requests through Netlify Forms
- explain the manual approval path
- link to the hosted user guide
- collect pilot feedback during setup, week one, urgent blockers, and closeout

New managed-pilot teams should not need GitHub, Supabase, Netlify, SQL, environment variables, or terminal commands.

## Forms

Workspace requests:

- form name: `deckplating-workspace-request`
- entry link: `https://deckplatingsetup.netlify.app/#request`
- thank-you page: `workspace-request-thanks.html`
- notification model: manual review, then the operator manually contacts the approved lead with the workspace link and one-time setup code

Pilot feedback:

- form name: `deckplating-pilot-feedback`
- entry link: `https://deckplatingsetup.netlify.app/#feedback`
- thank-you page: `pilot-feedback-thanks.html`
- review buckets: onboarding confusion, operational blockers, feature requests

Do not submit or test forms with secrets, setup codes, passphrases, real production data, sensitive names, counseling details, medical details, or sensitive operational locations.

## Hosted User Guide

- User guide URL: `https://deckplatingsetup.netlify.app/user-guide.html`
- Screenshot assets: `assets/screenshots/`
- Purpose: explain actual app use after approval, including workspace selection, activation, name/PIN, check-in, coverage, map, Mission Board, local admin setup, account switching, feedback, and safe-use boundaries.

## Advanced Self-Hosted Path

Self-hosted deployment remains an advanced/local-control option in the main repository docs. It is no longer the first path presented on this setup site.

Use the main repo documentation when a team intentionally needs local control:

- `docs/SETUP_GUIDE.md`
- `README.md`
- `supabase/migrations/`
- `supabase/seed.sql`

## Build

This site is static. The build copies HTML and assets into `dist`.

```bash
npm run build --prefix setup-site
```

## Deploy

Deploy only after reviewing changes and confirming the Netlify Forms attributes are intact.

Recommended setup-site deployment command from the repo root when the Netlify CLI is linked to the setup-site project:

```bash
npm run build --prefix setup-site
netlify deploy --prod --dir=setup-site/dist
```

Do not deploy from the app project link by accident. The app project is `deckplating`; the setup-site project is `deckplatingsetup`.
