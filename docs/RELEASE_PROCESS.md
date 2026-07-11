# Release Process

Use this when publishing a new Deckplating version for other RMTs.

## Version Names

Use simple version tags:

```text
v1.0.0
v1.1.0
v1.2.0
```

Suggested meaning:

- Patch release, such as `v1.0.1`: bug fixes and small copy changes.
- Minor release, such as `v1.1.0`: new features that should be easy to adopt.
- Major release, such as `v2.0.0`: changes that may require setup or database migration work.

## Before Creating A Release

Run:

```bash
npm ci
npm run validate
npm run test:ui
npm audit --audit-level=moderate
```

Check:

- The complete validation and browser workflow suites pass.
- The dependency audit has no moderate, high, or critical advisories.
- `README.md` is current.
- `docs/SETUP_GUIDE.md` is current.
- `docs/PILOT_READINESS_GUIDE.md` and `docs/PILOT_FEEDBACK_TEMPLATE.md` are current before outside-team pilots.
- `docs/PILOT_INVITATION_MESSAGE.md` and `docs/BETA_RELEASE_NOTES_CURRENT.md` are current before sending a beta handoff.
- `docs/OFFLINE_TEST_CHECKLIST.md` and `docs/MISSION_BOARD_TEST_CHECKLIST.md` were reviewed for relevant changes.
- `setup-site/` is current if setup instructions changed.
- Any database changes are documented.
- Any new environment variables are documented.

## Database Migration Order

When a release adds a migration, apply it before deploying API code that depends on it:

```bash
supabase backups list
supabase db push --linked --dry-run
supabase db push --linked
supabase db lint --linked --level warning
supabase migration list --linked
```

Do not migrate until a provider recovery point or a locally verified logical archive exists. A local archive must include schema and data, have owner-only permissions, pass its checksum, and produce a valid `pg_restore --list` inventory. Keep it in an ignored directory and never commit database contents.

Confirm the dry run lists only reviewed migrations. For this release, migrations `011` and `012` plus `supabase/tests/011_security_reliability_hardening.sql` were also executed inside rollback-only transactions before each real push. Both migrations must be applied before the matching Netlify deployment; the API intentionally fails closed when its transaction, credential, and rate-limit functions are missing.

## Deploy The Reviewed Artifacts

Always name the destination site explicitly. The repo root is linked to the application site, so an unqualified setup-site deploy can overwrite the application.

```bash
npm run build
netlify deploy --prod --no-build --dir=dist --site deckplating --message "v0.6.0-beta"

npm --prefix setup-site run build
netlify deploy --prod --no-build --dir=setup-site/dist --site deckplatingsetup --message "v0.6.0-beta"
```

Run the production smoke and two-workspace isolation suites only with the explicit production mutation override. Confirm that each suite reports successful cleanup before considering the release complete.

## Rollback

Restore the previous application deploy first if the new frontend or function bundle fails. Leave additive migration `011` in place unless it is proven to be the cause; the previous API remains compatible with its preserved PostgREST relationship names.

The pre-`v0.6.0-beta` production deploy IDs are:

- application: `6a4ef839bccb57000814254d`
- setup site: `6a4eb25722959356b1f5918d`

Restore through the Netlify deploy UI or the reviewed `restoreSiteDeploy` API operation. Restore the database archive only during stopped writes and only for demonstrated database corruption, because a database restore discards all activity after the backup.

## Create A GitHub Release

1. Open the GitHub repository.
2. Click **Releases**.
3. Click **Draft a new release**.
4. Click **Choose a tag**.
5. Type the new version, for example `v1.1.0`.
6. Click **Create new tag**.
7. Title the release, for example `v1.1.0 - Mobile layout fixes`.
8. Paste release notes.
9. Click **Publish release**.

## Release Notes Template

```md
## What's New

- Short plain-English bullet.
- Short plain-English bullet.

## Who Should Update

- Update if you need this fix or feature.
- No urgent action is required if your current setup is working.

## Setup Changes

- None.

## Database Changes

- None.

## Environment Variable Changes

- None.

## Known Issues

- None.
```

## What To Tell Other Teams

Use plain language:

```text
A new Deckplating version is available:
https://github.com/YOUR-ORG/YOUR-REPO/releases

Read the release notes before updating. If your current copy is working, you do not need to update immediately.
```
