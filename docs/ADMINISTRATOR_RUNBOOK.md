# Administrator Runbook

This runbook covers the controlled-demonstration administration flow for `https://deckplating.netlify.app`.

## First-Time Central Operator Bootstrap

Prerequisites:

- run from the linked Deckplating repo
- Netlify CLI authenticated to the linked production site
- production has managed-host behavior active and a dedicated random `ADMIN_SESSION_SECRET` of at least 32 bytes; explicitly set `DECKPLATING_MANAGED_HOST=true` when possible, while a configured central-operator hash also activates managed behavior for compatibility
- a separate random `CREDENTIAL_PEPPER` of at least 32 bytes is strongly recommended; without it, credential hashing derives a domain-separated pepper from `ADMIN_SESSION_SECRET`

Command:

```bash
./scripts/bootstrap-central-operator.sh
```

Procedure:

1. Run the command above.
2. Enter a new central operator passphrase of at least 12 characters twice when prompted.
3. The helper computes the SHA-256 hash locally and sets `CENTRAL_OPERATOR_PASSPHRASE_HASH` on the linked Netlify production site.
4. The helper does not print the plaintext passphrase or the hash.
5. Existing versioned operator sessions become invalid when the function environment refreshes. Deploy the reviewed production build and verify the new passphrase.

Use the same helper later for emergency central-operator passphrase rotation.

Credential hashes written without a dedicated `CREDENTIAL_PEPPER` use the `scrypt-v3` format. Configuring a dedicated pepper changes new and successfully verified credentials to keyed `scrypt-v4`; legacy raw-pepper `scrypt-v2` and unkeyed `scrypt-v4` credentials migrate after successful verification. Use the staged procedures below before rotating either root key.

## Credential Rotation Preflight And Recovery

The operator console shows aggregate credential counts by type, format, and non-secret key ID. It never returns a stored hash, workspace ID, member ID, or credential owner. Refresh **Credential safety / Rotation readiness** before and after each stage.

You can automate the same check from a reviewed administrative shell:

```bash
DECKPLATING_CREDENTIAL_PREFLIGHT_BASE_URL=https://deckplating.netlify.app \
DECKPLATING_CREDENTIAL_PREFLIGHT_ALLOW_PROD=YES \
DECKPLATING_CREDENTIAL_PREFLIGHT_TARGET=admin-session-secret \
DECKPLATING_CREDENTIAL_PREFLIGHT_OPERATOR_PASSPHRASE='use approved secret input' \
npm run credentials:preflight
```

The command exits `0` only when rotation is allowed, `2` when dependent credentials block rotation, and `1` for configuration or connectivity failures. Do not paste the JSON output into public tickets; it is aggregate security metadata.

### Migrate v3 before rotating ADMIN_SESSION_SECRET

1. Back up the current Netlify environment and database using the release runbook. Keep the old `ADMIN_SESSION_SECRET` recoverable.
2. Add a new, separate `CREDENTIAL_PEPPER` of at least 32 random bytes; leave `ADMIN_SESSION_SECRET` unchanged.
3. Deploy. New credentials become keyed `scrypt-v4`; successful member/admin login opportunistically upgrades older credentials.
4. Refresh rotation readiness. Reset inactive or unavailable member PINs and local-admin passphrases through the existing operator/admin recovery controls until the `scrypt-v3` blocker count is zero.
5. Run `credentials:preflight` with target `admin-session-secret`. Do not rotate on exit code `2`.
6. Rotate `ADMIN_SESSION_SECRET`, deploy, and verify operator, local-admin, and member login. Existing signed sessions are expected to expire.

Rollback: restore the prior `ADMIN_SESSION_SECRET` and redeploy. Credentials already upgraded to dedicated keyed v4 remain valid because they no longer depend on the session secret. If the old session secret is unavailable, use the reviewed reset plan to reset every remaining v3 credential before proceeding.

### Rotate CREDENTIAL_PEPPER online

Only one previous pepper is supported, preventing an unbounded key ring.

1. Back up the environment/database and record the current non-secret key ID from Rotation readiness.
2. Set `CREDENTIAL_PEPPER_PREVIOUS` to the exact old `CREDENTIAL_PEPPER` value.
3. Replace `CREDENTIAL_PEPPER` with the new random value and deploy both together.
4. Confirm the console shows a new active key ID and the old ID as previous. Successful logins upgrade old keyed, unkeyed v4, and v2 credentials to the new keyed v4 format.
5. Reset credentials that cannot migrate through normal login until the previous-key blocker count is zero.
6. Run `credentials:preflight` with target `credential-pepper`. Remove `CREDENTIAL_PEPPER_PREVIOUS` only on exit code `0`, then deploy and re-run login checks.

Rollback before previous-key removal: restore the old pepper as `CREDENTIAL_PEPPER` and keep the new value as `CREDENTIAL_PEPPER_PREVIOUS`; deploy. Both key IDs remain verifiable and successful login rekeys toward the restored active key. Rollback after prematurely removing the previous key: immediately restore `CREDENTIAL_PEPPER_PREVIOUS` and deploy; if it cannot be recovered, execute the reviewed reset plan for every blocked v2/v4 credential.

A blocked rotation may proceed only under a reviewed reset/override plan. Set `DECKPLATING_CREDENTIAL_PREFLIGHT_OVERRIDE_REVIEWED=YES` and a non-sensitive ticket/change reference in `DECKPLATING_CREDENTIAL_PREFLIGHT_PLAN_REFERENCE`. The API records the target, blocker count, key ID, and plan reference in the operator audit; never put key material or plaintext credentials in that reference.

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

## Approve Workspace Request

1. Open `System Administration`.
2. In `Workspace requests`, review the pending request details.
3. Adjust the generated workspace name or slug if needed.
4. Leave an operator note if useful.
5. Select `Approve and send welcome`.
6. Confirm the workspace card appears and the request status changes to approved.

Approval creates the workspace, issues the one-time setup code, records operator audit events, and sends the welcome email when email environment variables are configured.

## Create Workspace Manually

1. Open `System Administration`.
2. In `Create approved workspace`, enter the workspace name and slug.
3. Select `Create workspace`.
4. Confirm the workspace card appears with status and onboarding counts.

Use manual creation only for support, testing, or approved exceptions that did not come through the setup-site request form.

## Reject Or Request More Information

1. Open `System Administration`.
2. In `Workspace requests`, find the pending request.
3. Enter an operator note explaining the issue or missing information.
4. Select `Reject or needs info`.

The requestor receives the note by email when email environment variables are configured.

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
4. Record the initial PIN shown once after creation, then send the workspace link and PIN directly to that member through an authorized channel.
5. The member selects their name and signs in with the issued PIN. Do not retain the plaintext PIN in notes, screenshots, tickets, or chat history.
6. The member opens `Account` and changes the issued PIN to a private PIN; the app revokes that member's other device sessions.

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

- a replacement PIN is shown once to the local administrator
- the member's devices in that workspace are deactivated
- the local administrator delivers the replacement PIN directly to the member

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

- open signup
- email invitations
- Supabase Auth or role-based user accounts
- self-service workspace deletion or archive flows
- local-admin self-service exports or full backups
- analytics
- broader production hardening beyond the controlled demonstration
