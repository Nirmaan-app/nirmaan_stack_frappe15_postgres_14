# Environments: the laptop / desktop loop

The owner runs this repo on two machines on one Tailscale network. **One machine owns the branch at a time**, and
code moves only at a handover. That serial ownership is what keeps the two checkouts identical.

| | Laptop (`nitesh-laptop`) | Desktop (`nitesh-desktop`, hostname `DESKTOP-4RMALAH`) |
|---|---|---|
| Role | where the owner sits; monitors; the **only** place anyone pushes to GitHub | implementation and testing; always on |
| Database | a disposable copy of the desktop's | **the master copy** |
| Container arch | arm64 | x86_64 (`frontend/node_modules` carries x64 bindings) |
| SSH | client, key `~/.ssh/id_ed25519_desktop`, alias `desktop` | OpenSSH server; default shell PowerShell 5.1 |

All tooling is `scripts/env_sync/env_sync.sh`, run **on the laptop** in Git Bash. Every transfer goes through the
desktop's SSH server (scp + git bundles). Nothing in it talks to GitHub.

## The loop

1. **Ask.** Before implementing anything (a ticket or ad-hoc work), the laptop session asks the owner: laptop or
   desktop? On the desktop, skip this step: the laptop has already handed over.
2. **Check.** `bash scripts/env_sync/env_sync.sh status`. It reads both checkouts and both databases.

   | Code verdict | Meaning | Next |
   |---|---|---|
   | `IN_SYNC` | same branch, same HEAD | go |
   | `LAPTOP_AHEAD` | the desktop lacks laptop commits | `to-desktop` before desktop work |
   | `DESKTOP_AHEAD` | the laptop lacks desktop commits | `from-desktop` before laptop work |
   | `DIVERGED` / `BRANCH_MISMATCH` | each has commits the other lacks, or different branches | **STOP and ask the owner.** Never auto-merge |

   The data verdict is `SAME` or `DIFFERENT`. `DIFFERENT` means the laptop's copy isn't the master's.
   Before laptop work that needs live data, run `db-pull --yes`.
3. **Hand over.**
   - **Desktop chosen:** the laptop's Claude delegates (see [Delegating work to the desktop](#delegating-work-to-the-desktop)).
     `session-start` runs `to-desktop` itself when the laptop is ahead. The laptop must have no uncommitted tracked
     changes (they would not travel). The desktop fast-forwards, then migrates if doctypes, patches or hooks changed,
     and is destaled (bench + vite restarted).
   - **Laptop chosen:** run `from-desktop` first if the desktop is ahead, then work as usual. The next `status`
     shows `LAPTOP_AHEAD`, and `to-desktop` carries the commits over.
4. **Implement** on the chosen machine with the usual rules (CLAUDE.md § Session workflow): one commit per ticket,
   residence check first.
5. **Pull back.** `from-desktop` fast-forwards the laptop and destales it. It refuses while the desktop has
   uncommitted changes, because they would stay behind. `reports` copies the desktop's run reports to the laptop's Desktop.
   If the work wrote live data, run `db-pull --yes`.
6. **Push.** The owner pushes to GitHub from the laptop, by hand.

## Rules

- **Work that writes live data runs on the desktop only:** asset mints, paid AI runs, certification data. The laptop's
  database is refreshed from the master with `db-pull`. Two machines minting would collide on version numbers.
- **The one exception: a desktop drop** (owner 2026-10-26). If the desktop can't be reached, ALL work continues on the
  laptop, mints and paid runs included, and the laptop is the master. On reconnecting, before any desktop work, the
  desktop is brought up to the laptop with `to-desktop` and `db-push` (see [Desktop drop](#desktop-drop)).
- **Transfers only fast-forward.** A transfer that would need a merge or would overwrite uncommitted changes is refused,
  and leaves both machines unchanged.
- **While the desktop owns the branch, don't commit on the laptop.** That includes other Claude sessions.
- **The desktop never pushes**, to GitHub or to the laptop. Moving commits between the machines with `env_sync.sh`
  is not a push.

## Delegating work to the desktop

When the owner picks the desktop, **the laptop's Claude delegates the work and the desktop does it end to end**. The owner
does not keep any connection open.

1. **Write the brief:** what to do, the ticket number if there is one, and any rulings already given. A ticket is its own
   approved plan. For ad-hoc work, the plan is reviewed on the laptop first, as CLAUDE.md requires; the brief then says
   it is approved.
2. **`session-start --brief FILE --name <short-name>`.** It hands over the code if the laptop is ahead, adds
   `scripts/env_sync/desktop/brief_footer.md` (the protocol below) to the brief, and starts a Claude background session on
   the desktop in the repo folder, with auto permission mode.
3. **`session-wait --name N --pull-back`, run in the background.** It polls the desktop every 60 s and returns when:

   | Result | Exit code | What happens next |
   |---|---|---|
   | `DONE` | 0 | with `--pull-back`, it runs `from-desktop` and `reports`; the laptop reports to the owner, who pushes |
   | `BLOCKED` | 5 | the laptop relays the question to the owner, then `session-send --name N --message FILE` and waits again |
   | `FAILED` | 6 | the laptop reports to the owner |
   | idle five polls with no status | 4 | the laptop shows the session's recent output to the owner |
   | session gone with no status | 7 | the laptop shows the session's recent output to the owner |

4. **The protocol the desktop session follows** (the footer): CLAUDE.md in full, with the work treated as approved.
   Code, the affected tests, the residence check, the doc updates, one commit per ticket, and the Desktop report. No
   uncommitted tracked changes at the end. The **last** action writes
   `frappe-bench/envsync/sessions/<name>.status.md` on the desktop, first line `DONE`, `BLOCKED` or `FAILED`.

**How the session survives without SSH.** A process started inside an SSH session on the desktop dies when that session
closes (measured 2026-10-23), and Claude's background service starts on demand under whichever process first asks for it.
So `desktop/start_task.ps1` gives the launch to Task Scheduler: a task (`envsync-claude-launch`, Interactive logon,
limited rights, no time limit) runs `desktop/launch.ps1` in the owner's logged-on console session, as if it were typed
there. The background service and the session then run in that session.

**Requirements:**
- The owner must be logged on at the desktop console. The launch says so if not.
- The repo folder must be trusted once on the desktop: accept the prompt in an interactive `claude` there.

**Watching by hand:** `watch --logs N` gives the same snapshot at any time. The owner can also `ssh -t desktop` and run
`claude attach N`. Leaving with ← or Ctrl+Z keeps the session running.

## Desktop drop

When the desktop is unreachable, keep working on the laptop: it is the master until the desktop is back in step.
Record when the drop began and the laptop's last sync.

On reconnecting, **before any desktop work**:

1. **List what the laptop did since the drop:** commits (`git log <last synced>..HEAD`), asset mints, paid runs and any
   other database writes.
2. **Docker on both machines:** the four `frappe_docker_devcontainer-*` containers up, never `frappe_dev2-*`. After a
   start, wait for `/api/method/ping` and check that Postgres recovered cleanly.
3. **Code:** `status --no-data` shows `LAPTOP_AHEAD` (or `IN_SYNC`), then run `to-desktop`, then `status` shows `IN_SYNC`.
   `DIVERGED` means stop and ask the owner.
4. **Data:** `db-push --yes`. It refuses, changing nothing, when:
   - `--yes` is missing, or the code isn't `IN_SYNC`;
   - **the desktop has changed since the laptop's last `db-pull`.** That pull records the desktop's fingerprint in
     `frappe-bench/envsync/last_pull_fingerprint.txt`. A mismatch means desktop writes the laptop never saw. The refusal
     names both fingerprints; ask the owner. Only `--discard-desktop-writes` overrides it, and those writes are then lost;
   - the desktop's safety backup can't be proved: sizes and sha256, `gzip -t`, and a test restore into a scratch
     database (`remote/scratch_check.sh`; never the live one) with the table count and key row counts equal to live;
   - the laptop's backup can't be proved, or its copy on the desktop doesn't match by sha256 and size;
   - either machine's fingerprint moved while the push ran.

   Then it stops the desktop's bench and restores the laptop's backup. The old desktop database is kept as
   `<db>_envsync_prev` and the old file folders as `*.envsync_prev`. It runs migrate, starts bench, waits for ping, and
   prints the before and after fingerprints, which must be equal. Last, it writes a run record to the laptop's Desktop
   (`<date>_<time>_env_sync_db-push.md`) and refreshes the pull record. It takes about 15 minutes.
5. **Proofs.** Compare the desktop AFTER against the LAPTOP's values: the v54 / v66 live-vs-file content hashes, the row
   counts, the AI setting and key presence, the replay (equal by key). The site-config flags (`mute_emails`,
   `disable_push`, `disable_cloud_upload`, `nirmaan_env`) and `dev_isolate.py --verify` belong to each machine, so
   compare those with the desktop's own values from before the push.
6. `status` shows `IN_SYNC` / `SAME`. The desktop is the master again.

**Rollback** if a proof fails: stop the desktop's bench, rename the restored database away and `<db>_envsync_prev` back,
move the `*.envsync_prev` file folders back, start bench and re-prove. If that copy is unusable, restore the proved
safety backup instead, in the handover block-50 order. The full hand procedure is the SYNC-R runbook
(`2026-10-26_Desktop_Drop_Runbook.md` on the owner's Desktop).

## Commands

| Command | Does |
|---|---|
| `status [--no-data]` | code + data verdicts (exit code 0 in sync, 10 laptop ahead, 11 desktop ahead, 20 stop) |
| `to-desktop [--allow-dirty] [--no-restart]` | fast-forward the desktop to the laptop's commits, then migrate and destale it as needed |
| `from-desktop [--allow-dirty] [--no-restart]` | fast-forward the laptop to the desktop's commits, then migrate and destale it as needed |
| `db-pull --yes` | back up the desktop, restore the backup on the laptop (the replaced database is kept as `<db>_envsync_prev`), and record the pulled fingerprint for `db-push` |
| `db-push --yes [--discard-desktop-writes]` | after a desktop drop only: copy the laptop's database and files onto the desktop, behind the guards in [Desktop drop](#desktop-drop) |
| `reports` | copy files on the desktop's Desktop that are new or newer to the laptop's OneDrive Desktop |
| `watch [--logs NAME] [--lines N]` | one monitoring snapshot: desktop commits, changes, servers, Claude sessions, a session's recent output |
| `session-start --brief FILE [--name N]` | hand over the code if needed, then start a delegated desktop session |
| `session-wait --name N [--pull-back] [--interval S] [--idle-limit K]` | poll until DONE / BLOCKED / FAILED / stalled (see above) |
| `session-send --name N --message FILE` | relay the owner's answer and resume the session |
| `session-stop --name N` | stop the session (its conversation is kept) |

Overrides for hosts, paths and container names go in the git-ignored `.claude/state/env.local` (the `ENV_SYNC_*`
variables at the top of the script).

## Recovery

- **A transfer refused:** both machines are unchanged. Read the message, fix the cause (commit, stash or ask), and re-run.
- **`DIVERGED`:** stop. Show the owner both logs (`git log` on each machine) and let them rule. Never merge or reset on your own.
- **A failed `db-pull` restore:** bench is left stopped. The previous database is intact as `<db>_envsync_prev`.
  Rename it back in the postgres container, then start bench (`scripts/env_sync/remote/start_bench.sh`).
- **A refused `db-push`:** the desktop is unchanged; read the reason. A failure after the restore began leaves the desktop's
  bench stopped, with the previous database intact as `<db>_envsync_prev`; follow the rollback in [Desktop drop](#desktop-drop).
