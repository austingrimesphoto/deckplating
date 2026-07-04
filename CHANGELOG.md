# Changelog

## Unreleased

- Multi-Site Foundation v0.5.
  - Added `organizations` and default-organization schema groundwork.
  - Added `organization_id` to current organization-owned records.
  - Scoped API helpers and route queries to the default organization when the new schema is present.
  - Added organization-scoped admin credential and controlled setup-code groundwork.
  - Added protected central-operator API groundwork for approved workspace and setup-code creation.
  - Preserved current single-site behavior for existing self-hosted beta teams.
- Pilot Readiness Package v0.5.
  - Added outside-team pilot handoff guide.
  - Added pilot feedback template.
  - Added Mission Board validation checklist.
  - Updated setup-site SQL block to include current schema migrations through Mission Board settings.
  - Fixed setup troubleshooting and release-process documentation drift.
- Mission Board v0.4.
  - Renamed the score surface around meaningful coverage.
  - Added recovered-unit, distinct-unit, active-day, and computed badge display.
  - Added curated tone-controlled in-app nudges.
  - Added admin-selectable Mission Board tone.
- Offline-First Visit Batches, Optional Visit Indicators, and Deckplate Brief.
  - Added offline cached coverage, queued visit batches, and explicit sync status.
  - Added location-based check-in batches with idempotent retry behavior.
  - Added optional generic visit indicators for confidential care and referral counts.
  - Added local Deckplate Brief content after check-in confirmation.
  - Added PWA service-worker app shell caching and update prompt.
- Safe Use and Check-in Corrections.
  - Added safe-use guidance across the app and documentation.
  - Added soft-void support for check-ins.
  - Added immediate undo after check-in.
  - Added Admin Activity Log correction and voiding workflow.
  - Updated active coverage and scoring calculations to ignore voided check-ins.

## v0.1.0-alpha

- Placeholder for the first alpha release notes.
