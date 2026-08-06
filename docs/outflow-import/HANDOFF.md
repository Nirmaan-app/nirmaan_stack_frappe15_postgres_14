# HANDOFF — Bulk Import Outflow Transactions (v3)

**Date:** 2026-08-06 · **Branch:** `develop` · **Everything is uncommitted.**
**Status: the spec is CLOSED and the screen design is SIGNED OFF. No v3 code exists yet.**
**Your job: build slices V0 → V5 in `frontend/.claude/plans/outflow-import-plan.md` §C.**

---

## 0. Read these three, in this order, before touching anything

| # | File | What it is |
|---|---|---|
| 1 | `docs/outflow-import/workflow.html` — **section 0** | The spec. 7 tabs. Tab F is the decision log (14 rulings). Sections 1–12 of that file describe the **superseded v2** design — history, not instructions. |
| 2 | `frontend/.claude/plans/outflow-import-plan.md` — **§A–§F** | The build plan and slice list. §Z downward is the v2 as-built record. |
| 3 | `docs/outflow-import/screen-prototype.html` | The **signed-off** screen, as a working clickable page. Open it in a browser. It is the specification for V4, not an illustration. |

Everything below is the short version. Where this file and those disagree, **those win**.

---

## 1. What this feature is

An accountant uploads a bank statement of transfers that have **already left the bank**, and maps
each one to the record it settles. Money lives in three ledgers — `Project Payments`,
`Project Expenses`, `Non Project Expenses`.

> **THE SPINE:** the import **pays what someone has already approved**. It never approves anything,
> and it never creates a `Project Payment`.

All three ledgers settle `Approved → Paid` only. This is an **alternative bulk route chosen per
batch** — nothing about how the accounts team works today changes, so a statement half-ticked by
hand is the normal case.

⚠️ **v2 (the code in the repo) had the opposite spine — "the payment branch never writes".** The
owner reversed it. Do not "restore consistency" with anything you read in the v2 code comments.

---

## 2. The eight invariants that break silently

1. **Only `Approved` records are ever matched.** A transfer against a `Requested` or `CEO Pending`
   payment is simply **`Unmatched`**. There is no "matched but not approved" status, no approval
   nudge, no deep link to an approval queue. *(This reverses an earlier goal — surfacing the 111
   CEO-Pending payments. It was removed deliberately; do not re-add it.)*

2. **The already-Paid duplicate check SURVIVES, and it is a SKIP, not a match** (Q14). A transfer
   whose reference is already on a Paid payment reads
   `Skipped — already recorded as Paid on <name>`. Without it, a payment someone ticked by hand
   comes back `Unmatched` and gets **booked twice**. Keep the duplicate-check query visibly separate
   in the code from the candidate query, so a later reader cannot mistake one for the other.

3. **`Mismatched` is about AMOUNTS ONLY.** The v2 `Reference mismatch` branch is **deleted, not
   folded in**. The reference field is only ever *written* into a blank, never compared. Mismatched
   rows get the **same full decision dialog** as any other row — reporting a mismatch with no way to
   act on it was the defect.

4. **`for_update=True` must never carry `cache=True`.** Frappe skips the row lock when the value
   comes from cache, which makes the whole concurrency guard decorative.

5. **Marking a payment Paid commits mid-save.** `ProjectPayments.on_update` →
   `update_parent_amount_paid` calls `frappe.db.commit()` **inside** the save. That destroys the
   per-row savepoint isolation the expense loop relies on — and it matters more here because **bulk
   confirm is the selling point**. "Confirm 8" must never leave 4 written and 4 not.

6. **Indexes need explicit names.** PostgreSQL index names are unique per *schema*, Frappe generates
   them with no table prefix, and `CREATE INDEX IF NOT EXISTS` matches by name only — a generic name
   colliding with another table makes the call a **silent no-op**.

7. **The two expense doctypes are not twins.** `Project Expenses.amount` is a **Data** column holding
   bare numeric strings (`'2935'`); the non-project one is real **Currency**. `payment_by` exists
   **only** on the project side. `Non Project Expenses` has **no vendor column**. Expense Type is
   **scoped** — `project=1` and `non_project=1` types are disjoint sets, so switching ledger must
   reset the chosen type.

8. **`Outflow Import Row.remarks` must stay `Text`.** As `Data` it is `varchar(140)` and Frappe
   *throws* `CharacterLengthExceededError` rather than truncating.

---

## 3. Status vocabulary (the single deriver — ADR-0010 B3)

`Pending match run` · `Matched` · `Unmatched` · `Mismatched` · `Settled` · `Skipped` · `Error`

Batch: `Draft` → `In Review` → `Partially Settled` → `Completed`.
(`Completed with exceptions` is dropped — the three tabs show that directly.)

v2 → v3: `Reconciled` → `Skipped`; `Amount mismatch` → `Mismatched`; `Reference mismatch` →
**deleted**; `Control exception` → **deleted** (those rows are now `Unmatched`).

---

## 4. What is in the repo today (v2), and what happens to it

**Survives, essentially untouched — 195 passing tests, and the reason this reversal is affordable:**
`normalize.py`, `matcher.py`, `parser.py` (+ .xlsx), `candidates.py` (scope change only).

**Rewritten:** `status.py`, `outflowImportStatus.ts` (+ the FE↔BE parity test).

**Grows:** `settle.py` (the payment write path), `upload.py` (preview step, duplicate rules).

**Deleted:** `OutflowRowsTable.tsx`, `OutflowRowDetail.tsx`, `SettleExpensePanel.tsx`,
`ReconciliationReport.tsx`, `get_reconciliation_report`.

Existing files: services in `nirmaan_stack/services/outflow_import/`, endpoints in
`nirmaan_stack/api/outflow_import/`, frontend in `frontend/src/pages/outflow-import/`.
Three doctypes exist and are migrated: `Outflow Import Batch` · `Outflow Import Row` ·
`Outflow Row Match` (the last carries the DB unique constraint
`(transfer_id, target_doctype, target_name)` — that is the idempotency guarantee).

---

## 5. The screen (V4) — build it from the prototype

Three tabs **Pending · Settled · Skipped**, each a dense table on the app's existing conventions
(`DataTableColumnHeader` sort menu, funnel `Popover` faceted filters, row-selection checkboxes —
the **Design Tracker** table is the reference implementation).

Columns: Payment Date · Beneficiary (a/c + IFSC beneath) · Amount Paid · Remarks · Reference (UTR) ·
Status · **Outcome**. Bank a/c, IFSC and Time ship **hidden**, available from the Columns menu.

- Sort + filter on every column (facet / contains-text / min-max). **AND across columns, OR within.**
- One global search over remarks, reference and beneficiary, hit highlighted in the cell.
- **The Outcome cell is a real button** — border, hover lift, chevron. The owner's original complaint
  was that a clickable row does not read as clickable; a hover tint does not fix that.
- Clicking it opens the **decision dialog**: plain-English matching criteria as bullets, the four
  options each opening in place, link options as a **dropdown** that loads the chosen record's
  details (vendor, PO/SR number, project, approved-on, status, amount) plus an explicit
  *same amount ✓ / differs by ₹X ⚠* verdict, and the new-expense form.
- **The dialog owns its own scrollbar** — header and footer pinned, only the body scrolls. Scrolling
  the scrim instead pushes Confirm off-screen, which is the one control the dialog exists for.
- Exact-amount records sort first and are marked; pre-selected **only when there is exactly one** —
  two exact matches is ambiguity, and the screen never guesses between two real records.
- New-expense form: project selector filtered to `tendering_status = "Won"` (**a different field from
  `status`**; 100 live projects), **CEO-Hold projects shown disabled with the reason** (CEO Hold
  blocks all expense operations; hiding them makes their absence inexplicable), expense type scoped
  per ledger, amount/date/reference read-only from the bank row.
- Row checkboxes drive bulk Confirm / Skip. The bar reports how many selected rows are actually
  *decided* (`Confirm 4 decided` when 5 are ticked) — it never acts on an unresolved row.
- ⚠️ **Selection must never re-render the table body.** Rebuilding `<tbody>` replaces every checkbox
  element, so a second click lands on a detached node and is lost, and scroll + focus are thrown away
  on every tick. Toggle the row class and the bulk bar only. *(Found live in the prototype.)*

Won projects: a plain `useFrappeGetDocList("Projects", tendering_status = "Won")` — **no new
endpoint**. Expense types: the existing `get_expense_types(doctype)`.

---

## 6. Known limits, accepted with the numbers in hand

- **TDS payments will not match.** The bank sends `amount − tds`; exact-amount matching misses them,
  so they arrive as `Unmatched` and are handled by hand. Measured: **709 of 7,421 Paid payments
  (9.6%)** — ~15% for most of the past year, ~3% in Jun–Jul 2026. **No cheap workaround**: `tds` is
  written at fulfil time, so an approved unpaid payment has a blank TDS field and `amount − tds` has
  nothing to subtract. The tolerance pass (**Q11**) and the TDS box (**Q6**) are both **next version**.
- **No undo of a settle** from inside the import (Q9). Fix it in the payments screen.
- **Fan-out is report-only** (Q4) — one transfer settling several payments is reported, settled by
  hand. This is why the existing UTR duplicate guard is never challenged and stays as it is.
- **The settleable pool is near-empty today** (2 approved payments, 2 approved expenses) because
  people tick Paid immediately. Expected under Q12 — the pool exists when someone chooses the bulk
  route.

---

## 7. Migrate obligations

1. `Outflow Import Row.row_status` Select options (V0).
2. `Outflow Import Batch.status` Select options (V0 — drops `Completed with exceptions`).
3. ⚠️ **Existing dev rows carry retired status values** (`Reconciled`, `Control exception`,
   `Amount mismatch`, `Reference mismatch`). Nothing is in production and these are test batches, so
   the cleanup is a delete — but do it deliberately, do not discover it.
4. On top of debt already owed to teammates (4 new + 7 modified doctypes, 2 `[MIGRATE]` commits per
   the handover). Production is several migrates behind; one combined heads-up is owed.

**No new doctype and no new field** — `Outflow Row Match` already records what a row settled.

---

## 8. Testing — and what cannot be tested

- Backend: `FrappeTestCase`. Run one module:
  `bench --site localhost run-tests --app nirmaan_stack --module nirmaan_stack.api.outflow_import.test_review`
- Fast pure-layer run, no bench:
  ```
  docker exec -w /workspace/development/frappe-bench/apps/nirmaan_stack \
    frappe_docker_devcontainer-frappe-1 /workspace/development/frappe-bench/env/bin/python \
    -m unittest discover -s nirmaan_stack/services/outflow_import -t . -p "test_*.py"
  ```
- ⚠️ **Never run the bench suite and a browser session against localhost together** — they collide on
  the `tabSeries` naming lock.
- ⚠️ The `api` suites **write to the live dev DB** and purge in `tearDownClass`. If `setUpClass`
  raises, teardown never runs and residue survives — clean with `frappe.db.delete` on the three
  doctypes filtered to `source_file LIKE '%test-statement.csv'`.
- ⚠️ **There is no DOM test environment, by deliberate repo choice.** The table, the dialog and the
  selection behaviour are React semantics and are **structurally untestable** here. Only pure helpers
  get unit tests. **The honest verification for V4 is a live browser walk** — that method found five
  real defects in the prototype (wrapped cells, a listener killed by a non-Element event target,
  orphaned focus after a skip, selection lost to a body re-render, a dialog with no internal scroll)
  that no green suite could have seen.
- **Fixtures stay synthetic — the repo is public.** Real statements carry live beneficiary names,
  accounts and IFSC codes. Do not commit a real export.

---

## 9. First commands in a fresh session

```bash
cd .../apps/nirmaan_stack
git status --porcelain | grep outflow          # nothing is committed
open docs/outflow-import/screen-prototype.html  # the signed-off screen
```
Then read `docs/outflow-import/workflow.html` section 0 and
`frontend/.claude/plans/outflow-import-plan.md` §A–§F before writing a line.

**Start at V0 (the status vocabulary).** Everything else keys off it.
