# Managed Distribution Plan

Deckplating should keep the current React/Vite frontend, Netlify Functions API, Supabase database, and PWA/offline architecture for the next managed-distribution phase. The future target is one centrally hosted multi-organization service, not a platform port before pilot validation.

## Recommendation

Retain the current stack and evolve it into a centrally hosted service after pilot validation. The current PWA/offline model, Netlify Functions boundary, and Supabase schema are already aligned with the product's mobile-first field use.

A platform port is not recommended before pilot validation because it would delay learning, risk breaking offline behavior, and move effort away from the core question: whether RMTs will use this workflow consistently.

## Target User Experience

1. A command chaplain or RMT leader receives one link.
2. They activate an organization workspace using an invitation or setup code.
3. They create the team roster and organization-scoped admin access.
4. Team members open one link, select their roster identity, enter a PIN, and begin using the app.
5. Normal users never need GitHub, Supabase, Netlify, SQL, environment variables, or a terminal.

The current self-hosted template path should remain available as an advanced/local-control option.

## Organization Model

Managed hosting should use an `organizations` or `workspaces` table and treat every customer command/RMT as one workspace. Migration `005_multi_site_foundation.sql` adds the first default-organization groundwork while preserving current single-site behavior.

Required future schema changes:

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

## Migration Sequence

1. Add `organizations`. Done in foundation migration.
2. Create a default organization for existing single-organization data. Done in foundation migration.
3. Backfill `organization_id` on existing rows. Done in foundation migration.
4. Add not-null constraints and indexes. Done for current organization-owned tables.
5. Update every server API route to enforce organization scope. Started for default-organization scope.
6. Replace environment-wide admin access with organization-scoped admin access. Started in migration `006` and API groundwork.
7. Introduce invitation/setup flow for controlled onboarding. Started with setup-code schema, activation endpoint, and protected central-operator API groundwork.

## Controlled Pilot Onboarding

- Central admin creates the workspace.
- Central admin sends an invitation/setup code to the local RMT lead.
- Local lead creates roster and local admin access.
- No unrestricted public workspace creation during pilot.

Current foundation status:

- Setup-code records can exist in the database.
- Protected central-operator API routes can create approved organizations and one-time setup codes when `CENTRAL_OPERATOR_PASSPHRASE_HASH` is configured.
- `POST /api/workspaces/activate` can consume a valid setup code and establish an organization-scoped admin passphrase.
- The app still has no unrestricted public self-service signup and no public workspace creation UI.
- Current self-hosted teams can continue using the environment admin passphrase while optionally setting an organization admin passphrase from Admin Settings.

## Self-Hosted Support

Continue supporting the current template model for teams that require local control, separate infrastructure, or slower update adoption. Managed hosting should be the normal path; self-hosting should be documented as advanced.

## Central Hosting Responsibilities

Central hosting creates real operational responsibilities:

- uptime
- backups
- secrets
- migration rollout
- support
- tenant isolation
- incident response

## Explicit Exclusions

Managed Deckplating must remain outside these use cases:

- no CUI
- no classified data
- no counseling case management
- no official recordkeeping
- no unrestricted public signups
