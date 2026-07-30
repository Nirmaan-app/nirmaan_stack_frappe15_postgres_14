---
recorded_tip: 21086546
recorded_branch: develop
recorded_date: 2026-07-28
handover_version: v5.90
status: current
folded: 2026-07-29
---

# BoQ / Nirmaan Stack — Facts Doc (handover)

> **Purpose.** The single source of volatile truth. Anyone — a new session, a
> colleague, future-you — can resume from this doc alone.
>
> **Rule (owner decision, v5.81).** The frontmatter + Status dashboard below are
> the CURRENT record. Narrative history is NOT here — see *Sources* at the end.
>
> **Folded 2026-07-29** from `BOQ_Feature_Handover_2026-07-28_v5_90`. Every
> commit named below was verified to exist in this repo at fold time.

## Status dashboard — CURRENT

- **Recorded tip:** `21086546` — *docs(pricing): plan doc PW-DS fold* — 2026-07-28, PUSHED, in sync.
- **Lane:** `feature/boq-pricing-helper`. **Verified merged 2026-07-29** — `21086546` is an ancestor of `develop`. *(v5.90 flagged "whether develop has moved since the cut was NOT verified" — this closes it.)*
- **Drift at fold:** `develop` is **27 commits** ahead of the recorded tip (two of those are the 2026-07-29 docs-hygiene commits). The session-start hook re-derives this every session — trust the hook, not this line.
- **Cycle lineage since `011fd5b1`** (feat+docs pairs, except PW-FS which is fix+feat+docs):
  `efa8d620`+`0ac80ce3` (ST-1) → `bf3690b7`+`0a435fa8` (U1) → `5d3027e7`+`13fb35ed`+`be534037` (PW-FS) → `28e22450`+`21086546` (PW-DS)
- **Migrations pending for teammates:** no NEW exposure this cycle (no doctype JSON changed in any of the five slices). The lane's standing migrate-carrying ×1 — G2b's four `BoQ Sheet` override columns — is unchanged and the **Abhishek heads-up REMAINS OWED**.
- **Tests — frontend:** vitest **976** across 46 files (full in-container run, read live before/after at PW-DS: 960→976).
- **Tests — backend:** `test_pricing` **230** · `test_classify` **70** · `test_cross_boq_carry` **50**, as of `011fd5b1`. ⚠️ **ST-1 may have moved `test_classify`** — bench-verify fresh before quoting ANY backend count.
- **tsc:** repo floor ~**3,240** pre-existing; ZERO in touched files across all five slices.
- **AI toggle:** not exercised this cycle. HV-11 tracker armed, no known flips. Engine health stays untrusted until monitored.
- **Deferred items:** **5 / 5 — AT CEILING.** Stop deferring, start closing.
- **Open risks:** the three side-arc UI commits are dev-lane-only until Abhishek's next train; the pricing module is LIVE in production.

### Deferred register (at ceiling)

| # | Item | Note |
|---|---|---|
| a | §3 sub-phase records | |
| b | Narrative catch-up | |
| c | Editor-perf cleanup — A/B toggle retirement after the stability window | |
| d | Merge new-doctype inventory unread | |
| e | **Set-3 trigger undefined** | **LOAD-BEARING** |

Tracked riders (not carries): Electrical baseline re-snapshot (superseded by the new master); v5.89 arc-close leftovers (§6 correction, stale `review_screen.py` comment, PR-description note); `test_pricing` SQL-traceback noise; AI-abstains-on-Preambles; non-admin on-screen check; live worker-failure test.

### Operational state — pricing workbooks

Electrical content = the NEW team master (v7 lineage, imported via Replace from the prepared READY file); workbook version v5 at side-arc cert time, `checked_out_by` NULL. **The Electrical frozen baseline v2 is SUPERSEDED — re-snapshot at the next maintenance touch.** HVAC v1 / ELV v1 unchanged.

## Next action (strict order)

1. **U2** — earthing wired real, stub deleted. The 2-session box has one session left; exit criterion per rate-helper §7a.
2. **Prod deploy** of the three UI commits via Abhishek, **+ the G2b migrate heads-up (OWED since v5.89)**, + prod residuals: retire throwaway estimator tests; **Google sharing revocation — the containment endpoint, still owed**.
3. v5.89 arc-close leftovers: Pricing-Editor §6 correction; the stale `review_screen.py` comment; the PR-description note.
4. Production-era carries, unchanged.

**Checklist C is owed fresh at next resume** (agreement #41) against this dashboard.

## Canonical command block

⚠️ Copy verbatim into prompts; never retype. Bench-verify counts in-session.

```
# container + interpreter
frappe_docker_devcontainer-frappe-1
/workspace/development/frappe-bench/env/bin/python

# parser suite
docker exec frappe_docker_devcontainer-frappe-1 bash -c \
  "cd /workspace/development/frappe-bench && env/bin/python -m unittest discover \
   -s apps/nirmaan_stack/nirmaan_stack/services/boq_parser -v"

# canonical 7-module parser run
MSYS_NO_PATHCONV=1 docker exec -w /workspace/development/frappe-bench/apps/nirmaan_stack/nirmaan_stack/services/boq_parser \
  frappe_docker_devcontainer-frappe-1 /workspace/development/frappe-bench/env/bin/python \
  -m unittest test_classifier test_orchestrator test_auto_guess test_hierarchy \
  test_multi_area_detection tests.test_config tests.test_reader 2>&1 | tail -5

# frontend (local gate; CI runs the Python bench suite only)
yarn test          # vitest, environment: node -- NO DOM env, deliberate
yarn dev           # :8080, separate from bench's esbuild watcher on :8000
```

## Environment runbook

- **`MSYS_NO_PATHCONV=1`** on ALL `docker exec`/`docker cp` when passing UNIX paths through Git Bash/MSYS on Windows, or `/tmp/...` is rewritten to `C:/Users/.../Temp/...` (§9 #93).
- **Container file creation:** Write-tool → host temp file → `docker cp` IN. **Never** heredoc through `bash -c` — it corrupts ownership and files land root-owned (§9 #94).
- **Docker outage recovery:** quit Docker Desktop UI → `wsl --shutdown` → wait for Stopped → relaunch (§9 #65).
- Avoid PowerShell `Select-Object` piped with `docker exec`; use the file-redirect form (§9 #76).
- `bench execute` is flaky (spurious NameErrors) — use a direct `frappe.init` driver via the bench env's Python.
- Bench workers do NOT hot-reload — restart after pulling pipeline changes.
- Vite does not hot-reload host edits on the bind mount; the PWA service worker caches — de-stale before any frontend cert, then load the ROOT route first.
- **No DOM test environment** (deliberate, `vitest.config.ts`). Anything turning on a React semantic — mount, unmount, state across renders — is structurally untestable as a unit test. Use Cypress, chrome-devtools, or a live A/B.

## Working agreements (59)

Cited by number throughout the plan docs and prompts. Full text: §8 of the source handover (see *Sources*).

| # | Agreement | | # | Agreement |
|---|---|---|---|---|
| 1 | Two-Claude workflow | | 31 | Diagnostic snapshot before regenerating live output |
| 2 | Plain English before commands | | 32 | Filename verification from disk before prompting |
| 3 | Pause before destructive operations | | 33 | §3 refresh is part of housekeeping |
| 4 | Real-data verification cadence | | 34 | Iterative parser refinement loop |
| 5 | One sub-phase per Claude Code prompt | | 35 | Handover doc creation workflow |
| 6 | Working tree clean at prompt start | | 36 | **Phase-level exit criteria mandatory** (override allowed) |
| 7 | No GitHub push from Claude Code | | 37 | Checklist C — strategic blind-spot audit |
| 8 | Branch named explicitly in every prompt | | 38 | Trigger-based forced intervention |
| 9 | **Two-commit shape:** feat/chore + docs | | 39 | Deference threshold explicit (no override) |
| 10 | Read context files before starting | | 40 | Bug-13 deterministic-unambiguous bar |
| 11 | Verify against actual code, not recollection | | 41 | **Checklist C MANDATORY at every fresh-chat resume** |
| 12 | Tests run in-session | | 42 | Caveat-cleanup chores not bundled with feature docs |
| 13 | Documentation maintenance per sub-phase | | 43 | Parser-fix work is bounded |
| 14 | Mid-project reflection ritual | | 44 | Prompt hygiene principles |
| 15 | Prompt size cap ~700 lines | | 45 | **Rolling-window archive convention** |
| 16 | Verify "known pattern" claims | | 46 | Wizard scope discipline |
| 17 | **PK re-upload after every docs commit** | | 47 | Boundary-crossing slices live-tested before "done" |
| 18 | Claude Code runs tests in-session | | 48 | **Pre-send prompt gate + canonical command blocks** |
| 19 | Sub-phase cognitive scope — STOP on new design surface | | 49 | **Recon-first on EVERY code-touching change** |
| 20 | Test-count framing distinguishes suites | | 50 | Checklists A/B/C are distinct — do not conflate |
| 21 | Mechanical-cascade scope-expansion threshold | | 51 | Surgical hash-backfill, never a global replace |
| 22 | Verify ambiguous numeric claims vs tool output | | 52 | Verify a backgrounded build by its completion notification |
| 23 | Timestamp + commit hash on every docs commit | | 53 | **Push from HOST PowerShell, not `docker exec`** |
| 24 | Standing rule for multi-area vs vendor-compare etc. | | 54 | Frappe Int NULL→0 trap — explicit `-1` sentinel |
| 25 | Audit-script-diff regression check at parser boundaries | | 55 | Parser-test fixture byte-churn — revert before stage |
| 26 | Restore-command safety | | 56 | **Recon-ONLY first, then build — never combined** (strengthens #49) |
| 27 | Metric-parser co-evolution | | 57 | In-container tsc + foreground-build-with-marker are canonical |
| 28 | Ground-truth validation requirement | | 58 | The slice-composition framework |
| 29 | Real-fixture integration tests for new pattern/routing logic | | 59 | Tightly-dictated follow-up fixes may skip the plan gate (disclosure required) |
| 30 | Throwaway experiments before risky changes | | | |

**#49 and #56 are not in conflict** — #56 is a later tightening of #49. `process-config.md` cites #56; older handovers cite #49. Both are live.

## Known issues

The §9 register (numbered findings, currently past #164) lives in the source handover — it is large and is a **grep target, not a load**. The parser-specific subset is mirrored in `frontend/.claude/plans/boq/known-issues.md`.

## Standing noise

Mirror of `process-config.md`; re-confirm against `git status` before relying on it.

```
modified:  .claude/settings.local.json
modified:  patches.txt
untracked: _classification_review/          <- DO NOT DELETE
             contains hvac_corpus_export/ and hvac_set1_run_v0/ - scoring depends on them
untracked: BOQ-26-00145_SOW_faithful.csv
untracked: Handover doc.pdf
untracked: tendering-won.patch
```

## Sources

| Document | Location | Note |
|---|---|---|
| `BOQ_Feature_Handover_2026-07-28_v5_90` | Owner's machine + project knowledge | 1.57 MB — the full narrative. Grep, never load. |
| `BOQ_Handover_archive_v1_48` | Owner's Desktop, **not** in project knowledge (agreement #45) | 1.43 MB — rotated prior-cycle sections. |
| `handover-v5.73-raw.md` | `.claude/facts/archive/` | Superseded by v5.90. Retained pending the owner's delete call. |

Neither large source is committed: per agreement #45 the archive stays off project knowledge, and 3 MB of narrative in-repo would defeat the point of this doc.

**Folding this doc:** update the frontmatter `recorded_tip`/`recorded_date`/`handover_version`, refresh the dashboard, and re-verify the command block. The session-start hook checks drift against `recorded_tip` automatically and will redirect readers to `git log` when it goes stale.
