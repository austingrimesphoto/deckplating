# Pilot Support Playbook

Use this playbook while supporting the first two outside RMT pilots.

The purpose is to keep pilot support disciplined: help teams get started, capture real blockers, protect the safe-use boundary, and avoid turning every comment into immediate feature work.

## Pilot Support Objective

Support two outside RMTs through a 2-4 week Deckplating beta pilot and determine whether the app is ready for wider local development beta use.

Success means:

- each team completes setup with limited support,
- at least one phone user can check in online and offline,
- queued visits sync without duplicate records,
- users understand safe-use limits,
- Coverage and Mission Board help the team decide where to go next,
- feedback is specific enough to drive the next release.

The support goal is not to make the pilot feel effortless. The support goal is to learn whether a normal team can own setup, administration, phone use, and reporting with only bounded help.

## Roles

- `Project owner`: owns the template, setup site, release decisions, and feedback review.
- `Pilot lead`: local RMT lead who owns their team's GitHub, Supabase, Netlify, roster, admin passphrase, and local safe-use compliance.
- `Phone tester`: chaplain or RP using the app in normal deckplating.

Do not become the permanent administrator for another team's app during this pilot. The pilot lead must be able to own their local copy.

## Before The Setup Call

Send the pilot lead:

- Setup site: <https://deckplatingsetup.netlify.app>
- User guide: <https://deckplatingsetup.netlify.app/user-guide.html>
- Feedback form: <https://deckplatingsetup.netlify.app/#feedback>
- Source repository: <https://github.com/austingrimesphoto/deckplating>
- Safe-use policy: [SAFE_USE.md](SAFE_USE.md)
- Pilot packet: [PILOT_PACKET.md](PILOT_PACKET.md)

Confirm:

- they will start with GitHub, then use GitHub login for Supabase and Netlify when available,
- they have an account owner for GitHub, Supabase, and Netlify,
- they understand this is a local development beta,
- they will not enter CUI, counseling notes, medical details, PII, or sensitive operational locations,
- they have one installation or command name for map center lookup,
- they have 30-60 minutes available for first setup,
- they agree to submit setup feedback before the first call ends,
- they agree to submit closeout feedback after 2-4 weeks.

## Setup-Call Script

Use this sequence on the first live support call.

### 1. State The Boundary

Say this first:

```text
Deckplating is only for unclassified, non-sensitive coverage awareness. Do not enter counseling notes, medical information, personal details, home addresses, phone numbers, emails, dates of birth, CUI, classified information, or sensitive operational locations. If a location should not be broadly shared, leave it unmapped and use manual check-in.
```

Stop the pilot if the team wants to use the app outside that boundary.

### 2. Confirm Account Ownership

Ask:

- Who owns the GitHub account or organization?
- Who owns the Supabase project?
- Who owns the Netlify site?
- Is this tied to a durable team account where possible, or one person's personal account?

Record the answer in the pilot notes.

### 3. Walk The Setup Wizard

Have the pilot lead share screen if possible.

Proceed in this order:

1. Open <https://deckplatingsetup.netlify.app>.
2. Create or open the GitHub account.
3. Use the GitHub template to create their own repository copy.
4. Create or open Supabase using GitHub login when offered.
5. Press **Create new project** in Supabase.
6. Run the schema/migrations SQL block.
7. Run the starter-data SQL block.
8. Create or open Netlify using GitHub login when offered.
9. Press **Add new site** or equivalent Netlify create-site action.
10. Connect the copied GitHub repository.
11. Add the generated environment variables.
12. Deploy the site.
13. Open the deployed app on a phone.

If a button label changes on GitHub, Supabase, or Netlify, capture the new label for documentation updates.

### 4. First App Smoke Test

On the phone:

1. Open the deployed app.
2. Select the example roster identity.
3. Create a 4-digit PIN.
4. Open Admin with the generated admin passphrase.
5. Replace the example team member, area, and unit.
6. Add one public/general mapped location.
7. Attach one unit to that location.
8. Test **Locate Me** if physically near the location.
9. Test **Manual unit lookup**.
10. Submit one check-in.
11. Confirm Coverage and Mission Board update.
12. Open Reports and confirm the generic indicator counts make sense.

### 5. Immediate Feedback

Before ending the call, have the pilot lead submit the feedback form:

<https://deckplatingsetup.netlify.app/#feedback>

Tell them to submit again after 2-4 weeks of actual use.

Record before the call ends:

- whether the pilot lead could complete each major step without takeover,
- whether at least one phone user can proceed past first sign-in,
- whether reports and generic indicators made sense,
- whether any `P0` or `P1` blocker is already present.

## Issue Triage Flow

When a tester reports an issue, capture these facts before troubleshooting:

- team name or installation,
- phone model,
- browser or phone-home-screen app,
- online or offline,
- exact screen,
- exact error text,
- whether a visit was waiting to upload,
- whether the issue repeats after closing and reopening the app,
- whether safe-use data may be visible in screenshots.

Then classify the issue:

1. Is there data loss, cross-user exposure, unsafe data handling, or broken login? Mark `P0`.
2. Is setup, check-in, sync, or normal phone use blocked? Mark `P1`.
3. Does the workflow work but feel confusing, slow, or unreliable? Mark `P2`.
4. Is it polish, wording, or a nice-to-have? Mark `P3`.

Log the issue in [PILOT_FEEDBACK_REVIEW.md](PILOT_FEEDBACK_REVIEW.md).

If the issue means another RMT could not reasonably adopt the app, mark it as an adoption blocker even if the local team found a workaround.

## Fast Support Responses

### Setup Stuck

- Confirm they started with GitHub.
- Confirm they used GitHub login for Supabase and Netlify where available.
- Confirm they created a new Supabase project, not just an account.
- Confirm all migrations and `seed.sql` ran in order.
- Confirm Netlify has all required environment variables.
- Confirm the build uses the copied repository.

### Phone Cannot Locate User

- Confirm location permission is enabled.
- On iPhone, confirm **Precise Location** is on.
- Ask whether the phone reports broad accuracy.
- Use manual lookup for the visit.
- Later, check the saved location coordinates and radius.

### App Is Slow Or Frozen Offline

- Have them close and reopen the app.
- Confirm whether a cached snapshot exists.
- Tell them not to repeatedly tap submit.
- Use manual lookup if map tiles are unavailable.
- Ask whether any visits are waiting to upload.

### Sync Needs PIN Refresh

- Have the same user enter their existing 4-digit PIN.
- Do not change identity.
- Do not delete the app.
- Confirm queued visits remain after refresh.

### Accidental Check-In

- If still on confirmation and recent, use **Undo this check-in**.
- If queued offline and not synced, undo locally.
- If older or synced, use **Admin > Activity Log**.

## Weekly Pilot Cadence

Run this rhythm for each pilot team.

### Day 0

- Setup call.
- First app smoke test.
- Immediate feedback form.
- Log setup blockers.

### Week 1

- Confirm at least one phone user checked in during normal work.
- Confirm the app was opened from phone home screen if possible.
- Ask specifically about GPS, manual lookup, confirmation delay, offline behavior, and Mission Board usefulness.

### Week 2

- Confirm whether the team would keep using it without you present.
- Ask what would stop another RMT from adopting it.
- Ask whether admin screens and reports are usable without developer interpretation.
- Review Netlify Forms feedback.
- Update the pilot feedback review table.

### Week 3-4, If Continuing

- Look for repeated friction, not one-off comments.
- Validate whether fixes are documentation, setup wizard, app behavior, or long-term managed hosting.

## Go / No-Go Checklist

Mark the pilot `Go` only if:

- setup completed with limited support,
- at least one phone user completed normal check-ins,
- manual lookup worked,
- offline queued visits synced,
- no duplicate check-ins or points were observed,
- safe-use boundaries were understood,
- the local lead can administer roster, locations, and units,
- the local lead can understand the generic reports,
- feedback was submitted through the hosted form.

Mark `Go with fixes` if:

- the core app works,
- the team would keep using it,
- but setup, documentation, GPS, offline behavior, or reporting needs a targeted fix.

Mark `No-go until blockers are fixed` if:

- setup requires you to do most of the work,
- phone check-in is unreliable,
- offline sync risks losing work,
- safe-use boundaries are not understood,
- the team cannot identify an app owner,
- there is an unresolved `P0` or `P1`.

## What Not To Do During Pilot Support

- Do not enter production data for the team.
- Do not store their service-role key in notes, chat, screenshots, or email.
- Do not become their long-term app administrator.
- Do not encourage mapping sensitive locations.
- Do not add features during a setup call.
- Do not treat one team's preference as a product requirement until it appears in real use or affects adoption.

## Closeout Questions

Ask the pilot lead:

1. Would you keep using Deckplating next month?
2. What was the hardest setup step?
3. What was the hardest phone workflow?
4. Did the team understand what not to enter?
5. Did Coverage change where you chose to go?
6. Did Mission Board encourage useful behavior?
7. Did offline mode work well enough for your buildings?
8. What would stop another RMT from adopting this?
9. Would centralized hosting materially change your willingness to use it?
10. Could your local lead manage the app and understand reports without developer help?

## Output After Each Pilot

Create one closeout note with:

- team name or installation,
- pilot dates,
- phone types,
- setup result,
- app-use result,
- top three blockers,
- top three useful features,
- safe-use concerns,
- go / no-go decision,
- recommended next release items.

Use [PILOT_CLOSEOUT_TEMPLATE.md](PILOT_CLOSEOUT_TEMPLATE.md) for the closeout and record the final decision in [PILOT_DECISION_LOG.md](PILOT_DECISION_LOG.md).
