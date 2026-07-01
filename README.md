# Deckplate Coverage

Deckplate Coverage is a mobile web app for installation Religious Ministry Teams to track command coverage, map unit locations, log visits, and see which departments or tenant commands need attention.

It is designed to be copied by each RMT. Every team should run its own Netlify site and its own Supabase database, so no one has to manage one giant fleet-wide database.

## Start Here

For a plain-English, button-by-button setup walkthrough, use:

[docs/SETUP_GUIDE.md](docs/SETUP_GUIDE.md)

That guide is the one to hand to a chaplain, RP, or command teammate who just needs to get the tool running. It is written around a no-terminal beta setup path.

The beta browser helper is here:

[docs/setup-wizard.html](docs/setup-wizard.html)

## Share This With Another RMT

Send them the GitHub repository link and tell them to start with this README.

Recommended message:

```text
Deckplate Coverage setup starts here:
https://github.com/austingrimesphoto/deckplate-coverage

Open the README and follow docs/SETUP_GUIDE.md.
Click "Use this template" to create your own copy.
```

Because this repository is private, they need GitHub access before the link works. If they see a 404, add their GitHub username to the approved access list.

The owner of this repository should enable GitHub's template setting:

1. Open this repository on GitHub.
2. Click **Settings**.
3. Click **General**.
4. Check **Template repository**.
5. Save.

Each RMT should create its own copy from the template, then connect that copy to its own Netlify site and Supabase database.

## Getting Updates

Copies made with **Use this template** do not automatically receive updates from this repository. That is intentional: each installation owns its own app and database.

Recommended update process:

1. This project publishes named versions such as `v1.0.0`, `v1.1.0`, and `v1.2.0`.
2. Each release includes short notes explaining what changed.
3. Teams can decide when to update their own copy.
4. Early teams may choose to create a fresh copy from the latest template if they have not entered much data yet.

For now, keep updates simple: publish releases, write clear release notes, and avoid forcing changes onto other teams automatically.

## What Each Team Gets

- A private app deployment on Netlify
- A separate Supabase database
- A phone-friendly installable web app
- A local admin passphrase
- Name + PIN sign-in for team members
- Protected app data behind signed user sessions

## Fast Local Setup

Most users should skip this and use [docs/SETUP_GUIDE.md](docs/SETUP_GUIDE.md). This section is only for someone who wants to run the app on their own computer before deploying.

Install dependencies:

```bash
npm install
```

Create a local `.env` file:

```bash
npm run setup
```

Run the app with Netlify Functions:

```bash
netlify dev
```

Open the local URL Netlify prints, usually:

```text
http://localhost:8888
```

## Required Services

Each installation needs accounts for:

- GitHub, to hold that team's copy of the app: <https://github.com/signup>
- Supabase, to hold that team's database: <https://supabase.com/dashboard/sign-up>
- Netlify, to host that team's website and API functions: <https://app.netlify.com/signup>

## Required Environment Variables

These are needed locally in `.env` and in Netlify environment variables:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
ADMIN_PASSPHRASE_HASH
ADMIN_SESSION_SECRET
MAP_TILE_URL
MAP_TILE_KEY
```

`npm run setup` generates `ADMIN_PASSPHRASE_HASH` and `ADMIN_SESSION_SECRET` for local use. Use the same values in Netlify.

`MAP_TILE_URL` and `MAP_TILE_KEY` may be blank for basic use.

## Supabase Setup

Run these files in Supabase SQL Editor, in order:

1. `supabase/migrations/001_initial_schema.sql`
2. `supabase/seed.sql`

The schema enables row level security on all tables. Browser code never talks directly to Supabase. All database access goes through Netlify Functions using the server-side service-role key.

## Netlify Deployment

Netlify reads `netlify.toml`.

Expected settings:

```text
Build command: npm run build
Publish directory: dist
Functions directory: netlify/functions
```

After deployment, open the site on a phone and use **Add to Home Screen**.

## Security Model

- Public users can only load the minimal team-member name list needed for sign-in.
- Full app data requires a signed user session.
- Users get a session by selecting their name and entering their PIN.
- Check-ins require both a valid session and a registered device token.
- Admin create/edit routes require the admin passphrase session.
- Supabase service-role access stays inside Netlify Functions.

This is not a DoD enterprise identity system. It is a practical self-hosted app gate for local RMT use.

## File Structure

```text
src/                         React mobile web app
netlify/functions/api.ts     API router for /api/* routes
supabase/migrations/         Database schema
supabase/seed.sql            Starter areas, units, and team roster
public/                      PWA icons, manifest, background assets
scripts/setup.mjs            Local setup helper
docs/SETUP_GUIDE.md          Non-technical deployment guide
netlify.toml                 Build and API rewrite config
.env.example                 Environment variable names
```

## API Routes

Public:

- `GET /api/team-members`
- `POST /api/device/register`

User-session protected:

- `POST /api/device/change-identity`
- `GET /api/bootstrap`
- `GET /api/nearby-locations`
- `POST /api/checkins`
- `GET /api/dashboard`
- `GET /api/leaderboard`

Admin-session protected:

- `POST /api/admin/login`
- `GET /api/admin/locations`
- `POST /api/admin/locations`
- `PATCH /api/admin/locations/:id`
- `POST /api/admin/units`
- `PATCH /api/admin/units/:id`
- `POST /api/admin/team-members`
- `PATCH /api/admin/team-members/:id`

## Test Checklist

- First launch shows active team member roster.
- Selecting a name with a 4-digit PIN registers a device and stores identity locally.
- Returning to the app skips name selection when the saved session is valid.
- Protected API routes return `403` without a signed user session.
- Settings identity change requires the current PIN.
- Check In asks for geolocation and finds mapped locations within radius.
- Manual check-in works when no saved location is nearby.
- Coverage Board groups by parent area and shows green, yellow, red, and gray status correctly.
- Map shows pins and radius circles for mapped locations.
- Admin passphrase unlocks admin screens.
- Admin can create/edit locations, move units, deactivate units, and create team members.
- Leaderboard uses stored `score_awarded` values and monthly filtering.
- Service-role key is absent from built browser assets.
- Netlify deploy serves the app and all `/api/*` routes.
