# Central Operator Guide

This guide is for managed Deckplating pilots where `deckplating.netlify.app` supports multiple approved command workspaces.

It is not public signup. Do not create workspaces for unapproved teams.

Managed dry run status:

- Verified live on `2026-07-05`
- Dry-run notes: `docs/MANAGED_PILOT_DRY_RUN_2026-07-05.md`
- Managed feedback-loop status: `docs/MANAGED_PILOT_FEEDBACK_LOOP.md`

## Enable Operator Access

Set `CENTRAL_OPERATOR_PASSPHRASE_HASH` in the managed host environment.

The value is a SHA-256 hash of the central operator passphrase. Do not reuse the local organization admin passphrase.

Normal self-hosted installs should leave this value blank.

The managed host also needs the normal production values already in place:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_PASSPHRASE_HASH`
- `ADMIN_SESSION_SECRET`
- `MAP_TILE_URL`
- optional `MAP_TILE_KEY`

If `CENTRAL_OPERATOR_PASSPHRASE_HASH` is added or rotated, redeploy the site before testing operator login.

## Operator API Flow

The live host also exposes an in-app operator entry from the workspace setup screen. The API sequence below remains the source of truth and the fallback path for support.

### 1. Log In

`POST /api/operator/login`

```json
{
  "passphrase": "central operator passphrase"
}
```

Returns a short-lived central operator token.

### 2. Create an Approved Workspace

`POST /api/operator/organizations`

```json
{
  "name": "Example RMT",
  "slug": "example-rmt"
}
```

The slug is used as a stable internal label. Keep it short, lowercase, and command-neutral enough to survive minor naming changes.

### 3. Create a One-Time Setup Code

`POST /api/operator/organizations/{organizationId}/setup-codes`

```json
{
  "label": "Example RMT lead setup",
  "purpose": "pilot_setup",
  "expiresInDays": 14
}
```

The response includes the plaintext setup code one time. Send it directly to the local RMT lead with the setup link. Do not store setup codes in docs, screenshots, public chats, or tickets.

Use a workspace link in this form when possible:

```text
https://deckplating.netlify.app/?workspace=example-rmt
```

The app resolves that slug, stores the workspace on the device, and loads the roster/admin context for that workspace.

### 4. Local RMT Lead Activates the Workspace

The local lead uses:

`POST /api/workspaces/activate`

```json
{
  "setupCode": "one-time-code",
  "adminPassphrase": "new local admin passphrase",
  "organizationName": "Optional display name",
  "leadLabel": "Optional lead label"
}
```

Activation stores only an organization-scoped admin passphrase hash and marks the setup code used. The lead can continue directly into guided setup to create the roster, areas, locations, units, and local safe-use posture before any team member identity exists.

### 5. Revoke an Unused Setup Code

`POST /api/operator/setup-codes/{setupCodeId}/revoke`

Use this when a code was sent to the wrong recipient, expired operationally, or is no longer needed.

## Operator Guardrails

- Create workspaces only for approved pilot teams.
- Use short setup-code expiration windows.
- Send setup codes directly to the intended local RMT lead.
- Never post setup codes publicly.
- Never use operator access for routine local administration.
- Use operator access for workspace lifecycle, setup-code state, activity health, access posture, and support visibility.
- Do not use operator access to bypass tenant boundaries or expose one command's operational data to another command.
- Do not use this flow for CUI, classified information, counseling records, case management, or official records.

## Pilot Feedback Loop

The current managed-pilot feedback path is documented in `docs/MANAGED_PILOT_FEEDBACK_LOOP.md`.

Today, feedback collection still uses the hosted Netlify Form on `deckplatingsetup.netlify.app` rather than an in-app entry point on `deckplating.netlify.app`.

## Failure And Recovery Notes

- If `POST /api/operator/login` returns `Central operator access is not configured.`, set `CENTRAL_OPERATOR_PASSPHRASE_HASH` in Netlify production and redeploy.
- If setup-code issuance succeeds but the app does not display a usable code, confirm the site is running the post-`2026-07-05` build that accepts both `code` and `setupCode.code`.
- If activation fails, check whether the setup code is still marked unused. Do not keep issuing codes blindly; capture the activation response first.
- After failed activation attempts, revoke unused setup codes before continuing.
- Confirm readiness from the operator organization summary before handing the site to a wider command audience:
  - area count
  - location count
  - unit count
  - team-member count
  - organization admin configured
  - ready for check-ins
- For CLI support, link the repo to the live Netlify site before using `netlify env:*` or `netlify deploy`.

## Current Limitations

- The operator console is intentionally minimal. It supports workspace creation, setup-code issuance/revocation, and readiness summaries, not full lifecycle management.
- The app can remember one selected workspace per device and can resolve workspace links by slug.
- The app does not provide a full public workspace directory or unrestricted self-service signup.
- Environment-wide admin fallback still exists for self-hosted beta compatibility.
- Static tenant-isolation checks exist; a future live two-workspace integration suite is still recommended before broad managed expansion.
