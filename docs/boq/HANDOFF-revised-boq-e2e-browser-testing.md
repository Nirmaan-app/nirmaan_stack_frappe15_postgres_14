# HANDOFF — Revised BoQ (Amendment B W3–W6): browser E2E testing

**Created:** 2026-07-21 · **For:** a fresh-context agent doing **thorough end-to-end browser
testing** of the Revised-BoQ upload feature via the chrome-devtools MCP.
**Branch:** `feature/upload-revised-boq` @ **`36428389`** — local, NOT pushed.

**You are testing, not building.** Everything below is already implemented and unit/integration
tested. Your job is to find what the tests *cannot* see: real browser behaviour, real workbooks,
real timing, real user paths. **Do not "fix" product code without reporting first** — several
behaviours that look like bugs are owner-locked decisions (§6).

---

## 0. What shipped, in one paragraph

A **revision** is a new `BOQs` doc (`origin="revision"`, `source_boq` → the original) uploaded
against an already-committed original in the same project. It maps its sheets to the original's,
then **carries** the original's human work forward: classification + parenting (at parse), the
annotation/formula/category overlays (at commit), and **rates** (an explicit post-commit action).
Amendment B rewrote the carry rule and waves W3–W6 finished the surrounding workflow.

**The rule (W1, already shipped — you are verifying its consequences, not it):**

> A row copies the original's classification **and** parenting **iff** it is at the **same Excel
> row** with the **same** normalized description, **and its parent satisfies the same test**.
> Both, or neither. Status is `Copied` or blank; blank renders `Original`.

---

## 1. Environment — read this before touching anything

1. **`:8080` is LIVE (yarn dev). `:8000` is STALE.** Test in the browser on **`:8080`** only.
   This bites every new agent; a "bug" that reproduces only on :8000 is not a bug.
2. Container: `frappe_docker_devcontainer-frappe-1`. **`bench` lives at
   `/home/frappe/.local/bin/bench`**, not `env/bin/bench`.
3. **CSRF / login:** if login fails or POSTs 403, clear site data for `localhost` in DevTools
   (Application → Storage → Clear site data) and log in again. See the BoQ runbook.
4. Backend suites:
   `docker exec -w /workspace/development/frappe-bench frappe_docker_devcontainer-frappe-1 /home/frappe/.local/bin/bench --site localhost run-tests --module nirmaan_stack.api.boq.wizard.<module>`
5. Frontend vitest runs **inside the container only**:
   `docker exec -w /workspace/development/frappe-bench/apps/nirmaan_stack/frontend frappe_docker_devcontainer-frappe-1 npx vitest run src/pages/boq-wizard/`
6. Ad-hoc DB reads from the host need `os.chdir` to `sites/` **before** `frappe.init()` — recipe in
   the root `CLAUDE.md`.
7. **The repo is PUBLIC.** `docs/boq/revised-boq-explainer.html` and `revised-boq-workflow.html`
   contain **real client BoQ data and must never be committed** (they are untracked; keep it that
   way). **Do not paste real BoQ content, project names or client names into any file you create.**
8. **The dev DB has zero `BoQ Row Category` rows**, so category carry is not live-exercisable.
9. Test data that already exists: revision **`BOQ-26-00203`**; original **`BOQ-26-00023`** (its
   sheet `'LMS '` — note the trailing space — is the live example of the W6 orphaned-rate case).

---

## 2. Use the chrome-devtools MCP properly

Per the user's global instructions, browser work goes through the **chrome-devtools MCP**
(`chrome-devtools-mcp@claude-plugins-official`) and its bundled skills. **Playwright is installed
but disabled — do not use it.**

Beyond clicking through screens, actually use the tooling:

- **`list_console_messages`** after every flow — a clean-looking screen with a React key warning or
  an unhandled rejection is a finding.
- **`list_network_requests` / `get_network_request`** — verify the *payloads*, not just the UI.
  Several acceptance criteria below are about what the server was actually sent/returned.
- **`take_snapshot`** for structure, `take_screenshot` for visual regressions.
- **`performance_start_trace` / `stop_trace`** on the pricing grid — there is a documented history
  of main-thread saturation there (the T1/T2 socket-refetch storm). If the grid feels slow, trace
  it rather than guessing.
- **`emulate` / `resize_page`** — at least one pass at a narrow viewport; the wizard is used on
  laptops with small windows.

---

## 3. The four waves and exactly what to prove

### W3 — the New|Revise entry is LIVE after upload

Previously the radio froze the instant a file dropped. Now it converts through
`revision.convert_revision_entry`.

| # | Flow | Expected |
|---|---|---|
| 3.1 | Upload as **New**, then switch to **Revise** and pick an original | BoQ Name becomes the ORIGINAL's name; Version becomes original+1; seeded sheet drafts are DROPPED |
| 3.2 | Switch back to **New** | `source_boq` cleared; BoQ Name returns to the **filename-derived** name; drafts RE-SEEDED |
| 3.3 | **New → Revise → New → Revise** | Version must **NOT ratchet**. It should land on the same number as the first Revise. This is the single highest-value check in W3 |
| 3.4 | Switch mode with no original picked | Waits for the picker; no error thrown at the user, no server call |
| 3.5 | Drop the file BEFORE picking the original (Revise mode) | Still uploads once the original is picked — **order-independence must survive** |
| 3.6 | Convert twice to the same mode | No-op, no visible change, no error |

**Check in the network tab:** the `convert_revision_entry` POST for a Revise→New must include
**`file_name`** (the client's original filename). Without it the server falls back to the stored
`File` row, which Frappe may have uniquified — you would see a name like `my boq filef57551`.
If you see a hash-suffixed name, the frontend dropped `file_name`. That is a real bug, report it.

**Also confirm the guards** (each should show a clear inline message, not a stack trace): converting
a BoQ that is already committed, already parsed, or whose sheet mapping is already confirmed.

### W4 — every mapped sheet lands `Pending`, with work packages carried

| # | Check |
|---|---|
| 4.1 | After confirming a sheet mapping, **every** mapped data sheet shows **Pending** — even one whose columns are structurally identical to the original |
| 4.2 | Each mapped sheet arrives with the original's **work packages** already assigned |
| 4.3 | **The Config-Done attestation checkbox is actually clickable.** This is the whole point: it is disabled without ≥1 work package, so if the carry failed the sheet is permanently un-attestable |
| 4.4 | A **declared-New** sheet carries no work packages (correct — nothing to carry) and the user assigns one manually |
| 4.5 | The config screen still surfaces the diff diagnosis (dangling roles / description-set change) for an unsafe sheet |

⚠️ **Accepted cost, not a bug:** the hub's Parse button stays disabled until ≥1 sheet is marked
Config Done. That is the intent of W4.

### W5 — the carry numbers are shown

| # | Check |
|---|---|
| 5.1 | Parse a revision → the completion modal shows a **carry line** ("N of M rows copied…") |
| 5.2 | Parse a **non-revision** BoQ → **no** carry line at all, modal byte-identical to before |
| 5.3 | The number in 5.1 **agrees with reality** — count `Copied` rows on the review screen |
| 5.4 | Commit a revision → the results modal names the carried overlay layers per sheet, listing only **non-zero** ones, and never showing `provenance` |
| 5.5 | Commit a non-revision BoQ → no overlay line |
| 5.6 | Multiple sheets carrying → per-sheet breakdown is readable, not a wall of text |

**Network check:** `boq:parse_run_done` should carry `revision_carry` only for a revision; each
`committed[]` entry should carry `revision_overlay` only for a revision sheet.

### W6 — rates carry across committed versions

**This is the wave with real user impact and the one most worth your time.**

The defect it fixes: a source sheet priced at v1 and then **re-committed** to v2 has its pricing
orphaned onto the frozen v1. The mapping screen promised rates and the carry landed **zero**.

| # | Check |
|---|---|
| 6.1 | The mapping screen's **"rates" / "classifications" counts** are believable for a normal original |
| 6.2 | **Build the orphan case**: price a source sheet, **re-commit** it, then revise it. The count must still report the rates, and the carry must land them |
| 6.3 | The count and what actually lands **agree** — this is the stated acceptance criterion |
| 6.4 | Classification count reflects **all** classified rows, not only manually-typed ones (it now reads the effective value) |
| 6.5 | An **unclaimed** original sheet and a **general-specs** source contribute **0** to the counts |

⚠️ **6.2 has a KNOWN, OWNER-ACCEPTED limitation — do not report it as a bug.** See §6.1.

---

## 4. End-to-end journeys (run at least these three whole)

**Journey A — the happy revision.** New project → upload an original → configure → parse → review →
commit → price some cells → **upload a revision of it** → map sheets → confirm → attest each sheet →
parse → check the review screen's `Copied` rows and the "N of M rows copied from vX" header →
commit → run the rate carry → confirm rates landed on the pricing grid.

**Journey B — the mind-changer.** Start a New upload, change to Revise mid-flow, change back, change
again, then continue all the way to a committed revision. Nothing should be stale, mis-versioned or
double-seeded at any point.

**Journey C — the messy workbook.** A revision whose workbook has: a renamed sheet, an inserted row
near the top (which by design breaks the carry for everything below it — see §6.2), a reworded
description, a genuinely new sheet, and a removed sheet. Verify the review screen's `Copied` vs
`Original` split matches the rule, and that the removed-sheet advisory appears on the hub.

---

## 5. Regression surface — the non-revision flows MUST be unaffected

Every seam is gated on `origin == "revision"`. Prove it in the browser, not by reading code:

- A plain **New** BoQ: upload → configure → parse → review → commit → price. No revision UI, no
  carry lines, no behaviour change anywhere.
- **Create-from-Template** still works end to end (it shares `upload_file` and the commit pipeline).
- The **pricing editor** is untouched by this work — but sanity-check the grid still scrolls,
  freezes, virtualizes and edits normally, because W6 touched `pricing.py`.

---

## 6. Known and owner-locked — report, do NOT fix

### 6.1 The cross-version FORMULA carry is DECLINED

`commit_overlay`'s five layers (formula, remark, colour, remark-dismissal, category) stay
**version-pinned** even though W6 made rates cross-version. **The owner decided this on 2026-07-21
and it is not a bug.**

Consequence you WILL hit in test 6.2: a revision of a **re-committed** source arrives **not
formula-complete**, so the mandatory amount-formula gate locks every rate *and* the rate carry
reports **`formulas_incomplete`** for that sheet. The workaround is the intended flow: re-declare
the amount formula on the revision, then re-run the carry — and the rates should then land.

**Test that recovery path explicitly.** That is the user-visible behaviour that matters.
Pinned by `test_cross_boq_carry.TestOrphanedFormulaBlocksTheRateCarry` (all five links).

### 6.2 The net-zero insert+delete hole

A row inserted and another deleted above the same point can leave positions unchanged and let a
carry land on a row it should not. Documented in ADR-0014 §8 hole 1 and pinned deliberately by
`services/boq_revision/test_carry.py::TestKnownHole`. **If you find it, you have found the
documented hole, not a new bug.**

### 6.3 Other locked decisions

- **Rates read cross-version; structure reads per-commit.** Deliberate asymmetry, not an oversight.
- **`source_sheet_name` is write-once** — there is no remap affordance. Delete + re-upload is the
  escape hatch. A "missing" remap button is by design.
- **No new PricingGrid highlighting** for this feature (S10/#1106) — the existing "Show unpriced"
  filter is the review surface. `PricingGrid.test.ts` must stay at exactly **143** tests.
- **`sheet_name` is matched VERBATIM** — trailing/leading spaces exist in real data (`'LMS '`).
  Trimming is display-only. A sheet that looks duplicated may just have a trailing space.
- **The finalize gate is fully hard and purely structural** — no revision-specific override.

---

## 7. Pre-existing issues — not caused by this work, don't chase

- **`api/boq/wizard/test_upload_file.py` fails with 8 errors at HEAD** and did before this branch:
  it passes `tempfile_path=` to `_upload_file_worker`, which has never accepted that kwarg.
- **`upload_file.append_sheet_drafts` sets a dead `work_package` key** (singular). `BoQ Sheet Draft`
  has no such field, so it has never persisted. The owner chose to **leave it as is**; the
  explanatory comment stays.
- `frappe_s3_attachment` is now **`frappe_gcp_attachment`** app-wide. The root `CLAUDE.md` "BoQ File
  Reading (S3 safety)" section still says S3 — the *pattern* is unchanged, only the package name
  moved. Do not "fix" it back.

---

## 8. Baselines — everything is green at `36428389`

**Revision:** `revision_entry` **31** · `revision_mapping` **26** · `column_carry` **24** ·
`cross_boq_carry` **30** · `commit_overlay` **34** · `review_carry` 17 · `carry` 21 · `row_match` 17
· `column_diff` 17 · `revision_schema` 16 · `normalize` 10 · `sheet_match` 9.

**Regression:** `parse_run` **109** · `commit_pipeline` **55** · `review_screen` 260 · `pricing` 185
· `commit_validation` 51 · `classify` 38 · `create_from_template` 35 · `reader` 53 ·
`orchestrator` 78 · `classifier` 135 · `sheet_preview` 32.

**Frontend:** boq-wizard vitest **618** · `tsc` delta **0** in touched files (~3771 pre-existing
errors live in unrelated Retired-Components etc. — ignore them, measure the delta) ·
`PricingGrid.test.ts` **143**.

**Residence ratchet** (`python3 scripts/residence_check.py`, run from the **app root**, not
`frontend/`): b1 0 · b2 8 · b3 40 · f2 201 · f5 114.

Running the parser suites no longer dirties the tracked `.xlsx` fixtures — if you see 11 modified
fixtures in `git status`, something regressed `generate_synthetic._save`'s skip.

---

## 9. What to produce

A findings report with, per issue: **what you did**, **what you expected**, **what happened**,
**the console/network evidence**, and **your confidence that it is a real defect** rather than one
of §6's locked decisions or §7's pre-existing issues. Rank by user impact.

Screenshots for anything visual. For anything timing-related, a trace rather than a description.

**Do not commit product changes.** If you are confident about a small fix, propose it as a diff in
your report and let the owner decide.

---

## 10. The four commits under test

```
36428389 docs(boq): Amendment B W3-W6 as-built + the two owner decisions
b3d0341d feat(boq): Amendment B W3+W5 -- entry un-lock + carry reporting (frontend)
a6ae4ce9 feat(boq): Amendment B W3-W6 -- revised-BoQ entry, config gate, carry, reporting (backend)
9c6f2b9d chore(test): make BoQ parser fixture generation idempotent
```

Sitting on `a337a7f4` (the W3–W6 handoff), which sits on the shipped W0/W1/W2
(`465ab1e1` / `3f17db86` / `7ba86e9f`), rebased onto `feature/boq-create-from-template`
(`e2168d83`, already on `upstream/develop`). **Local and unpushed.**

**Read before starting:** `docs/boq/HANDOFF-revised-boq-amendment-b-w3-w6.md` (the build handoff,
§3 has the three owner calls that must not be re-litigated) and
`frontend/.claude/plans/boq-revised-upload-plan.md` (live status + the W3–W6 as-built section).
Backend contracts: `.claude/context/domain/boq-backend.md`. Frontend conventions:
`frontend/CLAUDE.md` + `frontend/.claude/context/domain/boq-frontend.md`.
