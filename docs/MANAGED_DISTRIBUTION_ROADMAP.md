# Managed Distribution Roadmap

## Stage 1 - Mission Board and Pilot Readiness

Objective: improve usefulness and engagement in the current single-organization beta without changing the hosting model.

Scope:

- Mission Board meaningful-coverage display
- badge and Mission Brief engagement features
- offline reliability fixes
- setup and safe-use documentation
- current self-hosted deployment path

Exclusions:

- multi-tenancy
- public self-service workspace signup
- enterprise identity
- CUI, classified, counseling, or official-record workflows

Exit criteria:

- current app remains stable for check-in, offline sync, coverage board, map, admin corrections, and reports
- Mission Board motivates meaningful coverage without rewarding raw volume
- non-technical setup docs remain usable for beta teams

## Stage 2 - Outside-Team Pilot Validation

Objective: validate real RMT use before centralized multi-tenant work begins.

Scope:

- at least two outside RMTs use the current app for 2-4 weeks
- collect setup friction, offline behavior, check-in reliability, admin workflow, and reporting feedback
- validate the default-organization foundation before adding workspace onboarding
- verify safe-use language is understood and followed

Exclusions:

- managed multi-organization hosting
- unrestricted onboarding
- new sensitive data collection
- app-store/native platform port

Exit criteria:

- two or more outside teams complete a 2-4 week pilot
- critical workflow blockers are documented or fixed
- there is clear evidence that centralized hosting would reduce real adoption friction

## Stage 3 - Managed Multi-Organization Service

Objective: build one centrally hosted Deckplating service with controlled organization onboarding.

Scope:

- organization/workspace onboarding beyond the default-organization foundation
- complete organization-scoped authorization for managed hosting
- invitation/setup-code onboarding
- organization admin model
- tenant-isolation tests
- migration strategy from current single-organization schema
- controlled managed pilot rollout

Exclusions:

- unrestricted public workspace creation
- CUI, classified, counseling case management, or official recordkeeping
- browser notifications, SMS, email campaigns, or analytics expansion

Exit criteria:

- automated tenant-isolation tests pass
- pilot workspaces can be created without developer setup by local users
- current self-hosted template remains available as advanced/local-control
- rollback and incident response plans exist before broader release
