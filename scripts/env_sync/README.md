# env_sync

The laptop side of the owner's two-machine loop. The loop, the delegation protocol and the desktop-drop procedure are in
[`docs/agents/environments.md`](../../docs/agents/environments.md); `bash scripts/env_sync/env_sync.sh` with no command
prints every command. This README covers the **checkpoint** commands (CKP-1, 2026-11-17): they keep the laptop close
behind the desktop, so a desktop that stops answering costs minutes of work, not hours.

Owner rulings (2026-11-17 14:13 / 14:17 / 14:31): when the owner says he is leaving, the desktop's work that is not on the
laptop is copied to the laptop, so the laptop can carry on from a safe point; while he is at home the laptop also takes
the code more often; the cost (seconds per code copy, minutes per database copy, in the background) is accepted.

## Commands

| Command | What it does | Cost (measured CKP-1) |
|---|---|---|
| `checkpoint-code --slice S [--name N] [--if-older MIN]` | **B1.** Fast-forwards the laptop to the desktop's commits (as after every commit), then copies the desktop's **uncommitted** work (tracked diff + new files, the declared noise left out) and a resume note into `BoQ main lane\S\checkpoints\<stamp>\`. Nothing is applied or committed on the laptop. Keeps the newest 8. `--if-older 15` makes it a no-op when the newest checkpoint is younger than 15 minutes, so a poller can call it every minute. | see the CKP-1 report |
| `db-pull --yes [--covers STEP]` | **B2.** Replaces the laptop's database with a fresh copy of the desktop's, **proved before it is used**: desktop backup into `envsync/backups` (sizes, sha256, `gzip -t`, tar listings), copy with sha256 + size equal, a scratch restore on the laptop whose table and key row counts must lie between the desktop's counts just before and just after its backup, then the restore (the replaced laptop database stays as `<db>_envsync_prev`). `STEP` goes into the pull record. | see the CKP-1 report |
| `checkpoint --slice S [--name N] --yes` | **B3, "leaving".** A local `ckpt/<slice>-<yyyymmdd-hhmm>` commit on the desktop (HEAD + uncommitted work, made in a temporary index - the session's tree, index and branch are not touched; never pushed), the desktop backup, then the code checkpoint and the proved database copy on the laptop. Verifies the code hash (desktop tree = bundle tree on the laptop = checkpoint tree), the data fingerprint and the resume note; prints `CHECKPOINT READY ... took N s`. With `--name`, it appends `CHECKPOINT TAKEN ... carry on` to the session's message file as soon as the code and the database are captured. | target <= 20 min |
| `resume-on-laptop --slice S [--name N]` | **B5 (a).** Desktop answers over SSH -> prints the session's state and does nothing else. Desktop silent -> lists the checkpoints a takeover would rebuild and stops. | seconds |
| `resume-on-laptop --slice S --takeover --yes` | **B5 (b), on the owner's word only.** Refuses while the desktop answers. Checks the laptop holds the newest B3 database copy (fingerprint), rebuilds the B3 code checkpoint and then every later B1 / B4 checkpoint in order on the laptop's checkout (each verified by its tree hash; a conflict stops), writes the master record (`frappe-bench/envsync/master.txt`, shown by `status`) and the turn file, and prints `RESUMED-ON-LAPTOP` with the resume note. A later `db-push` hands the master back to the desktop and removes the record. Any desktop work after the switch is parked on `desktop-<slice>-orphan-<time>` (preamble block 88). | minutes |
| `resume-on-laptop --slice S --dry-run` | The same rebuild on a throw-away clone: proves the takeover would end equal to the checkpoint (code hash + data fingerprint) and changes nothing. | minutes |
| `bash scripts/env_sync/desktop/ckpt_onedrive.sh S [N]` | **B4.** Run by the **desktop session** in Git Bash at every milestone: a code checkpoint into the desktop's `OneDrive\Desktop\BoQ main lane\S\checkpoints\` - code and notes only, never a database copy - so the laptop gets it when it reconnects. Needs the desktop's OneDrive signed in to the laptop's account. | seconds |

Where things live: checkpoints in `<OneDrive Desktop>\BoQ main lane\<slice>\checkpoints\<stamp>\` (`head.txt`, `tracked.diff`,
`untracked.tar`, `commits.bundle` when commits travel, `files.txt`, `resume.md`, `ckpt.txt`); env_sync's database backups
in `frappe-bench\envsync\backups\<stamp>\` on each machine (newest 3 kept; **never** OneDrive, **never**
`sites\<site>\private\backups`); the pull record `frappe-bench\envsync\last_pull_fingerprint.txt` (with `# covers:`).

## Who runs what, and when

- **The laptop session's slice poller** (the loop that relays the desktop's status file) runs
  `checkpoint-code --slice S --name N --if-older 15` on each poll and once more at every `COMMIT <hash>` line. A
  failed copy prints `CHECKPOINT FAILED` (exit 3): report it on the relay; it is not retried in a loop.
- **After a costly step** the desktop session writes `DBCOPY-POINT <time> <step>` in its status file (a paid run, a
  catalogue load, a migrate, or on request); the laptop runs `db-pull --yes --covers "<step>"` in the background. The
  laptop's containers run only for the copy (the turn file is claimed first and freed after).
- **"Leaving"**: chat-Claude posts `CHECKPOINT` on the relay. The laptop writes `=== CHECKPOINT <time> ===` into the
  session's message file; the session stops at the next **safe point** (list below), writes its resume note and
  `CHECKPOINT SAFE <time> <step>` in its status file, and polls its message file. The laptop runs
  `checkpoint --slice S --name N --yes` (the session reads `CHECKPOINT TAKEN ... carry on` within a minute or two and
  goes on) and posts `CHECKPOINT READY` with the time it took.
- **During the commute** the session runs `ckpt_onedrive.sh` at every milestone (B4).
- **Back home**: the laptop runs `resume-on-laptop --slice S --name N`. Desktop up -> work goes on there. Desktop
  down -> on the owner's word, `--takeover --yes`, then post `RESUMED-ON-LAPTOP` with the step to continue from.

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
the commands to re-check the start state. The checkpoint commands copy it next to the code.

## Tests

`bash scripts/env_sync/tests/test_env_sync.sh` (bash + git only; docker / ssh / scp are stubs). Section 6 builds
throw-away repositories and proves: a snapshot never touches the source checkout; the rebuilt tree equals the snapshot's;
conflicts (own edits, clashing new files) are refused with nothing changed; the B3 commit form and the in-order takeover
sequence; the count check of a pulled copy.
