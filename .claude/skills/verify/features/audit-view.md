# Audit View

Reports -> Audit View (#1732) lists every order, approved invoice and paid payment in a date range, for Admin,
Accountant and Accountant Lead only. The user picks a range first; then the Orders, Invoices and Payments tabs each
carry a count, and Payments shows Amount Paid + TDS = Net Paid. #1736 renamed the Report Types, kept the type, range
and tab across a refresh, replaced "Show details" with summary cards, and matched the columns to the Payments page. The server's `get_audit_view_rows` and
`get_audit_view_summary` (`nirmaan_stack/api/reports/audit_view.py`) select the rows and enforce the roles.

Last walked (walk_audit_view.py): 2026-11-23 UTC at 4fb4ccdea, passed.

## Sub-features

- `audit` the Audit View tab shows for Admin, Accountant and Accountant Lead, and not for Procurement Lead or PMO.
  After a range is picked, each tab's count equals the server's summary for that range, and Payments' Amount Paid,
  TDS and Net Paid equal the server's to the rupee, with Net Paid = Amount Paid + TDS.
- `labels` Report Type offers `Projects Data` and `Non Projects Data` (the values stay `All Project View` and
  `Non Project View`, so old links work).
- `datebox` the date box reads `Pick a date range` until a range is picked, and again after Report Type changes;
  the open tab is cleared with it.
- `refresh` a refresh keeps the report type, the range (ALL too: `audit_range=1` in the URL) and the open tab.
- `cards` no `Show details`. The cards above the table: in Projects Data the first is named after the tab (Orders,
  Invoices, Payments) and splits its amount by type; in Non Projects Data it is `Top expense types`. No %.
- `columns` Type is the pill with the expense type under it; Against is the PO / WO number or an expense's
  description (first line); on Invoices, `Invoice No.` is the second column.

## How to get to it (user POV)

- Sidebar `Reports` -> the `Audit View` button -> the date box (it reads `Pick a date range`) -> a preset such as
  `FY 26-27` -> Escape. Then the `Orders`, `Invoices` and `Payments` tabs. `Report Type` above switches between
  Projects Data and Non Projects Data.

## Driving it with drive.py

- **Whole walk.** `python3 -I BIN/walk_audit_view.py <env> <out dir>`. It reads the FY 26-27 summary from the env
  DB first (`<out dir>/db/`), walks the report as an unlocked Admin, then opens Reports as an Accountant, an Accountant
  Lead, a Procurement Lead and a PMO. `audit_steps` switches Report Type, refreshes with ALL picked, and comes back
  from another report. Parts: `audit_admin`, `audit_steps`, `audit_roles`; a part run leaves the stamp alone.
- **Date box.** A button whose text is `Pick a date range`, `ALL`, a preset or a range; `Report Type` is the first
  combobox in `main`.
- **Tab counts.** `get_by_role("tab")`; each reads `Orders 1,234` at desktop width (a phone shows `1.2K`).
- **Payments figures.** The page text holds `AMOUNT PAID ₹… + TDS ₹… = NET PAID ₹…`.

## Gotchas

- **Known since #1736, fixed in a follow-up PR:** searching by ID finds no expense (the ID column holds the
  description), and coming back to Audit View from another report with `audit_range=1` still in the URL skips
  steps 1 and 2. The walk checks both as `should`, so they show without failing it.
- The date picker's Apply stays disabled after a preset: press Escape.
- The screen rounds Amount Paid, TDS and Net Paid each to the rupee, so the shown sum can be ₹1 off the shown
  Net Paid (for example ₹100.40 + ₹0.40 shows as ₹100 + ₹0 against ₹101). The walk holds the
  formula to the server's figures in paise.
