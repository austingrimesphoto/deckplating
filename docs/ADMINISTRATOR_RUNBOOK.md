# Administrator Runbook

This runbook covers the managed-pilot administration flow for `https://deckplating.netlify.app`.

## First-Time Central Operator Bootstrap

Prerequisites:

- run from the linked Deckplating repo
- Netlify CLI authenticated to the linked production site

Command:

```bash
./scripts/bootstrap-central-operator.sh
```

Procedure:

1. Run the command above.
2. Enter a new central operator passphrase twice when prompted.
3. The helper computes the SHA-256 hash locally and sets `CENTRAL_OPERATOR_PASSPHRASE_HASH` on the linked Netlify production site.
4. The helper does not print the plaintext passphrase or the hash.
5. Deploy the reviewed production build so operator login uses the new passphrase.

Use the same helper later for emergency central-operator passphrase rotation.

## Enter The Operator Console

Normal in-app path:

1. Sign in normally if needed.
2. Open the bottom tab labeled `Account`.
3. Select `Open system administration`.
4. Enter the central operator passphrase.

Direct URL path:

- open `https://deckplating.netlify.app/?operator=1`

Exit path:

- select `Back and lock`
- this removes only the operator token from `sessionStorage`

## Create Workspace

1. Open `System Administration`.
2. In `Create approved workspace`, enter the workspace name and slug.
3. Select `Create workspace`.
4. Confirm the workspace card appears with status and onboarding counts.

## Issue And Revoke Setup Code

Issue:

1. Find the workspace card.
2. Optionally enter a lead label and expiration days.
3. Select `Issue setup code`.
4. Copy the one-time setup link and one-time setup code shown in the notice.
5. Send both directly to the approved local lead.

Revoke unused code:

1. In the same workspace card, find the unused code row.
2. Select `Revoke`.

## Send Workspace Link To Local Lead

Send:

- the workspace link shown after setup-code issuance
- the one-time setup code shown at the same time

The local lead opens the link, selects `Activate workspace`, enters the setup code, and sets the local admin passphrase.
The activation form also includes `Installation name`; use `Find installation` if the name may be abbreviated, variant, or misspelled. The chosen installation becomes the workspace map center.

## Local Roster Creation And Deactivation

Local admin path:

1. Open `Admin`.
2. Stay in the `Locations` setup section.
3. Use `Create team member` to add a roster entry.
4. Send the same workspace link to that member.
5. The member selects their name and creates their own PIN on first sign-in.

Deactivate a roster entry:

1. Open `Admin`.
2. Find the member in the roster list.
3. Select `Deactivate`.

## Local-Admin Passphrase Rotation

1. Open `Admin`.
2. Go to `Admin settings`.
3. Enter a new value under `New local admin passphrase`.
4. Select `Save local admin passphrase`.

## Open Workspace Admin As System Administrator

Use this only for support, recovery, or quality-control work where the central administrator needs to inspect or fix one workspace.

1. Open `System Administration`.
2. Find the active workspace card.
3. Select `Open admin as system administrator`.
4. Confirm the prompt.
5. Make the needed Admin change.
6. Use `Lock Admin`, `Back and lock`, or sign out when finished.

Result:

- the admin session is scoped to that one workspace
- the session starts only after an operator audit event is recorded
- the Admin screen shows a system administrator mode warning while active

## Onboarding Checklist

The local admin checklist appears in `Admin` > `Locations` while setup is incomplete. It tracks local admin passphrase, areas, locations, units, and team members.

- Select `Hide checklist` to dismiss it during setup.
- Select `Complete onboarding` after all readiness items are done.
- If setup later becomes incomplete, the checklist can appear again when admin settings are loaded.

## Central Recovery Of Forgotten Local-Admin Passphrase

1. Open `System Administration`.
2. Find the workspace card.
3. Enter a temporary recovery passphrase twice.
4. Select `Set temporary recovery passphrase`.
5. Confirm the emergency recovery prompt.
6. Deliver the temporary passphrase directly to the approved local lead.

Result:

- the old local-admin passphrase is not shown or stored
- existing local-admin sessions for that workspace stop working

## Team-Member PIN Reset

1. Open `Admin`.
2. Find the member in the roster list.
3. Select `Reset PIN and revoke devices`.
4. Confirm the reset prompt.

Result:

- the member PIN hash is cleared
- the member's devices in that workspace are deactivated
- the member must select their name and create a new PIN on next sign-in

## Suspend Or Reactivate Workspace

Suspend:

1. Open `System Administration`.
2. Find the workspace card.
3. Select `Suspend workspace`.
4. Type the workspace slug exactly in the confirmation prompt.

Suspend effect:

- workspace resolution is blocked
- setup activation is blocked
- new device registration is blocked
- existing member and admin sessions stop working
- data remains in place

Reactivate:

1. Open `System Administration`.
2. Select `Reactivate workspace`.
3. Type the workspace slug exactly in the confirmation prompt.
4. Members and admins must sign in again.

## Delete Workspace And Data

1. Open `System Administration`.
2. Find the workspace card.
3. Select `Delete workspace and data`.
4. Type the exact workspace slug when prompted.
5. Confirm the final irreversible delete prompt.

Result:

- the workspace is removed from the system administrator dashboard
- the workspace's roster, areas, locations, units, check-ins, setup codes, admin credentials, and settings are deleted
- the workspace can only be recreated as a new workspace later

## Not Supported Yet

- public signup
- email invitations
- Supabase Auth or role-based user accounts
- self-service workspace deletion or archive flows
- exports or backups from the UI
- analytics
- broader production hardening beyond the managed pilot
