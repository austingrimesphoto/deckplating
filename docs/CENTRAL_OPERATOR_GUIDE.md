# Central Operator Guide

This guide is for future managed Deckplating pilots where one centrally hosted app supports multiple approved RMT workspaces.

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

Activation stores only an organization-scoped admin passphrase hash and marks the setup code used.

### 5. Revoke an Unused Setup Code

`POST /api/operator/setup-codes/{setupCodeId}/revoke`

Use this when a code was sent to the wrong recipient, expired operationally, or is no longer needed.

## Operator Guardrails

- Create workspaces only for approved pilot teams.
- Use short setup-code expiration windows.
- Send setup codes directly to the intended local RMT lead.
- Never post setup codes publicly.
- Never use operator access for routine local administration.
- Do not use this flow for CUI, classified information, counseling records, case management, or official records.

## Current Limitations

- This is API groundwork only; there is no polished operator console yet.
- The app still defaults normal users to the configured default organization until full multi-workspace selection is implemented.
- Environment-wide admin fallback still exists for self-hosted beta compatibility.
- Tenant-isolation testing must be completed before any broad managed pilot.
