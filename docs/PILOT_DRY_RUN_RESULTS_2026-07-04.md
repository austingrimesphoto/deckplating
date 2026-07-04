# Pilot Dry Run Results - 2026-07-04

## Summary

This dry run tested the public Deckplating setup handoff path as far as the available local account authentication allowed.

## Passed

- Hosted setup site loaded:
  - <https://deckplatingsetup.netlify.app>
- Hosted user guide loaded:
  - <https://deckplatingsetup.netlify.app/user-guide.html>
- Hosted feedback thank-you page loaded:
  - <https://deckplatingsetup.netlify.app/pilot-feedback-thanks.html>
- GitHub template repository is public and marked as a template:
  - <https://github.com/austingrimesphoto/deckplating>
- Temporary GitHub template copy was created successfully:
  - `austingrimesphoto/deckplating-dry-run-20260704143205`
- The temporary copy contained expected root files, `setup-site/`, `supabase/`, `netlify/`, `src/`, and documentation.
- The deployed setup site points to:
  - <https://github.com/austingrimesphoto/deckplating>
  - <https://github.com/austingrimesphoto/deckplating/generate>
- Hosted setup site feedback form used the current form name:
  - `deckplating-pilot-feedback`
- A clearly marked non-sensitive test feedback submission reached the feedback thank-you page.

## Blocked

The full live throwaway deployment could not continue from this machine because:

- Netlify CLI is installed but not logged in.
- Supabase CLI is not installed.
- No Supabase access-token path was available locally.

No Supabase project, Netlify app site, database migration, or production app deployment was created during this dry run.

## Temporary Repo Cleanup

The temporary public repo could not be deleted because the current GitHub token lacks the `delete_repo` scope.

To delete it:

```bash
gh auth refresh -h github.com -s delete_repo
gh repo delete austingrimesphoto/deckplating-dry-run-20260704143205 --yes
```

The temporary repo is only a public copy of the public Deckplating template. It does not contain secrets, Supabase data, Netlify settings, or pilot data.

## Required Before Full Live Setup Test

Authenticate Netlify CLI:

```bash
netlify login
netlify status
```

Install and authenticate Supabase CLI, or create the Supabase project manually through the hosted setup guide:

```bash
brew install supabase/tap/supabase
supabase login
```

After those are available, repeat the dry run using:

- [PILOT_DRY_RUN_CHECKLIST.md](PILOT_DRY_RUN_CHECKLIST.md)
- <https://deckplatingsetup.netlify.app>

## Notes

- The setup site, user guide, feedback route, and GitHub template handoff are ready for an outside-team setup attempt.
- The remaining untested portion is the full external-service creation path: Supabase project, Netlify site, environment variables, SQL execution, and first app launch.
