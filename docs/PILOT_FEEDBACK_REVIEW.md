# Pilot Feedback Review

Use this document after outside teams begin submitting Deckplating pilot feedback.

It is the review layer that sits between:

- raw web-form submissions,
- ad hoc texts or emails,
- and actual product decisions.

## Review Goal

Turn pilot feedback into three outputs:

1. immediate blockers,
2. next-release candidates,
3. evidence for go / no-go on wider pilot use.

## Where Feedback Comes From

Primary source:

- Netlify Forms on `https://deckplatingsetup.netlify.app`

Secondary sources:

- live setup support notes,
- follow-up calls,
- emailed observations from pilot leads.

If feedback comes from a call or message, rewrite it into the same structure used by the hosted feedback form before reviewing it.

## Review Cadence

Run this review:

- once after each team completes setup,
- once per week during a 2-4 week pilot,
- once at pilot closeout.

## Triage Buckets

Classify each issue into one bucket only.

- `Setup`: account creation, GitHub, Supabase, Netlify, setup wizard, environment variables.
- `Identity`: name selection, PIN, session refresh, device behavior.
- `Check-in`: nearby flow, manual flow, confirmation, undo.
- `Map/GPS`: locate me, accuracy, nearby matching, map rendering.
- `Offline/Sync`: cached launch, queued visits, sync retry, expired session.
- `Coverage/Mission Board`: command detail, reporting, nudges, badges, leaderboard.
- `Admin`: areas, locations, units, team members, activity log, corrections.
- `Safe Use`: misunderstanding of approved data boundaries or mapping restrictions.
- `Performance`: slow loads, freezes, delayed confirmation, poor phone responsiveness.
- `Documentation`: setup guide, user guide, missing links, confusing wording.

## Severity Rules

- `P0`: data loss, cross-user data exposure, unsafe sensitive-data handling, broken login for normal users.
- `P1`: core workflow blocked for a normal pilot team, including setup failure, failed check-in, failed sync, or repeated app freeze.
- `P2`: workflow works but is confusing, slow, or unreliable enough to reduce adoption.
- `P3`: polish issue, wording issue, minor visual defect, or enhancement request.

## Adoption Weight

For each issue, assign one adoption weight:

- `High`: another RMT is unlikely to adopt the app until fixed.
- `Medium`: adoption is still possible, but support burden stays high.
- `Low`: useful improvement, but not a pilot gate.

## Decision Rules

Treat feedback this way:

- Fix immediately if it is `P0` or `P1`.
- Queue for next release if it is `P2` with `High` or `Medium` adoption weight.
- Hold for later if it is `P3` unless it appears across multiple pilot teams.
- Pause broader rollout if safe-use confusion appears in more than one team.

## Review Table

Copy this table for each pilot team and append rows as needed.

| Date | Team | Source | Bucket | Issue | Severity | Adoption Weight | Reproducible | Action | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| YYYY-MM-DD | Example team | Setup form | Setup | Supabase step unclear | P2 | High | Yes | Fix docs and setup wizard wording | Austin | Open |

## Weekly Pilot Summary

Fill out one summary per active pilot week.

### Team

- Installation or command:
- Pilot week:
- Number of active users:
- Phone types observed:

### What Worked

- 

### What Broke

- 

### Biggest Friction

- 

### Safe-Use Concerns

- None / list here

### Adoption Read

- `Go`
- `Go with fixes`
- `No-go until blockers are fixed`

### Required Before Next Team

1.
2.
3.

## Cross-Pilot Decision Board

Use this section to track patterns across teams.

### Release-Blocking Patterns

- 

### Repeated P2 Friction

- 

### Documentation Gaps

- 

### Training Gaps

- 

### Candidate Features To Delay

- 

## Go / No-Go Criteria For Broader Pilot

Do not widen pilot distribution until these are true:

- at least two outside RMTs complete setup with limited support,
- phone check-in works reliably online and offline,
- queued visits sync without duplicate records,
- users understand safe-use boundaries,
- Mission Board and Coverage help teams decide where to go next,
- no unresolved `P0` or `P1` issues remain.

## What To Build Next

Promote an item into the next implementation prompt only if:

- it appears in real pilot use, not just theory,
- it affects adoption, reliability, or safe use,
- the problem can be stated in one concrete workflow,
- success can be validated on a phone by a normal pilot user.
