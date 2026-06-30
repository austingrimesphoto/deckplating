# Deckplate Coverage

Minimum viable mobile web app for chapel team coverage tracking across NASKW parent areas, departments, and tenant commands.

## Stack

- React, TypeScript, Vite
- Netlify hosting and Netlify Functions
- Supabase Postgres
- MapLibre GL JS
- Browser calls only `/api/*`; Supabase service-role access stays inside Netlify Functions

## File Structure

```text
src/                         React mobile web app
netlify/functions/api.ts     Single API router for all required /api/* routes
supabase/migrations/         Database schema
supabase/seed.sql            Initial areas, units, and starter team roster
public/manifest.webmanifest  Basic PWA manifest
netlify.toml                 Vite build and /api rewrite config
.env.example                 Required environment variables
```

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Copy environment variables:

```bash
cp .env.example .env
```

3. Fill in `.env`:

```text
SUPABASE_URL=your-project-url
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ADMIN_PASSPHRASE_HASH=sha256-hash-of-shared-passphrase
ADMIN_SESSION_SECRET=random-long-server-side-secret
MAP_TILE_URL=https://your-map-style-url
MAP_TILE_KEY=optional-provider-key
```

`MAP_TILE_URL` may be a full MapLibre style URL. If it is blank, the app uses OpenStreetMap raster tiles for local MVP use.

4. Run locally:

```bash
npm run dev
```

For Netlify Functions locally, use Netlify CLI:

```bash
netlify dev
```

## Supabase Setup

1. Create a Supabase project.
2. Open SQL Editor and run:

```sql
-- paste supabase/migrations/001_initial_schema.sql
```

3. Run the seed data:

```sql
-- paste supabase/seed.sql
```

4. Do not use Supabase Auth for this app.
5. Do not expose the service-role key in browser code. It belongs only in Netlify environment variables.

The schema enables row level security on all tables. The MVP API uses the server-side service-role key through Netlify Functions.

## Admin Passphrase Hash

Create the SHA-256 hash of the shared admin passphrase:

```bash
node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" "your passphrase"
```

Set the output as `ADMIN_PASSPHRASE_HASH`.

## Netlify Deployment

1. Push the repository to GitHub or another Netlify-supported Git provider.
2. Create a Netlify site from the repo.
3. Build command: `npm run build`
4. Publish directory: `dist`
5. Functions directory: `netlify/functions`
6. Add these environment variables in Netlify:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
ADMIN_PASSPHRASE_HASH
ADMIN_SESSION_SECRET
MAP_TILE_URL
MAP_TILE_KEY
```

`netlify.toml` rewrites `/api/*` to the single Netlify Function router while preserving the required route surface.

## API Routes

- `POST /api/device/register`
- `POST /api/device/change-identity`
- `GET /api/bootstrap`
- `GET /api/nearby-locations`
- `POST /api/checkins`
- `GET /api/dashboard`
- `GET /api/leaderboard`
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
- Returning to the app skips name selection.
- Settings identity change requires the current PIN.
- Check In asks for geolocation and finds mapped locations within radius.
- A location with multiple units shows multi-select checkboxes.
- Manual check-in works when no saved location is nearby and stores `geofence_verified=false`.
- Coverage Board groups by parent area and shows green, yellow, red, and gray status correctly.
- Coverage filters work for area, unit type, overdue only, never visited, and date range.
- Map shows pins and translucent radius circles for mapped locations.
- Pin popup shows location, area, radius, units, and last-visit data.
- Admin passphrase unlocks admin screens.
- Admin can create/edit locations, move units, deactivate units, and create team members.
- Leaderboard uses stored `score_awarded` values and monthly filtering.
- Service-role key is absent from built browser assets.
- Netlify deploy serves the app and all `/api/*` routes.
