# Tenant Isolation Review

This review covers the API and offline paths hardened for the managed multi-organization pilot gate. The executable companion check is:

```bash
npm run test:tenant-isolation
```

## Scope Model

- Public workspace/setup routes may accept a workspace slug, organization UUID, or setup code because no session exists yet.
- User routes derive organization scope from the signed user token created during device registration.
- Admin routes derive organization scope from the signed admin token created during workspace activation, admin login, or audited superuser operator entry.
- Operator routes are global management routes and require the central operator token.

## Route Review

| Route | Scope source | Isolation notes |
| --- | --- | --- |
| `POST /operator/login` | Central operator passphrase hash | Issues only a central operator token; no organization data returned. |
| `GET /operator/organizations` | Central operator token | Returns organization and setup-code metadata only; stored setup-code hashes and admin credential hashes are not selected. |
| `POST /operator/organizations` | Central operator token | Creates organization records only. |
| `POST /operator/organizations/:id/admin-session` | Central operator token plus organization path ID | Verifies the target workspace is active, records an operator audit event, and returns an admin token scoped only to that workspace. |
| `POST /operator/organizations/:id/setup-codes` | Central operator token plus organization path ID | Verifies the target organization exists and is active; returns the generated setup code once, never the stored hash. |
| `POST /operator/setup-codes/:id/revoke` | Central operator token | Revokes unused setup codes without returning hashes. |
| `GET /workspaces/resolve` | Client-provided slug or organization UUID | Public discovery returns only active workspace summary. |
| `POST /workspaces/activate` | Setup code hash | Rejects invalid, expired, used, or revoked setup codes; stores only organization-scoped admin credential hash and marks the setup code used. |
| `GET /team-members` | Client-selected active workspace | Public pre-login roster is scoped to the selected active workspace. |
| `POST /device/register` | Client-selected active workspace | Validates active team member inside that workspace, stores device with organization scope, and issues a signed user token carrying organization scope. PIN hashes are organization-scoped with legacy beta hash upgrade on successful use. |
| `POST /device/change-identity` | Signed user token | Verifies current user and PIN in the token organization, disables the device only in that organization, and re-registers against the same organization. |
| `GET /bootstrap` | Signed user token | Loads roster, coverage, settings, and organization summary using token organization scope. |
| `GET /nearby-locations` | Signed user token | Uses token-scoped coverage only. |
| `POST /checkins` | Signed user token | Validates device, requested units, idempotency batch, scoring history, and inserted check-ins inside the token organization. |
| `POST /checkins/undo` | Signed user token | Can void only the current user's active check-ins inside the token organization. |
| `PATCH /checkin-batches/:clientBatchId/indicators` | Signed user token | Looks up and updates the batch inside the token organization, then verifies team member and device ownership. |
| `GET /dashboard` | Signed user token | Uses token-scoped coverage only. |
| `GET /coverage-detail` | Signed user token | Resolves the requested unit from token-scoped coverage before loading check-ins. |
| `GET /reports/indicators` | Signed user token | Reads only token-scoped check-ins and joined batch/location/unit data. |
| `GET /leaderboard` | Signed user token | Reads monthly and historical check-ins only inside the token organization. |
| `POST /admin/login` | Client-selected active workspace for login only | Successful token carries the resolved organization scope. |
| `POST /admin/organization-admin/passphrase` | Signed admin token | Updates only the admin token organization. |
| `GET /admin/settings` | Signed admin token | Reads only token organization settings. |
| `PATCH /admin/settings` | Signed admin token | Upserts settings with token organization scope. |
| `GET /admin/locations` | Signed admin token | Reads areas, locations, units, and members with token organization scope. |
| `GET /admin/checkins` | Signed admin token | Reads token-scoped check-ins; query filters cannot expand scope. |
| `PATCH /admin/checkins/:id` | Signed admin token | Loads and updates the check-in inside the token organization; replacement unit, edited team member, and admin actor are validated in the same organization. |
| `POST /admin/locations` | Signed admin token | Inserts with token organization scope; area and assigned unit IDs must belong to that organization. |
| `PATCH /admin/locations/:id` | Signed admin token | Updates only the token-scoped location; area and assigned unit IDs must belong to that organization. |
| `POST /admin/units` | Signed admin token | Inserts with token organization scope; referenced location must belong to that organization. |
| `PATCH /admin/units/:id` | Signed admin token | Updates only the token-scoped unit; referenced location must belong to that organization. |
| `POST /admin/team-members` | Signed admin token | Inserts with token organization scope. |
| `PATCH /admin/team-members/:id` | Signed admin token | Updates only the token-scoped team member. |

## Harness Limits

The current static harness is contract-oriented. It proves that the route guards, scoped query/update calls, related-ID validators, setup-code protections, hash omissions, managed-host fail-closed checks, audited superuser entry, and offline organization filters are present in the code.

The live two-workspace integration script seeds two temporary organizations and executes HTTP requests against Netlify Functions. Run it only against a safe non-production target unless production testing has been explicitly approved.
