# Pilot Decision Log

Use this as the running decision record for Deckplating pilot expansion.

Every outside pilot should produce:

- one feedback review entry in [PILOT_FEEDBACK_REVIEW.md](PILOT_FEEDBACK_REVIEW.md),
- one closeout based on [PILOT_CLOSEOUT_TEMPLATE.md](PILOT_CLOSEOUT_TEMPLATE.md),
- one row in this decision log.

## Decision Status

Current distribution status:

- `Self-hosted beta`: allowed for carefully supported outside pilots.
- `Broad self-service beta`: not approved yet.
- `Managed centralized hosting`: planned, not started.

Current decision:

```text
Continue with two outside RMT pilots before widening distribution or starting multi-organization hosting implementation.
```

## Pilot Decision Table

| Date | Team | Pilot Dates | Decision | Top Blocker | Top Adoption Signal | Required Before Next Pilot |
| --- | --- | --- | --- | --- | --- | --- |
| YYYY-MM-DD | Example RMT | YYYY-MM-DD to YYYY-MM-DD | Go / Go with fixes / No-go |  |  |  |

## Release Decision Table

Use this table when deciding what goes into the next implementation release.

| Date Added | Candidate | Source Pilot | Severity | Adoption Weight | Decision | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| YYYY-MM-DD |  |  | P0/P1/P2/P3 | High/Medium/Low | Build next / Hold / Reject |  |

## Stop Conditions

Pause pilot expansion if any of these happen:

- unresolved `P0` issue,
- repeated `P1` issue across more than one team,
- any evidence of cross-team or cross-user data exposure,
- safe-use boundary is misunderstood by more than one team,
- offline sync risks losing real check-ins,
- phone check-in remains too slow or unreliable for normal use,
- setup requires the project owner to do most of the work for each team.

## Expand Conditions

Consider adding more outside teams only when:

- at least two outside RMTs complete setup with limited support,
- each has at least one active phone user,
- online and offline check-ins work in normal use,
- queued visits sync without duplicate records,
- the local lead can administer roster, locations, and units,
- no unresolved `P0` or `P1` issues remain,
- the feedback form and closeout process produce actionable data.

## Managed Hosting Trigger

Begin centralized multi-organization architecture work only when pilot evidence shows:

- self-hosted setup is the primary adoption blocker,
- the core phone workflow is useful enough to keep,
- safe-use boundaries are understood,
- outside teams want the tool but do not want GitHub, Supabase, or Netlify setup,
- support burden would drop materially with one hosted link and organization setup flow.

## Decision Notes

Append dated notes here.

### 2026-07-05

- Decision: Pilot execution is ready internally but blocked externally until two outside RMT leads are identified and agree to the setup and closeout feedback cadence.
- Evidence:
  - The pilot packet, readiness guide, feedback template, support playbook, invitation message, closeout template, and decision log are current.
  - No actual outside-team pilot leads, contact records, setup feedback artifacts, or closeout artifacts are present in the repository.
  - No in-repo evidence exists yet to satisfy the Stage 2 pilot execution exit criteria.
- Follow-up:
  - Send the current pilot packet or invitation message to two real outside RMT leads.
  - Confirm durable GitHub, Supabase, and Netlify ownership for each lead.
  - Schedule setup calls and collect one setup feedback artifact plus one closeout artifact per team.
