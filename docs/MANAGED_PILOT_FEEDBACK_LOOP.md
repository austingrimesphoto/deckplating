# Managed Pilot Feedback Loop

This document records the current feedback path for centrally hosted managed pilots on `https://deckplating.netlify.app`.

## Current Status

Feedback capture **exists**, but it is not yet fully re-centered inside the managed hosted app.

What is already in place:

- hosted feedback capture uses the existing Netlify Form:
  - form name: `deckplating-pilot-feedback`
  - entry link: `https://deckplatingsetup.netlify.app/#feedback`
  - thank-you page: `https://deckplatingsetup.netlify.app/pilot-feedback-thanks.html`
- review workflow already exists in:
  - `docs/PILOT_FEEDBACK_REVIEW.md`
  - `docs/PILOT_DECISION_LOG.md`
  - `docs/PILOT_SUPPORT_PLAYBOOK.md`
  - `docs/PILOT_FEEDBACK_TEMPLATE.md`

What is not yet in place:

- no feedback link inside `https://deckplating.netlify.app`
- no managed-pilot-specific feedback entry screen in the hosted app
- some feedback-facing docs still assume the self-hosted/setup-site flow as the default user journey

## Recommended Managed Pilot Cadence

For the next real pilot command, use this cadence:

1. Operator sends the local lead:
   - the workspace link on `deckplating.netlify.app`
   - the one-time setup code
   - the feedback link `https://deckplatingsetup.netlify.app/#feedback`
2. Local lead submits one setup feedback response before the onboarding session ends.
3. Local lead submits one closeout feedback response after 2-4 weeks of real use.
4. Any critical blocker or safe-use confusion is reported immediately, outside the scheduled cadence if needed.

## Current Managed-Pilot Operator Packet

Until the managed feedback loop is moved into the hosted app, the operator should treat these as the minimum pilot handoff bundle:

- `https://deckplating.netlify.app/?workspace=<workspace-slug>`
- one-time setup code
- local admin instructions from `docs/CENTRAL_OPERATOR_GUIDE.md`
- feedback link: `https://deckplatingsetup.netlify.app/#feedback`

That means the project is close to a shareable hosted pilot, but not yet at a true single-link experience.

## Review And Decision Path

Submitted feedback should still flow through the existing review process:

1. review Netlify Form submissions
2. normalize any call or message notes into the same template shape
3. update `docs/PILOT_FEEDBACK_REVIEW.md`
4. record pilot decisions or blockers in `docs/PILOT_DECISION_LOG.md`

## Practical Readiness Assessment

Today, another chaplain at another installation could be onboarded into the managed hosted pilot **with operator involvement**.

What still prevents a clean "send one link and let them self-start" handoff:

- environment-wide admin fallback is still present and needs managed-host gating or removal
- operator-side containment controls are still minimal
- feedback capture is still off-app and tied to the setup-site Netlify Form
- there is not yet a managed-pilot-specific invitation/support packet that assumes the hosted path as the default

## Recommended Next Follow-Up

After `Managed Production Guardrails v1`, the next pilot-enablement pass should:

- add a feedback entry point inside `deckplating.netlify.app`
- update the invitation/support docs so managed hosting is the default pilot path
- keep the existing Netlify Form and review workflow unless there is a strong reason to replace it
