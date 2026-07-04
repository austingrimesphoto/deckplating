# Deckplate Coverage Setup Site

This folder is a separate static onboarding site for beta distribution.

It can be deployed as a public Netlify site that points users to the public Deckplate Coverage template.

## What It Does

- Gives users one guided setup page.
- Links directly to GitHub, Supabase, and Netlify.
- Provides copyable Supabase SQL blocks.
- Generates Netlify environment variables in the browser.
- Looks up an installation/unit map center and includes it in generated variables.
- Gives a deployment and launch checklist.
- Includes a hosted pilot feedback form captured by Netlify Forms.
- Includes a hosted end-user guide for actual app use after setup.

## What It Does Not Do Yet

- It does not create GitHub accounts.
- It does not create repositories automatically.
- It does not create Supabase projects automatically.
- It does not run SQL automatically.
- It does not create Netlify sites automatically.

Those steps would require a hosted app with GitHub, Supabase, and Netlify API/OAuth integrations.

## Pilot Feedback Collection

The setup site can also host a pilot feedback form.

- Direct pilot feedback URL: `https://deckplatingsetup.netlify.app/#feedback`
- Thank-you page: `https://deckplatingsetup.netlify.app/pilot-feedback-thanks.html`
- Submission storage: Netlify Forms for the setup-site deployment

To review submissions, open the Netlify site dashboard for the setup site and check the **Forms** section.

## Hosted User Guide

- User guide URL: `https://deckplatingsetup.netlify.app/user-guide.html`
- Purpose: explain actual app use after setup, including quick start, coverage workflow, map behavior, Mission Board, and admin correction paths

## What The App Owner Needs To Provide

To host this as the public setup path, provide:

- A public Netlify site for this folder.
- The GitHub template repository URL.
- A support email or contact method.
- Optional: a custom domain such as `setup.deckplatecoverage.org`.

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

Send users there first. They can create their own app copy from the public GitHub template.
