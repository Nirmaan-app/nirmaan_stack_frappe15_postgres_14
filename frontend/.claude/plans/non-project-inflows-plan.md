# Non-Project Inflows + direction-split import tabs — build plan

Date: 2026-09-14 · Status: **PLAN — awaiting owner go; no code written**

Decision record: `docs/adr/0016-bank-statement-import-creates-inflows.md` **Amendment A**.
Glossary: root `CONTEXT.md` § Inflows. Grill: `/grill-with-docs` 2026-09-14, Q1–Q15 + edit-permission ruling.

## Owner rulings (the contract)

| # | Ruling |
|---|---|
| Q1 | Six tabs: All · Not Matched – Outflow · Partly Allocated – Outflow · Matched / Settled – Outflow · Not Matched – Inflow · Settled – Inflow |
| Q2 | Inflow tab is "Settled – Inflow" (a credit never becomes Matched). Outflow keeps "Matched / Settled – Outflow" with both counts. Rows shown inside each tab are unchanged. |
| Q3/Q10 | Inflow Type = Interest Payouts · FD Closures · Loan Received · Others. Vendor refunds and labour advance returns → Others until their own workflow. |
| Q4 | Description field; required when type is Others. |
| Q5 | No status — counts on save. |
| Q6 + final | Create: Admin, Accountant, Accountant Lead. Edit: Admin + Accountant Lead. Delete: Admin. Sales roles cannot see it. |
| Q7 | Remove the negative-expense option **only from the Bulk Import decision dialog**. Manual expense dialogs and the existing negative rows are untouched. |
| Q8/Q11 | Separate "Non-Project Inflow (30 days)" figure on the payments dashboard, never netted; visible wherever the card is (scope later). |
| Q9 | Remove the receipt card **and** its endpoint, service and tests. Keep the read side. |
| Q12/Q14 | Link bank row → record via `Outflow Row Match` only. **No new field on any doctype.** |
| Q15 | Every field stays editable on an import-created record; audit trail is the control. |

Assumptions not challenged: blank direction = Outflow; default tab = Not Matched – Outflow; inflow tabs hidden
when the source filter is Cashfree or Cashbook; name series `NPI-.YY.-.#####`; Description prefilled from payer +
bank remarks in the import dialog; sidebar item "Non-Project Inflows" under "In-Flow Payments" at
`/non-project-inflows`; the Reports "Inflow Report" stays Project-Inflows-only; CEO Hold / project / customer
rollups never read the new doctype.

## Slices (one commit each, in order)

### S1 — Direction-split tabs (independent of the doctype)
- Backend `api/outflow_import/review.py`: scope becomes `(status set, direction class)`. Direction class is
  the SAME predicate as `status.is_received_direction` (`TRIM(direction) = 'Credit'` → inflow, else outflow) —
  one SQL fragment, never a second definition. `_tab_counts` groups by status **and** direction class.
  New scopes: `not_matched_out`, `partly_out`, `matched_out`, `not_matched_in`, `settled_in`; keep `all` and
  `skipped`. Old scope names map to the outflow variant (fail-safe for a stale client).
- Frontend `outflowTableModel.ts`: `OutflowTab` / `OUTFLOW_TABS` / `SCOPE_FOR_TAB` / `DEFAULT_TAB`;
  `tabCountParts` — "Settled – Inflow" shows the settled count only. Hide the two inflow tabs when the
  selected source cannot carry a credit (derive from the sources table, not a hardcoded name list).
  `OutflowMasterPage.tsx` post-import `location.state.outflowTab` seeding maps to the new ids.
- Tests: `test_review.py` scope + count cases (credit/debit/blank × each status); `outflowTableModel.test.ts`.

### S2 — `Non Project Inflows` doctype
- New doctype (`bench new-doctype`, then Desk): Inflow Details section copied from `Project Inflows`
  (`utr` Text, `inflow_attachment` Attach, `amount` Currency, `payment_date` Date) + `inflow_type` Select
  + `description` Text. `autoname` `NPI-.YY.-.#####`, `track_changes: 1`.
- Role perms: Nirmaan Accountant = read + create (no write); Accountant Lead = read/create/write;
  System Manager / Admin = all incl. delete. Sales roles: none.
- Doctype `.py` holds only a simple `validate`: `amount > 0`; `inflow_type` in the four values;
  `description` required when Others.
- `bench --site localhost migrate`; verify `frappe.db.has_column`. Real unit tests for the validate rules.

### S3 — Import backend: create a Non-Project Inflow from a credit row
- `services/outflow_import/settle.py`: `create_non_project_inflow_from_row` (credit-only, magnitude > 0,
  type + description rules, `utr = settlement_reference`, positive `amount`, `payment_date = added_on_date`,
  statement attachment). Delete `create_non_project_receipt_from_row`.
- `api/outflow_import/inflows.py`: `create_non_project_inflow(row, inflow_type, description=None)` — same
  pipeline as `create_inflow` (access → load settleable row → credit guard → duplicate guard → savepoint →
  create → `_record_settlement` → allocation refresh → rollup → commit → attach). Delete
  `create_non_project_receipt`.
- Ledgers: add the doctype to `ledgers.RECEIVED_LEDGER_DOCTYPES` / `LEDGER_NOUNS`, the settle attachment-field
  map, and the credit-side contains pool (`contains_guard` / `candidates.load_recorded_by_contains`, on `utr`)
  so both the match-run skip and `_guard_not_already_recorded` see it. **Keep** `Non Project Expenses` in the
  read-side ledgers and `allocated_of`'s `abs()` — rows written by the old path may exist.
- Tests: port the receipt cases in `test_inflows.py` to the new endpoint; add contains-guard cases in
  `test_contains_guard.py` / `test_status.py`; delete receipt-only tests.

### S4 — Import frontend: replace the receipt card
- `outflowTableModel.ts`: target `"receipt"` → `"nonProjectInflow"` in `availableDecisionTargets` and
  `isConfirmable` (needs credit row + type + description-if-Others); remove `receiptStoredAmount`;
  `settlementLink` routes the new doctype to `/non-project-inflows`.
- `DecisionDialog.tsx`: `NewNonProjectInflowForm` replaces `NewReceiptForm` (type Select, Description
  prefilled payer + remarks, amount/date/reference read-only). Copy no longer says "negative expense".
- `OutflowMasterPage.tsx` `settleOne`: dispatch to the new endpoint.
- Tests: `outflowTableModel.test.ts` confirm-gate cases.

### S5 — Non-Project Inflows screen
- `pages/non-project-inflows/`: list page modelled on `inflow-payments/InFlowPayments.tsx` minus
  Project/Customer/Invoice columns; plus Inflow Type (facet) and Description. Sum aggregate, CSV export,
  summary card. New dialog (receipt upload + `payment_autofill.extract_payment_fields`), Edit dialog,
  Delete (Admin only).
- Route `/non-project-inflows` behind a new guard (Administrator, Admin, Accountant, Accountant Lead).
  Sidebar item under "In-Flow Payments" (same audience). "Add" button in `renderRightActionButton`;
  dialog flags in `useDialogStore`. Edit/Delete buttons gated per Q6-final.
- vitest for any pure helpers.

### S6 — Payments dashboard figure
- `api/payments/get_project_payment_summary.py`: `total_non_project_inflow_30_days` beside the project inflow.
- `ProjectPayments/PaymentSummaryCards.tsx`: a separate figure; never subtracted from outflow.
- **Built in #1267.** Keys `total_non_project_inflow_30_days_count` / `_amount` (inclusive `today-29` window, no
  status filter). Card: "Project Inflow" (relabelled from "Total Inflow", which would have read as both) and
  "Non-Project Inflow" rows under *Inflow (30 Days)*; a third mobile tile; a `Non Project Inflows` realtime
  listener refetches the card. Tests: `api/payments/test_payment_dashboard_stats.py` (4, delta-based on the live
  site: window boundary at -29/-30, outflow and project inflow untouched). Live-checked: +₹4,321 shown with no
  reload, outflow unchanged, back to ₹0 after delete; 400px layout fits.

### S7 — Docs
- `.claude/context/domain/outflow-import.md`: fix the stale three-tab "The screen" section; ICICI section
  "credit becomes a Project Inflow or a Non-Project Inflow".
- `outflow-duplicate-skip-plan.md` FW1 → done. `bank-statement-ingestion-plan.md` Q3 → superseded pointer.
- Reference doc for the new doctype (or a section in an existing domain doc). No CLAUDE.md changelog.

## Gates per slice
`python3 scripts/residence_check.py` · the touched bench suites (`bench --site localhost run-tests --module …`)
· `yarn test` for frontend slices · `tsc` · a live browser walk for S1, S4, S5 (the JSX is untestable in vitest).

## Known risks (from Amendment A)
- AR1 vendor refunds in Others do not reduce any PO/vendor paid amount.
- AR2 old negative Non-Project Expenses coexist with the new doctype.
- AR3 an import-created inflow cannot be deleted from the screen (Frappe link check) or undone by the import.
