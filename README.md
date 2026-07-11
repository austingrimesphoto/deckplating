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
npm run validate
npm run test:ui
```

`npm run validate` runs the tooling regression tests, tenant-isolation guard, TypeScript build, production bundle, and setup-site build. The Playwright suite additionally exercises desktop/mobile workflows and requires Chromium (`npx playwright install chromium`).

Core local development variables:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
ADMIN_PASSPHRASE_HASH
ADMIN_SESSION_SECRET
CREDENTIAL_PEPPER
CENTRAL_OPERATOR_PASSPHRASE_HASH
DECKPLATING_MANAGED_HOST
MAP_TILE_URL
MAP_TILE_KEY
MAP_DEFAULT_LATITUDE
MAP_DEFAULT_LONGITUDE
INSTALLATION_NAME
DECKPLATING_APP_BASE_URL
DECKPLATING_SETUP_SITE_BASE_URL
DECKPLATING_ALLOWED_ORIGINS
NOTIFICATION_MODE
NOTIFICATION_FROM
NOTIFICATION_REPLY_TO
NOTIFICATION_PROVIDER_API_KEY
DECKPLATING_OPERATOR_EMAIL
DECKPLATING_FROM_EMAIL
RESEND_API_KEY
ENABLE_MINISTRY_INDICATORS
VITE_ENABLE_MINISTRY_INDICATORS
```

Managed hosting should explicitly set `DECKPLATING_MANAGED_HOST=true`, `CENTRAL_OPERATOR_PASSPHRASE_HASH`, and a dedicated random `ADMIN_SESSION_SECRET` of at least 32 bytes. For backward compatibility, a configured central-operator hash also activates managed-host behavior when the explicit flag is absent. A separate random `CREDENTIAL_PEPPER` of at least 32 bytes is strongly recommended. Without it, the API derives a domain-separated credential pepper from `ADMIN_SESSION_SECRET` and writes `scrypt-v3` credential hashes; with it, the API writes `scrypt-v4` hashes. Successful logins and credential resets upgrade older hashes to the active format, including legacy raw-pepper `scrypt-v2` hashes.

Keep both secrets only in the function environment. Changing or losing `CREDENTIAL_PEPPER` prevents verification of `scrypt-v2` and `scrypt-v4` credentials created with it. Before rotating `ADMIN_SESSION_SECRET` when any `scrypt-v3` credentials may remain, first configure a dedicated pepper and migrate those credentials through successful logins and resets, or plan resets for every remaining credential. Local development can leave managed hosting disabled.

`DECKPLATING_ALLOWED_ORIGINS` optionally adds comma-separated HTTPS origins for reviewed setup-site previews or alternate frontends. The configured app and setup-site origins are always included; arbitrary origins are not allowed.

`NOTIFICATION_MODE` defaults to `disabled`. The implemented modes are `disabled`, `mailto` (prepare an operator-controlled draft), and `provider` (send through the configured Resend-compatible provider key/from address). Unsupported or misspelled values normalize to `disabled`; SMTP and Microsoft Graph delivery are not implemented.

`ENABLE_MINISTRY_INDICATORS` and `VITE_ENABLE_MINISTRY_INDICATORS` default to off. Leave them off for Navy-facing demonstrations.
