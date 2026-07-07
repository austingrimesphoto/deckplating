# Deckplating User Guide

Hosted guide:

<https://deckplatingsetup.netlify.app/user-guide.html>

Live managed app:

<https://deckplating.netlify.app>

Use this guide to teach a Religious Ministry Team how to use Deckplating after workspace approval. Deckplating is a coverage-awareness tool for unclassified, non-sensitive ministry presence. It is not a counseling record, case-management tool, official record, CUI system, or classified system.

Screenshots in this guide use scrubbed demo data only. Do not capture or share setup codes, passphrases, real names, production data, sensitive locations, counseling details, medical details, or operational details.

## Contents

- [Select Workspace](#select-workspace)
- [Activate Workspace](#activate-workspace)
- [Choose Name And PIN](#choose-name-and-pin)
- [Check In](#check-in)
- [Manual Check-In](#manual-check-in)
- [Coverage Board](#coverage-board)
- [Map](#map)
- [Mission Board](#mission-board)
- [Admin Unlock](#admin-unlock)
- [Create Areas](#create-areas)
- [Create Locations](#create-locations)
- [Create Units](#create-units)
- [Create Team Members](#create-team-members)
- [Reset PIN](#reset-pin)
- [Activity Log](#activity-log)
- [Admin Settings](#admin-settings)
- [Account Switch And Sign-Out](#account-switch-and-sign-out)
- [Feedback](#feedback)
- [Safe-Use Boundaries](#safe-use-boundaries)
- [Troubleshooting](#troubleshooting)

## Select Workspace

Screenshot: [workspace activation](../setup-site/assets/screenshots/01-workspace-activation.svg)

What the user sees: `Workspace setup`, the current workspace, `Select workspace`, and `Activate workspace`.

What they click:

1. Open the workspace link from the operator, or open `https://deckplating.netlify.app`.
2. Choose `Select workspace` if the workspace already exists.
3. Enter the approved workspace slug.
4. Click `Use workspace`.

Expected result: the app loads that workspace and shows the roster name picker if local setup is complete.

Common mistake: entering an installation name instead of the workspace slug. The slug comes from the operator or workspace link.

Safe-use reminder: workspace selection should never require a passphrase, setup code, or production data in screenshots or chat.

## Activate Workspace

Screenshot: [workspace activation](../setup-site/assets/screenshots/01-workspace-activation.svg)

What the user sees: `Activate workspace`, `One-time setup code`, workspace display name, installation lookup, local lead label, and local admin passphrase.

What they click:

1. Click `Activate workspace`.
2. Enter the one-time setup code from the operator.
3. Confirm the workspace display name.
4. Search for the public installation or command area with `Find installation`.
5. Select the correct installation result to set the map center.
6. Enter a local admin passphrase.
7. Click `Activate workspace`.

Expected result: the workspace activates, the local lead is placed in Admin, and the lead continues to local setup for areas, locations, units, and roster.

Common mistake: treating activation like public signup. The setup code is centrally issued for an already approved workspace; it is not an email invitation or public account.

Safe-use reminder: never paste setup codes or passphrases into feedback forms, docs, screenshots, or messages.

## Choose Name And PIN

Screenshot: [name and PIN](../setup-site/assets/screenshots/02-name-pin.svg)

What the user sees: `Select your name`, the workspace name, safe-use reminder, a roster dropdown, and a 4-digit PIN field.

What they click:

1. Select their own roster name.
2. Enter a 4-digit PIN.
3. Click `Continue`.

Expected result: the device is registered for that roster identity and the app opens to normal use.

Common mistake: sharing a PIN or selecting another person's name to save time.

Safe-use reminder: display names should stay practical, such as rank and last name. Do not use full personal profiles or sensitive identifiers.

## Check In

Screenshot: [check-in](../setup-site/assets/screenshots/03-check-in.svg)

What the user sees: sync status, Mission Brief, `Locate Me`, nearby location result, unit checkboxes, and `Check In`.

What they click:

1. Read the sync/status bar.
2. Click `Locate Me`.
3. Select one or more units attached to the nearby mapped location.
4. Click `Check In`.
5. Review the confirmation screen.
6. Click `Done`.

Expected result: the visit is saved, coverage status updates, and the Mission Board can credit meaningful coverage.

Common mistake: closing the app before seeing confirmation when connectivity is weak.

Safe-use reminder: one check-in is one physical visit. Do not add notes, names, counseling details, or incident information.

## Manual Check-In

Screenshot: [check-in](../setup-site/assets/screenshots/03-check-in.svg)

What the user sees: `Manual unit lookup` on the Check In screen.

What they click:

1. Click `Manual unit lookup` when GPS is unavailable or the location is intentionally unmapped.
2. Choose one mapped location and its units, or choose one unmapped unit by itself.
3. Submit the manual check-in.
4. Review confirmation and click `Done`.

Expected result: the visit records without GPS verification and still contributes to coverage.

Common mistake: combining unrelated unmapped units into one manual visit.

Safe-use reminder: if a location should not be broadly shared, leave it unmapped and use manual check-in.

## Coverage Board

Screenshot: [coverage board](../setup-site/assets/screenshots/04-coverage-board.svg)

What the user sees: filters, unit cards, status colors, and detail drawers.

What they click:

1. Open `Coverage`.
2. Filter by area, type, overdue, never visited, or date range.
3. Click a unit card.
4. Read the detail drawer for last visit, recent check-ins, and indicator totals.

Expected result: the team can decide which command, department, division, or tenant unit needs attention next.

Common mistake: using the board as a productivity leaderboard only. It is primarily for coverage decisions.

Safe-use reminder: reports and indicators are generic location-level counts, not case records.

## Map

Screenshot: [map and mission](../setup-site/assets/screenshots/05-map-and-mission.svg)

What the user sees: mapped public locations, radius circles, and location cards. Offline mode may show the cached location list without live map tiles.

What they click:

1. Open `Map`.
2. Click or tap a mapped location card.
3. Review attached units and radius.

Expected result: users understand where public/general mapped locations are and which units are attached.

Common mistake: mapping sensitive spaces because they are operationally useful.

Safe-use reminder: map only publicly identifiable buildings or general areas. Do not map SCIFs, restricted spaces, deployed locations, homes, or sensitive locations.

## Mission Board

Screenshot: [map and mission](../setup-site/assets/screenshots/05-map-and-mission.svg)

What the user sees: score, meaningful visits, distinct units, recovered units, active days, badges, and Mission Brief tone.

What they click:

1. Open `Scores`.
2. Review monthly progress and badges.
3. Use the top needs to inform the next visit.

Expected result: the board rewards meaningful coverage, recovery, breadth, and consistency.

Common mistake: chasing repeated easy check-ins instead of overdue or never-visited units.

Safe-use reminder: Mission Board should encourage action without shaming named people, ranks, faith groups, commands, or roles.

## Admin Unlock

Screenshot: [admin setup](../setup-site/assets/screenshots/06-admin-setup.svg)

What the user sees: `Admin`, workspace name, and local admin passphrase field.

What they click:

1. Open `Admin`.
2. Enter the local admin passphrase for that workspace.
3. Click `Unlock`.

Expected result: Admin opens to `Locations`, `Activity Log`, and `Admin settings`.

Common mistake: using the central operator passphrase or expecting an email account login.

When finished, use `Lock Admin` or sign out so the device does not keep an unlocked Admin session.

Safe-use reminder: local admin passphrases are workspace-scoped. Do not store them in docs, forms, screenshots, or browser notes.

## Create Areas

Screenshot: [admin setup](../setup-site/assets/screenshots/06-admin-setup.svg)

What the user sees: `Create area` in `Admin` > `Locations`.

What they click:

1. Enter a broad area name.
2. Set sort order if needed.
3. Click `Save area`.

Expected result: the area becomes available for locations and coverage organization.

Common mistake: making areas too granular. Areas should help scanning and routing.

Safe-use reminder: area names should remain general and non-sensitive.

## Create Locations

Screenshot: [admin setup](../setup-site/assets/screenshots/06-admin-setup.svg)

What the user sees: `Create location`, mapping notice, area dropdown, location name, map picker, coordinates, radius, and attached units.

What they click:

1. Choose the area.
2. Enter a public/general location name.
3. Set coordinates with the map picker or coordinate fields.
4. Set a practical radius.
5. Attach units if they already exist.
6. Click `Save location`.

Expected result: `Locate Me` can match users to that public/general location.

Common mistake: using exact sensitive room names or pins.

Safe-use reminder: if there is doubt, do not map the location. Create or use an unmapped unit and manual check-in.

## Create Units

Screenshot: [admin setup](../setup-site/assets/screenshots/06-admin-setup.svg)

What the user sees: `Create unit`, unit name, type, optional location assignment, and visit interval.

What they click:

1. Enter the unit name.
2. Choose `Department`, `Division`, or `Tenant command`.
3. Assign a mapped location when appropriate.
4. Set the visit interval in days.
5. Click `Save unit`.

Expected result: the unit appears in Coverage and Check In workflows.

Common mistake: assigning every unit to a location even when the real visit should stay unmapped.

Safe-use reminder: unit names should not expose sensitive mission details.

## Create Team Members

Screenshot: [admin setup](../setup-site/assets/screenshots/06-admin-setup.svg)

What the user sees: `Create team member`, name, role, and active roster list.

What they click:

1. Enter a practical display name.
2. Enter a role if useful.
3. Click `Save member`.
4. Send the workspace link to that member.

Expected result: the member can select their name and create their own PIN on first sign-in.

Common mistake: trying to send email invitations. The current workflow is roster entry plus workspace link.

Safe-use reminder: do not add phone numbers, email addresses, birth dates, family details, or sensitive PII to roster fields.

## Reset PIN

Screenshot: [admin setup](../setup-site/assets/screenshots/06-admin-setup.svg)

What the user sees: the roster list in Admin with `Reset PIN and revoke devices`.

What they click:

1. Find the member.
2. Click `Reset PIN and revoke devices`.
3. Confirm the prompt.
4. Tell the member to select their name and create a new PIN on next sign-in.

Expected result: the old PIN hash is cleared, devices for that member in that workspace are deactivated, and a fresh PIN is required.

Common mistake: using reset as routine account switching. Use it only when a member forgot a PIN or device access should be revoked.

Safe-use reminder: do not ask members to share old or new PINs.

## Activity Log

Screenshot: [admin setup](../setup-site/assets/screenshots/06-admin-setup.svg)

What the user sees: filters for date, team member, area, unit, `Include voided`, and editable check-in rows.

What they click:

1. Open `Admin` > `Activity Log`.
2. Apply filters.
3. Correct unit, member, date/time, counseling indicator, or referral indicator mistakes.
4. Click `Save edit`.
5. Void accidental, duplicate, or incorrect records when needed.

Expected result: corrected records stay auditable; indicator changes update the generic reports; voided records stop affecting coverage and score.

Common mistake: using Activity Log to erase history. It is for correction and soft-voiding.

Safe-use reminder: counseling and referral indicators are yes/no counts only. Do not enter notes, circumstances, names, medical information, referral details, or sensitive explanations. Use the allowed correction reason only.

## Admin Settings

Screenshot: [admin setup](../setup-site/assets/screenshots/06-admin-setup.svg)

What the user sees: `Admin settings`, Mission Board tone, and local admin passphrase controls.

What they click:

1. Open `Admin` > `Admin settings`.
2. Choose Mission Brief tone: `Professional`, `Friendly`, or `Deckplate Banter`.
3. Save tone.
4. Rotate the local admin passphrase when needed.

Expected result: tone updates on the next user refresh and the workspace admin passphrase is replaced.

Common mistake: confusing `Admin settings` with the user `Account` tab.

Safe-use reminder: Deckplate Banter is curated local text only. It should not shame or target named people or groups.

## Account Switch And Sign-Out

Screenshot: [account and feedback](../setup-site/assets/screenshots/07-account-feedback.svg)

What the user sees: bottom tab `Account`, identity controls, `Sign out of this account`, `Switch workspace`, `Send feedback`, Safe Use, and sometimes System Administration if an operator token exists.

What they click:

1. Click `Account`.
2. Use `Sign out of this account` to leave the current name.
3. Use `Switch workspace` to clear the local identity and pick another workspace.
4. Use `Send feedback` to open the setup-site feedback form.

Expected result: users can leave a name or workspace without clearing the whole app installation.

Common mistake: switching identity while visits are waiting to upload.

Safe-use reminder: confirm pending visits are synced before changing identities.

## Feedback

Screenshot: [account and feedback](../setup-site/assets/screenshots/07-account-feedback.svg)

What the user sees: feedback form at `https://deckplatingsetup.netlify.app/#feedback`.

What they click:

1. Open `Account` > `Send feedback`, or go directly to the feedback link.
2. Choose the checkpoint: setup, week one, closeout, or urgent blocker.
3. Choose the bucket: onboarding confusion, operational blocker, feature request, or safe-use question.
4. Submit concrete, non-sensitive details.

Expected result: feedback is reviewed manually and used to decide the next fix or pilot step.

Common mistake: putting setup codes, names, or operational details in the feedback form.

Safe-use reminder: never submit secrets, setup codes, passphrases, production data, counseling details, medical details, personal information, or sensitive operational locations.

## Safe-Use Boundaries

What the user sees: safe-use reminders on setup, sign-in, Account, Admin mapping, and the setup-site forms.

What they click: nothing required; this is a hard boundary for all use.

Expected result: Deckplating stores only the minimum unclassified, non-sensitive coverage metadata needed to track ministry presence.

Common mistake: treating Deckplating like a counseling log because chaplains are using it.

Never enter:

- CUI
- classified information
- counseling notes
- medical details
- incident details
- home addresses
- phone numbers
- email addresses
- dates of birth
- family information
- sensitive operational locations
- real setup codes, passphrases, hashes, or production secrets

## Troubleshooting

Locate Me does nothing:

- Confirm location permission for the browser or home-screen app.
- On iPhone, confirm Precise Location is on.
- Try again after a few seconds.
- Use manual check-in if GPS remains unreliable.

Offline or slow:

- Read the sync/status bar.
- Use cached data if available.
- Do not change identity while visits are pending.
- Reopen the app or click `Sync Now` when connectivity returns.

Workspace suspended or deleted:

- Existing sessions should stop working.
- Sign out and contact the local lead or operator.
- Do not try to work around the workspace boundary with another slug or setup code.

Need help:

- Use feedback for non-sensitive pilot issues: <https://deckplatingsetup.netlify.app/#feedback>
- Keep urgent safety or operational matters outside Deckplating and follow command-approved channels.
