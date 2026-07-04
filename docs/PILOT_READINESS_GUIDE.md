# Pilot Readiness Guide

Use this guide before handing Deckplating to an outside RMT.

## Pilot Goal

Confirm that a normal RMT can use Deckplating for unclassified, non-sensitive coverage awareness without developer help.

The pilot is successful only if the team can:

- open the app on phones,
- sign in with name and PIN,
- add or edit roster, areas, locations, and units,
- check in online and offline,
- sync queued visits,
- understand safe-use limits,
- read coverage status and Mission Board progress,
- report issues clearly.

## Who To Recruit

Start with two outside RMTs that are willing to test for 2-4 weeks.

Prefer teams that have:

- one command chaplain or RMT lead willing to own setup,
- at least one RP or chaplain who will use the app on a phone,
- a manageable number of departments, divisions, or tenant commands,
- enough building access to test normal deckplate workflows,
- permission to use a beta tool for unclassified coverage metadata only.

## What To Send Them

Send one message with these links:

- Hosted setup site: `https://deckplatingsetup.netlify.app`
- Hosted user guide: `https://deckplatingsetup.netlify.app/user-guide.html`
- Hosted pilot feedback form: `https://deckplatingsetup.netlify.app/#feedback`
- Repository: `https://github.com/austingrimesphoto/deckplating`
- Pilot packet: `docs/PILOT_PACKET.md`
- Pilot support playbook: `docs/PILOT_SUPPORT_PLAYBOOK.md`
- Pilot closeout template: `docs/PILOT_CLOSEOUT_TEMPLATE.md`
- Pilot decision log: `docs/PILOT_DECISION_LOG.md`
- Setup guide: `docs/SETUP_GUIDE.md`
- Safe-use policy: `docs/SAFE_USE.md`
- Offline test checklist: `docs/OFFLINE_TEST_CHECKLIST.md`
- Pilot dry run checklist: `docs/PILOT_DRY_RUN_CHECKLIST.md`
- Latest dry run results: `docs/PILOT_DRY_RUN_RESULTS_2026-07-04.md`
- Pilot feedback template: `docs/PILOT_FEEDBACK_TEMPLATE.md`
- Pilot feedback review workflow: `docs/PILOT_FEEDBACK_REVIEW.md`

Suggested message:

```text
Deckplating is a beta tool for unclassified, non-sensitive ministry coverage awareness.

Start here:
https://deckplatingsetup.netlify.app

User guide:
https://deckplatingsetup.netlify.app/user-guide.html

If you need the source repository or backup reference:
https://github.com/austingrimesphoto/deckplating

Please read docs/SAFE_USE.md first, then follow docs/SETUP_GUIDE.md as needed.
After setup, use the app for normal deckplating for 2-4 weeks and capture feedback with docs/PILOT_FEEDBACK_TEMPLATE.md.
```

Tell pilot teams to start with GitHub first, then use GitHub sign-in for Supabase and Netlify when those sites offer it.

## First 30 Minutes

1. Read the safe-use policy.
2. Open the app on a phone.
3. Select the example team member and create a 4-digit PIN.
4. Open Admin and enter the admin passphrase.
5. Replace the example area, unit, and team member.
6. Add one real mapped public building or general area.
7. Attach one or more departments, divisions, or tenant commands to that location.
8. Return to Check In and test a normal check-in.
9. Open Coverage and confirm the unit status changed.
10. Open Mission Board and confirm the check-in appears.

## Pilot Boundaries

Do not use Deckplating for:

- CUI,
- classified information,
- counseling notes,
- medical details,
- incident details,
- home addresses,
- sensitive operational locations,
- official records.

If a location should not be broadly shared, leave it unmapped and use manual check-in.

## Support Triage

When a tester reports a problem, capture:

- phone type and whether the app was opened in a browser or from the phone home screen,
- whether the app was online or offline,
- what screen they were on,
- exact error text,
- whether a visit was pending sync,
- whether the issue repeated after closing and reopening the app.

Do not ask testers to send screenshots that expose sensitive locations or personal details.

## Where Feedback Goes

Pilot web-form submissions should be collected through the hosted setup site:

- Feedback link: `https://deckplatingsetup.netlify.app/#feedback`
- Storage location: Netlify Forms on the `deckplatingsetup.netlify.app` site

That keeps feedback centralized without asking pilot teams to paste notes back manually.
