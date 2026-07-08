# N6 / Privacy / Records Review Packet

Deckplating is designed to reduce risk, not to claim approval.

## Purpose

Deckplating is an unofficial open-source prototype for technical demonstration of unclassified, non-sensitive Religious Ministry Team coverage awareness. It is not approved by the Department of the Navy or Department of Defense.

## Current Hosting Stack

Current demonstration stack:

- React/Vite progressive web app
- Netlify static hosting and serverless functions
- Supabase Postgres database accessed only through server-side functions
- MapLibre/OpenStreetMap-compatible map tiles

This stack is the current prototype implementation, not an assertion that it is approved for Navy operational use.

## Data Categories

- controlled demonstration workspace metadata
- broad areas
- public/general mapped locations
- non-sensitive unit/department/division/tenant-command labels
- team member display names for local accountability
- generic visit/check-in timestamps and coverage status
- administrative contact email for approval notification when necessary
- operator audit metadata

## Prohibited Data

Do not enter CUI, classified information, counseling notes, case-management data, medical details, incident details, family information, home addresses, phone numbers, dates of birth, private email addresses, setup codes or passphrases in feedback/screenshots/reports, sensitive operational locations, SCIFs, restricted rooms, deployed/theater locations, or official records.

## Records Boundary

Deckplating is not a system of record. Demonstration data should not be treated as official records, counseling records, medical records, case files, or command reporting products. Any official recordkeeping must happen in approved channels outside Deckplating.

## Privacy Considerations

Deckplating is designed to avoid sensitive PII and minimize low-sensitivity administrative identity/contact data. Team display names and official administrative contact emails may be PII. They should be limited to what is necessary for access coordination and local accountability.

## OPSEC/Location Controls

Map only public/general locations already broadly identifiable. Do not map SCIFs, restricted rooms, residences, deployed operational locations, or sensitive operational spaces. Sensitive locations should remain unmapped; users can use manual check-in for broad coverage status without storing precise location data.

## Authentication/Access Model

- Controlled workspace selection by slug/link
- One-time setup code for activation
- Local admin passphrase scoped to workspace
- Team member display-name selection plus local PIN
- Device/session tokens stored as hashes server-side
- Central operator access for demonstration workspace approval and lifecycle controls

This is not DoD enterprise identity.

## Notification/Email Model

Notifications are pluggable and default to disabled. Supported modes are disabled, mailto, smtp, provider, and future graph placeholder. Official administrative contact email is used only when necessary for approval coordination. Setup code plaintext must not be logged; if emailed, it is sent only when the operator intentionally approves sending setup information to the official administrative contact.

## Open Questions for N6/Privacy/Records/Legal/OPSEC

- Is this hosting stack authorized for the intended demonstration?
- Are government networks or devices permitted?
- Is the proposed display-name practice acceptable?
- Is administrative contact email acceptable and where should it be stored?
- What is the required retention/deletion period?
- Is any workspace/unit/location naming likely to create CUI or OPSEC issues?
- Is email delivery of setup information authorized, and through what provider?
- What approval is required before any operational use?

## Current Risk-Reduction Measures

- Safe-use warnings in app and docs
- Manual workspace approval; no open signup
- Setup codes and passphrases prohibited in feedback/screenshots/docs
- Sensitive location warnings and coordinate validation
- Server-side API mediation for database access
- Tenant-isolation checks
- Notification mode defaults to disabled
- Legacy visit indicator workflow disabled by default

## Stop Conditions

Stop use and seek guidance if prohibited data is entered, users attempt operational command adoption without authorization, sensitive locations are mapped, screenshots expose setup codes/passphrases/production data, or the app is treated as an official record or approved Navy system.
