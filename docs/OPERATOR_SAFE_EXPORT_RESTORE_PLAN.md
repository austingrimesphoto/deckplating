# Operator Safe Export Restore Plan

Deckplating now supports a safe operator JSON export for backup, handoff, and migration planning. Restore/import is intentionally not implemented yet.

## Restore Guardrails

- Restore must be operator-only.
- Restore must never import setup-code plaintext, setup-code hashes, passphrase hashes, PIN hashes, device-token hashes, devices, service keys, counseling notes, referral details, medical details, personal details, or sensitive operational details.
- Restore must default to creating a new workspace rather than overwriting a live workspace.
- Overwrite mode, if ever added, must require a fresh export, explicit slug confirmation, and a pre-restore backup.
- Every restore attempt must create an operator audit event.
- Failed restore attempts must leave a clear error and must not partially activate member/device sessions.

## Candidate Restore Flow

1. Operator uploads a `deckplating-safe-operator-export-v1` JSON file.
2. App validates the export format, generated timestamp, organization slug/name, and required arrays.
3. Operator chooses `new workspace restore`.
4. App previews counts for areas, locations, units, team members, check-in batches, and check-ins.
5. Operator enters the new workspace slug and confirms safe-use boundaries.
6. API inserts records in dependency order:
   - organization
   - app settings
   - areas
   - locations
   - units
   - team members without PIN hashes
   - check-in batches
   - check-ins
7. API returns a restore report with created counts and skipped/invalid rows.
8. Local lead sets a fresh workspace admin passphrase and members create fresh PINs.

## Validation Rules

- Reject unknown export formats.
- Reject duplicate target slugs.
- Reject rows whose foreign keys are missing from the same export.
- Reject locations without area IDs unless the restore plan explicitly supports unmapped locations.
- Reject check-ins whose unit/member IDs are not present in the export.
- Preserve void metadata but do not restore devices.
- Preserve generic care/referral indicators only as true/null counts.

## Tests Needed Before Implementation

- Unit test malformed export rejection.
- Integration test restore into a new workspace.
- Integration test tenant isolation after restore.
- Integration test that restored users cannot sign in until fresh PINs are created.
- Smoke test that restored coverage, Mission Board, reports, Activity Log, and export all load.
- Negative test that forbidden fields in uploaded JSON are ignored or rejected.

## Current Decision

Keep restore/import as a documented plan, not a shipped feature, until the workflow above is reviewed against tenant isolation, safe-use limits, and operator audit requirements.
