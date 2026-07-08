# First Pilot Operator Script

Use this when onboarding the first outside workspace. Keep this page open and move line by line.

## Before You Start

- Confirm the request came from an approved local lead.
- Do not collect or store CUI, classified information, counseling notes, medical details, personal details, or sensitive operational locations.
- Do not paste setup codes, passphrases, or production data into docs, screenshots, feedback forms, or group chats.
- Have a direct channel to the approved local lead.

## Create The Workspace

1. Open `https://deckplating.netlify.app/?operator=1`.
2. Enter the central operator passphrase.
3. In `Create approved workspace`, enter the workspace name and slug.
4. Select `Create workspace`.
5. Confirm the workspace card appears.

Use a short slug that the local lead can recognize, for example `example-rmt`.

## Issue The Setup Code

1. Find the new workspace card.
2. Use workspace search if the operator console already has many commands or departments.
3. Enter a lead/request label.
4. Keep the expiration short, usually `14` days or less.
5. Select `Issue setup code`.
6. Copy the workspace link and setup code from the notice.

Send only this bundle to the approved local lead:

```text
Workspace link: https://deckplating.netlify.app/?workspace=<workspace-slug>
One-time setup code: <code shown once>
User guide: https://deckplatingsetup.netlify.app/user-guide.html
Feedback: https://deckplatingsetup.netlify.app/#feedback
```

Do not send the central operator passphrase. Do not save the setup code anywhere after sending it.

## Local Lead First Session

Ask the local lead to do this while you are available:

1. Open the workspace link.
2. Select `Activate workspace`.
3. Enter the one-time setup code.
4. Confirm the workspace display name.
5. Use installation lookup to set the map center.
6. Set a local admin passphrase.
7. Create at least one area, location, unit, and team member.
8. Open the member link on a phone, select the member, create a PIN, and complete one test check-in.
9. If visit flags were missed, open `Admin` > `Activity Log`, edit the check-in, and mark the generic yes/no indicators.
10. Open `Reports` and confirm the generic indicator counts make sense.

## Operator Readiness Check

Back in `System Administration`, confirm the workspace card shows:

- local admin passphrase configured
- at least one area
- at least one location
- at least one unit
- at least one team member
- ready for check-ins
- latest check-in shown after the local lead completes the test visit

If the local lead is stuck before roster creation, use `Open admin as system administrator` only for support or quality-control work, then lock Admin when finished.

Search the `Operator audit` panel for the workspace slug and confirm the expected events are present:

- workspace created
- setup code issued
- setup code used during activation
- superuser admin session, only if you used it

If the local lead asks about backup or handoff, use `Download safe export` from the workspace card. Confirm they understand this is operational metadata only and excludes setup codes, hashes, device records, passphrases, PINs, counseling notes, referral details, and sensitive personal or operational details.

## What To Say To The Local Lead

Use this plain-language boundary:

```text
Deckplating is for coverage awareness only. Visit flags are yes/no counts. Do not enter notes, names, circumstances, medical details, personal information, CUI, classified information, or sensitive operational locations.
```

## If Something Goes Wrong

- Setup code sent to the wrong person: revoke it and issue a new one.
- Local admin passphrase forgotten: set a temporary recovery passphrase from `System Administration`, then tell the local lead to rotate it from `Admin settings`.
- Workspace should pause: use `Suspend workspace`.
- Workspace should be removed: use `Delete workspace and data` only after confirming the exact slug and intent.
- Suspected cross-workspace data exposure: stop the pilot and capture the exact steps without sharing sensitive data.

## End Of First Session

Before leaving the local lead on their own:

1. Confirm they can sign in as a normal member.
2. Confirm they can open local Admin.
3. Confirm they understand how to add/edit roster, locations, units, and generic indicators.
4. Confirm they know that search is available in manual check-in, Coverage, Map, Admin setup records, Activity Log, reports, and System Administration.
5. Confirm they know where to send feedback.
6. Revoke any unused setup codes that are no longer needed.
