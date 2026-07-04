# Deckplating

Deckplating is a mobile web app for installation Religious Ministry Teams to track command coverage, map unit locations, log visits, and see which departments, divisions, or tenant commands need attention.

It is designed to be copied by each RMT. Every team should run its own Netlify site and its own Supabase database, so no one has to manage one giant fleet-wide database.

## Start Here

Preferred beta distribution path:

1. Send users to the public setup site: <https://deckplatingsetup.netlify.app>
2. They create their own app copy from the public template.
3. They follow the hosted setup wizard.

Hosted setup site:

<https://deckplatingsetup.netlify.app>

The setup site source lives in:

[setup-site/](setup-site/)

For a plain-English, button-by-button setup walkthrough, use:

[docs/SETUP_GUIDE.md](docs/SETUP_GUIDE.md)

For the actual end-user guide after setup, use:

[docs/USER_GUIDE.md](docs/USER_GUIDE.md)

Hosted version:

<https://deckplatingsetup.netlify.app/user-guide.html>

That guide is the one to hand to a chaplain, RP, or command teammate who just needs to get the tool running. It is written around a no-terminal beta setup path.

Offline release validation checklist:

[docs/OFFLINE_TEST_CHECKLIST.md](docs/OFFLINE_TEST_CHECKLIST.md)

Mission Board validation checklist:

[docs/MISSION_BOARD_TEST_CHECKLIST.md](docs/MISSION_BOARD_TEST_CHECKLIST.md)

Pilot readiness guide:

[docs/PILOT_READINESS_GUIDE.md](docs/PILOT_READINESS_GUIDE.md)

Pilot dry-run checklist:

[docs/PILOT_DRY_RUN_CHECKLIST.md](docs/PILOT_DRY_RUN_CHECKLIST.md)

Latest dry-run results:

[docs/PILOT_DRY_RUN_RESULTS_2026-07-04.md](docs/PILOT_DRY_RUN_RESULTS_2026-07-04.md)

Pilot feedback template:

[docs/PILOT_FEEDBACK_TEMPLATE.md](docs/PILOT_FEEDBACK_TEMPLATE.md)

Pilot invitation message:

[docs/PILOT_INVITATION_MESSAGE.md](docs/PILOT_INVITATION_MESSAGE.md)

Current beta release notes draft:

[docs/BETA_RELEASE_NOTES_CURRENT.md](docs/BETA_RELEASE_NOTES_CURRENT.md)

Safe-use policy:

[docs/SAFE_USE.md](docs/SAFE_USE.md)

The beta browser helper is here:

[docs/setup-wizard.html](docs/setup-wizard.html)

## Share This With Another RMT

Send them the hosted setup site first. Use the GitHub repository as the source of truth and backup reference.

Recommended message:

```text
Deckplating setup starts here:
https://deckplatingsetup.netlify.app

How to use the app after setup:
https://deckplatingsetup.netlify.app/user-guide.html

If you need the full source or backup instructions:
https://github.com/austingrimesphoto/deckplating
```

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
MAP_DEFAULT_LATITUDE
MAP_DEFAULT_LONGITUDE
INSTALLATION_NAME
```

`npm run setup` generates `ADMIN_PASSPHRASE_HASH` and `ADMIN_SESSION_SECRET` for local use. Use the same values in Netlify.

`MAP_TILE_URL` and `MAP_TILE_KEY` may be blank for basic use.

`MAP_DEFAULT_LATITUDE`, `MAP_DEFAULT_LONGITUDE`, and `INSTALLATION_NAME` set the first map center for a new installation.

## Supabase Setup

Run these files in Supabase SQL Editor, in order:

1. `supabase/migrations/001_initial_schema.sql`
2. `supabase/migrations/002_checkin_corrections.sql`
3. `supabase/migrations/003_offline_batches_outcomes_and_hardening.sql`
4. `supabase/migrations/004_mission_board_settings.sql`
5. `supabase/seed.sql`

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

## Offline Mode

Deckplating needs one successful online launch before offline use. That first launch installs the app shell and caches recent coverage data on the device.

The app queues visits offline and syncs automatically when it is open and can reach Deckplating again. Background upload while the app is closed is not guaranteed on every phone.

The sync bar shows:

- **Online and synced**: no queued visits remain.
- **Offline - cached data**: cached coverage is being used.
- **X visits waiting to upload**: local visit batches are pending.
- **Sync needs PIN refresh**: enter the existing 4-digit PIN to refresh the session without losing queued visits.
- **Sync failed - retry available**: use **Sync Now** after checking connectivity.

Queued visits stay on the device until they sync or are undone locally before upload.

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
public/                      Installable app icons, manifest, background assets
scripts/setup.mjs            Local setup helper
docs/SETUP_GUIDE.md          Non-technical deployment guide
docs/PILOT_READINESS_GUIDE.md Outside-team pilot handoff guide
setup-site/                  Public static onboarding wizard
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
- `POST /api/checkins/undo`
- `PATCH /api/checkin-batches/:clientBatchId/indicators`
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
- `GET /api/admin/checkins`
- `PATCH /api/admin/checkins/:id`
- `GET /api/admin/settings`
- `PATCH /api/admin/settings`

## Test Checklist

- First launch shows active team member roster.
- First online launch installs the phone app/service worker and caches the app shell.
- Selecting a name with a 4-digit PIN registers a device and stores identity locally.
- Returning to the app skips name selection when the saved session is valid.
- Protected API routes return `403` without a signed user session.
- Settings identity change requires the current PIN.
- After one successful online launch, disable network and reload the app.
- Cached coverage board loads with clear last-synced status.
- Check In asks for geolocation and finds mapped locations within radius.
- Nearby check-in works from cached location data.
- Manual check-in works when no saved location is nearby.
- Manual check-in works offline and keeps one location per visit batch.
- Offline visit survives app close/reopen.
- Reconnecting and syncing creates exactly one visit batch and correct unit check-ins.
- Repeated sync attempts do not duplicate check-ins or points.
- Offline indicator selections upload with the matching visit batch.
- A user can ignore optional indicators and immediately leave the confirmation screen.
- Checked indicators save automatically without a second submit button.
- Indicator values remain generic location-level data and are not duplicated across selected units.
- A queued offline visit can be undone locally before upload.
- Immediate undo removes a new check-in from coverage and leaderboard calculations.
- Uploaded undo rejects check-ins older than 15 minutes.
- Coverage Board groups by parent area and shows green, yellow, red, and gray status correctly.
- Map shows pins and radius circles for mapped locations.
- Admin passphrase unlocks admin screens.
- A voided record is visible only when Admin Activity Log includes voided records.
- Correcting a unit updates its linked location and clears geofence verification.
- Admin date/time and team-member edits zero score.
- Safe-use notices appear on identity selection, Settings, and Admin location editing.
- No PIN is stored outside the user’s typed-entry flow.
- No authenticated API responses are stored in service-worker Cache Storage.
- Existing identity, map, coverage board, admin location editing, and Mission Board still work.
- Admin can create/edit locations, move units, deactivate units, and create team members.
- Mission Board uses stored `score_awarded` values, active check-ins only, monthly filtering, recovered-unit credit, distinct-unit credit, and computed badges.
- Mission Brief appears once per local day, collapses, and does not block app controls.
- Admin can switch Mission Board tone between Professional, Friendly, and Deckplate Banter.
- Tone-controlled nudges remain curated local text and do not shame individual users.
- Pilot readiness and feedback docs are current before sharing with an outside RMT.
- Service-role key is absent from built browser assets.
- Netlify deploy serves the app and all `/api/*` routes.
