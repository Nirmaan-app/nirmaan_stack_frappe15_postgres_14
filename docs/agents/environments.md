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
   - **Desktop chosen:** `to-desktop`. The laptop must have no uncommitted tracked changes (they would not
     travel). The desktop fast-forwards, then migrates if doctypes, patches or hooks changed, and is destaled (bench + vite
     restarted). The owner then works in the desktop's Claude session (below) while the laptop monitors with `watch`.
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
  database is refreshed from the master with `db-pull`, never the other way. Two machines minting would collide on
  version numbers.
- **Transfers only fast-forward.** A transfer that would need a merge or would overwrite uncommitted changes is refused,
  and leaves both machines unchanged.
- **While the desktop owns the branch, don't commit on the laptop.** That includes other Claude sessions.
- **The desktop never pushes**, to GitHub or to the laptop. Moving commits between the machines with `env_sync.sh`
  is not a push.

## The desktop's Claude session

A process started inside an SSH session on the desktop dies when that session closes (measured 2026-10-23). So:

- **Start the session from the desktop's own console**, once, in the repo folder:
  `claude --bg -n nirmaan --permission-mode auto "<the first instruction>"`. It then runs in Claude's background
  service, independent of any SSH connection.
- **Work in it from the laptop:** `ssh -t desktop`, then `claude attach nirmaan`. Leaving with ← or Ctrl+Z drops
  back to the shell, and the session keeps running.
- **Monitor it from the laptop's Claude:** `bash scripts/env_sync/env_sync.sh watch --logs nirmaan` shows the desktop's
  commits since the laptop's HEAD, its uncommitted files, whether its servers answer, every Claude session (`claude agents --json`) and
  the session's recent output (`claude logs`). Repeat it as often as wanted, for example with `/loop`.
- After a desktop reboot, the background service is gone: start it again from the console.

## Commands

| Command | Does |
|---|---|
| `status [--no-data]` | code + data verdicts (exit code 0 in sync, 10 laptop ahead, 11 desktop ahead, 20 stop) |
| `to-desktop [--allow-dirty] [--no-restart]` | fast-forward the desktop to the laptop's commits, then migrate and destale it as needed |
| `from-desktop [--allow-dirty] [--no-restart]` | fast-forward the laptop to the desktop's commits, then migrate and destale it as needed |
| `db-pull --yes` | back up the desktop, restore the backup on the laptop (the replaced database is kept as `<db>_envsync_prev`) |
| `reports` | copy files on the desktop's Desktop that are new or newer to the laptop's OneDrive Desktop |
| `watch [--logs NAME] [--lines N]` | one monitoring snapshot (see above) |

Overrides for hosts, paths and container names go in the git-ignored `.claude/state/env.local` (the `ENV_SYNC_*`
variables at the top of the script).

## Recovery

- **A transfer refused:** both machines are unchanged. Read the message, fix the cause (commit, stash or ask), and re-run.
- **`DIVERGED`:** stop. Show the owner both logs (`git log` on each machine) and let them rule. Never merge or reset on your own.
- **A failed `db-pull` restore:** bench is left stopped. The previous database is intact as `<db>_envsync_prev`.
  Rename it back in the postgres container, then start bench (`scripts/env_sync/remote/start_bench.sh`).
