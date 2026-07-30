---
recorded_tip: e7f4602f
recorded_branch: feature/boq-within-boq-carry
recorded_date: 2026-07-30
handover_version: v5.91
status: current
folded: 2026-07-30
---

# BoQ / Nirmaan Stack — Facts Doc (handover)

> **Purpose.** The single source of volatile truth. Anyone — a new session, a
> colleague, future-you — can resume from this doc alone.
>
> **Rule (owner decision, v5.81).** The frontmatter + Status dashboard below are
> the CURRENT record. Narrative history is NOT here — see *Sources* at the end.
>
> **Folded 2026-07-30** (v5.90 → v5.91) **from git, not from a narrative doc.**
> The previous fold was 75 commits behind. Every claim below was derived from
> `git log`/`git diff` over `21086546..e7f4602f` in this checkout and is
> reproducible with the command shown beside it. Where a fact could NOT be
> verified from the host — anything needing a bench run — it is marked
> **UNVERIFIED** rather than carried forward from v5.90.

## Status dashboard — CURRENT

- **Recorded tip:** `e7f4602f` — *docs(context): carve the always-loaded docs into routers* — 2026-07-30. **UNPUSHED** (`git branch -r --contains e7f4602f` → 0 remote branches).
- **Lane:** `feature/boq-within-boq-carry`, **25 commits ahead of `develop`**, merge-base *is* `develop` (`2bd6032f`) so the merge is a **clean fast-forward, no conflicts** (`git merge-tree --write-tree develop HEAD` returns a tree).
- **Range folded:** `21086546..e7f4602f` — **69 non-merge commits, 369 files, +50,331 / −5,405**. Authors: Abhishek 42, **Nitesh 20**, Madhu 7.
- **What landed since the last fold** (six arcs; the last fold named none of them):

  | Arc | Commits | Author | State |
  |---|---|---|---|
  | **Rate Master + suggestion (RM-1 … RM-4b)** | 20 | Nitesh | **MERGED to `develop`** via PR #1133 (`2bd6032f`) |
  | **Within-BoQ carry parity (R1–R18)** | 24 | Abhishek | on this lane, **unpushed** |
  | Docs + context restructure | 7 | Abhishek | on this lane, unpushed |
  | Expenses / invoice-recon | 6 | Abhishek | merged |
  | Reports (Monthly WIP, inventory, Missing DC) | 3 | Abhishek / Madhu | merged |
  | Roles (Billing Executive view-only mirror) | 2 | Madhu | merged |

- **⚠️ MIGRATIONS PENDING FOR TEAMMATES — the v5.90 line "no NEW exposure this cycle" is FALSE for this range.** Verified via `git diff --name-status 21086546..HEAD -- '*/doctype/*/*.json'`:
  - **4 NEW doctypes:** `boq_rate_category_config`, `boq_rate_master_item`, `boq_rate_suggestion_event`, `boq_rate_suggestion_run` (all from the Rate Master arc)
  - **7 MODIFIED doctypes:** `boq_sheet`, `boq_row_category`, `boq_cell_color`, `boq_cell_dismissal`, `boq_cell_remark`, `project_expenses`, `non_project_expenses`
  - **2 `[MIGRATE]`-tagged commits:** `0fe9c6a2` (carry engine for categories + annotations, required provenance), `2a99d370` (lossless committed `sheet_config` snapshot)
  - `nirmaan_stack/patches.txt` is **unchanged in this range** and clean — but a teammate pulling this still needs `bench migrate`. **The Abhishek heads-up is OWED and is now much larger than the G2b item v5.90 tracked.**
- **Tests — ✅ BENCH-VERIFIED 2026-07-30, measured at `f215d6a9`** (4 commits past `recorded_tip`; ruling **R22**). All OBSERVED in-container via the bench runner, **not self-reported**. Cases and assertions given separately (assertions are static call-site counts):

  | Suite | Cases | Assertions | Result |
  |---|---|---|---|
  | `api.boq.wizard.test_pricing` | 255 | 787 | OK |
  | `api.boq.wizard.test_committed_carry` | 49 | 101 | OK |
  | `api.boq.wizard.test_cross_boq_carry` | 60 | 152 | OK |
  | `api.boq.wizard.test_classify` | 94 | 303 | OK |
  | `services.boq_category.tests` (5 modules: decay 12 · hv2-voter 14 · routing-policy 23 · runner-electrical 82 · runner-hvac 104) | **235** | 442 | OK |
  | **vitest** (in-container) | **1222** across **53** files | 2216 `expect(` | passed |

  **Zero skips anywhere.** Every backend suite's `Ran N` equals its `def test_` count, so nothing was silently filtered. ⚠️ `test_pricing` prints a SQL traceback + duplicate-key line from `test_atomicity_concurrent_first_edit_exactly_one_winner` — that is the suite deliberately racing the pricing lock; the noise is the assertion working, and the suite reports `OK`. **v5.90's `976 / 230 / 70 / 50` are historical.** Also historical: the interim `1188 / 50` quoted mid-arc.
- **tsc:** ✅ **3,236 error lines repo-wide**, measured by hand in-container at `f215d6a9` — the pre-existing baseline, unchanged. **Nothing in the repo runs tsc automatically** (no `typecheck` script; `build` is `vite build`/esbuild, which strips types without checking; CI runs the bench suite only), so this figure is only ever as fresh as the last manual run.
- **AI toggle:** not exercised in this range. HV-11 tracker armed, no known flips. Engine health stays untrusted until monitored.
- **Deferred items:** **still 5 / 5 — AT CEILING.** Item (b) is *partially* discharged (10 stranded Rate Master records recovered into the plan tree); item (d) has **escalated** — 4 new doctypes landed while the merge new-doctype inventory remains unread.
- **Open risks:** 25 commits unpushed and unreplicated on any remote; migration heads-up owed; the pricing module is LIVE in production; `boq-backend-wizard-endpoints.md` sits in the size warn band (65.6 KB) as a flat block with no structural split available.

### Context + plan layout (restructured 2026-07-29/30 — read this before looking for anything)

| Where | What | Rule |
|---|---|---|
| `CLAUDE.md`, `frontend/CLAUDE.md` | **routers**, 19.0 KB + 16.3 KB | Invariants + a when-you-touch-X-read-Y table. Auto-loaded. Was 177.8 KB combined. |
| `.claude/context/conventions/`, `frontend/.claude/context/conventions/` | 11 surfaces | How to **change** a surface. On demand. |
| `.claude/context/domain/boq-backend.md` | **router**, 1.7 KB → 5 surfaces | Was 187.3 KB. |
| `frontend/.claude/plans/boq/` | `README.md` trunk · `_slices.md` (180 rows) · `slices/` 179 write-once fragments · `phasing.md` / `known-issues.md` / `decisions/` registers | Fragments chain to `-part2.md`; registers are grepped, not loaded. |
| `frontend/.claude/plans/boq/archive/boq-upload-plan-pre-split.md` | 1.35 MB | The pre-rotation monolith. **Historical only.** |

Both `_index.md` files are authoritative; the session-start hook reports unindexed files. Neither `boq-frontend.md` nor `boq-upload-plan.md` exists any more — they were split at `61f82798` and rotated at `15e9b81e`.

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

1. **Get the 25 commits off this machine.** They exist on exactly one disk, include the whole R1–R18 carry arc and the docs restructure, and nothing is replicated. Clean fast-forward onto `develop`, owner-gated, from HOST PowerShell (#53).
2. **Send the migration heads-up to Abhishek** — now covering 4 new doctypes + 7 modified + the two `[MIGRATE]` commits, not just the G2b item. Name the merge order; `bench migrate` is required after pull. **This gates the push** (Full-tier rule).
3. ~~**Bench-verify the test counts** and record them here.~~ ✅ **DONE 2026-07-30** — recorded in the dashboard above, measured at `f215d6a9`. Re-verify after the next code-bearing slice; the numbers are a measurement with a date, not a standing fact.
4. **U2** — earthing wired real, stub deleted. The 2-session box has one session left; exit criterion per rate-helper §7a. (`stubRateHelper.test.ts` is already deleted in this range, so the stub retirement is partly done — verify what remains.)
5. **Close a deferred item before adding one** — register is at ceiling, and (d) *merge new-doctype inventory unread* is now the load-bearing one given the 4 new doctypes.
6. Residuals: retire throwaway estimator tests; **Google sharing revocation — the containment endpoint, still owed**; v5.89 arc-close leftovers (Pricing-Editor §6 correction, stale `review_screen.py` comment, PR-description note); carve `boq-backend-wizard-endpoints.md` if a structural split appears.

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

## Standing noise — **PER MACHINE, not global** (corrected 2026-07-30)

⚠️ **The v5.90 list was machine-specific and unlabelled, which made it wrong wherever it was read.** Verified on 2026-07-30 in the macOS checkout: 5 of its 6 entries do not exist there, and one had the wrong path. A13 asks the executor to declare pre-existing noise, so a list that misfires produces either a false "clean tree" or a phantom finding. **Derive it from `git status` each session; treat the block below as a per-machine expectation, not a fact.**

**Path correction, both machines:** `patches.txt` lives at **`nirmaan_stack/patches.txt`**, not the repo root. It is tracked, was **clean and unchanged** across `21086546..e7f4602f`, and is still Abhishek-owned — never edit it.

**Nitesh's Windows / Docker checkout** (`C:\Users\nites\Documents\...` — the one the Environment Runbook below describes):
```
modified:  .claude/settings.local.json
modified:  nirmaan_stack/patches.txt        <- when the migration train is moving
untracked: _classification_review/          <- DO NOT DELETE
             contains hvac_corpus_export/ and hvac_set1_run_v0/ - scoring depends on them
untracked: BOQ-26-00145_SOW_faithful.csv
untracked: Handover doc.pdf
untracked: tendering-won.patch
```

**Abhishek's macOS checkout** (verified 2026-07-30 at `e7f4602f`; `_classification_review/` and the three untracked artefacts above are **not present here at all** — they are Nitesh-machine working data):
```
untracked: docs/boq/                        <- ~45 explainer HTML/MD + node-audit-src/, shots/
untracked: docs/crm-merge/
untracked: docs/adr/0012-crm-stack-unification.md
untracked: docs/context-audit.html
untracked: frontend/.claude/hooks/
untracked: frontend/HANDOFF-pyopenssl-s3-deploy-issue.md
```

Also note: `.claude/projects/C--Users-nites-Documents-nirmaan-stack-frappe15-postgres-14/` (including a `memory/MEMORY.md`) is **committed into the repo** — a Claude Code session directory from Nitesh's machine travelling with the source. Not noise, but not obviously intended either; worth an owner call.

## Sources

| Document | Location | Note |
|---|---|---|
| `BOQ_Feature_Handover_2026-07-28_v5_90` | Owner's machine + project knowledge | 1.57 MB — the full narrative. Grep, never load. |
| `BOQ_Handover_archive_v1_48` | Owner's Desktop, **not** in project knowledge (agreement #45) | 1.43 MB — rotated prior-cycle sections. |
| `handover-v5.73-raw.md` | `.claude/facts/archive/` | Superseded by v5.90. Retained pending the owner's delete call. |

Neither large source is committed: per agreement #45 the archive stays off project knowledge, and 3 MB of narrative in-repo would defeat the point of this doc.

**Folding this doc:** update the frontmatter `recorded_tip`/`recorded_date`/`handover_version`, refresh the dashboard, and re-verify the command block. The session-start hook checks drift against `recorded_tip` automatically and will redirect readers to `git log` when it goes stale.
