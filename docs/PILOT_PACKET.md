# Deckplating Pilot Packet

Use this packet for the first two outside-team beta pilots.

## Who This Is For

Send this to one RMT lead who is willing to run a 2-4 week beta pilot for unclassified, non-sensitive ministry coverage awareness.

Best fit:

- one command chaplain or RMT leader who can own setup,
- at least one chaplain or RP who will use the app on a phone,
- a manageable list of departments, divisions, or tenant commands,
- permission to use a local beta tool for non-sensitive coverage metadata only,
- willingness to submit setup feedback once and usage feedback again after real use.

Do not start the pilot if the team expects centrally hosted onboarding, wants to store sensitive data, or cannot identify durable owners for GitHub, Supabase, and Netlify.

## Send This Message

```text
Subject: Deckplating outside-team beta pilot

I am testing Deckplating, a mobile web app for unclassified, non-sensitive ministry coverage awareness.

It helps an RMT:
- map public buildings or general areas,
- track department/division/tenant-command visits,
- see overdue and never-visited units,
- log visits from a phone,
- keep working when connectivity is poor,
- review Mission Board progress without storing counseling or sensitive operational data.

This is a beta pilot. It is not for CUI, classified information, counseling notes, medical details, home addresses, family information, phone numbers, email addresses, dates of birth, or sensitive operational locations.

Start here:
https://deckplatingsetup.netlify.app

How to use the app after setup:
https://deckplatingsetup.netlify.app/user-guide.html

Source repository:
https://github.com/austingrimesphoto/deckplating

Feedback form:
https://deckplatingsetup.netlify.app/#feedback

Suggested pilot:
- use it for 2 to 4 weeks,
- start with GitHub first, then use GitHub login for Supabase and Netlify when available,
- one RMT lead handles setup,
- at least one chaplain or RP uses it on a phone,
- use normal deckplating only,
- do not enter sensitive details,
- submit feedback once after setup and again after real use,
- report setup friction, phone issues, GPS/map issues, offline behavior, admin workflow, reporting usefulness, safe-use clarity, Mission Board usefulness, and anything that would stop another team from adopting it.
```

## Links To Include

- Setup wizard: <https://deckplatingsetup.netlify.app>
- User guide: <https://deckplatingsetup.netlify.app/user-guide.html>
- Feedback form: <https://deckplatingsetup.netlify.app/#feedback>
- Source repository: <https://github.com/austingrimesphoto/deckplating>
- Safe-use policy: [SAFE_USE.md](SAFE_USE.md)
- Setup guide: [SETUP_GUIDE.md](SETUP_GUIDE.md)
- Pilot readiness guide: [PILOT_READINESS_GUIDE.md](PILOT_READINESS_GUIDE.md)
- Pilot support playbook: [PILOT_SUPPORT_PLAYBOOK.md](PILOT_SUPPORT_PLAYBOOK.md)
- Pilot dry-run checklist: [PILOT_DRY_RUN_CHECKLIST.md](PILOT_DRY_RUN_CHECKLIST.md)
- Latest dry-run results: [PILOT_DRY_RUN_RESULTS_2026-07-04.md](PILOT_DRY_RUN_RESULTS_2026-07-04.md)
- Pilot feedback review workflow: [PILOT_FEEDBACK_REVIEW.md](PILOT_FEEDBACK_REVIEW.md)

## Ask Before They Start

- Who will own the GitHub, Supabase, and Netlify accounts?
- Will they use a command/team account instead of one person's personal account?
- Who will perform initial setup?
- How many phone users will test?
- What installation or command will they use as the map center?
- Are they comfortable testing the current self-hosted beta before centralized hosting exists?
- When will they submit setup feedback?
- When will they submit 2-4 week usage feedback?

## First 30 Minutes

Ask the pilot lead to complete this first-session checklist:

1. Read the safe-use policy.
2. Open the hosted setup wizard.
3. Create the GitHub template copy.
4. Create the Supabase project.
5. Run the schema/migrations block.
6. Run the starter-data block.
7. Generate and copy Netlify environment variables.
8. Deploy the app to Netlify.
9. Open the app on a phone.
10. Select the example team member and create a 4-digit PIN.
11. Open Admin and enter the admin passphrase.
12. Replace the example area, unit, and team member.
13. Add one real mapped public building or general area.
14. Attach one or more departments, divisions, or tenant commands to that location.
15. Return to Check In and test a normal check-in.
16. Open Coverage and confirm the unit status changed.
17. Open Mission Board and confirm the check-in appears.
18. Open Reports and confirm the generic indicator counts are understandable.
19. Submit the setup feedback form before ending the session.

## Pilot Timeline

- Day 0: setup call, smoke test, and immediate setup feedback submission.
- Week 1: at least one real phone check-in during normal work and a short owner follow-up.
- Week 2: checkpoint on offline behavior, admin workflow, reports, and Mission Board usefulness.
- Week 3-4: final feedback submission and go/no-go assessment.

## Pilot Boundaries

Do not use Deckplating for:

- CUI,
- classified information,
- counseling notes,
- medical details,
- incident details,
- family information,
- addresses,
- phone numbers,
- email addresses,
- dates of birth,
- sensitive operational locations,
- official records.

If a location should not be broadly shared, leave it unmapped and use manual check-in.

## Feedback Expectations

Ask the pilot team to submit feedback at least twice:

- once immediately after setup,
- once after 2-4 weeks of real use.

Feedback link:

<https://deckplatingsetup.netlify.app/#feedback>

Ask them to focus on:

- setup friction,
- phone type and browser/home-screen mode,
- GPS precision problems,
- map-radius problems,
- offline and sync behavior,
- admin workflow clarity,
- reporting usefulness,
- safe-use clarity,
- whether manual check-in made sense,
- whether Coverage and Mission Board helped them decide where to go,
- what would stop another RMT from adopting it.

## Owner Follow-Up Checklist

After sending this packet:

- confirm the RMT lead received the setup link,
- confirm they understand the safe-use boundary,
- confirm they know this is self-hosted and beta,
- confirm they can create or access GitHub, Supabase, and Netlify accounts,
- schedule a 30-minute setup support window,
- ask them to submit the feedback form after setup,
- schedule one midpoint check-in and one final closeout check-in,
- check Netlify Forms for their feedback submission,
- capture any blockers in the project roadmap.

## Stop Conditions

Pause the pilot if:

- they want to enter CUI, counseling notes, medical information, or sensitive location data,
- they cannot identify an account owner for GitHub/Supabase/Netlify,
- setup cannot be completed without you doing every step for them,
- phone use is too slow or unreliable for normal check-ins,
- offline sync fails in a way that could lose real work,
- admin workflow or reports are too confusing for normal local ownership,
- feedback indicates the safe-use boundary is not understood.
