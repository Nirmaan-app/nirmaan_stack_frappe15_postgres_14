---
recorded_tip: 9cc5e689
recorded_branch: feature/boq-within-boq-carry
recorded_date: 2026-07-31
handover_version: v5.92
status: current
folded: 2026-07-31
---

# BoQ / Nirmaan Stack — Facts Doc (handover)

> **Purpose.** The single source of volatile truth. Anyone — a new session, a
> colleague, future-you — can resume from this doc alone.
>
> **Rule (owner decision, v5.81).** The frontmatter + Status dashboard below are
> the CURRENT record. Narrative history is NOT here — see *Sources* at the end.
>
> **Folded 2026-07-31** (v5.91 → v5.92) **from git.** Every claim below was
> derived over `e7f4602f..9cc5e689` in this checkout. Test counts were observed
> in-container this session by an independent agent, re-checked here statically.

## Status dashboard — CURRENT

- **Recorded tip:** `9cc5e689` — *docs(boq): record slice WBC-S12* — 2026-07-31. **UNPUSHED** (`git branch -r --contains 9cc5e689` → 0 remote branches).
- **Lane:** `feature/boq-within-boq-carry`, **39 commits ahead of `develop`, 0 behind.** Merge-base *is* `develop` (`2bd6032f`), so the merge is **still a clean fast-forward, no conflicts** (`git merge-tree --write-tree develop HEAD` returns a tree).
- **Range folded:** `e7f4602f..9cc5e689` — **14 commits, 21 files, +2,683 / −408**. Author: **Abhishek 14 (sole)**.
- **What landed — one session, three slices, all on the carry arc:**

  | Slice | Commits | Headline |
  |---|---|---|
  | **WBC-S10** | `283a0199` | A copy-forward may land rates on uncategorised rows |
  | **WBC-S11** | `f289889a` `72933a60` `bce47806` `3cd922da` `8b845cd4` | Opt-in serial + description second-pass match, cross-BoQ carry ONLY |
  | **WBC-S12** | `50a437a4` `9cc5e689` | ADR-0014 Amendment G written under D6; three residues corrected |

  **S10 — ungate the copy-forward.** Owner's ruling: the category gate exists to stop a **hand-typed** rate landing on an uncategorised row; a copy moves known values from a known-good source, which is a **different risk**. The **edit-time gate is untouched** — `_guard_categories_complete` → `save_cell_price` (`pricing.py:680`) is byte-identical in *code* across the whole arc (only its docstring moved). `_categories_gate_ok` survives, and **`api/boq/rate_master.py:203` is now its sole non-test caller.**

  **S11 — a moved row can still carry.** The cross-BoQ carry gained an **opt-in second pass** on serial + normalized description, run only over rows the position pass leaves unmatched **on both sides**. It pairs only when the key is unique on BOTH sides; blank, duplicate or differing serials leave the row unmatched. **A bad serial LOSES a match, it never CREATES a wrong one.** Enabled on `committed_excel_row_match` only — the within-BoQ copy-forward and the parse-time parenting carry **stay strict**, pinned by an AST call-site test. Serial-matched rows carry rate AND annotation layers.

- **⚠️ MIGRATIONS STILL OWED TO TEAMMATES — carried from v5.91, NOT discharged.** This range adds **no new exposure**: `git diff --name-only e7f4602f..9cc5e689 -- '*/doctype/*/*.json'` is empty and `nirmaan_stack/patches.txt` is untouched. The outstanding debt is exactly what v5.91 recorded:
  - **4 NEW doctypes:** `boq_rate_category_config`, `boq_rate_master_item`, `boq_rate_suggestion_event`, `boq_rate_suggestion_run` (Rate Master arc)
  - **7 MODIFIED doctypes:** `boq_sheet`, `boq_row_category`, `boq_cell_color`, `boq_cell_dismissal`, `boq_cell_remark`, `project_expenses`, `non_project_expenses`
  - **2 `[MIGRATE]`-tagged commits:** `0fe9c6a2` (carry engine for categories + annotations), `2a99d370` (lossless committed `sheet_config` snapshot)
  - A teammate pulling this needs `bench migrate`. **The heads-up is OWED.**
- **Tests — ✅ observed in-container this session by an independent agent, at the commits named.** Static `def test_` counts in this checkout agree with every figure below.

  | Suite | Cases | Observed at |
  |---|---|---|
  | `api.boq.wizard.test_pricing` | **252** | `283a0199`, again at `8b845cd4` |
  | `api.boq.wizard.test_committed_carry` | **58** | `8b845cd4` (was 49) |
  | `api.boq.wizard.test_cross_boq_carry` | **68** | `8b845cd4` (was 60) |
  | `services.boq_revision.test_row_match` | **39** | `8b845cd4` (was 17) |
  | `services.boq_revision.test_carry` | **29** | `8b845cd4` |
  | **vitest** (in-container) | **1222** across **53** files | `8b845cd4` |
  | `api.boq.wizard.test_classify` | 94 | `f215d6a9`; count re-checked unchanged at `9cc5e689` |
  | `services.boq_category.tests` (5 modules) | 235 | `f215d6a9`; tree untouched in this range |

  **Zero skips** — verified by counting unittest progress characters, all plain dots; no `@skip` decorator exists in these modules. ⚠️ `test_pricing` prints a SQL traceback + duplicate-key line from `test_atomicity_concurrent_first_edit_exactly_one_winner` — the suite deliberately racing the pricing lock; the noise is the assertion working, and the suite still reports `OK`. **v5.91's `255 / 49 / 60` are historical.**
- **tsc:** 3,236 error lines repo-wide at `f215d6a9` — the pre-existing baseline, **NOT re-measured over this range.** Nothing runs tsc automatically (no `typecheck` script; `build` is esbuild, which strips types without checking), so it is only ever as fresh as the last manual run.
- **AI toggle:** not exercised in this range. HV-11 tracker armed, no known flips.
- **Deferred items:** **8 — OVER the ceiling of 5.** See the register below.
- **Open risks:**
  - **The arc is code-complete but UNCERTIFIED in a browser.** S10 and S11 both changed user-visible carry behaviour and neither has been driven live. This is the top risk and it gates the merge.
  - **39 commits unpushed and unreplicated on any remote** — they exist on exactly one disk and now include the whole S10/S11 carry work.
  - Migration heads-up owed (above).
  - The **pricing module is LIVE in production**.
  - `boq-backend-wizard-endpoints.md` sits in the size warn band (65.6 KB) as a flat block with no structural split available.

### Context + plan layout — read this before looking for anything

| Where | What | Rule |
|---|---|---|
| `CLAUDE.md`, `frontend/CLAUDE.md` | **routers**, 19.0 KB + 16.3 KB | Invariants + a when-you-touch-X-read-Y table. Auto-loaded. |
| `.claude/context/conventions/`, `frontend/.claude/context/conventions/` | 11 surfaces | How to **change** a surface. On demand. |
| `.claude/context/domain/boq-backend.md` | **router**, 1.7 KB → 5 surfaces | On demand. |
| `frontend/.claude/plans/boq/` | `README.md` trunk · `_slices.md` (185 rows) · `slices/` 183 write-once fragments · `phasing.md` / `known-issues.md` / `decisions/` registers | Fragments chain to `-part2.md`; registers are grepped, not loaded. |
| `frontend/.claude/plans/boq/archive/boq-upload-plan-pre-split.md` | 1.35 MB | The pre-rotation monolith. **Historical only.** |

Both `_index.md` files are authoritative; the session-start hook reports unindexed files. **Neither `boq-frontend.md` nor `boq-upload-plan.md` exists any more** — don't hunt for them.

### Deferred register — ⚠️ **8 items against a ceiling of 5. It is OVER.**

Three added this session, none discharged. Nothing was silently dropped; the
overflow is stated so the owner can choose what goes.

| # | Item | Note |
|---|---|---|
| a | §3 sub-phase records | **discharge candidate** — low-value, long-stale |
| b | Narrative catch-up | **discharge candidate** — partly done (10 stranded RM records already recovered) |
| c | Editor-perf cleanup — A/B toggle retirement after the stability window | |
| d | Merge new-doctype inventory unread | **LOAD-BEARING** — 4 new doctypes landed while it stayed unread |
| e | **Set-3 trigger undefined** | **LOAD-BEARING** |
| f | `_NODE_MATCH_FIELDS` in `committed_carry.py` fetches `level`, which `_content_match_rows` never reads | Pre-existing dead read (projects `source_row_number`/`description`/`code` only). Needs a slice owning that file. |
| g | **`docs/adr/` has duplicate ADR numbers** — two files each at **0002, 0007, 0008, 0009 and 0014** | "ADR-0014" **by number alone is ambiguous in this repo** (`0014-boq-revised-upload-and-carry.md` vs `0014-invoice-mutation-permissions.md`). Always cite the filename. Renumbering is its own decision. |
| h | **Two immutable commit messages overclaim** | `72933a60`'s body describes a boundary the owner's ruling then changed (corrected in `bce47806`); `8b845cd4`'s subject says it wrote ADR-0014 Amendment G but it **never opened the ADR** — that happened later, in `50a437a4`. **Anyone bisecting to either will be misled.** |

Tracked riders (not carries): Electrical baseline re-snapshot (superseded by the new master); v5.89 arc-close leftovers (§6 correction, stale `review_screen.py` comment, PR-description note); `test_pricing` SQL-traceback noise; AI-abstains-on-Preambles; non-admin on-screen check; live worker-failure test.

### Operational state — pricing workbooks

Electrical content = the NEW team master (v7 lineage, imported via Replace from the prepared READY file); workbook version v5 at side-arc cert time, `checked_out_by` NULL. **The Electrical frozen baseline v2 is SUPERSEDED — re-snapshot at the next maintenance touch.** HVAC v1 / ELV v1 unchanged.

## Next action (strict order)

1. **OWNER LIVE CERTIFICATION IS OWED FOR BOTH S10 AND S11. NOTHING MERGES BEFORE IT.**
   The arc is code-complete and browser-unverified. In each case the **pairing**
   is the proof — a single passing half proves nothing.

   - **S10.** On a sheet whose CURRENT version has uncategorised rows:
     (i) copy-forward **SUCCEEDS**; then (ii) hand-typing a rate on that **same
     sheet** is **still REFUSED**, with the amber banner. **Include a qty-less
     Preamble** among the rows checked.
   - **S11.** (i) A **within-BoQ** copy-forward on a **moved-but-same-serial**
     row must **STILL REFUSE** — the boundary holding. (ii) Rows with
     **duplicate serials** must stay in the **not-carried** bucket — the safe
     failure working.

2. **Decide push / merge to `develop`.** 39 commits, clean fast-forward,
   owner-gated, from HOST PowerShell (#53). Gated on (1) and (3).
3. **Send the migration heads-up to teammates** — 4 new doctypes + 7 modified +
   the two `[MIGRATE]` commits. Name the merge order; `bench migrate` is required
   after pull. **Carried from v5.91, still owed.** Gates the push (Full-tier rule).
4. **Discharge deferred items — the register is OVER ceiling at 8.** (d) and (e)
   are load-bearing and must survive; (a) and (b) are the candidates to close.
5. **U2** — earthing wired real, stub deleted. One session left in the 2-session
   box; exit criterion per rate-helper §7a. (`stubRateHelper.test.ts` is already
   deleted, so the stub retirement is partly done — verify what remains.)
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

## Standing noise — **PER MACHINE, not global**

⚠️ A13 asks the executor to declare pre-existing noise, so a list that misfires produces either a false "clean tree" or a phantom finding. **Derive it from `git status` each session; treat the blocks below as a per-machine expectation, not a fact.**

**Both machines:** `patches.txt` lives at **`nirmaan_stack/patches.txt`**, not the repo root. Tracked, Abhishek-owned, unchanged through `9cc5e689` — never edit it.

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

**Abhishek's macOS checkout** (re-verified 2026-07-31 at `9cc5e689`; `_classification_review/` and the three untracked artefacts above are **not present here at all** — they are Nitesh-machine working data):
```
untracked: cert-shots/                      <- NEW since v5.91; browser-cert screenshots
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
