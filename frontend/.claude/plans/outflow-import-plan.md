# Bulk Import Outflow Transactions — Implementation Plan

**Version:** **v3** (2026-08-06), **+ the v4 arc planned in §H** (2026-08-09). Supersedes v2 wherever
they conflict.
**Status:** **v3 is BUILT and committed** through T1–T5 (`6567d2e4`); the live browser walk and the
production migrate are still owed. **v4 (§H) is PLANNED, NOT STARTED — no code written.**
**§P1 — the period-scoped summary — is BUILT (2026-08-12), browser walk owed. See §P1 below.**
**Fresh-session brief:** `docs/outflow-import/HANDOFF.md` — read it first.
**Branch (proposed):** `feature/outflow-import`
**Spec + all 13 owner rulings:** `docs/outflow-import/workflow.html` **section 0** (7 tabs).
**Approved screen design:** `docs/outflow-import/screen-prototype.html` (clickable, signed off 2026-08-06).
**Everything below §Z is the v2 as-built record** — accurate about the code in the repo today,
wrong about the design going forward. Read it for what exists, not for what to do.

---

## §A — The reversal, in one line

v2's spine was *"the payment branch never writes"*. The owner reversed it. New spine:

> **The import pays what someone has already approved. It never approves anything, and it never
> creates a Project Payment.**

All three ledgers settle `Approved → Paid` only. This is an *alternative bulk route* chosen per
batch (owner ruling Q12) — **nothing about how the accounts team works today changes**, so mixed
usage (half a statement hand-ticked already) is the normal case, not an edge case.

### What survives, what changes

| Module | Fate |
|---|---|
| `services/…/normalize.py` | **Untouched.** |
| `services/…/matcher.py` | **Untouched** — passes A/B/C, grouping, ambiguity all still correct. |
| `services/…/parser.py` | **+ .xlsx** (Q10). Everything else untouched. |
| `services/…/candidates.py` | **Scope change** — settleable pool is `Approved` only; `Requested`/`CEO Pending` are loaded *for the nudge*, not for settling. |
| `services/…/status.py` | **Rewritten** — new 8-status vocabulary, reference-mismatch branch deleted. |
| `services/…/settle.py` | **+ the payment write path.** Expense path largely intact. |
| `api/…/upload.py` | **+ preview step, period-narrowed duplicate guard, refusal rules.** |
| `api/…/review.py` | Trimmed — `get_reconciliation_report` goes. |
| `api/…/expenses.py` | Becomes the settle dispatcher for all three targets. |
| `frontend/…/outflowImportStatus.ts` | **Rewritten** to mirror the new deriver, parity-pinned. |
| `frontend/…/OutflowRowsTable.tsx`, `OutflowRowDetail.tsx`, `SettleExpensePanel.tsx`, `ReconciliationReport.tsx` | **Deleted** — replaced by the card worklist. |

The pure layers carry 195 passing tests and are the reason this reversal is affordable.

---

## §B — Status vocabulary (the single deriver, ADR-0010 B3)

`Pending match run` · `Matched` · `Unmatched` · `Mismatched` · `Settled` · `Skipped` · `Error`

Load-bearing rules, all owner-ruled:

1. **ONLY `Approved` records are ever matched** (owner, 2026-08-06). A transfer against a
   `Requested` or `CEO Pending` payment is simply **`Unmatched`**. The v3-draft status
   *"Payment matched but not approved"*, its approval-queue deep links and the CEO-only wrinkle are
   all **removed** — nothing that cannot be settled is offered. ⚠️ This reverses an earlier stated
   goal (surfacing the 111 CEO-Pending payments, ₹88.8 L); recorded so it is not re-added by
   accident.
2. **The already-Paid duplicate guard SURVIVES, and is a skip, not a match** (Q14, decided
   2026-08-06). A transfer whose reference is already on a Paid payment reads
   `Skipped — already recorded as Paid on <name>`.
   Without it, a payment someone ticked by hand comes back `Unmatched` and can be booked **twice** —
   and under Q12 (mixed usage is normal) that is the common case, not an edge case. It is a
   *duplicate check*, not a settle candidate, so it does not violate rule 1.
3. **`Mismatched` is about AMOUNTS ONLY.** The v2 `Reference mismatch` branch is **deleted, not
   folded in** — the owner asked why the system would compare a stored reference on an already-Paid
   payment, and there is no answer under v3. The reference field is only ever *written* into a blank,
   never compared. It fires when the already-Paid record found by rule 2 disagrees on amount, and
   those rows get the **same full decision dialog** as any other row (owner: mismatched must be
   resolvable, not just reported).
4. **`Unmatched` is its own status**, not a flavour of `Mismatched`. It is where new expenses get
   created and, with rule 1 in force, will be the largest group on a real sheet.
5. **Batch statuses:** `Draft` → `In Review` → `Partially Settled` → `Completed`.
   `Completed with exceptions` is **dropped** — the three tabs show that directly.

---

## §C — Slices

Each slice is independently reviewable and leaves the tree green.

### V0 — the vocabulary
Rewrite `status.py` + `outflowImportStatus.ts` + the FE↔BE parity test (F1). Update the
`row_status` / batch `status` Select options on the two doctypes.
**Gate:** `test_status` rewritten and green; parity test green; no other module touched.
⚠️ **Migrate-carrying**, and existing dev rows hold retired values — see §D.

### V1 — candidate scope
`candidates.py`: the candidate pool is **`Approved` only, on all three ledgers** — nothing earlier on
the ladder is loaded at all (this also tightens `Non Project Expenses`, which currently accepts
`Requested`). The **one** query that still reads outside that pool is the already-Paid duplicate
check of §B rule 2, and it feeds a *skip reason*, never a settle candidate — keep the two paths
visibly separate in the code so a later reader cannot mistake one for the other.
**Gate:** `test_matcher` + a new candidates test; the 3-way ambiguity and account-only fixtures
still behave identically; a fixture proves a CEO-Pending payment yields `Unmatched`, and one proves
an already-Paid payment yields `Skipped`.

### V2 — the payment write path ⚠️ the risky one
New `settle.py` function + one dispatching endpoint `settle_row(row, target_doctype, target_name)`
covering all three targets (the guard then lives in exactly one place).
Must get right, each already located:
- Lock with `frappe.db.get_value(..., for_update=True)` and **never `cache=True`** (that silently
  skips the lock).
- Assert `status == "Approved"`; distinct named errors for already-Paid vs wrong-status.
- **`update_parent_amount_paid` calls `frappe.db.commit()` inside the save.** That destroys the
  per-row savepoint isolation the expense loop relies on, and it matters *more* now because bulk
  confirm is the selling point. Settle payments one at a time with a deliberate commit boundary, or
  suppress the hook for this path — decide with a test that proves row 3 failing leaves rows 1–2
  written and rows 4+ still attempted.
- Suppress the per-row CEO-Hold cashflow recompute and notification dispatch (the expense path
  already has this pattern).
- **Fan-out is refused here** (Q4, report-only), so the existing UTR duplicate guard is never
  challenged and stays exactly as it is.
- `Outflow Row Match` insert is the idempotency guard — unique on
  `(transfer_id, target_doctype, target_name)`.
**Gate:** new `test_settle_payment` — not-approved refused, already-Paid refused, double-settle
idempotent, PO `amount_paid` recomputed exactly once, savepoint isolation proven, fan-out refused.

### V3 — upload: preview, duplicates, .xlsx
- New `preview_outflow_statement` — parse only, **zero writes**, returns period, counts, gross,
  charges, duplicate count, overlap warning, format warnings. The browser re-posts the same file on
  confirm (a few kilobytes) rather than the server holding a parse between requests.
- Duplicate lookup **narrows to batches whose period overlaps** this sheet's period first. Safe
  because the DB unique constraint is the real backstop — the duplicate check is ergonomics, not the
  safety net.
- **100% duplicates → refuse outright**, nothing written, message names the earlier batch.
  **≥90% → warn in the preview**, never block. (Q2, Option B; 90% is one constant.)
- `.xlsx` reader in `parser.py` alongside `.csv` (Q10).
**Gate:** `test_upload` extended — refusal writes no File/batch/rows; threshold warns; an .xlsx
fixture parses to the same rows as its .csv twin.

### V4 — the batch screen (**table**, not cards)
Three tabs **Pending · Settled · Skipped**, each a dense `DataTable` built on the app's existing
conventions (`DataTableColumnHeader` sort menu, funnel `Popover` faceted filters, row-selection
checkboxes) — the Design Tracker table is the reference implementation.

**Columns:** Payment Date · Beneficiary (with a/c + IFSC beneath) · Amount Paid · Remarks ·
Reference (UTR) · Status · **Outcome**. Bank a/c, IFSC and Time ship **hidden by default**, available
from the Columns menu — that is where any further field belongs rather than widening the default row.

- **Every column sorts and filters.** Facet (multi-select checkbox) for date / beneficiary / status,
  contains-text for remarks / reference, min-max for amount. Composition is **AND across columns, OR
  within a column**, with a `Clear filters (N)` control — same semantics as the Rate Master viewer.
- **One global search** over remarks, reference and beneficiary, with the hit highlighted in the cell.
- **The Outcome cell is the one saturated, unmistakably-interactive element** — a real bordered
  button with a hover lift and a chevron. The original complaint was that a clickable row does not
  read as clickable; a hover tint alone was never going to fix that.
- **Clicking Outcome opens the decision dialog**, which carries:
  - *Why the system suggests this* — the matching criteria as plain-English bullets, never jargon
    ("The bank reference … is not recorded on any payment yet"; "One **approved** payment is for
    **exactly this amount**, to **the same vendor**, dated within three days");
  - the four options, each opening **in place** with everything it needs inside it;
  - link options use a **dropdown**, not radios; selecting a record loads a detail panel beneath it
    (vendor, PO/SR number, project, approved-on, status, amount) plus an explicit
    *same amount ✓ / differs by ₹X ⚠* verdict. Exact-amount records sort first and are marked;
    pre-selected **only when there is exactly one** — two exact matches is ambiguity, and the screen
    never guesses between two real records;
  - the new-expense form (project selector filtered to `tendering_status = "Won"`, **CEO-Hold
    projects shown disabled with the reason**, expense type scoped per ledger, amount/date/reference
    read-only from the bank row);
  - **Mismatched rows get the same full dialog** — the owner's point was that reporting a mismatch
    without offering a resolution is a dead end;
  - per-row **Re-run match** in the footer.
- **Row checkboxes drive bulk Confirm / Skip.** The bar shows how many of the selected rows are
  actually *decided* (`Confirm 4 decided` when 5 are ticked but one has no decision) — it never
  silently acts on a row the user has not resolved.
  ⚠️ **Selection must never re-render the table body.** Rebuilding `<tbody>` replaces every checkbox
  element, so a second click lands on a detached node and is lost — and it throws away scroll and
  focus on every tick. Toggle the row class and the bulk bar only. *(Found live in the prototype.)*

Won projects come from a plain `useFrappeGetDocList("Projects", tendering_status = "Won")` — no new
endpoint. Expense types reuse the existing `get_expense_types(doctype)`.
**Gate:** `tsc` clean; vitest on the pure helpers (status mirror, filter/sort predicates, the
`confirmable` rule); **live browser walk-through is the real gate** — see §E.

### V5 — cleanup + docs
Delete `ReconciliationReport.tsx` and `get_reconciliation_report`; simplify close/reopen to one
button; drop `Completed with exceptions`. Write
`.claude/context/domain/outflow-import.md` with a `## Residence — concept → owner` manifest, add one
row to the root `CLAUDE.md` Reference Docs table, and record the as-built here.
**Gate:** `python3 scripts/residence_check.py` does not regress.

---

## §D — Migrate obligations

1. `Outflow Import Row.row_status` Select options (V0).
2. `Outflow Import Batch.status` Select options (V0, drops `Completed with exceptions`).
3. ⚠️ **Existing dev rows carry retired status values** (`Reconciled`, `Control exception`,
   `Amount mismatch`, `Reference mismatch`). Nothing is in production and these are test batches, so
   the cleanup is a delete, not a patch — but it must be done deliberately, not discovered.
4. This is **on top of** debt already owed to teammates (4 new + 7 modified doctypes, 2 `[MIGRATE]`
   commits per the handover). Production is several migrates behind; one combined heads-up is owed.

No new doctype.

5. ⚠️ **CORRECTED at R1.** This section used to read *"no new field: `Outflow Row Match` already
   records which record a row settled."* That was true of the SETTLEMENT and wrong about the
   SUGGESTION — the two are different facts, and the suggestion cannot live in that table without
   taking its unique key before the settlement needs it. **`Outflow Import Row` gains
   `suggested_doctype` + `suggested_name`**, so the migrate obligation is now six doctype JSONs on
   this branch, not four.

---

## §E — What can and cannot be tested here

- Backend: `FrappeTestCase`. ⚠️ The `api` suites **write to the live dev DB** and purge in
  `tearDownClass` — if `setUpClass` raises, teardown never runs and residue survives.
- ⚠️ **Never run the bench suite and a browser session against localhost together** — they collide
  on the `tabSeries` naming lock.
- Frontend: **there is no DOM environment, by deliberate repo choice.** The card worklist,
  the pickers and the keyboard handling are React semantics and are **structurally untestable**
  here. Only pure helpers get unit tests. The honest verification for V4 is a live browser walk —
  the same method used to certify the prototype, which found three real defects a green suite could
  never have seen.

---

## §F — Risks carried into the build

1. **TDS payments will not match.** The bank sends `amount − tds`; exact-amount matching misses them,
   so they arrive as `Unmatched` and go through the existing screen by hand. Measured: **709 of
   7,421 Paid payments (9.6%)** — ~15% for most of the past year, ~3% in Jun–Jul 2026. Owner accepted
   this with the numbers in hand (Option A). **There is no cheap workaround**: `tds` is written at
   fulfil time, so an approved unpaid payment has a blank TDS field and `amount − tds` has nothing to
   subtract. Catching these needs the tolerance pass deferred as **Q11 → next version**, which also
   carries the TDS box (Q6).
2. **The settleable pool is near-empty today** (2 approved payments, 2 approved expenses) because
   people tick Paid immediately. Expected under Q12 — the pool exists when someone chooses the bulk
   route. It does mean the first real exercise will be thin until someone deliberately uses it.
3. **Dev DB is ~9 days stale** (data ends 2026-07-28).
4. **Fixtures stay synthetic — the repo is public.** Real statements carry live beneficiary names,
   accounts and IFSC codes. Do not commit a real export.

---

## §G — v3 as-built record

### R1 + R2 — pre-selection and the one Link payment list (2026-08-07, commit `f0330514`)

Two owner changes, one commit: they share four files and neither half is green alone.

**R1 — the match run writes down WHICH record it picked.**
Previously the run stored only a status, a note and the resolved vendor, so the screen had to re-run
the matcher one row at a time when a reviewer opened it. Two consequences, both owner-reported: a
matched row could not read as ready in the TABLE, and confirming twenty matched transfers meant
opening twenty dialogs to tick twenty records the matcher had already chosen.

- `services/outflow_import/status.py` — new pure `sole_suggestion(outcome, match) -> Suggestion|None`.
  Takes the **outcome**, not just the match: `derive_row_outcome` short-circuits on a duplicate, a
  failed transfer and an already-Paid record *before* it looks at candidates, so a match result can
  hold perfectly good candidates for a row that was correctly Skipped. It reads the same
  `_settleable_candidates` list `_matched_note` counts — the browser used to re-derive from
  `payment_groups` (all of them) while the note counted `best_payment_group` plus expenses, so a row
  could read "One approved record at this amount" and still refuse to pre-select it.
- `Outflow Import Row` — `suggested_doctype` + `suggested_name`, read-only. **MIGRATE.**
- `review._persist_row_outcome` — writes the pair **and blanks it** on every re-run that no longer
  finds one. The clearing half is the one that breaks silently: payments get ticked Paid by hand all
  day, so a batch matched at 10:00 finds different things at 16:00.
- `outflowTableModel.ts` — `suggestedDecision` / `seedDecisions` / `decisionOrigin`.
  `seedDecisions` never overwrites a decision a reviewer made **or deliberately cleared** (a clear
  leaves an entry with a null link, which is what makes it distinguishable from "never touched"), and
  returns the SAME Map when it adds nothing so refetches do not re-render the table.
- `solePreselection` **deleted** (owner: never guess). The only rows still reaching the picker
  un-ticked are rows the matcher DECLINED, so an auto-tick there was the screen overruling the
  matcher on amount alone.
- `OutflowRowsTable` — the outcome button NAMES the suggested record, so ticking without opening is
  an informed act rather than trust in the software.

**R2 — three ledger cards become one "Link payment" list.**

- `review.search_settleable_records` — `target_doctype` now OPTIONAL; blank = all three ledgers.
  Per-ledger queries split into `_search_one_ledger`, merged, sorted (suggested first, then closest)
  and **capped after the merge**, so the cut keeps the globally closest records rather than a third
  from each. Every record carries its own `target_doctype`.
- **Fixed an ID leaking into a name column:** `Project Expenses.vendor` / `.projects` are Link
  fields, so the raw values were `VEN-0001` / a project id. Two `LEFT JOIN`s now resolve real names,
  and expenses are searchable by vendor and project name (payments already were).
- **`updated_on` added for expenses.** Neither expense doctype has an approval date — no field, no
  approver; only `Project Payments` records one. The modification timestamp travels under its own
  key and the screen labels it "updated" vs "approved" (owner ruling).
- `RowDecision.target` is now OPTIONAL — the ledger arrives WITH the chosen record instead of from a
  card clicked first. `isConfirmable` requires **both** halves.
- **Closed a hole this opened:** a cleared selection leaves no target, and the dialog's Confirm would
  have posted a settle with an undefined doctype. Confirm is now gated on the same `isConfirmable`
  the bulk bar counts with, with a backstop in the page handler.
- "Create a new expense" **HIDDEN behind one `const`**, not deleted — form, `newExpense`, the `new`
  branch of `isConfirmable` and the `create_expense` endpoint are intact.

**Measured finding, worth keeping:** `match_expenses` matches on **amount alone** (description text
only raises the score). A round-number transfer with an approved payment *and* an unrelated approved
expense at the same amount honestly has two candidates and pre-selects nothing. Found because a test
asserting on the ₹5,000 fixture row failed against a live ₹5,000 approved expense. The test now
asserts its precondition so a future collision reports itself as data drift rather than a broken
deriver.

**Tests:** 192 pure · api `test_review` 21 → 38 · `test_status` 41 → 49 · 1627 vitest ·
`tsc` clean across `src/pages/outflow-import` · `vite build` succeeds.

### V5 — cleanup + docs (2026-08-07)

- Deleted `components/ReconciliationReport.tsx`, `review.get_reconciliation_report` and the
  `OutflowReconciliationReport` type — all three verified orphaned first (nothing imported the
  component; the endpoint had only its own two tests).
  ⚠️ **A capability went with it that the three tabs do NOT replace:** the REVERSE VIEW — payments
  recorded as Paid inside the period with no bank row behind them. The tabs answer "is this transfer
  recorded?"; nothing now answers "is every payment we recorded backed by a real transfer?".
  Deliberate scope decision; if wanted back it is a revert, not a rewrite. `test_review` 38 → 36.
- **"Simplify close/reopen to one button" needed no work** — it is already one toggling button
  (`Close import` / `Reopen`). That checkbox predates the v3 rework that collapsed it. The
  `CloseBatchDialog` confirm was deliberately KEPT: closing is the one action whose consequence is
  invisible afterwards, so naming what gets abandoned is its only feedback.
- Wrote `.claude/context/domain/outflow-import.md` with a `## Residence — concept → owner` manifest;
  registered it in `.claude/context/_index.md` and the root `CLAUDE.md` Reference Docs table.

**Still owed:** the live browser walk (the real gate — no DOM test environment exists here), the
production migrate (now **six** doctype JSONs on this branch), and the push. Nothing is pushed.

### T1–T5 — tiered matching + the Link payment table (2026-08-07)

Owner-directed, after the first real import: matching was finding too little and finding it on weak
evidence, and the Link payment dropdown was the wrong shape for comparing records.

**T1 — two amount windows.** `AMOUNT_TOLERANCE` ₹1 → **₹5** (the SETTLE window: SQL pools, write
guard, `suggested` flag, already-paid duplicate check) and a new `TIER1_TOLERANCE` = **₹1** used only
by tier 1. Invariant `TIER1_TOLERANCE ≤ AMOUNT_TOLERANCE` pinned by a test. Owner accepted both
consequences in writing: a payment genuinely ₹4 short now settles silently, and a hand-ticked payment
₹4 off reads `Skipped` rather than `Mismatched`. `test_amounts` 15 → 19.

**T2 — `services/outflow_import/project_match.py`** (new pure module + `candidates.load_project_index`).
Two readings, tried in order: the remark contains a project's WHOLE name (longest **nested** name
wins — `Fujitsu Chennai` over `Fujitsu`; two names that do not contain each other is an ambiguity and
yields nothing), else a keyword unique to one project. Distinctiveness is COUNTED from the project
list, so cities self-tune. ⚠️ Counting alone was not enough and the first real-data run proved it:
`BOQ MEP SITE 3 TABLESPACE` is the only project naming "site", so "site" became an identifier and
"sebi lucknow site" then named two projects — hence one small `GENERIC_PROJECT_TOKENS` list, applied
to the keyword reading ONLY (applying it to the whole-name reading would shrink `New Project at
Chennai` to "chennai"). Measured on the live master: **172/194 (88%) identifiable by their own name;
all 22 that are not are duplicate-named pairs** (two `Fidelity Chennai`, two `SEBI Lucknow`, `ANSR`
beside `ANSR - 2`, `Switch 1`/`Switch 2` — several differ only by a trailing digit, which is dropped
as a bare number, so renaming them in the master is the only fix). 26 new tests.

**T3 — the tier ladder.** `match_by_reference` extracted (tier 0, and now the duplicate guard's own
entry point — it used to rely on "no vendor passed, so the lower passes cannot run", true by
argument rather than construction, and tier 2 needs no vendor at all). `VendorCandidate.ifsc_matches`
added so tier 1 gates on a field, not on prose. **Pass B deleted**; `match_expenses` now REQUIRES the
project (description text still ranks). `load_payments_for_vendors` → `load_payments_by_amount` —
one pool, scoped by amount alone, because a pool narrower than a tier hides matches without a trace.
`match_row` orchestrates the ladder so a tier-1 hit is never topped up with a tier-2 expense.
`status._matched_note` gains a clause naming the tier. `test_matcher` 34 → 47.

**T4 — `components/SettleableRecordTable.tsx`** (new). Radio table, 6 columns from
`outflowTableModel.RECORD_COLUMNS`, fixed 260px scroll with a sticky header, dialog 860 → 960px. The
detail card shrank to a one-line verdict — everything else in it is now a column. `outflowTableModel`
gained `SettleableRecord`, `recordKey`/`parseRecordKey`, `recordDateLabel`, `ledgerLabel`.
vitest 1642 → 1652.

**T5 — docs.** Domain doc: matching rules, residence manifest (two windows + `project_match.py`),
the now-REVERSED `match_expenses` warning, the screen section, the test notes.

**Tests:** 245 pure · api `test_review` 36 → 40 (incl. `TestTheTierLadderEndToEnd`, which drives
tiers 1 and 2 through the real endpoint because every other fixture payment carries its row's own
UTR and so only ever exercised tier 0) · `test_expenses` 21 · `test_settle_payment` 14 ·
`test_upload` 25 · `test_close` 13 · 1652 vitest · `tsc` clean across `src/pages/outflow-import` ·
`yarn build` succeeds.

⚠️ **No doctype changes and no migrate in T1–T5.**

⚠️ **STILL OWED, AND IT IS THE REAL GATE: the live browser walk, plus a measurement of tier 2 on a
real statement.** The dev DB carries **0 outflow import rows and 5 Approved payments**, so neither
the table nor the tiers have been seen against real data; T3 is verified against fixtures only. One
real statement's remarks column is what would tell us how often a remark actually names a project.

---

## §P1 — the period-scoped summary (BUILT 2026-08-12)

**Owner request:** *"Currently the summary section shows the summary of an import. Change it to the
overall summary of all the imports in the system, with a period selector that changes the summary as
well as the tabs having all the transactions"* — plus *"the date filter for the `added_on` column
should be the date filter we provide for other screens."*

### The ruling it reverses, stated plainly

The domain doc recorded, as the design and dated 2026-08-10: *"the summary panel above summarises ONE
import while the table spans all of them. That is the design: 'how did that statement go?' and 'what
do I still owe a decision on?' are different questions."* **The owner took the other side on
2026-08-12.** It is recorded as a reversal rather than quietly overwritten, because the next reader
is entitled to see that both positions were held deliberately.

**The 2026-08-10 ruling had two halves and only one is reversed.**
- The POPULATION-MISMATCH half — *"a panel describing ONE import silently rewrote the filters of a
  table spanning ALL of them"* — **dissolves**: there is one population now, so the objection has
  nothing to attach to. The reasoning arguably endorses the new shape.
- The MOVED-THE-TAB half **stands and is kept**: reading a figure must never navigate away from the
  work in progress. `SummaryTile.statuses` and `tabForStatus` stay deleted, the status figures still
  REPORT, and changing the period does not change the tab.

### The seam that made it cheap

`status.derive_import_summary` folds a stream of `StatusTally` and **has never known what a batch
is**, so widening it to a period was a WHERE-clause change and nothing else — no deriver change, no
tile change, no change to how a number is rendered. Everything else followed from routing every read
through the one `_row_filters` builder that already existed.

### Decisions

| Decision | Why |
|---|---|
| The period filters **`row.added_on`** (when the money moved) | The only one of the schema's THREE "periods" the transaction table can filter on. A batch's declared `period_from`/`period_to` is not a fact about where its rows fall, and `overlaps_batch` exists precisely because declared periods overlap. |
| The summary honours **every table filter except the scope** | Not just the period — search, funnels, amount too. `tab_counts` already works this way. Anything less lets the panel and the tabs disagree the moment somebody types in the search box, which is the defect the reversed ruling was protecting against. |
| **ONE date value, TWO editors** | The `Period` control and the `Payment Date` column funnel read/write the same store entry. Two filters over one column would AND: "Last 30 days" + "Is 01-Jan" selects nothing and neither control looks wrong. |
| The period lives in a **store**, not page state | Four surfaces need it, and one of them — the Skipped dialog's own `useOutflowRows` instance — is not a child of the page. |
| Presets are the app's **`timespanOptions`**, NOT the reports' `datePresets` | ⚠️ MEASURED CONFLICT: the two vocabularies define the SAME WORDS differently. `datePresets`' "Last 30 days" is `today-29 → today`; the timespan is `today-30 → today`. Its "This month" runs to the END of the month; the timespan runs to TODAY. With one value and two editors, mapping between them would move the window every time it passed between the controls. |
| A preset is stored as the **word**, resolved live | A relative window frozen into two dates at click time is a bookmark that means something different tomorrow — the same trap `datePresets` documents. Only the fixed FYs and a hand-picked range are stored as dates. |
| `_MAX_CONFIRMABLE` **refuses**, never truncates | A `LIMIT` shows a list shorter than the button that opened it, over a set nobody chose, with the missing rows sharing no property the screen can name. |
| Matching stays **per batch**, looped | `match_batch`'s four global passes reason over a whole import at once; a partial picture breaks claims and stacks. The overspill is stated in the UI instead. |

### What was found by building it

⚠️ **A TRANSFER WITH AN UNPARSEABLE DATE WOULD HAVE BECOME INVISIBLE.** The bank's date column is
free text; the parser stores NULL rather than guessing, and `cashfree_sample.csv` carries a literal
`not-a-date` row for the case. Under a plain `>=` / `<` bound it matches **no** period — so once the
period became the screen's SCOPE it would have vanished from the summary, all three tabs and the
Skipped dialog at once, **with no filter on screen able to bring it back**. `_row_filters`' two date
clauses now carry `OR r.added_on IS NULL`. Found by a test (`9 != 10`), not by the screen, and
pinned by `test_an_undated_transfer_is_visible_in_EVERY_period`.

⚠️ **`added_on` HAD SHIPPED AS A FACET FILTER** — a tick box per distinct calendar day, growing
without limit, unable to express "everything after the 14th". Removed from `SERVER_FACET_COLUMNS`
and from the server's `_FACET_COLUMNS`; caught by a test written for the new behaviour.

### Files

**Backend** (`api/outflow_import/review.py`): NEW `get_outflow_summary` (+ `_imports_in_scope`),
NEW `match_period`, NEW `_assert_confirmable_size` / `_MAX_CONFIRMABLE`; `get_confirmable_rows`
widened batch→filters; `get_import_summary` becomes a thin wrapper (the regression pin);
`_row_filters` date clauses widened for NULL; `added_on` dropped from `_FACET_COLUMNS`.

**Frontend**: NEW `components/data-table/dateFilterModel.ts` (pure) +
`date-filter-popover.tsx` (controlled popover, with `data-table-date-filter.tsx` now a thin TanStack
binding over it — every other screen untouched); NEW `utils/dateFilterRange.ts`; NEW
`outflow-import/outflowPeriod.ts`, `useOutflowPeriodStore.ts`,
`components/OutflowPeriodFilter.tsx`; `ImportSummaryPanel` rebuilt around the period;
`outflowTableModel` gains the `date` filter kind, `PERIOD_COLUMN_ID`, `isDateFilterValue`,
`importsCoveredLabel`, `rematchWarning`; `useOutflowRows` routes `added_on` to the store and exposes
`filterQuery`; `OutflowRowsTable` renders the app-standard date popover for the date column;
`SkippedRowsDialog` and `ConfirmAllMatchedDialog` rescoped batch→period.

### The import selector (owner follow-up, same day)

The period-only screen lost the ability to ask "how did *that* statement go" — the question the
reversed 2026-08-10 ruling was built around. The owner asked for the selector back, **demoted**: a
top-level `Import` control, **empty by default meaning every import**, which switches the whole
screen to one statement's summary when set. System-wide by default, per-statement on demand.

| Decision | Why |
|---|---|
| Selecting an import **IGNORES** the period | Owner ruling. "That sheet's summary" is the WHOLE statement, not a slice of it. `useOutflowRows` withholds the period when a batch is pinned — the same rule that fixed the deep link, so there is one rule rather than two. |
| The period control is **disabled, not hidden** | A vanishing control cannot distinguish "no period applies" from "a period applies and you cannot see it". The second is a defect this screen actually shipped. It also stops NAMING a window while greyed (`Not applied`), because a greyed "Last 30 days" reads as applied-but-locked. |
| The **route param IS the selection** | No second copy in page state, so the URL and the control can never contradict each other. `/bulk-import-outflow/:id` stops being a mode you cannot leave and becomes just "the selector has chosen this". |
| Remount on switch is **fine** | Two route entries, so switching remounts — correct, because a different import is a different set of rows and the ticked selection / un-confirmed decisions belong to the rows they were made on. The period survives in the store. |
| `import` metadata moved INTO `get_outflow_summary` | Filled only when a batch is selected (absent across a period — no single filename or uploader to name). This let `get_import_summary` become a **pure delegate**, so there is no second query that could answer the same question differently. |

### What the browser walk found

The walk was the real gate, and it earned its place — **three defects, none visible to a green suite**:

1. ⚠️ **THE DEEP LINK WAS SILENTLY FILTERED.** `/bulk-import-outflow/OFI-26-00289` reported **274
   transfers out of 1,043**: a period left in the store by an earlier visit was still applied while
   the control was hidden. Every number wrong, everything looking right, nothing on screen able to
   reveal or clear it. This is what produced the disabled-not-hidden rule above.
2. **`"1 of them extend past this period"`** — broken grammar on the one sentence whose job is to
   warn that a button reaches further than it looks, and "1 of them" is clumsy for a set of one.
   Subject and verb are now chosen separately.
3. **The selector's label rendered raw ISO** (`2026-05-02 → 2026-08-06`) directly above a metadata
   line already showing `02-May-2026` — two date conventions on one panel. `importOptionLabel` now
   uses the app-wide `dd-MMM-yyyy`; `dateOnly` stays ISO because it also feeds the Payment Date
   column's SORT value, where a `dd-MMM-yyyy` string would order by day-of-month.

All three are pinned by tests written after the fact.

### Verified live

Period drives summary + tabs together with every figure reconciling at each setting (All 274 /
Not-Matched 36 / 238 settled against the chips; All 516 / 95 / 421 at Last Quarter; All 996 / 152 /
844 at All time, where All = total − skipped and the Skipped chip = skipped + failed). The tab never
moves. Presets persist as WORDS (`?ofl_period_op=Timespan&ofl_period_from=last+quarter`); All time
persists as an explicit `none`. The column funnel opens the app-standard date filter already showing
the Period's value, and clearing there moved the Period control — the one-value-two-editors design.
Import selector round-trips to `/OFI-26-00289` and back, restoring the period from the store. Skipped
chip 47 → dialog 47 (20 already paid / 27 bank refused). Console clean (its one error also fires on
`/rate-master`).

### Gates run

- `tsc --noEmit`: **no errors in any touched file** (the repo carries ~3,200 pre-existing elsewhere).
- vitest: **309 pass** (was 226) — 7 files, incl. new `dateFilterRange.test.ts` (16) and
  `outflowPeriod.test.ts` (18).
- pure services: **409 pass**, untouched.
- `test_review`: **137 pass** (was 121). `test_upload` 25, `test_expenses` 31,
  `test_settle_payment` 24, `test_approved` 16 — all green.
- `yarn build`: succeeds.
- ✅ **The live browser walk is DONE** (see above) and found three defects the suite could not —
  there is no DOM test environment in this repository, so the panel, the two-editor date value and
  the tab wiring are structurally untestable here.

---

## §H — v4: exact amounts + the unified screen (PLANNED 2026-08-09, no code written)

Two owner requests that arrived together and are independent in the code:

> **1.** When the bank amount differs from the record's amount, write the BANK amount onto the record.
> **2.** The sheet stops being a place you navigate to. One master table of every transaction, an
> import DIALOG that adds to it, a summary of any chosen import above it, and a bulk
> confirm-all-matched action inside that summary.

### §H.0 — The four owner rulings that scope this arc (2026-08-09)

| # | Question | Ruling |
|---|---|---|
| 1 | Bank paid MORE than approved (up to Rs 5 over) | **Overwrite both ways.** The bank amount always wins. Accepted: the import can now record spending slightly ABOVE an approval, and only the Version log says so. |
| 2 | Which ledgers | **All three.** Which forces the expense write path off `set_value` — see §H.1, it is the biggest single risk in this arc. |
| 3 | "import, skipping and confirmation in that dialog" | **Import dialog + per-row dialogs.** The import dialog runs upload → preview → confirm → match, then closes. Skip/confirm on ONE row keep their own dialog, opened from the master table. |
| 4 | Master table default | **Open work first, paged.** Default scope = rows still owed a decision. Settled and Skipped are tabs. Server-side paging and filtering throughout. |

⚠️ **A FIFTH RULING IS STILL OPEN and it is a naming one, raised but not answered: the owner asked
for "approve all the matched transactions".** This feature's entire safety story is that it **never
approves anything** — it records that already-approved money left the bank. A button labelled
*Approve* inside it tells an accountant they are approving payments, which is false. §H.5 is written
as **"Confirm all matched"** throughout. If the owner overrules this, the label changes in exactly
one place and nothing else in the slice moves.

---

### §H.1 — Slice X1: write the exact bank amount

**Goal.** At settle time, if the record's amount differs from the bank's, the record takes the
bank's. All three ledgers, both directions. The `+-Rs 5` settle window is unchanged and still runs
FIRST — the rewrite never widens what may be settled, it only corrects what is written.

**This REVERSES a recorded ruling.** The domain doc's "Known limits" says, in the owner's own
accepted words: *"The paise difference is not recorded. Settling an Rs 18,678.69 payment from an
Rs 18,679.00 transfer leaves the payment at Rs 18,678.69. Accepted explicitly."* That entry gets
rewritten as a reversal, not silently deleted — the next reader must be able to see that both
positions were held deliberately.

**⚠️ This is a NEW KIND OF WRITE and the spine has to be restated precisely.** Until now the import
wrote `status`, `utr`, `payment_date`, `payment_by` — never money. It now edits a financial figure a
human approved. The spine still holds and must be re-stated in these words: *the import never
approves and never creates a record; it now also corrects the settled amount to what the bank
actually moved.* Anything in the codebase that reads "this import does not touch amounts" is history
from this slice on.

#### The decision itself

One new PURE function in `amounts.py`, joining the residence manifest:

```
rewrite_amount(record_amount, bank_amount) -> Decimal | None
    the bank amount when the two differ, else None
```

It lives there because `amounts.py` owns "when two amounts count as the same money" and already owns
`to_decimal`, so the Decimal/float/numeric-string coercion has exactly one home.

⚠️ **It does NOT read either window, and the manifest note must say so.** The manifest currently
pins the two windows to FIVE call sites. `rewrite_amount` is a sixth call into the module but not a
sixth window use — by the time it runs, `amounts_match` has already proven the pair is inside the
settle window. Do not let a later reader "tidy" it into taking a tolerance.

#### Payments — `settle.settle_payment`

Straightforward, because the plumbing already exists:

- `_lock_and_assert_payment_settleable` already returns the locked record's amount, already proven
  inside the window. Feed it and the bank amount to `rewrite_amount`; assign `doc.amount` when it
  returns a value.
- **The audit is FREE and is the reason this is safe.** `Project Payments` carries
  `track_changes: 1` and this path already writes through `doc.save()`, so every amount change lands
  in the Version log with the user and the timestamp, with no new field and no new code.
- **`amount_paid` on the parent PO recomputes itself correctly.** The `update_parent_amount_paid`
  hook SUMS the paid payments rather than incrementing, so it picks up the new figure — and under
  `from_outflow_import` it recomputes inside our transaction and skips only its commit. Pin it with
  a test rather than trusting the reading.
- Vendor-credit recalculation is deliberately NOT suppressed on this path and will see the new
  amount. That is correct and wanted.
- **`tds` is still never written.** Unchanged, and the reason is unchanged: this import does not
  know the deduction.

`SettleResult` gains `original_amount` and reports `amount` as the value **written**, not the value
found. Today it returns the pre-settle amount, which after this slice would be a quietly wrong
number on the one screen that needs it most (§H.5 shows the delta per row before you confirm).

#### Expenses — `settle.settle_existing_expense` — ⚠️ THE RISK IN THIS ARC

Ruling 2 says all three ledgers. That single word forces a change nobody asked for directly:

**Today the expense settle writes with `frappe.db.set_value`, which skips the document lifecycle
entirely.** No `validate`, no `on_update`, **no Version**. So an amount rewritten through that call
would be an unaudited edit to a financial figure — precisely the thing the payment path gets for
free. The write must move to `frappe.get_doc(...)` + `doc.save(ignore_permissions=True)`.

Moving it fires hooks that have never fired here before, and that cuts both ways.

**Finding 1 — it FIXES a silent bug that predates this arc.** `hooks.py` wires
`project_cashflow_hold_update.on_project_expense` to `Project Expenses` `on_update`, and that hook
recomputes the project's CEO-Hold cashflow gap whenever a row enters or leaves `Paid`. Because the
import settles with `set_value`, **that hook has never run when this feature settles an expense** —
so settling a project expense through the import has never moved the CEO-Hold gap. `api/…/expenses.py`
carries a long docstring explaining that the CEO-Hold hook is *"deliberately NOT suppressed"*; that
reasoning is sound for `create_expense`, which genuinely inserts a document, and has simply never
applied to the settle path beside it. Switching to `doc.save()` makes the stated intent true for the
first time. **Record it as a bug fix, not as a side effect.**

**Finding 2 — it BREAKS the per-row savepoint isolation, exactly as the payment path once did.**
That same cashflow module calls `frappe.db.commit()` (two sites: before its realtime publish, and
once more in its own path). **A commit inside the savepoint makes the rollback a silent no-op** —
"Confirm 8" could then leave four rows written and four not, with nothing recording which. This is
the identical failure `update_parent_amount_paid` and the notification cascade were suppressed for.

**The fix, and why it is shaped differently from the existing two.** The existing suppressions read
`doc.flags.from_outflow_import` at the hook site, which works because the hook has the doc. Here the
commits sit in INNER helpers that never see it. So this slice sets a REQUEST-level
`frappe.flags.outflow_import_settling` around the save in `settle.py` and guards those commits on it.

Three things about that flag are load-bearing and must be written into the code, not just here:
1. **It is set and cleared in a `try/finally`.** A request-level flag that leaks would suppress a
   commit for unrelated later work in the same request.
2. **It suppresses the COMMIT, never the RECOMPUTE.** The CEO-Hold gap still recalculates, inside our
   transaction, and lands when the endpoint commits. Same shape as `update_parent_amount_paid`, and
   the same test: not *"is this side effect wanted"* but ***"does it commit"***.
3. **The realtime publish is suppressed with it,** because publishing before our commit announces
   state that is not yet durable. Accepted cost: a settle no longer pushes a live CEO-Hold update to
   other browsers; the state is correct on their next read. Named here so it is a decision, not a
   regression somebody finds later.

`Non Project Expenses` has no such hook (only `on_trash`) and is clean.

**Two smaller checks already done, recorded so nobody re-does them:** both expense doctypes'
`validate` short-circuits on `not self.is_new()`, so the AUTO_APPROVE_LIMIT branch cannot re-flip a
status on a settle-time save. And `Project Expenses.amount` is a **Data** column of numeric strings
while `Non Project Expenses.amount` is real **Currency**, so the write goes through the existing
`format_amount_for` rather than assuming a shape.

**⚠️ The fallback, if the hook work proves worse than it looks.** Narrow ruling 2 back to payments
only and leave the expense path on `set_value`. That is a ruling change, not a silent retreat — it
must go back to the owner, because the reason for all-three was audit parity.

#### What must NOT change in X1

- The `+-Rs 5` guard runs first and still REFUSES anything outside it. A TDS payment is still
  unsettleable here.
- The reference is still only ever written into a blank, never compared.
- The already-Paid duplicate check and the `Mismatched` branch are untouched — they compare the bank
  against a record that is ALREADY Paid, where there is nothing to rewrite.

#### Tests

- **pure** (`test_amounts`): `rewrite_amount` — equal pair yields `None`; bank higher yields the bank
  amount; bank lower yields the bank amount; Decimal / float / numeric-string inputs all coerce.
- **api `test_settle_payment`**: a 31-paise gap rewrites `amount`; a Version row exists carrying the
  change; the parent PO's `amount_paid` equals the new sum; an exactly-equal pair leaves the amount
  alone.
- **api `test_expenses`**: the same on both expense doctypes; `Project Expenses.amount` comes back in
  its Data shape; the CEO-Hold recompute RAN; **and the savepoint-isolation test still passes with
  the expense path now going through `doc.save()`** — that one is the real gate on this slice.
- ⚠️ **The standing fixture warning applies:** a fixture pinning a REFUSAL by amount must sit clearly
  OUTSIDE the Rs 5 window, never one step past its edge. That has silently inverted a refusal test
  into an acceptance test twice already.

**Migrate: none.**

#### AS BUILT (2026-08-09)

Landed as planned, with three findings worth carrying forward.

- `amounts.rewrite_amount(record, bank) -> Decimal | None` — `None` on an equal pair, so an ordinary
  settlement writes nothing and mints no Version claiming a change. No tolerance parameter, pinned
  by a signature test.
- `settle_payment` and `settle_existing_expense` both apply it through `format_amount_for`, so the
  `Project Expenses` Data column keeps its bare-numeric-string shape on a rewrite as on a create.
- `SettleResult` gained `original_amount` + an `amount_changed` property; `amount` now means WHAT WAS
  WRITTEN. `_summary` surfaces all three to the client, and `_settled_note` names the correction on
  the import row ("Amount corrected from X to Y to match the transfer") — silent when nothing changed.
- **FINDING 1 — the commit is narrower than feared.** `sync_cashflow_reason` genuinely never commits;
  the only commit reachable from `trigger_check` is inside `_notify_manual_hold_releasable`. So the
  suppression is ONE line added to that function's existing `in_patch / in_migrate / in_install /
  in_import` bail list, not new machinery. The recompute is untouched.
- **FINDING 2 — the payment path was already exposed.** That hook is wired to `Project Payments`
  `on_update` too, so V2's savepoint isolation had a hole in it from the day it shipped, reachable
  whenever a settle brought a manually-held project back within its limit. X1 closes it for both
  ledgers.
- **FINDING 3 — the pre-existing isolation test could not have caught it.** It provokes a refusal in
  the amount GUARD, which throws BEFORE anything is saved, so it can never observe a commit that
  happens DURING a save. `test_a_failure_AFTER_the_expense_save_rolls_the_expense_back` patches
  `_record_settlement` to raise after the save; that is the arrangement that actually pins it.

**Tests:** pure `test_amounts` 19 → 26 (243 pure tests run clean on the host via a package stub —
`test_ledgers` alone needs a bench, since `candidates.py` imports `frappe`). api
`test_settle_payment` +7, `test_expenses` +8. ⚠️ **The api suites were NOT run — Docker is down on
this host, so the bench runner is unreachable. They are written, not verified.** Both suites also
gained Version-row cleanup in teardown, since X1 makes every settle mint one on a live database.

---

### §H.2 — Slice X2: the import summary

**Goal.** One endpoint returning everything the summary section renders for a chosen import.

**Where the numbers are derived.** A new pure `derive_import_summary(rows)` in `status.py`, taking
`(status, amount)` pairs. That keeps the residence rule intact — `status.py` is the ONLY place a
status or a count over statuses is derived, and a summary that disagreed with the tabs beneath it
would be worse than no summary.

**Where they are COUNTED.** One SQL `GROUP BY row_status` with `COUNT(*)` and `SUM(amount)` on
`Outflow Import Row`, in the new `review.get_import_summary(batch)`. Aggregates belong in the
database (ADR-0010) — never a `get_all` and a Python loop.

**What it returns.**

| Group | Fields |
|---|---|
| Identity | batch name, source file, statement period from–to, uploaded on, uploaded by, batch status, `closed_at` |
| Totals | total rows, **total transaction value** |
| Per status | count **and value** for each of the seven statuses |
| Derived | settled value · skipped value · **open value** (total − settled − skipped) · decided percentage |
| Bulk | count + value of `Matched` rows **carrying a suggestion** (what §H.5 can confirm), and count of `Matched` rows **without** one |
| Provenance | rows skipped as already-imported duplicates |

**⚠️ On "matched and mismatched", which is what the owner asked for.** `Mismatched` is a RARE status
in this design — it fires only when a payment somebody already ticked Paid by hand disagrees on
amount beyond the window. On a real statement it is usually 0 or 1. The split that carries the work
is **Matched vs Unmatched**. Both are returned; the section leads with Matched / Unmatched / Settled
/ Skipped and shows Mismatched and Error beside them, so a non-zero one is still impossible to miss.

**Every count is a link.** Clicking one filters the master table below to exactly those rows. That is
what turns the summary from a report into a worklist, and it costs nothing beyond wiring the
existing filter.

**The import picker** reads `Outflow Import Batch` through the existing generic list hook — no new
endpoint. Entries are labelled `file · period · uploaded date`, never the batch id, which means
nothing to an accountant. Defaults to the newest.

**Deliberately DEFERRED: the match-tier breakdown** (how many rows matched by reference, by vendor
account, by project-in-remark). It would be the best available evidence for whether tier 2 earns its
keep — and the tier is currently used to compose the note and then **thrown away**, never stored. So
it needs a new field on `Outflow Import Row` and therefore a migrate, on a branch that already owes
six. Parked with the cost named; it is a one-field slice whenever the owner wants it.

#### Tests
- **pure** (`test_status`): empty batch; all-settled; mixed; value sums; open value never negative.
- **api** (`test_review`): assert PARTITIONS and invariants, never exact live counts — these suites
  see the live ledger and a pinned number becomes a false failure when real data drifts.

**Migrate: none.**

#### AS BUILT (2026-08-09) — BACKEND ONLY

⚠️ **The summary SECTION (the UI) moved into X3.** It has no page to live on until the master screen
exists, and building it against the retiring batch page would have meant writing it twice. X2 as
shipped is the endpoint and the deriver.

- `status.StatusTally` + `status.derive_import_summary(tallies) -> dict`. Input is **already
  aggregated by the database** — one tally per `row_status` — which is what keeps the count-and-sum
  in SQL (ADR-0010) while the assembly stays pure and unit-testable.
- `review.get_import_summary(batch)` runs ONE `GROUP BY row_status` carrying `COUNT`, `SUM(amount)`,
  and two `CASE` sums for the suggestion subset. Returns `{batch, import, totals, auto_skipped_rows,
  manually_skipped_rows}`.
- **`suggested_value` is its own SUM, not a share of the group's total.** Three matched rows of ₹10,
  ₹10 and ₹90,000 where only the last is confirmable are not "one third of the value" — apportioning
  would invent a number. Costs one more `CASE` in a query that was already grouping.
- **`open_value` is summed from the open statuses, never subtracted from the total.** Identical
  arithmetic today; subtraction goes negative the day a status falls outside both sets (a retired v2
  value on an old row), and an unknown status is carried into the totals rather than dropped.
- **The auto/manual skip split keys on `decided_by`, not on the reason text.** An upload-time skip
  has a system reason and no decider; a manual one records the person. No sentence is parsed — the
  same rule `_related_paid_payments` follows.
- `_jsonable_summary` converts Decimal → float at the boundary only, so the deriver keeps reasoning
  in the type money actually needs. Pinned by a test, because a Decimal reaching the response
  serialises as a STRING and every arithmetic on the screen would silently concatenate.
- **Deferred, with the cost named:** a duplicate-rows count. The only signal is the skip sentence,
  and this feature has a standing rule against parsing those. The auto/manual split carries more
  information for the same query.

**Tests:** pure `test_status` +11 (254 pure tests run clean on the host). api `test_review` +8,
asserting PARTITIONS and cross-checks against `get_batch_rows` rather than live counts. ⚠️ **The api
suite was NOT run — Docker is still down.**

---

### §H.3 — Slice X3: the master table

**Goal.** `/bulk-import-outflow` becomes one table of every staged transaction, across every import.
The batch stops being a destination and becomes an ATTRIBUTE — a column and a filter.

**The `Outflow Import Batch` doctype survives untouched.** It still holds provenance, the statement
period, the counters and `closed_at`, and it is still what the cross-batch duplicate guard reads at
upload. Only the navigation changes. Nothing about matching, settling or duplicate detection moves.

**⚠️ THE SIZE PROBLEM IS THE WHOLE SLICE.** The batch screen loads an entire batch in one call and
filters, sorts and searches it IN THE BROWSER. Correct for 26 rows; wrong for every row ever staged.
Weekly statements reach thousands within a couple of years, and `get_batch_rows` also runs a
paid-payments lookup on every fetch.

So: a new `review.get_outflow_rows(filters, sort, limit, offset) -> {rows, total}`.

- Filters: status set, batch, date range, amount range, and text across beneficiary / remarks /
  reference. **AND across columns, OR within a column** — the same composition the current client
  filters use and the same one the rest of this app uses.
- Default scope (ruling 4): the OPEN statuses. Settled and Skipped are tabs, not the landing view.
- `_related_paid_payments` runs for the PAGE's references instead of the batch's — same query, less
  of it.

**⚠️ Filtering moves to SQL, and the client copies must be DELETED, not left beside it.** `visibleRows`
/ `passesFilters` / `matchesQuery` in `outflowTableModel.ts` become a second filter engine the moment
the server has one, and two engines that answer "which rows match" will disagree the day somebody
edits one. Residence rule F1/F3: one home. This costs real vitest coverage, which the slice replaces
with endpoint tests — **the count going DOWN is expected here and is not a regression.**

**What stays in `outflowTableModel.ts`:** decisions, tabs, the column model, `isConfirmable`,
seeding, the record shapes. Those are the parts that are not about querying.

**Decisions still live in the browser until confirmed**, keyed by row name, so they survive paging.
But the bulk bar's wording has to get honest: it counts decided rows **among the rows loaded**, not
across pages it has never seen. §H.5 is the answer for acting on a whole import at once, and it is
driven from the server precisely because client decisions cannot span unloaded pages.

**New column: Import** (file + date), because rows now arrive from many sheets and "which statement
was this?" becomes a real question for the first time.

**Routes.** `/bulk-import-outflow` = the master. **`/bulk-import-outflow/:id` is KEPT** and renders
the master pre-filtered to that batch, so every existing deep link and bookmark still resolves.
`/bulk-import-outflow/new` is removed — the dialog replaces it.

**⚠️ Likely the only MIGRATE in this arc.** The row doctype will now be queried by `row_status`,
`import_batch` and `added_on` across the whole table rather than by parent batch. That wants a
composite index declared in the controller's `on_doctype_update` — and a plain migrate does NOT fire
that hook for a controller-only change, so an already-deployed database needs a patch module that
CALLS the hook (the `add_boq_read_indexes` precedent). Decide the index from the final query shape,
not before.

#### Tests
- **api**: paging, total count, default scope, filters composing, deep-link scoping to one batch.
- ⚠️ **The table itself is a React semantic and this repo has NO DOM test environment. The honest
  gate is a live browser walk.**

---

### §H.4 — Slice X4: the import dialog

**Goal.** `NewOutflowImportPage.tsx` becomes `ImportStatementDialog.tsx`, opened from the master
screen. Same two steps inside: choose file → preview → confirm.

- Every upload rule is unchanged and stays SERVER-side: parse-before-`save_file`, the
  period-narrowed duplicate lookup, refuse at 100% duplicates, warn at 90%.
- **The dialog runs the match itself after staging** and closes only when it is done, refreshing the
  master table and the summary. Today "Run match" is a separate button on a screen the user has to
  find first; there is no case where an accountant uploads a statement and does NOT want it matched.
  A manual **Re-run match** stays available on the summary, because re-running IS a normal act — the
  ledger changes under a batch all day.
- `OutflowImportBatchPage.tsx` is retired; its decision wiring moves to the master page.
- `CloseBatchDialog` moves into the summary section and acts on the SELECTED import. Its confirm
  step stays — closing is the one action whose consequence is invisible afterwards.
- The per-row `DecisionDialog` and `SettleableRecordTable` are **unchanged** (ruling 3). They open
  from the master table instead of from the batch page. Everything the T4 radio table earned carries
  over untouched.

#### Tests
No pure logic changes. **Browser walk is the gate.**

---

### §H.5 — Slice X5: confirm all matched

**Goal.** One button in the summary opens a dialog listing every row the matcher was SURE about,
with the record each will settle, and confirms them together.

**⚠️ "Matched" is not the same as "confirmable", and conflating them is the trap in this slice.** A
row is `Matched` when the matcher found **one OR MORE** approved records. When it found two it
deliberately stores NO suggestion — the screen never guesses between two real records. So the dialog
shows two lists:

- **Ready (N).** `Matched` **and** carrying a stored `suggested_doctype`/`suggested_name`. Ticked by
  default, confirmable.
- **Needs you (M).** `Matched` with no suggestion. Listed read-only with a link that opens the
  per-row dialog. **Never auto-confirmable** — there is nothing to confirm them against.

**Each ready row shows the bank line beside the record it will settle**, and — because of §H.1 —
**the amount delta.** Confirming 40 rows will now silently rewrite up to 40 approved figures, so
`Rs 18,678.69 -> Rs 18,679.00` has to be legible BEFORE the click, not discoverable after it. Rows
with a delta get a marker so a scan finds them.

**Execution keeps the per-row isolation exactly as it is: one call per row.** The existing endpoint's
docstring forbids all-or-nothing in these words — *"one unsettleable row would then discard seven
good decisions"* — and that reasoning gets stronger, not weaker, at forty rows. The client loops with
a progress bar and a cancel.

⚠️ A server-side bulk endpoint is the obvious optimisation and is **deliberately not in this slice**.
It is only safe if it reproduces per-row savepoints, per-row commits and a per-row result list, and
the version of it that is easy to write is one transaction — which is the exact thing that must not
ship. Revisit only if round-trip count proves to be a real problem in a real browser.

**A results panel closes the action:** *N settled, M failed*, each failure carrying its real reason
(already Paid by someone else, status changed, amount drifted outside the window). **Failures here
are NORMAL, not exceptional** — payments get ticked by hand all day, and the per-row locks are what
make a stale confirm fail safely instead of writing the wrong thing.

**Staleness is surfaced, not forced.** The button shows *"matched 4 hours ago"* and offers Re-run
match beside it. Forcing a re-match before every bulk confirm would be theatre: the locks already
make the stale case safe.

#### Tests
- **api**: `get_confirmable_rows` excludes ambiguous `Matched` rows, excludes settled/skipped, and
  carries the delta.
- **pure**: any selection/summary helper added to `outflowTableModel.ts`.
- ⚠️ **Browser walk for the dialog.**

---

### §H.3–H.5 — AS BUILT (2026-08-10): the master screen, the dialog, Confirm all

⚠️ **X3, X4 AND X5 LANDED AS ONE CHANGE, and they are not separable.** The moment the read moved to
`get_outflow_rows`, the batch page was reading helpers that no longer existed — X3 without X4 leaves
the tree broken, and the summary panel X2 deferred had no page to live on until both were done.
X5's dialog is the only thing that makes the summary's headline button real.

**Backend**
- `review.get_outflow_rows(scope, batch, search, date_from/to, amount_min/max, facets, sort_by,
  sort_dir, limit, offset)` → `{rows, total, limit, offset, scope, tab_counts}`. One shared
  `_row_filters` builder feeds the page query, its count, the tab counts AND the facet values.
- `review.get_outflow_facet_values(column, …)` — **the funnels survived server paging.** The easy
  path was to ship search + date + amount and drop the per-column funnels; that would have been a
  silent capability cut. Distinct values now come from the DB over the whole filtered table.
  ⚠️ It deliberately does NOT apply the column's own selection.
- `review.get_confirmable_rows(batch)` → `{ready, needs_you, ready_value}`, each ready row carrying
  its target's vendor/project/status and its **amount delta**.
- `review.list_imports(limit)` for the picker.
- **Two allow-lists are injection guards, not tidiness:** `_SORTABLE_COLUMNS` and `_FACET_COLUMNS`
  are interpolated (a sort key and a column name cannot be bound parameters). Everything else binds.
- **MIGRATE:** a third index on `Outflow Import Row` — `(row_status, added_on)`, equality column
  first, ordering second. The existing `(import_batch, row_status)` cannot serve a master query
  whose leading column is unconstrained. Controller-only change ⇒ deployed DBs need
  `patches/v3_0/add_outflow_master_index.py`, which CALLS the hook. **The `patches.txt` line is the
  maintainer's to add.**

**Frontend**
- `OutflowMasterPage.tsx` replaces `OutflowImportBatchPage` + `OutflowImportListPage` (both
  DELETED, along with `NewOutflowImportPage` and the now-orphaned `config/` DataTable wiring).
- `ImportSummaryPanel` (picker + money figures + clickable status chips + Confirm-all),
  `ImportStatementDialog` (upload → preview → confirm → **match**), `ConfirmAllMatchedDialog`.
- **The client filter engine was DELETED, not bypassed** — `matchesQuery`, `passesFilters`,
  `visibleRows`, `facetValues`, plus `rowsForTab`/`tabCounts`. `serverQuery` replaces them and owns
  the MEANING of a filter; SQL owns the application. **The vitest count going DOWN is the correct
  outcome and is not a regression.**
- Routes: `index` and `:id` both render the master page; `:id` is kept so every pre-X3 link
  resolves, pre-scoped. `/new` is gone.

**Owner ruling honoured throughout: the word is CONFIRM, never APPROVE.**

⚠️ **VERIFICATION STATE — READ BEFORE TRUSTING ANY OF THIS.**
- ✅ `tsc --noEmit` clean across `src/pages/outflow-import`, the types and `routesConfig`.
- ✅ 254 pure Python tests green on the host (via the package stub; `test_ledgers` alone needs a
  bench because `candidates.py` imports `frappe`).
- ❌ **vitest and `vite build` CANNOT RUN ON THIS HOST** — `node_modules` is the container's
  linux-arm64 build and the native rollup/rolldown bindings are missing. The model tests are
  type-checked but **not executed**.
- ❌ **The api suites were NOT run** — Docker is down, so the bench runner is unreachable.
  `test_review` gained ~20 tests across three new classes; they are written, not verified.
- ❌ **No browser walk.** Three of these five slices are React semantics end to end.

### §H.8 — The first real statement, and what it found (2026-08-10)

A 1,043-row Cashfree statement (₹3.45 cr, 02-May → 06-Aug) against a scenario where every ledger
record from 01-May was set to `Approved` with **UTRs cleared**, so tier 0 was impossible and tiers 1
and 2 had to do all the work. That measurement was owed since T3.

**Result: 863 of 1,016 successful transfers matched (85%) on tiers 1+2 alone. 734 settled,
₹2,10,95,243.** 47 auto-skipped — 27 failed at the bank, and **20 caught by the already-Paid
duplicate guard**, which is ruling Q14 paying for itself on real data. X1 corrected 313 amounts, all
sub-rupee, each audited.

**Three defects found, all fixed:**

1. **THE CANDIDATE COLLAPSE** — see invariant 0 in the domain doc. `_settleable_candidates` read
   only `best_payment_group`. Fixed to read every group. On the real batch this took the rows
   offered as "ready" from **112 to 59** — the 59 that genuinely have one candidate — and the
   ambiguity notice from 5 to 58. Residual collisions dropped from **124 to 3**, and those 3 are
   honest: the statement contains more transfers than the ledger has records, which no per-row logic
   can resolve.
2. **THE RESULTS PANEL NEVER APPEARED.** 124 failures were collected and discarded when the dialog
   reverted to the list, so nobody could see what failed or why. Fixed structurally: the confirmable
   fetch is SUSPENDED (null SWR key) once `outcomes` is set, and the results view no longer shares a
   `!isLoading` gate with the list. The exact trigger was never isolated — a focus revalidation is
   the best candidate — so the dependency was removed rather than re-ordered.
3. **The delta rendered as `₹27,504 → ₹27,504`** — the confirm dialog formats both sides with the
   rounded-rupee formatter, and virtually every correction is sub-rupee. ✅ **FIXED in §H.9.**

**Two owner rulings applied the same day:** the Link payment table dropped `type` as its own column
(Amount was off-screen), and "Skip this row" is hidden behind `SHOW_SKIP_ROW` — with the consequence
recorded in the domain doc.

### §H.9 — Three removals, one formatter (2026-08-10, owner-directed)

Commit 1 — `refactor(outflow): a control nobody read, a figure that moved the tab, and a change
notice showing no change`. No migrate.

- **Close Import deleted** — button, `CloseBatchDialog.tsx`, the closed banner, `close_batch` /
  `reopen_batch` / `get_close_preview`, `test_close.py` (13 tests). It stamped three fields and
  nothing read them; at X3 an import stopped being a place, so closing one marked nothing as
  finished with. **The three doctype fields stay** — dropping them is a migrate that destroys the
  close history of already-closed batches to save nothing. Rationale in the domain doc.
- **Summary status chips are figures, not buttons.** A click re-scoped a table spanning ALL imports
  from a panel describing ONE, and moved the tab as a side effect. `SummaryTile.statuses` and
  `tabForStatus` went with it.
- **Amount deltas now render to the paise** at all three sites (confirm dialog before→after,
  `SettleableRecordTable`'s `AmountMark`, `DecisionDialog`'s two "differs by" lines). The candidate
  tables had the same defect from the other side, reading `off by ₹1` for a 31-paise gap. Plain
  amounts keep the rounded form — **the rule is about differences**, where the rounding is the whole
  signal.

Commit 2 — the status merge. **MIGRATE-CARRYING, and it adds an eighth doctype JSON plus a second
patch module to the branch's obligation.**

- **`Unmatched` merged into `Mismatched`** — seven statuses became six, both sides of the parity
  pin, the doctype Select, and `unmatched_rows` / `unmatched_value` removed from the summary
  (**absent, not zeroed**). Full rationale + the two test consequences: domain doc §Status
  vocabulary.
- **`patches/v3_0/merge_outflow_unmatched_status.py`** rewrites stored rows. Raw SQL, idempotent;
  the `patches.txt` line is the maintainer's, matching `add_outflow_master_index`. **Verified live**
  on a planted probe row: `Unmatched → Mismatched`, second run a no-op, probe removed.
- **`ROW_FILTERS` deleted** from `outflowImportStatus.ts` — the pre-V4 chip strip's buckets, with no
  caller since X3 deleted that screen. A second, older answer to "which rows belong together"
  sitting beside `_SCOPE_STATUSES`; the merge is what surfaced it.
- `DecisionDialog`'s "Only approved records are ever offered here" line no longer branches on the
  retired status. It applies to only ONE of the merged status's two causes, and is now gated on
  `related_payments` — the fact the database already holds, not the note text.

⚠️ **The dev database held 0 import rows and 0 batches at this point**, so the merge has NOT been
seen against the 1,043-row statement. The patch is proven on a probe, not on that data. Re-import
before trusting the screen.

Commit 3 — the retab. No migrate.

**All / Not-Matched / Matched & Settled**, replacing Pending / Settled / Skipped. Sets, the
skipped-has-no-tab ruling and the two structural consequences are in the domain doc's §The screen.
What is worth recording here is what the retab *cost*, because none of it was in the plan:

- **`all` needed a real WHERE clause**, having previously meant "no clause". `_scope_clause`'s
  unknown-scope fallback had to move from `[], []` to `all` in the same breath, or a typo'd scope
  leaks skipped rows into the one view nobody checks.
- **Row selection had to become per-row.** The old `selectable: boolean` worked only because the
  tabs partitioned open from terminal. "Matched / Settled" deliberately does not, so the table now
  takes `selectableRowNames`; select-all acts on that subset, and the checkbox `<td>` renders empty
  rather than being omitted (omitting shifts every later cell one column left).
- **`SCOPE_FOR_TAB` is now compiler-enforced** against the payload type
  (`OutflowScope = keyof OutflowRowsPage["tab_counts"]`). The pre-retab tab strip special-cased the
  one tab whose id and scope disagreed; with three of them that pattern is a bug waiting.

**Two test failures caught real things, and one was in the new test itself:**

1. `test_the_total_is_the_whole_result_not_the_page` pinned `scope="all"` against
   `len(self.parsed.rows)`. Correct until `all` stopped meaning every row. Re-pinned to the scope's
   own count — it is a paging test and should not fail for a reason it does not describe.
2. ⚠️ **My partition test counted skipped rows through `_rows_by_transfer_suffix`, which is keyed by
   transfer id — and this fixture deliberately REPEATS one.** The in-file duplicate's two rows
   collapsed to one entry, so the count came back one short: 8 + 2 ≠ 11. The collapsed row is a
   *duplicate*, i.e. one of the three ways a row gets skipped — precisely what the assertion was
   about. Counted from the database instead. **Any future test counting rows by status must not go
   through that helper.**

Tests after all three commits: 270 pure python · `test_review` **71** · `test_expenses` 29 ·
`test_settle_payment` 21 · `test_upload` 25 · **1657** vitest (59 files) · `bench migrate` clean ·
tsc clean across `src/pages/outflow-import`. `residence_check.py` fails two rules (F5, F2)
**identically at HEAD** — pre-existing, stale baseline, not from this work.

### §H.10 — Chunk E: stacks (2026-08-10)

Rules, mitigations and limits: domain doc §Stacks. What belongs here is what the work COST.

Commit 4 (E1+E2+E4) — the pure module, the auto-pair pass, a fourth index + patch. Commit 5 (E3) —
`get_unpaired_stacks` + the Resolve-stacks dialog.

**Three fixture defects, all mine, all found by the tests rather than by review:**

1. `pair_stack` ordered the RECORDS but took the transfers as given, leaning on
   `group_into_stacks` having sorted them. A function whose whole contract is "same input, same
   pairing" cannot delegate half of it to its caller. It sorts both sides itself now.
2. ⚠️ **The fixture built stack rows from suffix `0001`, which the CSV REPEATS** (rows 1 and 12) to
   exercise the in-file duplicate guard — so the `transfer_id` lookup returned the row SKIPPED at
   upload and nothing could ever pair. **Second time this trap has bitten in two days** (the first
   was the retab's skipped count). `_stack_row` now asserts the row staged as `Pending match run`.
3. The unbalanced fixture was 2 transfers against 1 payment, which tested **nothing**: a single
   candidate gives every row a sole suggestion from the per-row matcher, so the stack pass never saw
   them. Now 3 against 2 — the smallest set for which `sole_suggestion` declines.

**And one about the code, found the same way:** the first three test amounts were 7737.11 / .22 /
.33, all inside the ±₹1 tier-1 window of each other, so every stack's candidate set held every
stack's payments and nothing paired. That was the code behaving CORRECTLY — it is now pinned
deliberately as `test_a_record_inside_the_tier_one_window_unbalances_the_stack`.

**A test-ordering trap worth remembering:** `test_the_leftovers_endpoint_spans_imports` originally
asserted on stack C, which is unbalanced only *until* the test that stages the batch balancing it —
and that test sorts earlier. It builds and tears down its own cross-import member now. A test whose
meaning depends on which tests ran before it is not testing what its name says.

Tests: 295 pure python (+25 new `test_stacks`) · `test_review` **81** (+10) · `test_expenses` 29 ·
`test_settle_payment` 21 · `test_upload` 25 · **1666** vitest (59 files) · tsc clean across
`src/pages/outflow-import`. Fourth index verified present on localhost.

⚠️ **`_match_many` in `test_status.py` is the fixture that did not exist.** Every prior fixture built
ONE payment group, so reading `payment_groups[0]` was indistinguishable from reading all of them and
263 green tests said nothing. Any new candidate test must use it.

### §H.11 — The polish pass (2026-08-10, owner-directed)

> Lands on top of §H.10 (chunk E, stacks), which was committed by a concurrent session while this
> pass was in flight. Nothing here touches `stacks.py` or the stack endpoints.

Four asks, one commit-sized change. No migrate. Tests: **295** pure python · `test_review` **84** ·
`test_expenses` **31** · `test_settle_payment` **24** · `test_upload` **25** · **1675** vitest
(59 files) · tsc clean across `src/pages/outflow-import`. `residence_check.py` fails F5 (119) and
F2 (213) — **the exact numbers the previous session verified at pristine HEAD**, so this work added
none.

**1. Failed transfers leave every figure (owner: option B, not option A).**
Full rules in the domain doc, invariant 13. The owner chose to KEEP staging the row and remove its
effect on the numbers, rather than never staging it. Two findings worth recording because they
shaped the work:

- **`gross_amount` already excluded failed transfers and always had** (`parser.py`, documented). So
  half of the ask was a LABEL change — "Gross out" → "Gross Outflow" — with no arithmetic behind it.
  What was actually wrong was *after* import: the summary panel's Statement total summed every
  status, so the failed money was on screen the whole time, just not in the table.
- The single definition of "successful" had to become one. It was a property on `RawRow`; the
  summary needed the same test against rows read back out of the database, and a second
  `== 'SUCCESS'` in that SQL is the shape where one side later learns about `REVERSED` and the other
  does not. `parser.is_success_status` / `BANK_SUCCESS_STATUS` is now that one place, and the query
  **binds** the literal.

**2. The 688-vs-893 reconciliation.** The owner reported the confirm dialog showing 688 and the
table showing 893. Both were right; four separate things stack up between them, and only the last
was a defect:

| | Cause | Verdict |
|---|---|---|
| 1 | The table spans EVERY import; the button describes ONE | by design (X3) |
| 2 | The tab counts `Settled` too, which is not confirmable | by design (the retab) |
| 3 | `Matched` ≠ has a suggestion — ambiguous rows carry none | by design (invariant 0) |
| 4 | The button counts a suggestion; the dialog checks it still RESOLVES | **the defect** |

Fixed by naming the fourth: `get_confirmable_rows` now returns a `stale` bucket, so
`ready + stale == confirmable_rows` and the dialog can state the whole funnel. **The two numbers are
deliberately NOT forced equal** — see invariant 14. Causes 1–3 got one line of copy above the tab
strip saying which population the table describes, because the honest fix for "two correct numbers
labelled the same word" is labelling, not arithmetic.

**3. The statement lands on what it settled.** `payment_attachment`, blank-only, all three ledgers
plus newly created expenses. Invariant 15 has the rules; the two that are easy to get wrong are the
write going in BEFORE `doc.save()` (so it shares the savepoint) and the `File` row going in AFTER
the commit (so the cloud hook's commit cannot corrupt one).

**4. The import dialog.** `max-w-2xl` → `max-w-3xl`; every label and value `whitespace-nowrap`;
dates through `formatDate` (`dd-MMM-yyyy`, the app-wide rule) instead of raw ISO. The summary block
was rebuilt as two columns — *In this file* (period, transfers, successful, failed-and-excluded,
already-imported) and *Left the bank*, which **foots**: Gross Outflow + Bank charges, a rule, then
**Total debited**. That total is the number the accountant reconciles against the account and the
dialog had never shown it; gross and charges were sitting there as two unrelated figures when they
sum to a real fact.

⚠️ **`previewCounts` deliberately exposes NO combined "how many will I work on" figure.** The two
exclusions are on different axes and can OVERLAP — a failed transfer may also be a duplicate — so
`total - failed - duplicates` double-subtracts and `min(new, successful)` is a bound, not a count.
Naming a guess as a count is how a confirm button ends up promising a number the import misses.

**5. The Outcome column** (owner, mid-pass): 320px → 220px, and the note moved OUT of the button
onto its own line above it. A control wrapped around a whole sentence stops reading as a control —
it reads as a bordered paragraph, which was the complaint. The button now holds a verb
(Confirm / Choose / Review) and a chevron, and is filled (`bg-secondary`) rather than
`bg-background`, which on a white table left a hairline border as the only thing distinguishing it
from the cell around it.

**Three api tests changed, and all three were describing the old behaviour:**
`test_the_status_counts_sum_to_the_total` pinned `len(self.parsed.rows)` (now `success_count`);
`test_the_money_agrees_with_the_rows_it_describes` pinned the summary equal to the row sum (the two
now describe different populations ON PURPOSE, so the assertion names the difference rather than
adding the failed money back); and `test_a_suggestion_pointing_at_a_vanished_record_becomes_needs_you`
asserted the collapse this pass split apart — renamed to `..._becomes_stale`.

**6. Verbose errors — a browser walk found the confirm dialog saying "There was an error."** and
nothing else, on a real 1-row confirm failure. That string is FRAPPE'S, not ours: a `frappe.throw`
comes back as HTTP 417 with `message: "There was an error."` and the real sentence inside
`_server_messages` (a JSON array of JSON strings). **All six call sites in this feature read
`err?.message`**, so every refusal in the product rendered identically and none could be acted on.

One shared pure `describeFrappeError` now digs out, in order: `_server_messages` (titles included
when they add something) → `exception` (class + text) → `message` (only when not the placeholder) →
the HTTP status. All six sites use it, including `ImportStatementDialog`'s raw-`fetch` path, whose
local parser read only `list[0].message` and dropped titles, later messages and the exception
fallback. The confirm dialog's failure rows also gained amount + UTR, so a reason has a subject.

**7. The Outcome column, properly.** The 320px → 220px change alone did NOTHING, and the reason is
worth keeping: **this table is AUTO-LAYOUT, so `<th style={{width}}>` is only a hint** — the browser
widens any column whose content demands it, and `truncate` cannot help because with nothing bounding
it the cell simply grows and there is never overflow to cut. The cap has to be on the CELL CONTENT
(`OUTCOME_CELL_WIDTH`), which is also what makes the `truncate` do anything. Full text on `title`.

**8. The silent Confirm — the defect behind "it looks like a bug in the frontend".** Picking a
record ₹2,19,000 from the transfer left Confirm → Paid fully enabled; clicking it did NOTHING
visible. **Two independent causes, and both had to go:**

- **`handleConfirmOne` had no `catch`.** The settle rejected, nothing caught it, the dialog just sat
  there. The BULK path had reported its failures since V4; this single-row path never had. It now
  catches and renders the server's sentence **in the dialog footer, beside the button that caused
  it** — not a toast, which is how the refusal went unseen in the first place. It clears when the
  pick changes, so it can never describe an abandoned choice.
- **Nothing said the pick was going to be refused.** The new pure `settleBlocker` + an AlertDialog
  (`AmountOutsideWindowDialog`) say it before anything is posted: the gap, the rule, **"Nothing has
  been recorded, and nothing will be"**, and the two ways forward.

⚠️ **THE CHECK RUNS ON THE CLICK, NOT ON `disabled`.** Disabling the button would have restored the
other half of the same complaint — a dead control with no explanation. A click that opens a dialog
SAYING why answers the question at the moment it is asked. **There is deliberately no "try anyway":**
the server refuses this pick with certainty, so an override would offer a guaranteed failure.

⚠️ **`settleBlocker` GATES ON THE SERVER'S OWN `suggested` FLAG, NEVER A CLIENT COPY OF THE
TOLERANCE** — the invariant `CandidateLike.suggested` already documents (both windows live in
`amounts.py` and have changed twice). **And it FAILS OPEN:** `suggested` absent is "the server did
not say" and must not block, or an older payload makes a valid record unconfirmable with no
override. Only an explicit `false` blocks. Pinned by test.

**9. Sidebar order (owner):** `Bulk Import Outflow` moved ABOVE `Project Payments`. The block moved
whole — its role gate, comment and icon are unchanged — so the four registry-driven touches
(`allKeys`, `groupMappings`, the flat-label Set, the route) needed nothing.

### The browser walk (2026-08-10)

Run against a refreshed database holding one real import, `OFI-26-00081` (26 rows, `05-06-aug.csv`).

**Confirmed live:**
- **The failed-transfer exclusion caught a real overstatement.** That import carries one failed
  transfer of **₹4,52,002**. Statement total read **₹24,78,291** before and **₹20,26,289** after; the
  footnote renders as *"1 failed at the bank (₹4,52,002), excluded from every figure above"*.
  `sum(by_status) == total_rows` and `total + failed == staged rows` both hold on this data.
- Outcome column narrow, note truncated, button reads as a button — and the table now fits without
  horizontal scroll, which it did not before.
- `payment_attachment` lands on a settled payment: `PAY-00107-024` carries the statement's URL.
- The import dialog's period renders `dd-MMM-yyyy`.

**NOT confirmed, and stated as such:**
- ⚠️ **The original confirm failure could not be reproduced.** It was live-observed once
  (*"0 settled · 1 could not be"*), and the SAME row then settled cleanly through `settle_row`
  server-side with identical inputs, leaving no Error Log. The cause is UNKNOWN. What changed is
  that the next occurrence will name itself.
- ⚠️ **`_link_statement_file_to_target` did not fire on that settle** — no second `File` row, no
  logged failure. Called directly against the same URL and record it works and creates the row, so
  the function is sound and the 403 mitigation is real; why it was skipped on that one run is
  undetermined. **Confirm on the next real settle before trusting it.**
- The confirm funnel (`ready` / `stale` / `needs_you`) never rendered: this import has at most one
  matched row, so `ready === matched` and the line correctly stays hidden. Covered by tests only.
- ⚠️ **`frappe.db.exists` / `get_all` on a `file_url` CONTAINING `&` and `=` breaks Frappe's query
  builder** (`psycopg2.errors.SyntaxError`) — the GCP attachment hook rewrites `source_file` into
  exactly that shape. Parameterised raw SQL is unaffected. Noted for anyone querying File by URL.

⚠️ **One api-suite run collapsed mid-pass with `relation "tabOutflow Import Batch" does not exist`
across all four suites, then passed cleanly on a re-run with no code change.** The live tables were
present throughout (checked directly). A concurrent DB operation is the only explanation that fits;
recorded so the next person who sees it re-runs before believing it.

### §H.6 — Order, and what each slice costs

| Slice | Depends on | Migrate | Verifiable here? |
|---|---|---|---|
| **X1** exact amounts | — | none | **Yes** — pure + api tests, incl. the isolation regression |
| **X2** summary | — | none | **Yes** — pure + api tests |
| **X3** master table | X2 (for the counts it links to) | **likely one index + a patch** | Partly — endpoint yes, table NO (browser) |
| **X4** import dialog | X3 | none | **No** — browser only |
| **X5** confirm all matched | X1, X2, X3 | none | Partly — endpoint yes, dialog NO (browser) |

X1 and X2 are independent of each other and of everything else; either can ship alone. X1 goes first
regardless, because X5 has to display what it introduces.

### §H.7 — Obligations this arc inherits and adds

**Inherited, still unpaid:**
- **The live browser walk of the v3 screen.** Never done. The dev database carries 0 import rows and
  5 approved payments, so neither the table nor tiers 1 and 2 have been seen against real data.
- **The production migrate** — six doctype JSONs on this branch already.
- **Nothing is pushed.**

**Added by this arc:**
- A **seventh** migrate obligation if X3 lands an index, plus a patch module for deployed databases.
- An **eighth** from §H.9's status merge (`outflow_import_row.json`), plus a **second** patch module
  (`merge_outflow_unmatched_status`).
- A **third** patch module from §H.10 (`add_outflow_stack_index`, the fourth read index). **All
  three patches need their `patches.txt` lines from the maintainer — none ships its own.** Note that
  the two index patches both CALL the controller hook, so either one applies all four indexes; a
  missed line on those two is survivable, which is the pay-off for never re-inlining an `add_index`.
  The status-merge patch has no such backstop and must be wired.
- A behaviour change to the CEO-Hold cashflow recompute on expense settles (§H.1) — it starts
  running, which it should always have done, and stops publishing realtime on that path.
- The reversal of the "paise difference is not recorded" limit in the domain doc.
- ⚠️ **The `Approve` vs `Confirm` label ruling is still open** (§H.0).

---

## §Z — v2 as-built record (superseded)

Everything below describes the build that is in the repo today. It is accurate about the code and
wrong about the design. Kept because the pure layers survive and their rationale is still the reason
they are shaped as they are.

---

## §0 — What this feature is

### 0.1 The spine: one branch reads, the other writes

An accountant exports completed bank transfers from Cashfree and uploads the CSV. What happens
next depends on which kind of record the row belongs to, and the two kinds behave **oppositely**:

| Branch | Behaviour | Why |
|---|---|---|
| **Payments** | **READ-ONLY.** Match, classify, report. Never writes to `Project Payments`. | Accountants mark payments Paid by hand at transfer time (owner decision R1). By upload time the payment is already `Paid` with a UTR — there is nothing to settle. |
| **Expenses** | **WRITES.** Marks an Approved expense Paid, or creates a fresh expense at Paid. | Expenses genuinely rest at `Approved` waiting for money. This is the productive half. |

**This asymmetry is the load-bearing invariant of the design.** It is what removes almost all
the risk the first draft carried, and it must not be "made consistent" later. Nothing in this
feature may write to `Project Payments`, `PO Payment Terms`, or a PO's `amount_paid`.

### 0.2 What the payment branch produces

Per bank row, one of these outcomes — all read-only:

| Outcome | Meaning |
|---|---|
| **Reconciled** | matched a Paid payment (or a group of them), amounts agree ✓ |
| **Amount mismatch** | matched, but `sum(payment amounts)` ≠ bank amount — TDS, partial, or error. Reported with the implied rate. |
| **Reference mismatch** | matched by vendor+amount+date, but the payment's stored `utr` isn't the bank reference. **Reported, never fixed** (owner ruling 2026-08-06). |
| **Control exception** | matched a payment that is **not** `Paid` — money left the bank before approval completed |
| **Unmatched** | no payment found → the row is expense work |

Plus one batch-level report: **payments marked Paid inside the period with no bank row in the
file** — informational, since another channel may have paid them.

### 0.3 What R1 = no deleted from the design

Recording this so nobody re-adds it. Every item below was in v1 and is now **out of scope**,
because each existed only to make the payment *write* path safe:

- `flags.bulk_settle` suppression on `update_parent_amount_paid`
- the `bulk_actions.py`-shaped settlement engine for payments
- TDS derivation and per-target allocation arithmetic
- the `_fulfil_payment` mid-save-commit problem (`doctype/project_payments/project_payments.py:125`)
- the `_fulfil_payment` UTR duplicate-guard collision (`api/payments/project_payments.py:274-281`)
- `Blocked` + re-check as a payment state — a non-Paid match is now simply a *reported*
  Control exception

### 0.4 Decisions of record

| Ref | Decision | Date |
|---|---|---|
| R1 | Accountants keep marking payments Paid by hand → **payment branch is read-only** | 2026-08-06 |
| R2 | **N targets per bank row supported** — as a grouping key, not an allocation. ⚠️ *Taken as yes on my recommendation without an explicit confirmation; cheap to reverse — see §3.4.* | 2026-08-06 |
| R3 | CSV attached **once to the batch**; settled records link back to the batch + row | 2026-08-06 |
| — | Junk/padded UTRs are **reported, never repaired** | 2026-08-06 |
| — | Fresh expenses created directly at `Paid`; role-gated | earlier |
| — | Manual skip requires a reason; auto-skip carries a system reason | earlier |
| — | Access: Accountant, Accountant Lead, Admin, Administrator | earlier |
| — | Date-range overlap **warns**, never blocks | earlier |
| — | Diesel / Garbage bills → a new `Miscellaneous Expenses` type, `non_project=1` | earlier |
| — | Bank charges: total shown, opt-in single non-project expense | earlier |

---

## §1 — Architecture

### 1.1 Concept → owner (ADR-0010)

| Concept | Owner | Rule |
|---|---|---|
| CSV → normalized rows | `services/outflow_import/parser.py` — **pure** | B1 |
| Account / name / amount / reference normalization | `services/outflow_import/normalize.py` — **pure** | B1 |
| Match scoring + N-target grouping | `services/outflow_import/matcher.py` — **pure, no `frappe.db`** | B1 |
| Candidate retrieval | `services/outflow_import/candidates.py` — reads only | B2 |
| Row + batch status | `services/outflow_import/status.py` — **one deriver** | B3 |
| Expense settlement (the only write) | `services/outflow_import/settle.py` | B4 |
| Endpoints | `api/outflow_import/*.py` — thin orchestrators | B4 |

`matcher.py` receives candidate pools as arguments and never queries — that is what makes it
unit-testable without a bench, and it mirrors `services/boq_bcs/readiness.py`: **api → service
is the one legal import direction.** Nothing under `services/outflow_import/` may import from
`api/` or read request context.

### 1.2 Synchronous, not a long job

~50 rows; a pure parse on a small file; the only writes are expenses. One request, one
transaction, savepoint per row. No Redis marker, no socket, no worker.

---

## §2 — Doctypes

Three new. Per recon, a brand-new doctype needs **no patch and no `patches.txt` line** — three
files each (`__init__.py`, `<name>.json`, `<name>.py`), hand-written JSON keeping the vestigial
`"engine": "InnoDB"`, explicit prefix `autoname`, and `on_doctype_update` **module-level in the
doctype's own `.py`** (not in `integrations/controllers/`).

### 2.1 `Outflow Import Batch` — `autoname: OFI-.YY.-.#####`, `allow_rename: 0`

`source` (Select: Cashfree / Cashbook) · `source_file` (Attach — the CSV lives **here and only
here**, R3) · `original_filename` · `period_from` / `period_to` (Date, from min/max `Added On`)
· `uploaded_by` (Link User) · `status` (Select, §3.5) · `gross_amount`, `charges_amount`
(Currency) · `charges_expense` (Link Non Project Expenses) · `overlaps_batch` (Link self) ·
counters `total_rows`, `reviewed_rows`, `reconciled_rows`, `settled_rows`, `skipped_rows`,
`exception_rows`, `error_rows` (Int).

`track_changes: 1`. The counters are the decision-tracking the owner asked for.

### 2.2 `Outflow Import Row` — a **separate linked doctype**, not a child table

Recon gave five independent reasons; the two decisive ones: reading a child table loads the
**whole** parent on every access, and the row's matches would then be **grandchildren**, which
Frappe never hydrates.

- **Raw, verbatim:** `transfer_id`, `reference_id`, `added_on` (Datetime), `amount` (Currency),
  `status_raw`, `beneficiary_name`, `beneficiary_id`, `bank_account`, `ifsc`,
  **`remarks` (Text)**, `bank_reference_no`, `service_charge`, `service_tax`, `added_by_raw`
- **Derived:** `normalized_account`, `normalized_reference`, `resolved_vendor` (Link Vendors),
  `resolved_project` (Link Projects)
- **Decision:** `row_status` (Select, §3.5), `skip_reason` (Small Text), `outcome_note` (Text),
  `decided_at`, `decided_by`

`track_changes: 1`. Indexes on `(import_batch)` and `(transfer_id)` — **see §2.4**.

> ⚠️ `remarks` **must** be `Text`. As `Data` it is PG `varchar(140)` and Frappe *throws*
> `CharacterLengthExceededError` rather than truncating — the same trap the expense
> `description` field hit on 2026-07-28.

### 2.3 `Outflow Row Match` — the match record and idempotency key

One row per (import row → target). Covers **both** kinds via `match_kind`:

`import_row` / `import_batch` (Link) · `transfer_id` (Data) · `target_doctype` (Link DocType) ·
`target_name` (Dynamic Link) · `target_amount` (Currency) · `match_kind`
(Select: `Reconciled` — read-only payment match / `Settled` — we wrote) · `match_basis`
(Select: `Bank reference` / `Vendor+amount+date` / `Manual`) · `matched_at` / `matched_by`.

**DB unique constraint on `(transfer_id, target_doctype, target_name)`** — this, not `utr`, is
the idempotency guard. (`tabProject Payments` has *no* index beyond its primary key, `utr` has
no unique constraint, 226 rows are whitespace-padded, and a second non-stripping writer exists
at `EditFulfilledPaymentDialog.tsx:96-105`.)

### 2.4 ⚠️ Index names must be explicit — live-verified silent failure

PostgreSQL index names are unique **per schema**, not per table, and Frappe generates them
**without a table prefix**. `add_index(dt, ["parent"])` produces `parent_index`, which already
exists on `tabBoQ Committed Sheet Grid Row`; `CREATE INDEX IF NOT EXISTS` then matches by name
and **silently does nothing**. Every index here passes an explicit, prefixed name
(`ofi_row_batch_idx`, `ofi_row_transfer_idx`, `ofi_match_transfer_idx`).

Also: never name a field `user` or `order` — both are PostgreSQL reserved words. (`BoQ Rate
Suggestion Event` renamed its actor field to `event_user` for exactly this reason.)

### 2.5 Property edits to two existing doctypes

`track_changes: 1` on **`Project Expenses`** and **`Non Project Expenses`**. Both are currently
unset, so `save_version()` returns early and **an expense settlement leaves no audit row
anywhere**. This is a doctype-level property, not a field `fieldtype` or `description`, so it
sits **outside** the `CLAUDE.md` sanctioned exception as written — **explicit owner approval
required before S0.**

---

## §3 — Matching

### 3.1 Pass A — payments, strong key

`normalize_reference(bank_reference_no) == normalize_reference(utr)`, both whitespace-stripped.
A direct key, far stronger than vendor+amount. **`GROUP BY` the key yields the N-target group**
(§3.4). Since 0 non-Paid payments carry a UTR, Pass A only ever finds `Paid` records.

### 3.2 Pass B — payments, weak key

For rows Pass A misses: vendor + amount + a ±3-day window on `added_on`. Needed because
**932 of 7,420 Paid payments (12.6%) carry a UTR that is not a bank reference** — PO numbers,
short numbers like `10737978`, `043572728741/BULD67453750`.

Vendor resolution, in order:
1. **Normalized bank account** — strip whitespace, strip leading zeros
2. **Normalized name** against **both** `vendor_name` **and** `account_name` — 174 of 1,077
   vendors have an `account_name` that differs; the CSV's "Beneficiary Name" *is* an account name
3. nothing

**`|candidates| > 1` always routes to human choice.** Shared accounts are legally distinct
entities: `50200051045430` maps to three D.S. Ductofab companies with three different GSTs;
`0000786000` to two Siemens entities. Account narrows — it never picks.

`Beneficiary Id` is **not** a signal: it is stored nowhere in the database.

Pass B is what surfaces **Reference mismatch** and **Control exception**.

### 3.3 Pass C — expenses

Approved expenses by exact amount + a `description` scan for the beneficiary name or bank
account. Vendor cannot filter here: `Project Expenses.vendor` is populated on **0.58%** of rows
and `Non Project Expenses` has no vendor column at all. The signal is real but fragile — it is
how the one clean live match was found:

```
CSV 28-Jul 17:05 · Ravindra reddy kuppagiri · ₹5,000 · a/c 39088842277
  → t9r9h8v9qk [Approved] Staff Accommodation Rent · BENGALURU-PROJ-00066
    description: "Wasim Alam (July PG rent) / Account Number: 39088842277 / ..."
```

Always presented as a suggestion, never applied.

### 3.4 N-target grouping (R2)

Pass A groups by normalized reference. For a group, compare `sum(target amounts)` against the
bank amount and report the difference plus its implied rate. **No allocation, no split, no
write.**

Measured incidence: **40 genuine fan-out transfers** — 0.55% of bank rows, 1.33% of payments,
but **2.53% of settled value (₹10.0M)**. Shape: 31 pairs, then 3(×5), 4, 5, 6, 7. The largest
is `742905000271` — ₹7,289,432 across 7 payments and 6 projects.

*To reverse R2:* drop the `GROUP BY` and take the single best candidate. Cost: 99 payments in
fan-out groups produce 40 matches and **59 spurious exceptions**, concentrated on the largest
transfers.

### 3.5 Statuses

**Row:** `Pending` · `Reconciled` · `Amount mismatch` · `Reference mismatch` ·
`Control exception` · `Unmatched` · `Settled` · `Skipped` · `Error`

**Batch:** `Draft` → `In Review` → `Partially Settled` → `Completed` /
`Completed with exceptions`

All derived in `status.py` and nowhere else (B3).

---

## §4 — Backend

### 4.1 Pure modules

**`parser.py`** — bytes → `list[RawRow]`. Handles both sample header sets, tolerates column
reordering, rejects an unknown schema loudly. **Never filters** — `FAILED` rows are parsed and
staged, then auto-skipped, so the skip is visible. (A FAILED transfer still carries a bank
reference: `620918791146` at 18:17:59, with a successful retry `620919871893` at 19:23 for the
same ₹22,000 to the same beneficiary. Both would otherwise match the same payment.)

**`normalize.py`** — every rule derived from an observed failure: `'Sri Sai Enterprises '`
(trailing space), `RIDDHI SIDDHI …&…` vs `AND`, `RAJ MARKETING e-Hub` vs `eHub`,
`Absolute Air Solution` vs `Solutions`, `0869102000002783` vs `869102000002783`,
`' 504918114686'` (padded UTR).

**`matcher.py`** — pure. Passes A/B/C, N-target grouping, ambiguity flagging.

**`status.py`** — `derive_row_status(...)`, `derive_batch_status(...)`.

### 4.2 `settle.py` — the only write path

Expenses only. Per row: savepoint → write → release, or rollback and mark that row `Error`;
one `frappe.db.commit()` at the end. Pre-flight `frappe.db.get_value(dt, name, "status",
for_update=True)` — **never with `cache=True`**, which silently skips the lock
(`frappe/database/database.py:591`) — and distinct named errors for already-Paid vs wrong-status.

Four things recon says this must get right:

1. **`frappe.flags.in_import = True` around the Project-Expenses loop.**
   `hooks.py:258-259` fires `project_cashflow_hold_update.on_project_expense` on both
   `after_insert` and `on_update`; `trigger_check:187` bails on that flag. Without it every row
   triggers a full CEO-Hold gap recompute.
2. **Format `amount` per doctype.** `Project Expenses.amount` is `Data` → PG `varchar(140)`
   holding bare numeric strings (`'2935'`, `'351.72'` — no commas, symbols or negatives in
   2,574 live rows). `Non Project Expenses.amount` is `Currency` → `numeric(21,9)`.
3. **`payment_by` exists only on `Project Expenses`** and is a `Data` field, not a Link.
   Copying the project payload to the non-project twin will throw or silently drop.
4. **Validate `type` scope** — a Project Expense's type needs `Expense Type.project = 1`, a
   non-project one needs `non_project = 1`. Nothing enforces this today.

Model the writer on `api/po_adjustments/adjustment_logic.py:146-159` — the only existing
backend expense writer, and already a direct-to-Paid `frappe.new_doc("Project Expenses")`
precedent.

> **Creating at `Paid` deliberately trips the second auto-approval guard**
> (`project_expenses.py:22-23`, `if self.status and self.status != 'Requested': return`), so
> auto-approval never evaluates. That is intended — the money is already gone. Recording it so
> it is not later read as a bug. Note also: exactly ₹5,000 is *not* auto-approved (strict `<`),
> and a negative amount (a refund — 12 live non-project rows) is not either.

### 4.3 Endpoints — `api/outflow_import/`

| File | Endpoints |
|---|---|
| `upload.py` | `upload_outflow_file(source, file)` |
| `review.py` | `get_batch`, `get_rows`, `get_row_candidates`, `set_row_decision`, `skip_row` |
| `commit.py` | `commit_batch`, `close_with_exceptions` |
| `expenses.py` | `settle_expense`, `create_expense_from_row` — the new whitelisted writes |
| `report.py` | `get_reconciliation_report`, `get_unmatched_payments` |

Upload captures bytes **before** `save_file()` into a `NamedTemporaryFile` with a `finally`
cleanup — `File.get_content()` reads local disk only and breaks under `frappe_s3_attachment`.

All gated on Accountant / Accountant Lead / Admin / Administrator. **The server re-validates
every decision** — the UI confirmation cannot be the only gate, because the frontend guarantee
is structurally untestable here (§6).

> There is **no** whitelisted expense endpoint anywhere in the app today. Every expense write is
> a raw SDK `updateDoc` → `frappe/api/v1.py:52-57` (`get_doc(for_update=True) → update() →
> save()`), which re-reads the doc server-side so `check_if_latest` can **never** fire — zero
> optimistic-concurrency protection. `expenses.py` is new ground, not an extension.

---

## §5 — Frontend — `src/pages/outflow-import/`

### 5.1 Sidebar — five edits, four in one file

Recon corrected the docs here: the "four registry-driven touches" are four **literals** in
`NewSidebar.tsx` (only the pricing workbooks generate theirs from a registry); routes are a
fifth file.

1. `NewSidebar.tsx` — role-gated `items` entry, near the `/project-invoices` Accountant cluster (`:563-571`)
2. `NewSidebar.tsx` — `allKeys` Set (`:694-755`)
3. `NewSidebar.tsx` — `groupMappings` (`:766-807`)
4. `NewSidebar.tsx` — the flat-label discriminator Set (`:883-922`) — **omit this and the item
   falls into the collapsible-group branch and renders wrong**
5. `routesConfig.tsx` — route objects

⚠️ The sidebar reads `role` from its own `useFrappeGetDoc`, which is **skipped for
`Administrator`** (`:90-94`), leaving `role === null` — the opposite of `useUserData()`, which
fakes Administrator into `"Nirmaan Admin Profile"`. The gate must handle both.

### 5.2 Route guard

New `OutflowImportRoute` modelled on `PricingRoute` (`ProtectedRoute.tsx:182-201`).
**Do not copy `AdminRoute`** (`:23-29`) — it returns `undefined` for unauthorized users and
renders a blank screen.

### 5.3 Pages

- **List** — `useServerDataTable` + `DataTable`, config files per the `NonProjectExpenses`
  exemplar; columns source, period, uploader, counters, status; **New Import** button
- **New Import** — source picker, drop zone, overlap warning
- **Review** — the row table with outcome chips, the candidate panel, and the decision controls.
  Read-only outcomes need no control at all; only Unmatched and expense matches do.
- **Report** — reconciliation summary + the unmatched-payments list

**Pure modules:** `outflowRowOutcome.ts`, `outflowImportStatus.ts` — mirroring `status.py`,
pinned by an FE↔BE parity test (F1).

---

## §6 — Tests

| Layer | Coverage |
|---|---|
| `parser` | both real files as fixtures, incl. the FAILED row and its retry |
| `normalize` | every observed failure mode in §4.1 |
| `matcher` | Pass A grouping (the 7-payment ₹7.29M transfer); `Dharmaraj L → SMB INSULATIONS` (account-only); `Aura Air Systems` (account-miss, name-hit); the 3-way D.S. Ductofab ambiguity; the Ravindra description match |
| `status` | full outcome matrix |
| `settle` | savepoint isolation (row 17 fails; 1–16 survive, 18–40 still run); double-commit idempotency; unique-constraint violation; the `in_import` flag suppressing the cashflow recompute |
| parity | FE↔BE status deriver |

`bench --site localhost run-tests --app nirmaan_stack --module nirmaan_stack.services.outflow_import.test_<mod>`

⚠️ Never run the bench suite and a browser session against localhost together — they collide on
the `tabSeries` naming lock.

⚠️ **"Every row requires explicit human confirmation" cannot be tested in this repo** — there is
no DOM environment, by deliberate choice (`frontend/CLAUDE.md`). Hence the server-side
re-validation in §4.3; the UI is convenience, the endpoint is the boundary.

---

## §7 — Slices

| # | Content | Gate |
|---|---|---|
| **S0** | 3 doctypes + `track_changes` on the 2 expense doctypes + migrate | §2.5 approval |
| **S1** | `parser` + `normalize` — pure, tested | — |
| **S2** | `matcher` + `candidates` + `status` — pure + reader, tested | — |
| **S3** | upload endpoint + sidebar + guard + list page + new-import page | — |
| **S4** | **review screen + reconciliation report — ZERO writes.** Ships the whole payment branch. | — |
| **S5** | expense settlement + fresh expense creation — the only write path | — |
| **S6** | unmatched-payments report + close-with-exceptions | — |
| **S7** | bank-charges opt-in | — |
| **S8** | domain doc + residence manifest + plan record | — |

**S4 is the first shippable slice and it writes nothing.** The payment branch is complete at
that point; S5 adds the only mutation in the feature.

---

## §8 — Risks and obligations

**Migrate obligation.** 3 new doctypes + 2 property edits, on top of debt already outstanding to
teammates (4 new + 7 modified doctypes, 2 `[MIGRATE]`-tagged commits per the handover). Prod is
several migrates behind. One combined heads-up is owed.

**The handover doc is 88 commits behind** (folded at `9cc5e689`, 2026-07-31). A fresh fold is
owed.

**Dev DB is 9 days stale.** Refresh deferred to after implementation by owner decision, so
S1–S5 are verified against fixtures and the first real exercise is post-implementation.
Fixtures must cover: the FAILED/retry pair, the N-target transfer, a padded UTR, a junk UTR, a
CEO-Pending control exception, and the Ravindra expense match.

**Docs.** New `.claude/context/domain/outflow-import.md` with a residence manifest. Per the
DOCS-UPDATE RULE, per-slice detail goes to this plan + that doc only — **never** into an
always-loaded `CLAUDE.md`; the `guard_claude_md.py` hook will block it.

**`residence_check.py` exits 1 on a clean tree and mutates a tracked file** — do not wire it
into a blind pre-commit gate for this feature.

**Pre-existing data defects surfaced by this work — recorded, out of scope:**

- 226 Paid payments carry a whitespace-padded UTR
- 932 of 7,420 (12.6%) carry a UTR that is not a bank reference, incl. PO/SR numbers and the
  literal string `refund`
- `_delete_payment` (`api/payments/project_payments.py:258-262`) has **no status guard** and
  will delete a `Paid` payment through the live endpoint; the legacy commented-out version had
  one
- `EditFulfilledPaymentDialog.tsx:96-105` writes `utr` via raw `updateDoc` with no strip and no
  dedup

The reconciliation report will make the first two visible for the first time. Repairing them is
a separate decision — the owner has ruled this feature **reports, never fixes**.
