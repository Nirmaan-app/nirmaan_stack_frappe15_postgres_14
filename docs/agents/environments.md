# Environments: the second dev environment (dev2)

The owner's two-machine tools (the laptop / desktop loop, `env_sync.sh`, the checkpoint copier, delegating to the desktop, the desktop drop, dev2's tooling and its sync between the machines) live outside this repository, in `C:\nirmaan_tools` on the owner's two machines (`README.md` and `docs\environments.md` there).

## Second environment (dev2)

A second, separate dev environment runs beside main dev for parallel work on its own branch (owner R-LANE, 2026-10-29).
It is its own docker compose project `frappe_dev2` in `C:\Users\<user>\Documents\frappe_docker_dev2` on each machine:
containers `frappe_dev2-{frappe,postgresql,redis-cache,redis-queue}-1`, site `dev2.localhost`, host ports 8100 (bench),
8180 (vite) and 9100 (socket.io), its own checkout and bench under `development\frappe-bench`. The same loop applies
(the desktop is dev2's master too); the laptop holds one environment at a time, so its after-commit syncs take turns
between the two lanes (R-DEV2R0 (7); the laptop's turn file is in the tools folder's `docs\environments.md`).

**Isolation.** dev2's data is a copy of main's (R-DEV2R0 (5)), so the in-database guards travel with it (email accounts
off, the ruled stopped jobs, blank push tokens, removed token cache and asset secrets, rotated api secrets). The
site-config flags do not: add `mute_emails`, `disable_push`, `disable_cloud_upload` (each 1) and `nirmaan_env: "dev"` to
`sites/dev2.localhost/site_config.json` before the first bench start, then run
`scripts/dev_isolate.py --site dev2.localhost --stopped-file <ruled list> --verify` in dev2's frappe container.
`dev_isolate.py` accepts `localhost` and `dev2.localhost` only; production is refused by the `nirmaan_env` marker,
developer_mode and db_host checks whatever its name. A restore or transfer never replaces `site_config.json`, so the
flags and `--verify` belong to each machine's dev2.

**Scheduler OFF in dev2** by ruling (R-DEV2R0 (3)): `enable_scheduler` 0 (`bench --site dev2.localhost
disable-scheduler`), `pause_scheduler: 1` in dev2's `sites/common_site_config.json`, and no `bench schedule` process.
Main's data carries `enable_scheduler` 1, so a refresh from main turns it on again: switch it off before the first
start. Main keeps its own scheduler setting.

**Dev login.** dev2 logs in with main's dev login file and details, automatically: R-DEV2LOGIN (owner 2026-10-29
19:31): "use the login file and details for dev 2 also. ithe login should happen automatiocllay and not need me". A
session that needs a browser login on dev2 reads the login file (on the desktop `C:\Users\USER\Desktop\dev_login.txt`)
and logs in at http://dev2.localhost:8180 itself, without asking the owner. dev2's users are a copy of main's, so the
same details work after every refresh. Never print, log, copy or screenshot the password.

**Claude trust.** A Claude session that runs in the dev2 checkout needs that folder trusted once on that machine: in
the dev2 checkout run `claude`, accept the trust dialog, and exit. Trusting main's checkout does not cover it.

**Frontend.** dev2's vite exports `VITE_SOCKET_PORT=9100`; `App.tsx` passes it to `FrappeProvider` as `socketPort`.
Unset (main), the provider uses its default port 9000. dev2 carries no local edit to `App.tsx`.

**Bench commands in dev2** take `--site dev2.localhost`; a brief for dev2 says so, because CLAUDE.md and the test helpers
say `--site localhost`.

### Refreshing dev2 from a main backup

This brings dev2's data up to main dev's, on one machine (the desktop; the laptop then takes it with `db-pull`). It is
the procedure DEV2-2 ran by hand on 2026-10-29. env_sync's `restore_db.sh` and `restore_files.sh` do not fit it as they
are: the first keeps the old database as `<db>_envsync_prev` and drops an older one, and the second extracts the tar's
`./localhost/` paths unrenamed and migrates at once, before the guards.

1. **Back up main** at a quiet point (no test, build, load, backup or migrate in main's container): main's
   `envsync/backup_local.sh <folders to keep>` in main's container. It takes main's backup lock, so it cannot run beside
   a "leaving" or away backup of main (a second caller waits up to 5 minutes, then fails), and it keeps the database
   password off the command line. It removes backup folders older than the number to keep: read what it would remove
   first. Then `gzip -t` the dump. This backup is the only thing done to main.
2. **Database** (dev2's bench stopped; only dev2's postgres needs to run): rename dev2's database to `<db>_dev2_prev`,
   refusing if that name exists; create a fresh `<db>` owned by the site's database role (as main's is); load the dump
   through `gunzip | psql` with the `\restrict` line stripped (pg_dump 17 writes it and psql refuses it). dev2's
   `site_config.json` has main's db name and password; the two databases are separate because each environment has its
   own postgres container. Write the restore script with a file editor, not a bash heredoc: a heredoc ate the
   backslash of the `\restrict` pattern in DEV2-2.
3. **Files:** keep dev2's `private/files` and `public/files` as `*.dev2_prev`, then extract both tars with
   `--transform` renaming `./localhost/` to `./dev2.localhost/`. No `sites/localhost` folder may appear in dev2's bench.
4. **Guards, before any start:** the four site_config flags (Isolation, above); the scheduler off (above);
   `scripts/dev_isolate.py --site dev2.localhost --stopped-file <main's envsync/cc_stopped_jobs.json> --yes`, then
   `--verify` must PASS.
5. **Migrate:** `bench --site dev2.localhost migrate`, then `clear-cache` and `clear-website-cache`.
6. **Start:** `docker exec -d -u frappe frappe_dev2-frappe-1 bash /workspace/dev2_scripts/start_bench.sh`; wait for
   ping with `Host: dev2.localhost` on 8100; then `start_vite.sh` the same way, and 8180 answers 200.
7. **Prove:** dev2's fingerprint (`db_fingerprint.py` with `ENV_SYNC_SITE=dev2.localhost`) equals main's at the
   backup; the rate masters' live == file is unchanged; the tracked replay run in dev2 is byte-equal to main's at the
   same tip; `--verify` passes again.

dev2's old data stays as `<db>_dev2_prev` and the `*.dev2_prev` folders until someone deletes them by hand.
