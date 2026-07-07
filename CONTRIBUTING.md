# Contributing

Deckplating is currently an alpha/beta self-hosted template. Keep changes small, practical, and easy for another RMT to adopt.

## Beta Workflow

Use `main` as the deployable template branch. Make focused changes, run validation, then publish releases when the setup path or app behavior changes.

## Release Names

Use simple prerelease names while the project is early:

- `v0.1.0-alpha`
- `v0.1.1-alpha`
- `v0.2.0-alpha`

Document user-facing changes in `CHANGELOG.md` before tagging a release.

## Do Not Commit Generated Files

Do not commit:

- `node_modules/`
- `dist/`
- `.env`
- `.netlify/`
- `setup-site/dist/`

Keep `package-lock.json` committed so installs are reproducible.

## Validation

Before proposing a release, run:

```bash
npm run test:tenant-isolation
npm run typecheck
npm run build
npm run build --prefix setup-site
```
