# env_sync

The laptop side of the owner's two-machine loop. The loop, the delegation protocol and the desktop-drop procedure are in
[`docs/agents/environments.md`](../../docs/agents/environments.md); `bash scripts/env_sync/env_sync.sh` with no command
prints every command. This README covers the **checkpoint** commands (CKP-2, 2026-11-17): they keep the laptop close
behind the desktop, so a desktop that stops answering costs minutes of work, not hours.

Owner rulings (2026-11-17 14:13 / 14:17 / 14:31 / 18:32): when the owner says he is leaving, the desktop's work that is not
on the laptop is copied to the laptop, so the laptop can carry on from a safe point; while he is at home the laptop also
takes the code more often; the cost (seconds per code copy, minutes per database copy, in the background) is accepted.

**No cloud drive, anywhere, for anything.** Every copy goes desktop -> laptop over this SSH route (Tailscale: the laptop at
home still reaches the office desktop). Checkpoints live on the laptop's local disk. Never start, sign in, open or configure
OneDrive on the desktop, and never write into a OneDrive folder from it. (CKP-1 tried a OneDrive route on 2026-11-17; its
folder backup moved the desktop's Desktop and Documents - the whole dev environment - into OneDrive. It was undone.)

## Commands

| Command | What it does |
|---|---|
| `checkpoint-code --slice S [--name N] [--if-older MIN]` | **B1.** A snapshot of the desktop's **uncommitted** work (tracked diff + new files, the declared noise left out, built on the desktop host in a temporary index - the checkout is never touched) plus a resume note, into `frappe-bench\envsync\checkpoints\S\<stamp>\` on the laptop, sha256-checked on both sides; then the desktop's commits by fast-forward (as after every commit). Nothing is applied or committed on the laptop. Keeps the newest 8. `--if-older 15` is a no-op while the newest checkpoint **or the newest attempt** is younger than 15 minutes, so a poller can call it every minute and a failed copy (laptop offline, link drop) is retried only at the next 15-minute mark; each failure is logged once in `checkpoints\S\failures.log`. |
| `db-pull --yes [--covers STEP] [--chunked]` | **B2.** Replaces the laptop's database with a copy of the desktop's, **proved before it is used**: desktop backup into `envsync\backups` (sizes, sha256, `gzip -t`, tar listings); then the copy - the **normal copy first, one try, on any network** (owner 2026-11-17 18:52); only if it fails (cut, sha / size mismatch, timeout) the **chunked resumable copy** takes over (rule 16: the desktop splits each file into 50 MB parts in `envsync\chunks`, each part sha256-checked and a failed part re-sent alone, the laptop reassembles and checks the whole file's sha256 + size and `gzip -t`); `--chunked` forces it. Then a scratch restore on the laptop whose table and key row counts must lie between the desktop's counts just before and just after its backup, then the restore (the replaced laptop database stays as `<db>_envsync_prev`). The pull record says what the copy covers (`STEP`), which route it took, how long, and on which network. The chunk parts are removed on both machines after the proved restore. |
| `checkpoint --slice S [--name N] --yes` | **B3, "leaving"** (do it while both machines are still in the office). A local `ckpt/<slice>-<yyyymmdd-hhmm>` commit on the desktop (HEAD + uncommitted work in a temporary index - the session's tree, index and branch are not touched; never pushed), the desktop backup, `CHECKPOINT TAKEN ... carry on` to the session's message file, then the code checkpoint and the proved database copy on the laptop. Verifies the code hash (desktop tree = bundle tree on the laptop = checkpoint tree), the data fingerprint and the resume note; prints `CHECKPOINT READY ... took N s`. Only then does the owner unplug. |
| `catch-up --slice S [--name N] [--yes]` | **B4, back home.** The desktop answers -> a fresh B1 checkpoint of everything it made since, then `CAUGHT-UP` with the moment of the last database copy and what it covered. If the session's status file shows a `DBCOPY-POINT` (a costly step) newer than that copy, it says so, and with `--yes` brings the data up to date the B2 way (normal copy first, then chunked). The desktop silent -> `NOT CAUGHT UP` (laptop offline, or the desktop is down: see `resume-on-laptop`). |
| `resume-on-laptop --slice S [--name N]` | **B5 (a).** Desktop answers over SSH -> prints the session's state and does nothing else. Desktop silent -> lists the checkpoints a takeover would rebuild and stops. |
| `resume-on-laptop --slice S --takeover --yes` | **B5 (b), on the owner's word only.** Refuses while the desktop answers. Checks the laptop holds the newest B3 database copy (fingerprint), rebuilds the B3 code checkpoint and then every later B1 checkpoint in order on the laptop's checkout (each verified by its tree hash; a conflict stops), writes the master record (`frappe-bench\envsync\master.txt`, shown by `status`) and the turn file, and prints `RESUMED-ON-LAPTOP` with the resume note. A later `db-push` hands the master back to the desktop and removes the record. Desktop work after the switch is parked on `desktop-<slice>-orphan-<time>` (preamble block 88). |
| `resume-on-laptop --slice S --dry-run` | The same rebuild on a throw-away clone: proves the takeover would end equal to the checkpoint (code hash + data fingerprint) and changes nothing. |

**Which network a copy ran on** is recorded, never a gate: `tailscale ping` says how the laptop reaches the desktop -
`via <private address>:<port>` is a direct office-LAN path, `via DERP(...)` the Tailscale relay, a public address a direct
path over the internet. The desktop's LAN address changes (192.168.1.3 earlier; 192.168.0.210 on 2026-11-17), so no fixed
address is trusted; without Tailscale, `ENV_SYNC_DESKTOP_LAN=<address>` in `.claude/state/env.local` is the fallback probe.

Where things live: checkpoints in `frappe-bench\envsync\checkpoints\<slice>\<stamp>\` on the laptop (`head.txt`,
`tracked.diff`, `untracked.tar`, `commits.bundle` when commits travel, `files.txt`, `resume.md`, `ckpt.txt`); the desktop's
working copies in `frappe-bench\envsync\ckpt_out\`; env_sync's database backups in `frappe-bench\envsync\backups\<stamp>\` on
each machine (newest 3 kept; **never** a cloud drive, **never** `sites\<site>\private\backups`); the pull record
`frappe-bench\envsync\last_pull_fingerprint.txt` (with `# covers:` and `# copy:` route / time / network); chunk parts while a
chunked copy runs in `frappe-bench\envsync\chunks\<stamp>\` on both machines (outside any Frappe backups folder; removed after
the proved restore; kept on a failure so a later run can see them).

## Any Stack dev work, several at once, "leaving" from anywhere (CKP-4, 2026-11-18)

Owner 2026-11-18 17:30: "it should cover whichever dev work is going on from which ever chat and also multiple dev works
going simultaneously". Since CKP-4 the copier needs no `poller follow`: every run DETECTS what is running.

| | |
|---|---|
| Detection | `env_sync.sh units` (read-only; `desktop/detect_units.ps1`): every existing git worktree of main dev's and dev2's checkout on the desktop is a **unit**. The Claude Code sessions working in it are found from their processes and Claude's own job files (`~\.claude\jobs\<id>\state.json`: folder, name, state), whichever chat or project started them; a session typed at the console counts while its transcript was written in the last 10 minutes. "Working" = Claude's job state says working; blocked / done sessions are listed, not copied for |
| One copy per checkout | Per unit with a working session: `checkpoint-code --slice <unit> --checkout <path> --env main\|dev2 --if-older 13`. Two sessions in one checkout share the copy. Any branch: a local-only branch's commits travel in the snapshot's bundle. When nobody works in a unit any more but its tree moved since the last copy, one more copy is taken. Checkpoints land in `envsync\checkpoints\u-<env>-<branch>\` |
| A failure on one unit | written once to the heartbeat, the log and the relay (`CKPFAIL-<unit>`); the other units are still copied; no session is stopped |
| dev2 | code copies only. The copier NEVER starts a dev2 container on either machine. If dev2 runs on the desktop and has work, ONE question goes to the relay ("a dev2 database copy needs the owner's word"); nothing is copied without it |
| Database copies | main dev only, away from the office only (CKP-3's rule), plus the one copy "leaving" makes |
| **"Leaving"** | One shared flag, `BoQ main lane\_run_records\ckp_leaving.flag`, raised by chat-Claude (any chat), by `env_sync.sh leaving`, or by the Desktop shortcut **"Leaving"** (which also starts the task at once). The run that finds it: asks every main-dev session that keeps a status file (our brief footer) to pause at its safe point (`=== CHECKPOINT ... ===` in its message file) and waits up to 10 minutes for `CHECKPOINT SAFE`; makes ONE code + database checkpoint of main dev, office or away (`checkpoint --slice <unit> --name <one session> --also-tell "<the others>"`: all are released by the same `CHECKPOINT TAKEN ... carry on` the moment the desktop side is captured, about 75 s); copies every other unit and every session without a status file as it stands; writes READY / FAILED per unit to the heartbeat and ONE relay entry (`id LEAVING`); clears the flag. Measured 2026-11-18: 532 s and 604 s to READY; the sessions paused 3 minutes |
| Takeover | `resume-on-laptop --units` lists every unit's last checkpoint; `--units --dry-run` rebuilds each on a throw-away clone and compares the laptop's data fingerprint with its last proved copy. A real takeover stays on the owner's word |
| Heartbeat v2 | `detected: N unit(s)`, one `unit:` line each (environment, branch, sessions and their state, last code copy, this run's result), `location:`, a `leaving:` line after a leaving run. chat-Claude's alarm: a unit with a working session and no code copy for over 20 minutes; or "detected 0" while a slice is known to run |
| Relay entries no slice owns | a leaving result, a unit's failure, CAUGHT-UP, the dev2 question: `_relay\_checkpoints\to_chat.md` once that folder exists, `_relay\CKP-4\to_chat.md` until then |
| `poller follow` | OPTIONAL now. It only names main dev's unit after a slice while that session works; the name drops by itself |
| Robustness | every ssh / scp has keep-alives (a stalled connection is given up after 4 x 15 s), every copier step has a time limit, and every call gets its stdin from /dev/null (ssh inside the per-unit loop once swallowed the rest of the unit list) |
| Rehearsal switches | in `envsync\poll\poller_test.env`, besides CKP-3's: `POLLER_LOCATION=away`, `POLLER_FAIL_UNIT=<unit>`, `POLLER_LEAVING_ONLY="<the only sessions a rehearsal may pause>"`. A real "leaving" pauses every session with a status file: that is the point |
| Launching in another worktree | `desktop/start_task.ps1 -Name N -Mode start -Dir <worktree>` (default: the repo, arguments unchanged) |

## The scheduled poller (CKP-3, 2026-11-18): the copies no longer depend on Claude Code

On 2026-11-17 Claude Code's memory reaper stopped the laptop session's poller, and no checkpoint was taken after it. Since
CKP-3 the copies are made by a **Windows scheduled task on the laptop**, `BoQ Checkpoint Poller`, which runs
`scripts/env_sync/poller_run.sh` whether or not Claude Code is open.

| | |
|---|---|
| Runs | every 15 minutes, at log-on, on network connect, on resume from sleep; one run at a time; no window (`laptop/poller_hidden.vbs`) |
| As | the logged-on user, "run only when the user is logged on" (no password is stored), least privilege |
| Follows | since CKP-4 every working session it DETECTS (section above); `poller follow` is optional |
| Each run | nothing followed -> IDLE. Desktop silent -> OFFLINE (logged once, B1 skipped). Desktop back -> the B4 catch-up by itself, `CAUGHT-UP` in the log and one relay entry. Otherwise B1 `checkpoint-code --if-older 13`, then B2 when the session's newest `DBCOPY-POINT` is newer than the last database copy |
| **Office vs away** | **In the office: code only. After "leaving" and at home: code + database** (owner 2026-11-18 16:42 "ok option a"). "Office" = the laptop reaches the desktop over a direct private-LAN path (`tailscale ping` says `via 192.168.x.x:port` and the like); the Tailscale relay, a public address, no answer or no Tailscale = "away". In the office a due `DBCOPY-POINT` is NOT copied by the poller and the laptop's Docker is never started for it (`B2 not in office`); the point stays due and is copied at the first run away. The standing rules are unchanged: code after every commit, the slice-end `db-pull`, and the B3 "leaving" checkpoint with its full code + database copy on the office LAN. The heartbeat has a `location:` line |
| B2 and standby | Docker Desktop and the four main containers are started only for the copy and put back as they were (MEM-R0 F3); never dev2. After Docker starts the run waits 45 s before the copy (a just-started Docker Desktop dropped a 277 MB `docker cp` with "502 Bad Gateway") |
| B2 guards | No copy starts with under 3,000 MB of memory free on the laptop (`B2 PENDING`, tried again at the next run, not a failure): both AC5 failures on 2026-11-18 were the laptop's Docker falling over with about 2 GB free. A FAILED copy is tried again for the same `DBCOPY-POINT` only after 60 minutes (each try costs a desktop backup). The whole output of the last copy is kept in `envsync\poll\b2_last_output.txt` |
| Heartbeat | `<laptop Desktop>\BoQ main lane\_run_records\ckp_heartbeat.txt`, overwritten at every run: run time, result (`IDLE` / `B1 OK` / `B1 SKIP not due` / `B2 OK` / `OFFLINE` / `CAUGHT-UP` / `FAILED ...` / `PAUSED`), the slice, desktop reachable, the last good B1 and B2. Text only |
| Log | `frappe-bench\envsync\checkpoints\poller.log` (appended, 30 days kept) |
| A failure | one heartbeat line + one log line; `ckfail` adds the one `<slice>-CKPFAIL` relay entry (F1 unchanged). No retry loop: the next run tries at its next mark |

**The owner's Desktop shortcuts** (owner 2026-11-18 17:10 "yes add the shortcut"): **double-click "Copier - Pause",
"Copier - Resume", "Copier - Status" or (CKP-4) "Leaving" on the laptop's Desktop.** "Leaving" raises the shared flag,
starts the copier at once and says "Checkpoint started - wait for READY in the chat". Each shows one message box and no console window.
Pause and Resume call `poller pause` / `poller resume` and then run the poller once, so the heartbeat shows the new
state at once; Status only reads the heartbeat. They are made by `env_sync.sh poller shortcuts` (removed by
`poller shortcuts-remove`); the `.lnk` files live only on the Desktop and call `laptop/copier_shortcut.vbs` here.

**The owner's off switch.** The owner says "pause the copier", "resume the copier" or "remove the copier" to chat-Claude
or to the laptop session, which runs `poller pause`, `poller resume` or `poller remove` and confirms with the heartbeat.

**Every run writes the heartbeat first** (`RUNNING since <start>`, then the result), paused, idle and not-due runs
included. A stale heartbeat therefore only ever means the job did not run: the laptop asleep, hibernated (a flat battery
did this on 2026-11-18) or off, the user logged off, or the task removed.

**Off switch and undo.** `env_sync.sh poller status` shows the task, what it follows and the last heartbeat.
`poller pause` / `poller resume` stop and restart the copying (a paused run still writes a `PAUSED` heartbeat).
`poller unfollow` makes it idle. `poller remove` unregisters the task: that is the complete undo of `poller install`,
the one Windows change CKP-3 made. `poller run` does one run in the terminal.

**Rehearsal switches** (never in normal use): the file `frappe-bench\envsync\poll\poller_test.env` may set
`ENV_SYNC_DESKTOP=<an alias that does not answer>` (the desktop "unreachable", without touching Wi-Fi or Tailscale),
`ENV_SYNC_TEST_FAIL=b1` and `POLLER_B1_MINUTES=0` for the runs while it exists. Delete it afterwards.

**Run records.** env_sync's own run records (`db-push`), the loose report files `reports` copies from the desktop's
Desktop, and the heartbeat go to `<laptop Desktop>\BoQ main lane\_run_records\`, never the Desktop's root
(`ENV_SYNC_RUN_RECORDS` overrides it). Folders are still mirrored at the same path.

## Who runs what, and when

- **The scheduled task copies; the laptop session only watches the status.** B1, B2, the catch-up and "leaving" are
  the scheduled copier's job (above). It finds every working session by itself (CKP-4), so a laptop session that launches
  a desktop slice runs NO copier command; it only relays status lines and questions. `slice_poll.sh` (below) is kept for a session that wants the events in its own
  terminal; running it beside the task is harmless, because both use `checkpoint-code --if-older`.
- **The laptop session's slice poller** is `bash scripts/env_sync/slice_poll.sh --slice S --name N`: it polls the desktop
  session's status file once a minute (plain reads over SSH), runs `checkpoint-code --if-older 15` on each poll (B1), and
  exits on an event (a new status line, OFFLINE, or CAUGHT-UP) so the laptop session relays it and restarts it. When the
  desktop answers again after the laptop could not reach it (back home), it runs `catch-up` BY ITSELF and reports
  CAUGHT-UP (owner 2026-11-17, R2: nobody has to say "home"). While offline it skips B1 (no failure entry every 15 min).
- **After a costly step** the desktop session writes `DBCOPY-POINT <time> <step>` in its status file (a paid run, a
  catalogue load, a migrate, or on request); the laptop runs `db-pull --yes --covers "<step>"` in the background, on any
  network (normal copy first, chunked if it fails). The laptop's containers run only for the copy (the turn file is claimed
  first and freed after).
- **"Leaving"** (while both machines are in the office): chat-Claude posts `CHECKPOINT` on the relay. The laptop writes `=== CHECKPOINT <time> ===` into
  the session's message file; the session stops at the next **safe point** (list below), writes its resume note and
  `CHECKPOINT SAFE <time> <step>` in its status file, and polls its message file. The laptop runs
  `checkpoint --slice S --name N --yes`; the session reads `CHECKPOINT TAKEN ... carry on` and goes on; the laptop posts
  `CHECKPOINT READY` with the time it took. Then the owner unplugs.
- **During the commute** the laptop is simply offline; the desktop carries on.
- **Back home**: nothing to say - when the laptop reconnects, `slice_poll.sh` runs `catch-up` by itself and the laptop posts
  `CAUGHT-UP` (`catch-up --slice S --name N [--yes]` by hand does the same). If the desktop does not answer:
  `resume-on-laptop --slice S --name N`, and on the owner's word `--takeover --yes`, then post `RESUMED-ON-LAPTOP` with the
  step to continue from.
- **Laptop standby = Docker off** (owner 2026-11-18, MEM-R0 F3; applies whenever the DESKTOP is master): the laptop's 4
  devcontainer containers and Docker Desktop stay stopped. A sync, db-pull or checkpoint starts them first and stops
  them after (it claims the turn file first and frees it after). Measured gain: ~1.3-1.7 GB of WSL memory plus ~0.5 GB
  for Docker Desktop. While the laptop is master (a takeover), they run as normal. Never start dev2.

## If the checkpoint process fails (owner 2026-11-17 19:11) - hard rules

- **F1** A checkpoint failure never stops or blocks the slice. A failed B1 / B2 / B4 copy is logged once (in
  `checkpoints\<slice>\failures.log` and as one relay entry `<slice>-CKPFAIL` naming the last good checkpoint and its age),
  the slice goes on, and the copy is simply tried again at the next mark. The slice's own work never waits on a copy.
- **F2** The "leaving" pause has a ceiling: the desktop waits at its safe point at most **20 minutes**. If the copy fails
  before the code and database are captured, the laptop releases it at once (`CHECKPOINT FAILED ... carry on`); if the
  laptop goes silent, the session resumes by itself at 20 minutes and writes `CHECKPOINT FAILED ... ceiling ... resumed`.
  Either way the owner sees the failure and the last good checkpoint, and decides whether to wait or leave.
- **F3** A takeover (`resume-on-laptop --takeover --yes`) runs only on the owner's word; nothing starts it by itself.
- **F4** The checkpoint tooling never edits product code or the slice's data. It changes the laptop's database only in a
  proved pull (B2 / B3 / B4 `--yes`), the master record only in B5, and the laptop turn file only to start and stop the
  laptop's containers for a copy (the standing turn-file rule) or to take over in B5.
- Rehearsal switch (tests only): `ENV_SYNC_TEST_FAIL=b1|b3-capture|b3-copy|b3-silent` forces a failure at that point.

## Safe points (B6) - quote this list in every build prompt

A session may stop for a checkpoint **only at a safe point**:
1. right after a commit (the tree is clean or holds only finished work);
2. between two milestones, with the status file and the resume note just written;
3. after a test suite has finished and its log is saved (never while a suite, vitest or tsc is running);
4. after a catalogue load AND its verify have finished;
5. after a paid run has finished and its capture lines are counted (or after it is stopped by the owner);
6. while waiting for an owner answer (QUESTION-READY written, nothing running).

**Never** a safe point - finish the step first, then stop: inside a catalogue load or its verify; inside a paid model
run; inside a migrate or a db-pull / db-push / restore; inside any database write step (a mint load, a repair, a
backfill); inside a browser cert (between de-stale and dev_isolate --verify); while a suite, vitest or tsc is running;
with a half-applied edit that does not parse.

## The session's resume note

Every delegated session keeps `envsync\sessions\<name>.resume.md` (a few lines, rewritten at each milestone): the slice,
the milestone reached, the next step exactly, open questions with their files, anything half-done (files, why), and
the commands to re-check the start state. The checkpoint commands copy it next to the code (brief_footer.md point 6).

## Tests

`bash scripts/env_sync/tests/test_env_sync.sh` (bash + git only; docker / ssh / scp are stubs). Section 6 builds
throw-away repositories and proves: a snapshot never touches the source checkout or a host's global git config; the rebuilt
tree equals the snapshot's; conflicts (own edits, clashing new files) are refused with nothing changed; the B3 commit form
and the in-order takeover sequence; the count check of a pulled copy; the network record reads a direct private path as the LAN and
the DERP relay or a public address as not; chunk_split's parts reassemble byte-for-byte; a failed normal copy switches once
to the chunked route and `--chunked` forces it; no cloud-drive script or path is left. Section 7 runs `poller_run.sh`
against stubs for the desktop probe, `env_sync.sh`, docker and the Docker Desktop start (a test never starts the real
one): IDLE, OFFLINE logged once, the catch-up on reconnecting, B1 OK / not due / failed, B2 with standby, pause, one run
at a time, the slice's end, and the task's XML (triggers, user, single instance, hidden start).
