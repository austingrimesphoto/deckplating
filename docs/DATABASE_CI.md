# Database Behavior CI

The pull-request database job starts a disposable Supabase CLI stack and tests the real migration chain, Postgres functions, tenant constraints, RLS boundary, and PostgREST relationship discovery. It never connects to the linked production project.

## Architecture

The workflow in `.github/workflows/database-behavior.yml` uses:

- Supabase CLI `2.109.0`
- the official Supabase PostgreSQL 17 container
- PostgREST and Kong from the Supabase local stack
- the local Auth service required by the gateway
- Node.js 22 with `pg` for independent concurrent database sessions
- the existing `@supabase/supabase-js` client for PostgREST requests

Studio, Storage, Realtime, Inbucket, Edge Runtime, Functions, Analytics, Vector, image proxy, and database metadata services are disabled. The runner always calls `supabase stop --no-backup`, and the GitHub-hosted runner is discarded after the job.

The database is reset without seed data. Migrations `001` through `012` are applied in filename order from a truly empty public schema. The migration-version table is checked before fixtures are created.

## Local Requirements

- Docker with the daemon running
- Supabase CLI `2.109.0`
- PostgreSQL client (`psql`)
- Node.js 22 and npm

Install dependencies once:

```bash
npm ci
```

Run the same isolated suite used by CI:

```bash
npm run test:database
```

The command starts the local stack, resets it, runs the tracked SQL assertion in a rollback-only transaction, runs the behavior harness, and destroys the stack. It refuses non-loopback database or API URLs.

The expected cold-run budget is under 12 minutes, including container downloads. Warm local runs should be substantially faster. The first observed GitHub Actions runtime for this branch will be recorded in the pull request.

## Test Boundaries

Direct SQL tests cover:

- exact empty-database migration ordering
- validation and two-column shape of every tenant composite foreign key
- cross-tenant insert rejection
- rollback of a failed multi-write workspace approval
- overlapping check-in scoring transactions
- overlapping idempotent retries
- device registration racing an administrator PIN reset
- administrator credential recovery racing the login compare-and-set upgrade
- workspace approval racing rejection

PostgREST tests cover:

- anonymous access blocked by RLS
- cross-tenant writes rejected through the Data API
- composite `locations -> areas` embedding
- composite check-in embeds for unit, location, member, device, and batch
- absence of relationship ambiguity under the legacy relationship names retained by migration `011`

The tracked `supabase/tests/011_security_reliability_hardening.sql` assertion runs separately through `psql` inside `BEGIN`/`ROLLBACK`.

## Controlled Failure

The workflow-dispatch input `controlled_failure` sets a test-only mode that deliberately expects two check-ins from an idempotent retry. Before the workflow exists on the default branch, a push to a `ci/**` branch with `[controlled-db-failure]` in the commit message activates the same proof. A correct database produces one row, so the job must fail with the sanitized message:

```text
controlled failure: intentionally false idempotency expectation
```

Normal pull-request runs never enable this mode and execute the correct one-effect assertion.

## Secret Handling

Supabase CLI connection metadata is written to a temporary owner-only file, sourced with shell tracing disabled, masked in GitHub Actions, and removed during cleanup. Start and SQL failure logs pass through a redactor before the final 30 lines can be printed. No database log or artifact is uploaded.

All organization IDs, record IDs, credential material, device material, fingerprints, and setup-code material are generated at runtime. The Node harness catches unexpected database errors and reports only a test label and SQLSTATE, not query parameters, server details, or connection strings.

## Differences From Production

- The test environment contains generated fixtures rather than production data.
- External email, storage, realtime, browser, and Netlify services are not started.
- The local stack enables Supabase's legacy automatic table grants because this production project predates the newer default-deny grant behavior; RLS remains enabled and is tested with the local anonymous role.
- The administrator recovery/login race is exercised at the exact database boundary used by the application: initial credential read, compare-and-set legacy upgrade, recovery upsert, and credential-version invalidation. The Netlify handler itself is not started in this job.
- Container patch versions can advance independently of the hosted production patch version, while PostgreSQL major version 17 and migration behavior remain pinned by repository configuration and tests.
