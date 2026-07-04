# Deckplating User Guide

Hosted guide:

<https://deckplatingsetup.netlify.app/user-guide.html>

Use this guide to teach a new Religious Ministry Team how to use Deckplating after setup is complete.

## Quick Start

Teach this first. A normal phone user should be able to do this in under 10 minutes.

1. Open Deckplating from the phone home screen or browser.
2. Select your roster name.
3. Enter your 4-digit PIN.
4. Read the sync/status bar at the top.
5. Tap **Locate Me** on the **Check In** screen.
6. If a mapped location appears, select one or more units at that location and tap **Check In**.
7. If no location appears, tap **Manual unit lookup**, choose one mapped location with attached units or one unmapped unit, then submit.
8. Review the confirmation screen.
9. Optional: check **Confidential care provided** or **Referral provided** only when appropriate.
10. Tap **Done**.

The daily habit is simple: open the app, find the location, select the unit or units, check in, move on.

## App Philosophy

Deckplating is a lightweight coverage-awareness tool.

It is built to answer practical RMT questions:

- Which commands, departments, divisions, or tenant units have been visited recently?
- Which units are overdue or have never been visited?
- Where are the public mapped locations?
- What meaningful coverage progress has the team made this month?
- Are referrals or confidential-care indicators increasing in certain locations over time?

Deckplating is not:

- a counseling record,
- a case-management tool,
- an official system of record,
- a CUI system,
- a place for sensitive operational data.

The tool should help chaplains and RPs get out of the office and maintain practical ministry presence without creating risky records.

## Safe Use

- Use Deckplating only for unclassified, non-sensitive coverage tracking.
- Do not enter CUI, classified information, counseling notes, medical details, family information, home addresses, phone numbers, email addresses, dates of birth, or sensitive operational locations.
- Map only publicly identifiable buildings or general areas.
- If a location should not be broadly shared, leave it unmapped and use manual check-in.
- Optional indicators are generic location-visit counts only. They are not tied to a person, department, counseling case, or referral detail.

For the full policy, read [SAFE_USE.md](SAFE_USE.md).

## The Five Things Every User Must Know

1. **Sign in with name and PIN.** Pick your own roster identity and use your own 4-digit PIN.
2. **Locate Me is the fastest check-in path.** Precise location permission matters.
3. **Manual lookup is the fallback.** GPS problems should not stop check-ins.
4. **The confirmation screen is the immediate correction window.** Use Undo there for accidental check-ins.
5. **The sync bar tells the truth.** If visits are waiting to upload, keep the app until they sync or intentionally undo the queued visit.

## Screen-by-Screen Guide

### Login And Identity

Use this screen to select who is using the device.

Normal first use:

1. Select your roster name.
2. Enter a 4-digit PIN.
3. The app registers that device for your identity.

Returning use:

1. Open the app.
2. If the session is still valid, the app opens directly.
3. If prompted, enter the same PIN to refresh the session.

Rules:

- Do not share PINs.
- Do not use another person's roster identity.
- Do not change identity while unsynced visits are waiting to upload.
- PINs are not stored in browser storage.

### Sync And Offline Status

The status bar appears near the top of the app.

- **Online and synced**: no queued visits remain.
- **Offline - cached data**: the app is using the latest cached snapshot.
- **X visits waiting to upload**: check-ins are saved on the phone and waiting for sync.
- **Sync needs PIN refresh**: enter your existing PIN to refresh the session without losing queued work.
- **Sync failed - retry available**: check connectivity and tap **Sync Now**.

Offline mode requires one successful online launch first. Background upload while the app is fully closed is not guaranteed on every phone.

### Check In

The Check In screen is the main working screen.

Normal nearby flow:

1. Tap **Locate Me**.
2. Wait for the nearest saved location to appear.
3. Select one or more units attached to that physical location.
4. Tap **Check In**.
5. Review the confirmation screen.
6. Tap **Done**.

Manual flow:

1. Tap **Manual unit lookup**.
2. Choose one mapped location and one or more units attached to it, or choose one unmapped unit.
3. Submit the manual check-in.
4. Review the confirmation screen.

Location rules:

- One check-in batch represents one physical visit.
- Multi-unit check-ins are allowed only when those units belong to the same mapped location.
- An unmapped unit can be checked in manually by itself.
- Do not combine unrelated unmapped units into one visit.

Confirmation screen:

- Shows units checked in.
- Shows date/time.
- Shows points awarded.
- Shows **Undo this check-in**.
- Shows optional visit indicators.
- Shows Deckplate Brief.

Use **Undo this check-in** only for immediate accidental submissions. Older or more complex corrections belong in **Admin > Activity Log**.

### Optional Visit Indicators

The optional indicators are:

- **Confidential care provided**
- **Referral provided**

Use them only as generic location-level counts.

Rules:

- They are optional.
- Leaving them unchecked stores no value.
- Checking a box saves automatically.
- Unchecking it before leaving the confirmation screen returns it to unanswered.
- Do not enter names, circumstances, counseling details, medical information, or referral details.
- Indicators do not affect score, badges, coverage status, or the leaderboard.

### Coverage

Use Coverage to decide where attention should go next.

What to look for:

- **Never visited** units.
- **Overdue** units.
- **Due soon** units.
- Current units that are being maintained.
- Recent check-in history for a specific unit.

Common actions:

1. Filter by area, type, overdue status, never-visited status, or date range.
2. Tap a command, department, division, or tenant-command card.
3. Review the detail drawer that opens directly under that card.
4. Look at recent check-ins and last visitor.
5. Use the reporting section for confidential-care and referral indicator trends.

### Reports

Reports help answer trend questions without creating sensitive records.

Use reports to see:

- referral indicator counts by mapped location,
- confidential-care indicator counts by mapped location,
- date-range totals,
- which locations are producing more generic indicator activity over time.

Reports should not be used to infer counseling cases, medical details, names, events, or sensitive operational information.

### Map

Use Map to review public mapped locations and the units attached to them.

Online:

- Shows the interactive map.
- Shows saved locations and radius circles.
- Lets you open a location detail panel.

Offline:

- Uses cached location data.
- May hide map tiles.
- Keeps the cached location list usable.

If the map freezes or tiles are unavailable, use the list and manual check-in flow.

### Mission Board

Mission Board rewards meaningful coverage.

It shows:

- score,
- meaningful visits,
- distinct units visited,
- recovered units,
- active days,
- badges.

Badges:

- **First Rounds**: first qualifying check-in this month.
- **Recovery Team**: recovered an overdue or never-visited unit.
- **Gray to Green**: completed a first-ever visit.
- **Wide Coverage**: visited five distinct units in the month.
- **Sustained Presence**: checked in on four distinct days in the month.
- **Coverage Sweep**: helped leave an area with no overdue or never-visited active units.

The point is not raw volume. A meaningful recovery is more useful than repeated visits to the same already-current place.

### Settings

Use Settings to:

- refresh app data,
- review safe-use guidance,
- refresh the signed session,
- change identity when no queued visits are pending.

Admins may also set the Mission Brief tone:

- **Professional**
- **Friendly**
- **Deckplate Banter**

Deckplate Banter is curated local content only. It should never shame named people, ranks, faith groups, commands, or roles.

### Admin

Admin is for local leads.

Use Admin to:

- add and edit areas,
- add and edit mapped public locations,
- attach units to locations,
- create and deactivate team members,
- correct check-ins through Activity Log,
- set Mission Board tone.

Admin location mapping rule:

Map only publicly identifiable buildings or general areas. Do not map SCIFs, restricted spaces, deployed-unit locations, homes, or any location that should not be broadly shared.

Activity Log corrections:

- Correct unit, team member, or date/time mistakes.
- Void accidental, duplicate, or incorrect records.
- Do not delete historical records.
- Voided records stop affecting coverage and score.

## Common Workflows

### Daily Deckplate Round

1. Open the app.
2. Read Mission Brief.
3. Tap **Locate Me**.
4. Select the unit or units at the current location.
5. Submit the check-in.
6. Add optional indicators only if appropriate.
7. Tap **Done**.
8. Move to the next location.

### GPS Does Not Find The Location

1. Confirm phone location permission is set to precise/high accuracy.
2. Tap **Locate Me** again.
3. Use **Manual unit lookup** if needed.
4. Ask an admin to verify the mapped location, coordinates, and radius later.

### Offline Check-In

1. Launch the app once online before relying on offline use.
2. When offline, confirm the app shows cached data or pending-sync status.
3. Submit the visit normally.
4. Confirm it says the visit is saved on the device or waiting to upload.
5. Reopen the app or tap **Sync Now** when connectivity returns.

### Fixing A Mistake

- Immediate user mistake: use **Undo this check-in** on the confirmation screen.
- Queued offline visit that has not uploaded: undo removes it locally.
- Uploaded or older mistake: use **Admin > Activity Log**.

### Adding A New Location

1. Open **Admin**.
2. Add or choose an area.
3. Add a location with a public/general name.
4. Set coordinates and radius.
5. Attach one or more units to that location.
6. Test **Locate Me** from that building if possible.

### Adding A New Team Member

1. Open **Admin**.
2. Add the member display name.
3. Keep display names practical, such as rank and last name.
4. Have the member select their name and create their own PIN on their device.

## Troubleshooting

### Locate Me Does Nothing

- Confirm the browser or phone-home-screen app has location permission.
- On iPhone, confirm **Precise Location** is on.
- Try closing and reopening the app.
- Use manual lookup for the visit, then have an admin check the saved location radius.

### GPS Accuracy Is Too Broad

- Enable precise location.
- Step outside or near a window if inside a heavy building.
- Try again after a few seconds.
- Use manual lookup if accuracy remains poor.

### App Is Offline Or Slow

- Check the sync/status bar.
- If cached data appears, continue using manual lookup or cached nearby locations.
- If the app says it needs one online launch, reconnect and open it once online.
- If visits are waiting to upload, do not change identity.

### Check-In Confirmation Is Delayed

- Wait for the confirmation before closing the app when online.
- If the network fails, the app should save the visit locally.
- Check the sync bar for pending visits.

### User Cannot Change Identity

The app blocks identity changes while pending visits belong to the current identity. Sync or intentionally discard those pending visits first.

## Training Plan

### First 10 Minutes

- Safe-use reminder.
- Sign in.
- Locate Me.
- Manual lookup.
- Submit one test check-in.
- Read the confirmation screen.

### First 30 Minutes

- Coverage Board.
- Map.
- Mission Board.
- Offline behavior.
- Undo and Activity Log correction paths.

### Local Lead Add-On

- Add/edit areas.
- Add/edit locations.
- Attach units.
- Create team members.
- Review Activity Log.
- Set Mission Board tone.

## Annotated Screenshot Plan

Use this list when capturing real screenshots for future guide updates or videos.

Do not capture real sensitive locations, names, counseling details, medical information, or operationally sensitive spaces. Use seeded/example data whenever possible.

Capture these screens:

1. Login identity selection.
2. Sync/status bar states.
3. Check In before tapping **Locate Me**.
4. Nearby location result with selected units.
5. Manual unit lookup.
6. Check-in confirmation with Undo, optional indicators, and Deckplate Brief.
7. Coverage Board with a command detail drawer open.
8. Reports section showing generic indicator totals.
9. Map page online with mapped public locations.
10. Map page offline/cached list fallback.
11. Mission Board with score, supporting metrics, and badges.
12. Settings with Safe Use.
13. Admin location editing with mapping notice.
14. Admin Activity Log correction flow.

Recommended annotations:

- Mark the primary action button.
- Mark the safe-use warning where present.
- Mark where sync status appears.
- Mark where details open after tapping a card.
- Mark what not to enter.

## Recommended Training Package

Send new teams these links together:

- Hosted setup wizard: <https://deckplatingsetup.netlify.app>
- Hosted user guide: <https://deckplatingsetup.netlify.app/user-guide.html>
- Safe-use policy: [SAFE_USE.md](SAFE_USE.md)
- Setup walkthrough: [SETUP_GUIDE.md](SETUP_GUIDE.md)
- Pilot feedback form: <https://deckplatingsetup.netlify.app/#feedback>
