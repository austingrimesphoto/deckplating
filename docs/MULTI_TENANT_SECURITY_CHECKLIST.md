# Multi-Tenant Security Checklist

Use this checklist before any managed multi-organization pilot.

- Every API request derives organization scope from the authenticated session, not client-provided organization IDs.
- Every database query filters by `organization_id`.
- Every mutation verifies all referenced records belong to the same organization.
- No cross-workspace UUID lookup can reveal data.
- Service-role database access stays server-side only.
- Row level security remains enabled as defense in depth, even though server functions use service role.
- Organization-scoped admin authentication replaces the single environment-wide admin passphrase before managed production.
- During foundation rollout, the environment admin passphrase may remain only as a self-hosted/default-organization fallback.
- Device identity is scoped to organization and member.
- PIN hashing includes organization context.
- Offline IndexedDB data is scoped and cleared safely when a device changes organizations.
- Logging avoids sensitive visit, location, or counseling information.
- Automated tenant-isolation tests are required before managed pilots.
- Backup, restore, export, and deletion boundaries are organization-specific.

## API Review Requirements

For every route:

- Identify how organization scope is derived.
- Confirm all select/update/insert/delete operations include organization scope.
- Confirm referenced IDs are validated inside the same organization.
- Confirm error responses do not reveal whether another organization's UUID exists.

## Admin And Setup-Code Review Requirements

- Organization admin passphrase hashes include organization context.
- Setup codes are stored only as hashes.
- Setup codes are single-use or explicitly revocable.
- Setup-code activation cannot create unrestricted public workspaces.
- Environment admin fallback is disabled before centrally hosted managed production.
- Organization admin tokens carry organization scope and never accept client-provided organization scope for data access.

## Offline Review Requirements

Before managed pilots:

- Include organization ID in cached bootstrap metadata.
- Partition pending batches by organization and team member.
- Block identity changes across organizations while pending batches exist.
- Clear cached organization data only with explicit user action or successful organization switch.
- Never store PINs, admin passphrases, service-role keys, or sensitive visit content in browser storage.
