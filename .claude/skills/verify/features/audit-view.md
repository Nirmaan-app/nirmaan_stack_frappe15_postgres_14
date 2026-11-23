# Audit View

Reports -> Audit View (#1732) lists every order, approved invoice and paid payment in a date range, for Admin,
Accountant and Accountant Lead only. The user picks a range first; then the Orders, Invoices and Payments tabs each
carry a count, and Payments shows Amount Paid + TDS = Net Paid. The server's `get_audit_view_rows` and
`get_audit_view_summary` (`nirmaan_stack/api/reports/audit_view.py`) select the rows and enforce the roles.

Last walked (walk_audit_view.py): 2026-11-23 UTC at 590375af0, passed.

## Sub-features

- `audit` the Audit View tab shows for Admin, Accountant and Accountant Lead, and not for Procurement Lead or PMO.
  After a range is picked, each tab's count equals the server's summary for that range, and Payments' Amount Paid,
  TDS and Net Paid equal the server's to the rupee, with Net Paid = Amount Paid + TDS.

## How to get to it (user POV)

- Sidebar `Reports` -> the `Audit View` button -> the date box (it reads `ALL`) -> a preset such as `FY 26-27` ->
  Escape. Then the `Orders`, `Invoices` and `Payments` tabs, and `Show details`.

## Driving it with drive.py

- **Whole walk.** `python3 -I BIN/walk_audit_view.py <env> <out dir>`. It reads the FY 26-27 summary from the env
  DB first (`<out dir>/db/`), walks the report as an unlocked Admin, then opens Reports as an Accountant, an Accountant
  Lead, a Procurement Lead and a PMO. Parts: `audit_admin`, `audit_roles`; a part run leaves the stamp alone.
- **Tab counts.** `get_by_role("tab")`; each reads `Orders 1,702` at desktop width (a phone shows `1.7K`).
- **Payments figures.** The page text holds `AMOUNT PAID ₹… + TDS ₹… = NET PAID ₹…`.

## Gotchas

- The date box says `ALL` before a range is picked, yet the tabs stay locked until one is: pick a preset.
- The date picker's Apply stays disabled after a preset: press Escape.
- The screen rounds Amount Paid, TDS and Net Paid each to the rupee, so the shown sum can be ₹1 off the shown
  Net Paid (on the 2026-11-17 backup: ₹11,58,07,752 + ₹1,88,030 shown against ₹11,59,95,783). The walk holds the
  formula to the server's figures in paise.
