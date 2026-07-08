# Deckplating

Deckplating is an unofficial open-source prototype for unclassified, non-sensitive Religious Ministry Team coverage awareness. It is not approved by the Department of the Navy or Department of Defense.

Do not use Deckplating for CUI, classified information, sensitive operational data, counseling notes, case management, medical information, incident details, family information, home addresses, phone numbers, dates of birth, passphrases, setup codes, sensitive locations, SCIFs, restricted spaces, deployed operational locations, or official records. Do not use it on government-furnished equipment or government networks unless authorized by local IT/N6.

## What Deckplating Is

Deckplating is a mobile-first web app that helps an RMT see routine coverage by broad area, public/general location, unit, department, division, or tenant command. It supports check-ins, coverage status, search, map views, local admin correction, and a TV dashboard for team awareness.

It is designed to avoid sensitive PII and to minimize low-sensitivity administrative identity/contact data. Team display names and official administrative contact emails, if used, should be limited to what is necessary for access coordination and local accountability.

## Current Status

Current status: technical demonstration. The hosted instance is a central demonstration instance for controlled demonstration workspaces pending local IT/N6, privacy, records, OPSEC, and command guidance.

Deckplating is not approved for operational Navy use unless authorized.

## Safe-Use Boundary

Allowed demonstration data:

- workspace name or local command label, if non-sensitive
- broad area names
- public/general buildings or locations already broadly identifiable
- unit, department, division, or tenant-command names, when not sensitive
- team member display names limited to practical ministry workflow identity, such as rank/last name or role/name
- generic visit/check-in timestamps
- generic coverage status

Prohibited data:

- CUI or classified information
- counseling notes, case-management data, medical details, incident details, family information, or official records
- home addresses, phone numbers, dates of birth, private email addresses, setup codes, passphrases, or screenshots containing those values
- sensitive operational locations, SCIFs, restricted rooms, deployed/theater operational locations, or residences

See [docs/SAFE_USE.md](docs/SAFE_USE.md).

## Not Approved for Operational Navy Use Unless Authorized

Deckplating is not a system of record, counseling record, medical tracker, case-management system, CUI system, classified system, or Navy-approved production application. Use for any real command workflow requires local authorization and review.

## Demonstration Setup

Use the central demonstration instance and setup site for controlled demonstration workspaces:

- App: <https://deckplating.netlify.app>
- Setup/user guidance: <https://deckplatingsetup.netlify.app>
- User guide: <https://deckplatingsetup.netlify.app/user-guide.html>

Workspace approval is manual. There is no open signup. Setup codes are issued only for approved controlled demonstration workspaces.

## Documentation

- [docs/SAFE_USE.md](docs/SAFE_USE.md)
- [docs/USER_GUIDE.md](docs/USER_GUIDE.md)
- [docs/DATA_DICTIONARY.md](docs/DATA_DICTIONARY.md)
- [docs/N6_REVIEW_PACKET.md](docs/N6_REVIEW_PACKET.md)
- [docs/CENTRAL_OPERATOR_GUIDE.md](docs/CENTRAL_OPERATOR_GUIDE.md)
- [docs/ADMINISTRATOR_RUNBOOK.md](docs/ADMINISTRATOR_RUNBOOK.md)
- [docs/OFFLINE_TEST_CHECKLIST.md](docs/OFFLINE_TEST_CHECKLIST.md)
- [docs/MISSION_BOARD_TEST_CHECKLIST.md](docs/MISSION_BOARD_TEST_CHECKLIST.md)

## Development Setup

These instructions are for local development and testing only. They are not instructions to create an operational Navy deployment.

Install dependencies:

```bash
npm install
```

Create a local `.env` file:

```bash
npm run setup
```

Run the app locally with Netlify Functions:

```bash
netlify dev
```

Quality checks:

```bash
npm run typecheck
npm run build
npm run test:tenant-isolation
npm run test:ui
```

Required local development variables:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
ADMIN_PASSPHRASE_HASH
ADMIN_SESSION_SECRET
CENTRAL_OPERATOR_PASSPHRASE_HASH
MAP_TILE_URL
MAP_TILE_KEY
MAP_DEFAULT_LATITUDE
MAP_DEFAULT_LONGITUDE
INSTALLATION_NAME
DECKPLATING_APP_BASE_URL
DECKPLATING_SETUP_SITE_BASE_URL
NOTIFICATION_MODE
NOTIFICATION_FROM
NOTIFICATION_REPLY_TO
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASSWORD
ENABLE_MINISTRY_INDICATORS
VITE_ENABLE_MINISTRY_INDICATORS
```

`NOTIFICATION_MODE` defaults to `disabled`. Supported modes are `disabled`, `mailto`, `smtp`, `provider`, and `graph`. Missing notification variables must not block local development.

`ENABLE_MINISTRY_INDICATORS` and `VITE_ENABLE_MINISTRY_INDICATORS` default to off. Leave them off for Navy-facing demonstrations.
