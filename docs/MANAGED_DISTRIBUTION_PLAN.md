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

Future managed hosting should add an `organizations` or `workspaces` table and treat every customer command/RMT as one workspace. All organization-owned records must include `organization_id`.

Required future schema changes:

- `organizations`
- `organization_id` on `areas`
- `organization_id` on `locations`
- `organization_id` on `units`
- `organization_id` on `team_members`
- `organization_id` on `devices`
- `organization_id` on `checkins`
- `organization_id` on `checkin_batches`
- `organization_id` on future settings
- `organization_id` on future invitations

## Migration Sequence

1. Add `organizations`.
2. Create a default organization for existing single-organization data.
3. Backfill `organization_id` on existing rows.
4. Add not-null constraints and indexes.
5. Update every server API route to enforce organization scope.
6. Introduce invitation/setup flow for controlled onboarding.

## Controlled Pilot Onboarding

- Central admin creates the workspace.
- Central admin sends an invitation/setup code to the local RMT lead.
- Local lead creates roster and local admin access.
- No unrestricted public workspace creation during pilot.

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
