# Managed Distribution Plan

Deckplating should keep the current React/Vite frontend, Netlify Functions API, Supabase database, and PWA/offline architecture for the next managed-distribution phase. The near-term target is one centrally hosted multi-organization service at `deckplating.netlify.app`, administered centrally during the small-command test phase.

## Recommendation

Retain the current stack and evolve it directly into a centrally hosted service. The current PWA/offline model, Netlify Functions boundary, and Supabase schema are already aligned with the product's mobile-first field use.

A platform port is not recommended before managed hosted validation because it would delay learning, risk breaking offline behavior, and move effort away from the core question: whether commands can onboard and use Deckplating through one tenant-isolated hosted app.

## Target User Experience

1. A command chaplain or RMT leader visits `deckplating.netlify.app`.
2. They choose or activate an approved command workspace using a centrally issued setup code.
3. Guided onboarding prompts them to create local admin access, roster, areas, locations, units, and initial settings.
4. Team members open the same hosted app, choose their command workspace, select their roster identity, enter a PIN, and begin using the app.
5. Normal users never need GitHub, Supabase, Netlify, SQL, environment variables, or a terminal.
6. The system administrator can see workspace status, setup-code state, access posture, and operational health without allowing one command to view another command's data.

The current self-hosted template path should remain available only as an advanced/local-control option.

## Organization Model

Managed hosting uses an `organizations` table and treats every customer command/RMT as one workspace. Migrations `005` through `008` add the multi-site foundation, organization admin credentials/setup codes, workspace-scoped settings uniqueness, and operator audit events while preserving current single-site behavior.

Current schema foundation:

- `organizations` - foundation added in `005_multi_site_foundation.sql`
- `organization_id` on `areas` - foundation added
- `organization_id` on `locations` - foundation added
- `organization_id` on `units` - foundation added
- `organization_id` on `team_members` - foundation added
- `organization_id` on `devices` - foundation added
- `organization_id` on `checkins` - foundation added
- `organization_id` on `checkin_batches` - foundation added
- `organization_id` on settings - foundation added for `app_settings`
- `organization_id` on setup codes/invitations - foundation added in `006_org_admin_and_invitations.sql`
- workspace-scoped settings uniqueness - added in `007_app_settings_workspace_key.sql`
- operator audit events - added in `008_operator_audit_events.sql`

## Migration Sequence

1. Add `organizations`. Done in foundation migration.
2. Create a default organization for existing single-organization data. Done in foundation migration.
3. Backfill `organization_id` on existing rows. Done in foundation migration.
4. Add not-null constraints and indexes. Done for current organization-owned tables.
5. Update every server API route to enforce organization scope. Static tenant-isolation checks cover the current route contracts.
6. Replace environment-wide admin access with organization-scoped admin access. Managed workspace admin login now uses organization credentials or audited superuser entry.
7. Introduce invitation/setup flow for controlled onboarding. Implemented with setup-code schema, activation endpoint, and protected central-operator API groundwork.

## Controlled Managed Onboarding

- System administrator creates or approves each command workspace.
- System administrator sends a workspace link and one-time setup code to the local RMT lead.
- Local lead activates the workspace from the hosted app.
- Local lead completes guided setup for roster, areas, locations, units, local admin access, and safe-use acknowledgment.
- No unrestricted public workspace creation during testing.

Current foundation status:

- Setup-code records can exist in the database.
- Protected central-operator API routes can create approved organizations and one-time setup codes when `CENTRAL_OPERATOR_PASSPHRASE_HASH` is configured.
- `POST /api/workspaces/activate` can consume a valid setup code and establish an organization-scoped admin passphrase.
- The central operator can open an audited superuser admin session scoped to one active workspace for support or quality control.
- The app still has no unrestricted public self-service signup.
- Current self-hosted teams can continue using the environment admin passphrase while optionally setting an organization admin passphrase from Admin Settings. Managed workspace admin login does not accept the environment passphrase when central operator mode is enabled.

## Self-Hosted Support

Continue supporting the current template model for teams that require local control, separate infrastructure, formal handoff, or slower update adoption. Managed hosting should be the normal path; self-hosting should be documented as advanced.

## Central Hosting Responsibilities

Central hosting creates real operational responsibilities:

- uptime
- backups
- secrets
- migration rollout
- support
- tenant isolation
- incident response
- workspace lifecycle administration
- operator auditability

## Explicit Exclusions

Managed Deckplating must remain outside these use cases:

- no CUI
- no classified data
- no counseling case management
- no official recordkeeping
- no unrestricted public signups
