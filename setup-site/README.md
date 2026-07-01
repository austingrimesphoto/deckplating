# Deckplate Coverage Setup Site

This folder is a separate static onboarding site for beta distribution.

It can be deployed as a public Netlify site while the main Deckplate Coverage app repository remains private.

## What It Does

- Gives users one guided setup page.
- Links directly to GitHub, Supabase, and Netlify.
- Provides a copyable private-template access request.
- Provides copyable Supabase SQL blocks.
- Generates Netlify environment variables in the browser.
- Gives a deployment and launch checklist.

## What It Does Not Do Yet

- It does not create GitHub accounts.
- It does not create private repositories automatically.
- It does not create Supabase projects automatically.
- It does not run SQL automatically.
- It does not create Netlify sites automatically.

Those steps would require a hosted app with GitHub, Supabase, and Netlify API/OAuth integrations.

## Deploy

Create a separate Netlify site and set:

```text
Base directory: setup-site
Publish directory: setup-site
Build command: leave blank
```

The entry point is `index.html`.

## Suggested Public URL

Use a simple URL such as:

```text
https://deckplate-coverage-setup.netlify.app
```

Send users there first. The private app repository remains the template they request access to.
