# Managed Pilot Feedback Loop

This document records the current feedback path for centrally hosted managed pilots on `https://deckplating.netlify.app`.

## Current Status

Feedback capture exists and is now centered on the managed pilot support site, with a low-profile in-app link from `Account`.

What is already in place:

- hosted feedback capture uses the existing Netlify Form:
  - form name: `deckplating-pilot-feedback`
  - entry link: `https://deckplatingsetup.netlify.app/#feedback`
  - thank-you page: `https://deckplatingsetup.netlify.app/pilot-feedback-thanks.html`
- managed workspace requests use a separate Netlify Form:
  - form name: `deckplating-workspace-request`
  - entry link: `https://deckplatingsetup.netlify.app/#request`
  - thank-you page: `https://deckplatingsetup.netlify.app/workspace-request-thanks.html`
- `deckplating.netlify.app` includes `Account` > `Send feedback`, which opens the setup-site feedback form
- review workflow already exists in:
  - `docs/PILOT_FEEDBACK_REVIEW.md`
  - `docs/PILOT_DECISION_LOG.md`
  - `docs/PILOT_SUPPORT_PLAYBOOK.md`
  - `docs/PILOT_FEEDBACK_TEMPLATE.md`

What is not yet in place:

- no fully in-app feedback capture screen inside `deckplating.netlify.app`
- no automated email notification or approval workflow for workspace requests
- no ticketing integration; review remains manual

## Recommended Managed Pilot Cadence

For the next real pilot command, use this cadence:

1. Local lead submits a workspace request at `https://deckplatingsetup.netlify.app/#request`.
2. Operator manually reviews the request, creates the workspace, issues the setup code, and contacts the approved lead outside the form.
3. Operator sends the local lead:
   - the workspace link on `deckplating.netlify.app`
   - the one-time setup code
   - the user guide `https://deckplatingsetup.netlify.app/user-guide.html`
   - the feedback link `https://deckplatingsetup.netlify.app/#feedback`
4. Local lead submits one setup feedback response before the onboarding session ends.
5. Local lead submits one week-one feedback response after the first real-use week.
6. Local lead submits one closeout feedback response after 2-4 weeks of real use.
7. Any critical blocker or safe-use confusion is reported immediately outside the scheduled cadence if needed.

## Current Managed-Pilot Operator Packet

Until the managed feedback loop is moved into the hosted app, the operator should treat these as the minimum pilot handoff bundle:

- `https://deckplating.netlify.app/?workspace=<workspace-slug>`
- one-time setup code
- local admin instructions from `docs/CENTRAL_OPERATOR_GUIDE.md` and `docs/ADMINISTRATOR_RUNBOOK.md`
- hosted user guide: `https://deckplatingsetup.netlify.app/user-guide.html`
- feedback link: `https://deckplatingsetup.netlify.app/#feedback`

That keeps the first pilot path explicit without creating public signup or automated account provisioning.

## Review And Decision Path

Submitted feedback should still flow through the existing review process:

1. review Netlify Form submissions
2. normalize any call or message notes into the same template shape
3. classify each issue into one of the three first-pilot buckets:
   - onboarding confusion
   - operational blockers
   - feature requests
4. update `docs/PILOT_FEEDBACK_REVIEW.md`
5. record pilot decisions or blockers in `docs/PILOT_DECISION_LOG.md`

## Practical Readiness Assessment

Today, another chaplain at another installation can be onboarded into the managed hosted pilot with operator involvement and manual approval.

What still prevents a clean "send one link and let them self-start" handoff:

- stale-session UX around suspended/deleted workspaces needs more polish
- feedback capture still lives on the setup-site Netlify Form rather than inside a hosted-app workflow
- workspace request approval is manual and has no automated email notification
- live two-workspace integration coverage still needs to be run repeatedly against safe targets

## Recommended Next Follow-Up

After the first RMT onboarding materials are reviewed, the next hardening pass should:

- improve stale-session UX for suspended/deleted workspaces
- run the live two-workspace integration script against a safe target
- add operator audit review/export surfaces
- review performance on bootstrap, map, coverage, and admin activity routes
- keep the existing Netlify Form and review workflow unless pilot feedback proves it is too clumsy
