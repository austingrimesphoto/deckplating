# Transactional administrator workflows

Every administrator endpoint that changes multiple dependent records now delegates the complete mutation to one organization-scoped PostgreSQL function. API validation still provides fast user-facing feedback, but referenced records are validated again after locks are acquired inside the transaction.

## Mutation inventory

| API surface | Dependent records | Transaction and concurrency rule |
| --- | --- | --- |
| `PATCH /api/admin/checkins/:id` | check-in, optional batch visit flags | `admin_correct_checkin`; locks the check-in and batch, validates actor/member/unit in the workspace, and rolls both changes back together |
| `POST /api/admin/locations` | new location and assigned units | `admin_mutate_location`; validates and locks all workspace units before inserting/assigning |
| `PATCH /api/admin/locations/:id` | location and assigned units | `admin_mutate_location`; locks the location and unit IDs in deterministic order |
| `PATCH /api/admin/team-members/:id` | roster profile/status and device revocation | `admin_update_team_member`; locks the member and rolls profile/status changes back if device revocation fails |
| `POST /api/operator/setup-codes/:id/revoke` | setup-code state and operator audit | `revoke_setup_code_with_audit`; both records commit or roll back together |
| `POST /api/operator/workspace-requests/:id/reject` | request status and operator audit | `reject_workspace_request`; locks the pending request and writes rejection plus audit together |
| `POST /api/operator/organizations/:id/status` | workspace status and operator audit | `set_organization_status_with_audit`; locks the workspace and writes the matching suspend/reactivate audit |
| `POST /api/operator/organizations/:id/admin-passphrase` | administrator credential and operator audit | `recover_organization_admin_with_audit`; locks the workspace before credential replacement |
| `DELETE /api/operator/organizations/:id/delete` | all workspace-owned rows and deletion audit | `delete_deckplating_organization`; writes the audit before deletion in the same transaction; the audit foreign key becomes null through `ON DELETE SET NULL` |

Single-row area, unit, settings, and roster-create endpoints do not have dependent writes. PIN reset, member-device registration, workspace activation/approval, and check-in creation were already transactional before migration 014. Notification delivery and notification-status updates occur after their database state transition because external email delivery cannot participate in a PostgreSQL transaction.

The complete inventory also includes three non-destructive operator creation flows: workspace creation, setup-code issuance, and workspace-request approval. Their primary records are already created atomically (approval uses `approve_workspace_request` for the workspace, code, and request transition); informational operator audit rows are recorded immediately afterward. They are not destructive transitions and were therefore left outside migration 014’s destructive action/audit requirement. Export and superuser-session routes perform only one audit write in addition to a read or token creation, not multiple dependent database mutations.

## Error contract

The functions use stable internal conditions rather than leaking database details:

- tenant-scoped records that do not exist return a typed 404 response;
- invalid state, duplicate input IDs, or missing required batch state return a typed 400 response;
- concurrent/uniqueness conflicts return a typed 409 response;
- a missing migration helper returns 503 instead of falling back to partial multi-write behavior.

All functions revoke execution from `public`, `anon`, and `authenticated`; only `service_role` can execute them. The database behavior suite injects failures into the second dependent write and proves rollback for check-in/batch, location/unit, roster/device, and managed action/audit pairs. It also covers retries, cross-tenant references, and concurrent check-in corrections.
