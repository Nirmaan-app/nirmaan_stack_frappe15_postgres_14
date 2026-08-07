# Bulk Import Outflow Transactions — Implementation Plan

**Version:** **v3** (2026-08-06). Supersedes v2 wherever they conflict.
**Status:** **SPEC CLOSED, SCREEN SIGNED OFF, ready to build. No v3 code written yet.**
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
