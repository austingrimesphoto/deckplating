# Central Operator Guide

This guide is for managed Deckplating pilots where `deckplating.netlify.app` supports multiple approved command workspaces.

It is not public signup. Do not create workspaces for unapproved teams.

## Enable Operator Access

Set `CENTRAL_OPERATOR_PASSPHRASE_HASH` in the managed host environment.

The value is a SHA-256 hash of the central operator passphrase. Do not reuse the local organization admin passphrase.

Normal self-hosted installs should leave this value blank.

## Operator API Flow

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

## Current Limitations

- This is API and app-entry groundwork only; there is no polished operator console yet.
- The app can remember one selected workspace per device and can resolve workspace links by slug.
- The app does not yet provide a full public workspace directory or unrestricted self-service signup.
- Guided workspace setup needs to become the normal first-run flow for local command leads.
- Environment-wide admin fallback still exists for self-hosted beta compatibility.
- Static tenant-isolation checks exist; a future live two-workspace integration suite is still recommended before broad managed expansion.
