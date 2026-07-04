# Offline Release Test Checklist

Use this checklist before tagging or deploying the offline-first release.

- First online launch: open the app online, confirm the installable phone app/service worker is available, then cold reload in Airplane Mode.
- Offline manual check-in: choose a mapped location, select one or more units at that location, and confirm the visit is saved on device.
- Offline nearby-location check-in: use cached location data to identify nearby units and save a queued visit.
- App close/reopen: close the phone home-screen app or browser, reopen offline, and confirm the queued visit is still listed as waiting to upload.
- Restored connection and sync: reconnect, open the app, and confirm the queued visit uploads.
- Repeated Sync Now: press **Sync Now** multiple times for the same pending batch and confirm only one batch and one check-in row per unit are created.
- Simulated partial batch retry: create a batch with multiple units, simulate only some unit rows existing, retry sync, and confirm only missing unit rows are added.
- Optional indicators ignored: complete a check-in and tap **Done** without touching indicators; confirm both values remain `null`.
- Optional indicators checked then cleared: check each indicator, then uncheck before leaving confirmation; confirm each returns to `null`.
- Multi-unit location visit: select multiple units at one location and confirm one pair of location-level indicators, not duplicated per unit.
- Expired session with queued visit: expire/remove the session, reconnect, and confirm queued work remains until PIN refresh succeeds.
- Identity change while queued: attempt to change identity with queued visits and confirm it is blocked.
- Local undo before sync: undo a queued visit and confirm it is removed locally without contacting the server.
- Server undo after sync: undo synced check-ins inside 15 minutes and confirm soft-void; retry outside 15 minutes and confirm rejection.
