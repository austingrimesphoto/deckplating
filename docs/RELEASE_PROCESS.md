# Release Process

Use this when publishing a new Deckplate Coverage version for other RMTs.

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
npm run build
```

Check:

- The app builds successfully.
- `README.md` is current.
- `docs/SETUP_GUIDE.md` is current.
- `setup-site/` is current if setup instructions changed.
- Any database changes are documented.
- Any new environment variables are documented.

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
A new Deckplate Coverage version is available:
https://github.com/YOUR-ORG/YOUR-REPO/releases

Read the release notes before updating. If your current copy is working, you do not need to update immediately.
```
