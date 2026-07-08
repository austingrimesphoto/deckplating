# Current Beta Release Notes

Use this as the draft release note for the current beta build.

## Title

`v0.5.0-beta - Mission Board, pilot readiness, and multi-site foundation`

## What's New

- Added Mission Board engagement features built around meaningful coverage rather than raw visit volume.
- Added weekly winners and selected-month winners to the Mission Board.
- Added a managed workspace request approval queue for System Administration.
- Added Mission Brief nudges, compact badge rewards, and in-confirmation achievement cards.
- Added pilot handoff, feedback, and Mission Board validation documents.
- Added the first multi-site foundation migration with a default organization for current single-site installs.
- Added organization-scoped admin credential and setup-code schema groundwork.
- Updated the setup-site SQL block so new beta teams get the current schema support through Mission Board settings and multi-site groundwork.

## Who Should Update

- Update if you are starting a fresh beta team or preparing an outside-team pilot.
- Update if you want Mission Board nudges, badge display, and current pilot documentation.
- No urgent action is required if your current setup is working and you are not onboarding new testers yet.

## Setup Changes

- Review `docs/SETUP_GUIDE.md`.
- Review `docs/PILOT_READINESS_GUIDE.md` before handing the app to another RMT.
- The setup-site SQL block now reflects the current beta schema support.

## Database Changes

- Current beta schema expects:
  - `001_initial_schema.sql`
  - `002_checkin_corrections.sql`
  - `003_offline_batches_outcomes_and_hardening.sql`
  - `004_mission_board_settings.sql`
  - `005_multi_site_foundation.sql`
  - `006_org_admin_and_invitations.sql`
  - `007_app_settings_workspace_key.sql`
  - `008_operator_audit_events.sql`
  - `009_activity_log_search_indexes.sql`
  - `010_workspace_request_queue.sql`
  - `seed.sql`

## Environment Variable Changes

- Managed workspace request emails use `DECKPLATING_OPERATOR_EMAIL`, `DECKPLATING_FROM_EMAIL`, and `RESEND_API_KEY`.
- Email links can be controlled with `DECKPLATING_APP_BASE_URL` and `DECKPLATING_SETUP_SITE_BASE_URL`.

## Known Issues

- Background upload while the app is fully closed is not guaranteed on every phone.
- GPS accuracy still depends on device permissions and phone settings.
