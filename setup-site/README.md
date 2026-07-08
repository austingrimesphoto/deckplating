# Deckplating Setup Site

This folder is a static support site for Deckplating controlled demonstration workspaces.

Published setup site:

```text
https://deckplatingsetup.netlify.app
```

Published demonstration app:

```text
https://deckplating.netlify.app
```

Deckplating is an unofficial open-source prototype. It is not approved by the Department of the Navy or Department of Defense. Do not use it for CUI, classified information, counseling notes, case management, medical details, incident details, family information, sensitive locations, setup codes, passphrases, or official records.

## Site Purpose

- explain the central demonstration instance
- request a controlled demonstration workspace
- provide the user guide
- collect non-sensitive demonstration feedback

New demonstration teams should not need developer accounts, SQL, environment variables, or terminal commands.

## Forms

Workspace request:

- form name: `deckplating-workspace-request`
- entry link: `https://deckplatingsetup.netlify.app/#request`
- thank-you page: `workspace-request-thanks.html`
- notification model: JavaScript submits to `https://deckplating.netlify.app/api/workspace-requests`; Netlify Forms remains a no-JavaScript fallback

Demonstration feedback:

- form name: `deckplating-pilot-feedback`
- entry link: `https://deckplatingsetup.netlify.app/#feedback`
- thank-you page: `pilot-feedback-thanks.html`
- review buckets: onboarding confusion, technical blockers, feature requests, safe-use questions

Do not submit or test forms with secrets, setup codes, passphrases, production data, sensitive names, counseling details, medical details, official records, or sensitive operational locations.

## Deployment

Deploy only after reviewing changes and confirming the form attributes are intact.

```bash
npm --prefix setup-site run build
netlify deploy --prod --dir=setup-site/dist
```
