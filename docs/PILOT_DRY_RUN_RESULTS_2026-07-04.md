# Pilot Dry Run Results - 2026-07-04

## Summary

This dry run tested the public Deckplating handoff path and a full temporary GitHub, Supabase, and Netlify setup.

Result: **passed**.

All temporary external resources were deleted after validation.

## Public Handoff Checks

Passed:

- Hosted setup site loaded:
  - <https://deckplatingsetup.netlify.app>
- Hosted user guide loaded:
  - <https://deckplatingsetup.netlify.app/user-guide.html>
- Hosted feedback thank-you page loaded:
  - <https://deckplatingsetup.netlify.app/pilot-feedback-thanks.html>
- GitHub template repository is public and marked as a template:
  - <https://github.com/austingrimesphoto/deckplating>
- The deployed setup site points to:
  - <https://github.com/austingrimesphoto/deckplating>
  - <https://github.com/austingrimesphoto/deckplating/generate>
- Hosted setup site feedback form used the current form name:
  - `deckplating-pilot-feedback`
- A clearly marked non-sensitive test feedback submission reached the feedback thank-you page.

## Temporary Resources Created

- GitHub repo:
  - `austingrimesphoto/deckplating-dry-run-20260704144527`
- Supabase project:
  - `deckplating-dry-run-20260704144527`
  - Ref: `kpncivxarqzvhqfuhced`
- Netlify site:
  - `deckplating-dry-run-20260704144527`
  - Site ID: `abb9bfb6-27e3-47e1-ac59-3b84328e23f2`

## Database Setup

Passed:

- Created the temporary Supabase project through Supabase CLI.
- Linked a disposable `/tmp` clone of the GitHub template to the temporary Supabase project.
- Applied migrations through Supabase CLI:
  - `001_initial_schema.sql`
  - `002_checkin_corrections.sql`
  - `003_offline_batches_outcomes_and_hardening.sql`
  - `004_mission_board_settings.sql`
- Applied `supabase/seed.sql`.
- Verified starter data:
  - areas: `1`
  - team members: `1`
  - units: `1`
  - locations: `0`

Note: direct `psql` to `db.<project-ref>.supabase.co:5432` failed from this machine because the host resolved to IPv6 and the machine had no route. Supabase CLI linking and `supabase db push --linked` worked.

## Netlify Setup

Passed:

- Created the temporary Netlify site.
- Imported required environment variables.
- Built and deployed the app to production through Netlify CLI.
- Deployed URL was:
  - `https://deckplating-dry-run-20260704144527.netlify.app`

Security note: Netlify CLI printed the temporary Supabase service-role key during `netlify env:import`. The temporary Supabase project was deleted after testing, so that key is no longer valid. Avoid copying real service-role keys into logs or screenshots during real pilot support.

## App Smoke Test

Passed against the temporary deployed app:

- App shell returned HTTP `200`.
- `GET /api/team-members` returned the seeded example team member.
- `POST /api/device/register` succeeded with a temporary PIN.
- `GET /api/bootstrap` succeeded.
- Manual check-in for the seeded unmapped unit succeeded.
- Dashboard endpoint returned HTTP `200`.
- Leaderboard endpoint returned HTTP `200`.
- Leaderboard showed one row with score `3` after the manual check-in.

## Cleanup

Deleted:

- Temporary GitHub repo:
  - `austingrimesphoto/deckplating-dry-run-20260704144527`
- Temporary Supabase project:
  - `kpncivxarqzvhqfuhced`
- Temporary Netlify site:
  - `abb9bfb6-27e3-47e1-ac59-3b84328e23f2`
- Local temp clone and secret files under `/tmp`.

Cleanup verification:

- GitHub repo lookup returned not found.
- Netlify site lookup returned not found.
- Supabase project list no longer included `kpncivxarqzvhqfuhced`.

## Remaining Notes

- The local development setup path is viable for a technically guided beta.
- The biggest user-facing friction remains account creation and copying values between GitHub, Supabase, and Netlify.
- The setup wizard and docs are ready for an outside-team setup attempt.
- For a non-technical broad rollout, the managed-distribution plan is still the right long-term path.
