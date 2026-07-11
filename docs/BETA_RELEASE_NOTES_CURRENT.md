# Current Beta Release Notes

Use this as the draft release note for the current beta build.

## Title

`v0.6.0-beta - Security, reliability, and workflow hardening`

## What's New

- Hardened user, admin, and operator token separation and expiry checks.
- Added persistent authentication throttling, peppered slow credential hashes, administrator-issued PINs, self-service PIN rotation, and device revocation.
- Made workspace approval/rejection, activation, deletion, PIN reset/change, and check-in scoring operations transaction-backed and concurrency-safe.
- Added database-enforced tenant relationships, stricter request validation, sanitized server errors, and immutable check-in batch fingerprints.
- Fixed mobile Coverage collisions, account-switch failure behavior, local-time Mission Board grouping, offline queue recovery, kiosk reauthentication, and map/search lifecycle issues.
- Reduced the install precache and deferred the large map bundle until a map view is opened.
- Added CI, tooling regression checks, setup-site workflow coverage, and desktop/mobile browser tests.

## Who Should Update

- Update before onboarding or continuing any managed-host beta workspace.
- Apply migration `011` before deploying this application build.

## Setup Changes

- Review `docs/SETUP_GUIDE.md`.
- Review `docs/PILOT_READINESS_GUIDE.md` before handing the app to another RMT.
- New local-admin passphrases must contain at least 12 characters.

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
  - `011_security_reliability_hardening.sql`
  - `seed.sql`

## Environment Variable Changes

- Managed hosting requires `DECKPLATING_MANAGED_HOST=true`, a dedicated random `ADMIN_SESSION_SECRET` of at least 32 bytes, and a separate random `CREDENTIAL_PEPPER` of at least 32 bytes.
- Notification delivery defaults to disabled; use only the documented `disabled`, `mailto`, or Resend-compatible `provider` mode.

## Known Issues

- Background upload while the app is fully closed is not guaranteed on every phone.
- GPS accuracy still depends on device permissions and phone settings.
