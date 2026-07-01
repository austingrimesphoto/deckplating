# Deckplate Coverage Setup Guide

This is the beta setup path for a chapel team that wants its own copy of Deckplate Coverage.

The goal is simple: each RMT gets its own app, its own database, and its own data. Nobody has to share one giant fleet-wide database.

## What You Need

Create these accounts first:

- GitHub: <https://github.com/signup>
- Supabase: <https://supabase.com/dashboard/sign-up>
- Netlify: <https://app.netlify.com/signup>

Use a command email or shared team account if your local policy allows it. Do not tie the whole app to one person who will PCS.

## Best Beta Path

Use this path if you do not want to touch Terminal. If the project owner has given you a public setup-site URL, start there and use this guide as the backup reference.

1. Make your own GitHub copy.
2. Create a Supabase database.
3. Copy and run two SQL files.
4. Use the browser setup wizard to generate Netlify values.
5. Deploy to Netlify.
6. Open the app and finish setup from the Admin tab.

## Step 1: Make Your Own App Copy

1. Go to the Deckplate Coverage template:
   <https://github.com/austingrimesphoto/deckplate-coverage/generate>
2. If GitHub asks you to sign in, sign in.
3. Under **Owner**, choose your command/team account if available.
4. Name the repository something like `deckplate-coverage`.
5. Choose **Private** unless your command intentionally wants the copy public.
6. Click **Create repository**.

Important: your copy will not automatically receive future updates. That keeps your local tool stable and under your control. Check the original repository's releases when you want to see whether a newer version is available.

## Step 2: Create The Database

1. Go to Supabase projects:
   <https://supabase.com/dashboard/projects>
2. Click **New project**.
3. Pick your organization.
4. Project name: `deckplate-coverage`
5. Create a strong database password and save it somewhere approved.
6. Pick the closest region.
7. Click **Create new project**.

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

Open the setup wizard file from this repository:

[setup-wizard.html](setup-wizard.html)

If GitHub shows it as code instead of a web page:

1. Click **Download raw file**.
2. Open the downloaded `setup-wizard.html` file in Chrome, Edge, Safari, or Firefox.

In the wizard:

1. Paste the Supabase Project URL.
2. Paste the Supabase `service_role` key.
3. Type the admin passphrase you want for your Admin tab.
4. Type your installation or unit name.
5. Click **Look Up Map Center**.
6. Confirm the latitude and longitude look reasonable.
7. Leave map tile fields blank unless you already have a map provider key.
8. Click **Generate Netlify Values**.
9. Click **Copy All**.

Keep this copied text ready. You will paste it into Netlify.

## Step 6: Deploy To Netlify

1. Go to Netlify's import page:
   <https://app.netlify.com/start>
2. Click **Import an existing project**.
3. Choose **GitHub**.
4. Pick your Deckplate Coverage repository.
5. Netlify should read the settings from `netlify.toml`.

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

## Step 7: First Launch

1. Open the Netlify site URL.
2. Select your name.
3. Choose a 4-digit PIN.
4. The first PIN you enter becomes your PIN.
5. Go to **Admin**.
6. Enter the admin passphrase from the setup wizard.
7. Add or edit team members, locations, units, and mapped areas.

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
- Confirm both SQL files were run in Supabase.

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
