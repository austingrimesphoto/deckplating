# Deckplate Coverage Setup Guide

This guide is written for a chapel team that wants its own copy of Deckplate Coverage with its own database.

You do not need to share your data with another installation. Each team gets:

- its own GitHub copy of the app
- its own Supabase database
- its own Netlify website
- its own admin passphrase

## Before You Start

You need accounts for:

- GitHub
- Supabase
- Netlify

Use a command email or shared team account if your local policy allows it. Do not use a personal account if the tool needs to survive turnover.

## The Short Version

1. Make your own GitHub copy of the app.
2. Create a Supabase project.
3. Run the two SQL files in Supabase.
4. Deploy the GitHub copy to Netlify.
5. Paste six environment variables into Netlify.
6. Open the site and set up your team.

## Step 1: Make Your Own App Copy

1. Open the Deckplate Coverage GitHub repository.
2. Click **Use this template**.
3. Click **Create a new repository**.
4. Name it something like `deckplate-coverage-your-installation`.
5. Choose **Private** unless your command intentionally wants the code public.
6. Click **Create repository**.

Important: your copy will not automatically receive future updates. That keeps your local tool stable and under your control. Check the original repository's releases when you want to see whether a newer version is available.

## Step 2: Create The Database

1. Go to Supabase.
2. Click **New project**.
3. Pick an organization.
4. Name the project, for example `deckplate-coverage`.
5. Create a strong database password and save it somewhere approved.
6. Pick the closest region.
7. Click **Create new project**.

Wait for Supabase to finish creating the project.

## Step 3: Create The Tables

1. In Supabase, open your project.
2. Click **SQL Editor**.
3. Click **New query**.
4. Open `supabase/migrations/001_initial_schema.sql` from the GitHub repo.
5. Copy the whole file.
6. Paste it into the Supabase SQL editor.
7. Click **Run**.

Then load starter data:

1. Click **New query** again.
2. Open `supabase/seed.sql` from the GitHub repo.
3. Copy the whole file.
4. Paste it into the Supabase SQL editor.
5. Click **Run**.

You can edit the starter areas, units, and team members later in the Admin tab.

## Step 4: Get Supabase Values

In Supabase:

1. Click **Project Settings**.
2. Click **API**.
3. Copy the **Project URL**.
4. Copy the **service_role** key.

Important: the `service_role` key is a server secret. Put it only in Netlify environment variables or your local `.env` file. Do not paste it into browser code, screenshots, Teams chats, or public documents.

## Step 5: Prepare Environment Variables

If you are testing locally, run:

```bash
npm install
npm run setup
```

The setup helper asks for:

- Supabase Project URL
- Supabase `service_role` key
- Admin passphrase
- Optional map tile URL
- Optional map tile key

It creates `.env` and prints the same values you need to paste into Netlify.

If you are not running locally, use these variable names in Netlify:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
ADMIN_PASSPHRASE_HASH
ADMIN_SESSION_SECRET
MAP_TILE_URL
MAP_TILE_KEY
```

`MAP_TILE_URL` and `MAP_TILE_KEY` may be blank for basic use.

## Step 6: Deploy To Netlify

1. Go to Netlify.
2. Click **Add new site**.
3. Click **Import an existing project**.
4. Choose GitHub.
5. Select your Deckplate Coverage repository.
6. Netlify should read `netlify.toml` automatically.

Confirm these settings:

```text
Build command: npm run build
Publish directory: dist
Functions directory: netlify/functions
```

Before deploying, add environment variables:

1. Open the Netlify site settings.
2. Click **Environment variables**.
3. Add each value from Step 5.
4. Click **Deploy site**.

## Step 7: First Launch

1. Open the Netlify site URL.
2. Select your name.
3. Choose a 4-digit PIN.
4. The first PIN you enter becomes your PIN.
5. Go to **Admin**.
6. Enter the admin passphrase.
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
- Run `npm run setup` locally if you need to generate a fresh hash.

If a user cannot sign in:

- Make sure the team member is active in Admin.
- If they forgot their PIN, create a new team member record or clear/reset the stored `pin_hash` in Supabase.

If the map does not show:

- Basic OpenStreetMap tiles should still work.
- If using a paid map provider, check `MAP_TILE_URL` and `MAP_TILE_KEY`.
