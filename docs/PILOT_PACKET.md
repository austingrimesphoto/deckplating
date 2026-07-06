# Deckplating Managed Pilot Packet

Use this packet for the first outside RMT pilots using the centrally hosted app.

## Who This Is For

Send this to one RMT lead who is willing to run a 2-4 week managed pilot for unclassified, non-sensitive ministry coverage awareness.

Best fit:

- one command chaplain or RMT leader who can own local setup,
- at least one chaplain or RP who will use the app on a phone,
- a manageable list of departments, divisions, or tenant commands,
- permission to use a local beta tool for non-sensitive coverage metadata only,
- willingness to submit feedback after setup, after week one, and at closeout.

Do not start the pilot if the team wants public signup, sensitive data storage, counseling/case management, automated email invitations, or official-record workflows.

## Send This Message

```text
Subject: Deckplating managed pilot

I am testing Deckplating, a mobile web app for unclassified, non-sensitive ministry coverage awareness.

It helps an RMT:
- map public buildings or general areas,
- track department/division/tenant-command visits,
- see overdue and never-visited units,
- log visits from a phone,
- keep working when connectivity is poor,
- review Mission Board progress without storing counseling or sensitive operational data.

This is a managed beta pilot. Your team uses the centrally hosted app at:
https://deckplating.netlify.app

Start by requesting workspace access here:
https://deckplatingsetup.netlify.app/#request

After manual approval, I will send the approved lead a workspace link and one-time setup code. The lead will activate the workspace, set the local admin passphrase, and create the local roster, areas, locations, and units.

User guide:
https://deckplatingsetup.netlify.app/user-guide.html

Feedback form:
https://deckplatingsetup.netlify.app/#feedback

This is not for CUI, classified information, counseling notes, medical details, home addresses, family information, phone numbers, email addresses, dates of birth, setup codes, passphrases, or sensitive operational locations.

Suggested pilot:
- use it for 2 to 4 weeks,
- one approved local lead handles workspace activation and local setup,
- at least one chaplain or RP uses it on a phone,
- use normal deckplating/check-in workflows only,
- do not enter sensitive details,
- submit feedback after setup, after week one, and at closeout,
- report onboarding confusion, operational blockers, safe-use questions, and feature requests.
```

## Links To Include

- Managed app: <https://deckplating.netlify.app>
- Workspace request form: <https://deckplatingsetup.netlify.app/#request>
- User guide: <https://deckplatingsetup.netlify.app/user-guide.html>
- Feedback form: <https://deckplatingsetup.netlify.app/#feedback>
- Safe-use policy: [SAFE_USE.md](SAFE_USE.md)
- Administrator runbook: [ADMINISTRATOR_RUNBOOK.md](ADMINISTRATOR_RUNBOOK.md)
- Central operator guide: [CENTRAL_OPERATOR_GUIDE.md](CENTRAL_OPERATOR_GUIDE.md)
- Feedback review workflow: [PILOT_FEEDBACK_REVIEW.md](PILOT_FEEDBACK_REVIEW.md)

## Ask Before Approval

- Who will be the approved local lead?
- What official contact email should be used for coordination?
- What installation or command should identify the workspace?
- What preferred workspace slug should be used, if any?
- How many RMT members will use the pilot?
- What public/general location should be used as the initial map center?
- When will they submit setup, week-one, and closeout feedback?
- Do they understand the safe-use boundaries and that no sensitive data belongs in the app or forms?

## Operator Approval Steps

1. Review the workspace request form submission in Netlify Forms.
2. If approved, open `https://deckplating.netlify.app/?operator=1`.
3. Create the approved workspace.
4. Issue a one-time setup code.
5. Send the local lead:
   - workspace link,
   - one-time setup code,
   - user guide link,
   - feedback link,
   - safe-use reminder.
6. Do not send setup codes through public channels or record them in docs.

## First 30 Minutes

Ask the local lead to complete this first-session checklist:

1. Read the safe-use boundary.
2. Open the workspace link.
3. Select `Activate workspace`.
4. Enter the one-time setup code.
5. Confirm the workspace display name.
6. Find the public installation/map center.
7. Set the local admin passphrase.
8. Open `Admin` and review the onboarding checklist.
9. Create at least one area.
10. Create at least one public/general location.
11. Create at least one unit.
12. Create at least one team member.
13. Have a member select their name and create a PIN.
14. Complete one non-sensitive test check-in.
15. Open Coverage, Map, Mission Board, Account, and Admin settings.
16. Submit setup feedback before ending the session.

## Pilot Timeline

- Day 0: workspace request, approval, activation, smoke test, setup feedback.
- Week 1: at least one real phone check-in during normal work and one week-one feedback response.
- Week 2: checkpoint on offline behavior, admin workflow, reports, and Mission Board usefulness.
- Week 3-4: closeout feedback and go/no-go assessment.

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
- setup codes or passphrases,
- sensitive operational locations,
- official records.

If a location should not be broadly shared, leave it unmapped and use manual check-in.

## Feedback Expectations

Ask the pilot team to submit feedback at least three times:

- once immediately after setup,
- once after week one,
- once after 2-4 weeks of real use.

Feedback link:

<https://deckplatingsetup.netlify.app/#feedback>

Ask them to classify feedback into:

- onboarding confusion,
- operational blockers,
- feature requests.

Ask them to focus on:

- workspace request clarity,
- setup-code and activation clarity,
- local admin passphrase clarity,
- roster and map setup,
- phone type and browser/home-screen mode,
- GPS precision problems,
- map-radius problems,
- manual check-in,
- offline and sync behavior,
- admin workflow clarity,
- reporting usefulness,
- safe-use clarity,
- whether Coverage and Mission Board helped them decide where to go,
- what would stop another RMT from adopting it.

## Owner Follow-Up Checklist

After sending this packet:

- confirm the lead received the request link,
- confirm they understand manual approval is required,
- confirm they understand the safe-use boundary,
- create the workspace only after approval,
- send setup code only to the approved lead,
- schedule a setup support window,
- ask for setup feedback before the setup call ends,
- schedule one week-one check-in and one final closeout check-in,
- check Netlify Forms for workspace request and feedback submissions,
- capture blockers in the project roadmap.

## Stop Conditions

Pause the pilot if:

- they want to enter CUI, counseling notes, medical information, sensitive location data, or official records,
- the approved lead cannot complete activation/local setup with bounded support,
- phone use is too slow or unreliable for normal check-ins,
- offline sync fails in a way that could lose real work,
- admin workflow or reports are too confusing for normal local ownership,
- feedback indicates the safe-use boundary is not understood,
- any cross-workspace data exposure or auth-boundary concern appears.
