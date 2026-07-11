# Deckplating Setup Guide

This is the beta setup path for a chapel team that wants its own copy of Deckplating.

The goal is simple: each RMT gets its own app, its own database, and its own data. Nobody has to share one giant fleet-wide database.

Hosted setup site:

<https://deckplatingsetup.netlify.app>

Hosted user guide for daily app use:

<https://deckplatingsetup.netlify.app/user-guide.html>

Before using the app, read the safe-use policy:

[SAFE_USE.md](SAFE_USE.md)

## What You Need

Start with GitHub first. Then use GitHub sign-in for Supabase and Netlify if those sites offer it.

Create or open these accounts:

- GitHub: <https://github.com/signup>
- Supabase: <https://supabase.com/dashboard/sign-up>
- Netlify: <https://app.netlify.com/signup>

Use a command email or shared team account if your local policy allows it. Do not tie the whole app to one person who will PCS.

## Naming Standard

Use **Deckplating** as the app name everywhere users will see it.

Recommended account/project names:

- GitHub repository: `deckplating`
- Supabase project: `deckplating`
- Netlify site: `deckplating` or `deckplating-your-command`
- Hosted setup site: `deckplatingsetup.netlify.app`

Do not use `Deckplate Coverage` for new pages, sites, docs, or pilot messages. Some internal asset filenames may still include `deckplate-coverage`; those are technical file paths and do not need to be renamed for normal users.

If you are helping another RMT test the beta, use this setup guide together with:

- [PILOT_READINESS_GUIDE.md](PILOT_READINESS_GUIDE.md)
- [PILOT_FEEDBACK_TEMPLATE.md](PILOT_FEEDBACK_TEMPLATE.md)
- [USER_GUIDE.md](USER_GUIDE.md)

## Best Beta Path

Use this path if you do not want to touch Terminal. If the project owner has given you a public setup-site URL, start there and use this guide as the backup reference.

Recommended starting point:

<https://deckplatingsetup.netlify.app>

1. Make your own GitHub copy.
2. Create a Supabase database.
3. Copy and run the SQL migration files.
4. Use the browser setup wizard to generate Netlify values.
5. Deploy to Netlify.
6. Open the app and finish setup from the Admin tab.

## Step 1: Make Your Own App Copy

1. Go to the Deckplating template:
   <https://github.com/austingrimesphoto/deckplating/generate>
2. If GitHub asks you to sign in, sign in.
3. Under **Owner**, choose your command/team account if available.
4. Name the repository something like `deckplating`.
5. Choose **Private** unless your command intentionally wants the copy public.
6. Click **Create repository**.

Important: your copy will not automatically receive future updates. That keeps your local tool stable and under your control. Check the original repository's releases when you want to see whether a newer version is available.

## Step 2: Create The Database

1. Go to Supabase projects:
   <https://supabase.com/dashboard/projects>
2. If Supabase offers **Continue with GitHub**, use that sign-in if it matches your command-owned GitHub account.
3. Click **New project**.
4. Pick your organization.
5. Project name: `deckplating`
6. Create a strong database password and save it somewhere approved.
7. Pick the closest region.
8. Click **Create new project**.

Wait until Supabase says the project is ready.

## Step 3: Create The Tables

In Supabase:

1. Open your new project.
2. Click **SQL Editor**.
3. Click **New query**.
4. In your GitHub copy, open `supabase/migrations/001_initial_schema.sql`.
5. Click the copy button or select all the text and copy it.
6. Paste it into Supabase SQL Editor.
7. Click **Run**.

Then run the correction migration:

1. Click **New query** again.
2. In your GitHub copy, open `supabase/migrations/002_checkin_corrections.sql`.
3. Copy the whole file.
4. Paste it into Supabase SQL Editor.
5. Click **Run**.

Then run the offline visit batch migration:

1. Click **New query** again.
2. In your GitHub copy, open `supabase/migrations/003_offline_batches_outcomes_and_hardening.sql`.
3. Copy the whole file.
4. Paste it into Supabase SQL Editor.
5. Click **Run**.

Then run the Mission Board settings migration:

1. Click **New query** again.
2. In your GitHub copy, open `supabase/migrations/004_mission_board_settings.sql`.
3. Copy the whole file.
4. Paste it into Supabase SQL Editor.
5. Click **Run**.

Then run the multi-site foundation migration:

1. Click **New query** again.
2. In your GitHub copy, open `supabase/migrations/005_multi_site_foundation.sql`.
3. Copy the whole file.
4. Paste it into Supabase SQL Editor.
5. Click **Run**.

Then run the organization admin and setup-code migration:

1. Click **New query** again.
2. In your GitHub copy, open `supabase/migrations/006_org_admin_and_invitations.sql`.
3. Copy the whole file.
4. Paste it into Supabase SQL Editor.
5. Click **Run**.

Then run the workspace settings key migration:

1. Click **New query** again.
2. In your GitHub copy, open `supabase/migrations/007_app_settings_workspace_key.sql`.
3. Copy the whole file.
4. Paste it into Supabase SQL Editor.
5. Click **Run**.

Then run the operator audit migration:

1. Click **New query** again.
2. In your GitHub copy, open `supabase/migrations/008_operator_audit_events.sql`.
3. Copy the whole file.
4. Paste it into Supabase SQL Editor.
5. Click **Run**.

Then run the Activity Log search index migration:

1. Click **New query** again.
2. In your GitHub copy, open `supabase/migrations/009_activity_log_search_indexes.sql`.
3. Copy the whole file.
4. Paste it into Supabase SQL Editor.
5. Click **Run**.

Then run the workspace request queue migration:

1. Click **New query** again.
2. In your GitHub copy, open `supabase/migrations/010_workspace_request_queue.sql`.
3. Copy the whole file.
4. Paste it into Supabase SQL Editor.
5. Click **Run**.

Then run the security and reliability hardening migration:

1. Click **New query** again.
2. In your GitHub copy, open `supabase/migrations/011_security_reliability_hardening.sql`.
3. Copy the whole file.
4. Paste it into Supabase SQL Editor.
5. Click **Run** before deploying the matching application build.

Then load starter data:

1. Click **New query** again.
2. In your GitHub copy, open `supabase/seed.sql`.
3. Copy the whole file.
4. Paste it into Supabase SQL Editor.
5. Click **Run**.

This only adds one example area, one example unit, and one example team member. Replace those examples later in the app's Admin tab.

## Step 4: Copy Supabase Values

In Supabase:

1. Click **Project Settings**.
2. Click **API**.
3. Copy the **Project URL**.
4. Copy the **service_role** key.

The `service_role` key is a server secret. Put it only in Netlify environment variables. Do not post it in Teams, email it around, or paste it into screenshots.

## Step 5: Use The Setup Wizard

The hosted setup site is only for requesting a workspace on the central controlled demonstration. Never paste a Supabase service key into that site.

For an authorized self-hosted development deployment, open the setup wizard file from this repository locally:

[setup-wizard.html](setup-wizard.html)

If GitHub shows it as code instead of a web page:

1. Click **Download raw file**.
2. Open the downloaded `setup-wizard.html` file in Chrome, Edge, Safari, or Firefox.

In the wizard:

1. Paste the Supabase Project URL.
2. Paste the Supabase `service_role` key.
3. Type an admin passphrase of at least 12 characters and confirm it.
4. Type your installation or unit name.
5. Click **Look Up Map Center**. This sends only that installation name to OpenStreetMap; credentials stay in the local page.
6. Confirm the latitude and longitude look reasonable. Overseas locations should work too, but enter latitude and longitude manually if lookup still fails.
7. Leave map tile fields blank unless you already have a map provider key.
8. Click **Generate Netlify Values**.
9. Click **Copy All**.

Keep this copied text ready. You will paste it into Netlify.

## Step 6: Deploy To Netlify

1. Go to Netlify's import page:
   <https://app.netlify.com/start>
2. If Netlify offers **Sign in with GitHub**, use that if it matches your command-owned GitHub account.
3. Click **Import an existing project**.
4. Choose **GitHub**.
5. Pick your Deckplating repository.
6. Netlify should read the settings from `netlify.toml`.

Confirm these settings if Netlify asks:

```text
Build command: npm run build
Publish directory: dist
Functions directory: netlify/functions
```

Before the first deploy, add environment variables:

1. In Netlify, open your new site.
2. Click **Site configuration**.
3. Click **Environment variables**.
4. Add each line from the setup wizard.
5. Save.
6. Click **Deploys**.
7. Click **Trigger deploy**.
8. Click **Deploy site**.

Controlled demonstration hosts that use the workspace request approval queue should also set:

- `DECKPLATING_MANAGED_HOST=true`
- `CREDENTIAL_PEPPER` (a separate random secret of at least 32 bytes, function-scoped)
- `CENTRAL_OPERATOR_PASSPHRASE_HASH`
- `DECKPLATING_OPERATOR_EMAIL`
- `DECKPLATING_FROM_EMAIL`
- `RESEND_API_KEY`
- `DECKPLATING_APP_BASE_URL`
- `DECKPLATING_SETUP_SITE_BASE_URL`
- `NOTIFICATION_MODE` (`disabled`, `mailto`, or `provider`)

`NOTIFICATION_MODE` defaults to `disabled`. Use `provider` only with the reviewed Resend provider key and from address, or `mailto` to prepare a draft for the operator without sending automatically. SMTP and Microsoft Graph delivery are not implemented. If the email variables are blank, workspace requests and approvals still work, but notification status is recorded as skipped or failed configuration rather than pretending a message was sent.

## Step 7: First Launch

1. Open the Netlify site URL.
2. Go to **Admin** and enter the admin passphrase from the setup wizard.
3. Add or edit team members, locations, units, and mapped areas.
4. Managed hosts issue each roster member an initial 4-digit PIN from Admin. Deliver it directly; it is shown once.
5. The member selects the workspace and name, enters the issued PIN, and can replace it from **Account**.
6. An unmanaged local-development install may still allow an empty legacy roster entry to claim its first PIN.

## Phone Setup

On iPhone:

1. Open the site in Safari.
2. Tap the Share button.
3. Tap **Add to Home Screen**.
4. Tap **Add**.

On Android:

1. Open the site in Chrome.
2. Tap the menu.
3. Tap **Add to Home screen** or **Install app**.
4. Confirm.

## Offline Use

Open the app once while online before relying on offline mode. That first successful launch caches the app shell and recent coverage data.

The app queues visits offline and syncs automatically when it is open and can reach Deckplating again. Background upload while the app is closed is not guaranteed on every phone.

Look at the sync bar:

- **Online and synced** means nothing is waiting.
- **Offline - cached data** means the app is using the last saved snapshot.
- **X visits waiting to upload** means check-ins are saved on that device.
- **Sync needs PIN refresh** means the user should enter the same 4-digit PIN to refresh the session.
- **Sync failed - retry available** means tap **Sync Now** after connectivity returns.

Optional visit indicators are generic location-visit counts only. They are not tied to specific people, departments, counseling cases, or referral details. Do not enter sensitive information.

## Optional: Local Testing With Terminal

Most teams can skip this section.

Terminal is the text-command app on a computer.

On Mac:

1. Press **Command + Space**.
2. Type `Terminal`.
3. Press **Return**.

On Windows:

1. Click **Start**.
2. Type `PowerShell`.
3. Open **Windows PowerShell**.

Only use this if someone on the team is comfortable with command-line work:

```bash
npm install
npm run setup
netlify dev
```

Optional quality checks for maintainers:

```bash
npm run typecheck
npm run build
npm run test:tenant-isolation
npm run test:ui
```

## What This Beta Wizard Does Not Do Yet

The browser setup wizard helps generate the hard environment values. It does not yet:

- create GitHub accounts
- create Supabase projects
- run SQL in Supabase
- create Netlify sites
- paste environment variables into Netlify for you

A future one-click setup would need a hosted onboarding wizard with GitHub, Supabase, and Netlify authorization. That is possible, but it is a separate product-level project.

## Turnover Checklist

Before a PCS, PRD, or turnover:

- Make sure the command owns the GitHub, Supabase, and Netlify accounts.
- Save the Supabase database password in an approved place.
- Save the Netlify login in an approved place.
- Save the admin passphrase in an approved place.
- Add the relief as an admin/team member before leaving.
- Do not hand off only a personal phone with the app already signed in.

## Troubleshooting

If the app loads but data does not:

- Check Netlify environment variables.
- Confirm the Supabase URL is correct.
- Confirm the `service_role` key was used, not the anon key.
- Confirm all migration files and `seed.sql` were run in Supabase.

If offline mode does not work:

- Open the app once while online before testing offline.
- Confirm the first online launch reached the Check In, Coverage, or Map screen.
- Close and reopen the phone app after reconnecting if queued visits do not sync immediately.
- Use **Sync Now** after reconnecting.

If Mission Board tone will not save:

- Confirm migrations `004` through `011` were run.
- Confirm the Admin tab unlocks with the current admin passphrase.

If the Admin tab will not unlock:

- The admin passphrase must match the hash in `ADMIN_PASSPHRASE_HASH`.
- Use `setup-wizard.html` to generate a fresh hash if needed.

If a user cannot sign in:

- Make sure the team member is active in Admin.
- If they forgot their PIN, create a new team member record or clear/reset the stored `pin_hash` in Supabase.

If the map does not show:

- Basic OpenStreetMap tiles should still work.
- If using a paid map provider, check `MAP_TILE_URL` and `MAP_TILE_KEY`.
- If the map opens in the wrong area, check `MAP_DEFAULT_LATITUDE`, `MAP_DEFAULT_LONGITUDE`, and `INSTALLATION_NAME` in Netlify.
