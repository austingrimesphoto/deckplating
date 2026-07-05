# Controlled Workspace Onboarding

Use this blueprint for centrally hosted Deckplating pilots at `deckplating.netlify.app`.

This is not public self-service signup. The system administrator creates or approves each command workspace before a local RMT lead can activate it.

## Current Foundation

Migration `006_org_admin_and_invitations.sql` adds:

- `organization_admin_credentials`
- `organization_setup_codes`

The API adds:

- `POST /api/operator/login`
- `GET /api/operator/organizations`
- `POST /api/operator/organizations`
- `POST /api/operator/organizations/:id/setup-codes`
- `POST /api/operator/setup-codes/:id/revoke`
- `GET /api/workspaces/resolve`
- `POST /api/workspaces/activate`
- `POST /api/admin/organization-admin/passphrase`

Current self-hosted teams can keep using the environment admin passphrase. Organization admin passphrases are the normal local admin model for managed hosting.

See `docs/CENTRAL_OPERATOR_GUIDE.md` for the protected operator workflow.

## Intended Flow

1. System administrator creates or approves a command workspace.
2. System administrator creates a one-time setup code for that workspace.
3. System administrator sends the `deckplating.netlify.app` workspace link and code to the local RMT lead.
4. Local RMT lead activates the workspace with the code.
5. Local RMT lead creates the organization admin passphrase.
6. Guided onboarding prompts the lead to create roster, areas, locations, units, and safe-use acknowledgment.
7. Team members open `deckplating.netlify.app`, select the command workspace, select their name, set a PIN, and use the app.

The system administrator keeps overhead visibility into workspace status, setup-code state, activity health, and access posture. Command data remains tenant-scoped and must not be visible across workspaces.

Workspace links may include `?workspace=workspace-slug`. The browser stores the selected workspace locally so roster selection, device registration, admin login, and cached bootstrap data stay attached to that workspace.

## Current API Contract

### Central Operator Login

`POST /api/operator/login`

Body:

```json
{
  "passphrase": "central operator passphrase"
}
```

Behavior:

- Disabled unless `CENTRAL_OPERATOR_PASSPHRASE_HASH` is configured.
- Uses a separate central operator passphrase, not a local organization admin passphrase.
- Returns a short-lived central operator token.

### Create Organization

`POST /api/operator/organizations`

Body:

```json
{
  "name": "Example RMT",
  "slug": "example-rmt"
}
```

Behavior:

- Requires a central operator token.
- Creates an approved workspace.
- Does not create roster, locations, units, or local admin credentials.

### Create Setup Code

`POST /api/operator/organizations/{organizationId}/setup-codes`

Body:

```json
{
  "label": "Example RMT lead setup",
  "purpose": "pilot_setup",
  "expiresInDays": 14
}
```

Behavior:

- Requires a central operator token.
- Stores only the setup-code hash.
- Returns the plaintext setup code only once.
- Supports revocation through `POST /api/operator/setup-codes/{setupCodeId}/revoke`.

### Activate Workspace

`POST /api/workspaces/activate`

Body:

```json
{
  "setupCode": "one-time-code",
  "adminPassphrase": "new local admin passphrase",
  "organizationName": "Optional RMT name",
  "leadLabel": "Optional local lead label"
}
```

Behavior:

- Requires a valid active setup code hash in `organization_setup_codes`.
- Rejects expired or already-used codes.
- Stores only an organization-scoped admin passphrase hash.
- Marks the setup code used.
- Returns an organization-scoped admin token.
- Lets the local lead continue directly into guided setup before any roster identities exist.

### Set Organization Admin Passphrase

`POST /api/admin/organization-admin/passphrase`

Body:

```json
{
  "passphrase": "new local admin passphrase"
}
```

Behavior:

- Requires an existing admin token.
- Stores only an organization-scoped admin passphrase hash.
- Does not store the passphrase itself.
- Allows current self-hosted installs to transition away from environment-only admin access later.

## Setup Code Storage

Setup codes must never be stored in plaintext.

The current hash formula is:

```text
sha256("setup-code:" + setupCode.trim())
```

The setup code table stores:

- code hash,
- organization ID,
- label,
- purpose,
- expiration time,
- used time,
- optional used-by label.

## System Administrator Responsibilities

- Create only approved pilot workspaces.
- Send codes directly to the correct local RMT lead.
- Set expiration dates.
- Revoke unused codes that are no longer needed.
- Do not post setup codes in public docs, screenshots, group chats, or tickets.
- Do not allow unrestricted public workspace creation.
- Monitor workspace activation and basic activity health.
- Maintain support, backup, migration, and incident-response posture while the service is centrally operated.

## Future Work

Still needed before managed hosted pilots:

- guided workspace onboarding after activation,
- central administrator visibility into workspace status and activity health,
- organization admin session refresh behavior,
- removal or disabling of environment admin fallback in managed production,
- organization-scoped backup/export/delete operations.
