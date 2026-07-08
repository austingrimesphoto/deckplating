# Managed Distribution Roadmap

## Stage 1 - Mission Board and Pilot Readiness

Objective: improve usefulness and engagement in the current single-organization beta without changing the hosting model.

Scope:

- Mission Board meaningful-coverage display
- badge and Mission Brief engagement features
- offline reliability fixes
- setup and safe-use documentation
- current local development deployment path

Exclusions:

- multi-tenancy
- public self-service workspace signup
- enterprise identity
- CUI, classified, counseling, or official-record workflows

Exit criteria:

- current app remains stable for check-in, offline sync, coverage board, map, admin corrections, and reports
- Mission Board motivates meaningful coverage without rewarding raw volume
- non-technical setup docs remain usable for beta teams

## Stage 2 - Managed Hosted Small-Command Pilot

Objective: validate real command use through one centrally hosted, tenant-isolated Deckplating app before broader rollout.

Scope:

- a small number of approved commands use `deckplating.netlify.app`
- system administrator creates or approves each workspace and setup code
- local command leads activate their workspace and complete guided setup inside the app
- team members use the same hosted app while remaining inside their command sandbox
- collect feedback on guided onboarding, offline behavior, check-in reliability, admin workflow, reporting, and safe-use clarity
- verify central overhead visibility without cross-tenant data exposure

Exclusions:

- unrestricted onboarding
- new sensitive data collection
- app-store/native platform port
- each command creating GitHub, Supabase, or Netlify accounts as the normal path

Exit criteria:

- two or more commands activate managed workspaces
- local leads complete roster, locations, units, and local admin setup without GitHub/Supabase/Netlify exposure
- real check-ins and admin workflows operate inside tenant boundaries
- critical workflow blockers are documented or fixed
- there is clear evidence that the hosted path reduces adoption friction

## Stage 3 - Managed Service Hardening And Sustainment

Objective: make centrally hosted Deckplating durable enough for broader use, Navy handoff, or another sustainable operating model.

Scope:

- stronger central operator console
- workspace lifecycle administration
- backup, export, and deletion boundaries by organization
- repeated tenant-isolation integration checks with seeded workspaces
- operator audit review/export surfaces
- incident response and rollback process
- operational documentation for system administrator duties
- handoff-oriented documentation for future Navy ownership or a self-sustaining support model

Exclusions:

- unrestricted public workspace creation
- CUI, classified, counseling case management, or official recordkeeping
- browser notifications, SMS, email campaigns, or analytics expansion

Exit criteria:

- automated tenant-isolation tests pass
- live two-workspace integration checks pass against approved targets
- workspaces can be created, activated, monitored, suspended, and supported without developer intervention
- current local development template remains available as advanced/local-control
- rollback, incident response, backup, and ownership-transfer plans exist before broader release
