# Pilot Dry Run Checklist

Use this before sending Deckplating to an outside RMT.

## Scope

This is a no-data dry run. Do not create production test data, run migrations against a real pilot database, or submit sensitive feedback.

## Hosted Setup Site

- Open <https://deckplatingsetup.netlify.app>.
- Confirm the page title and brand say **Deckplating**.
- Confirm **Open User Guide** opens <https://deckplatingsetup.netlify.app/user-guide.html>.
- Confirm **Open Feedback Form** jumps to the feedback section.
- Confirm **Open Repository** opens <https://github.com/austingrimesphoto/deckplating>.
- Confirm **Create My App Copy** opens <https://github.com/austingrimesphoto/deckplating/generate>.

## Account Flow

- Confirm Step 1 starts with GitHub.
- Confirm Supabase and Netlify instructions tell users to use GitHub login when available.
- Confirm setup tells users to click **New project** in Supabase.
- Confirm setup tells users to click **Import an existing project** in Netlify.
- Confirm the naming standard uses **Deckplating**, `deckplating`, and `deckplating-your-command`.

## Database Flow

- Confirm the schema/migrations block includes migrations 001 through 004.
- Confirm the starter-data block contains only one example area, one example team member, and one example unit.
- Confirm users are told to run the schema block before the starter-data block.

## Map-Center Flow

- Test one stateside installation name.
- Test one overseas installation name.
- Confirm lookup fills latitude and longitude or clearly tells the user to enter coordinates manually.

## Netlify Flow

- Confirm setup asks for `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, admin passphrase, installation name, latitude, and longitude.
- Confirm generated values are copyable.
- Confirm deploy settings match:
  - Build command: `npm run build`
  - Publish directory: `dist`
  - Functions directory: `netlify/functions`

## User Guide

- Confirm the guide explains:
  - sign-in,
  - Locate Me,
  - manual lookup,
  - confirmation and undo,
  - offline sync,
  - Coverage,
  - Map,
  - Mission Board,
  - Admin,
  - safe-use limits.

## Feedback Form

- Confirm the direct feedback link is <https://deckplatingsetup.netlify.app/#feedback>.
- Confirm pilot dates use start and end date fields.
- Confirm phone type supports multiple choices and an Other field.
- Confirm the form avoids CUI, counseling, medical, personal, or sensitive operational details.
- Submit only a clearly marked non-sensitive test response when intentionally testing Netlify Forms.

## Stop Conditions

Do not hand the pilot to another RMT if:

- the template link fails,
- the setup site is unavailable,
- the user guide is unavailable,
- SQL blocks are stale,
- overseas map lookup silently fails without a manual-coordinate fallback,
- feedback submission is broken,
- safe-use limits are missing or unclear.
