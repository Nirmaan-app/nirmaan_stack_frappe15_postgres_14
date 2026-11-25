# Work Order invoice auto-approval

The System approves a Work Order (WO) invoice by ADR-0050's three rules, whoever uploaded it (ADR-0014 Amendment C):
a generated invoice's signed copy (rule 1), Approved WO invoices + this one = the WO total (rule 2), or = its
Amount Paid incl. TDS (rule 3), each ± ₹1. On the WO page's Invoices card, Upload signed copy approves the copy at
once, and Add Invoice of a generated invoice's number links the upload to it and approves it when the AI finds the
"Authorized Signature" box signed or stamped; found empty, the dialog warns above its button and rules 2 and 3
decide. When nothing matches, the invoice waits in Pending Invoice Approvals and its *Not Auto-Approved Reason* says
why, with the figures.

## Sub-features

- `upload` WO page › Invoices card › generated invoices › Upload signed: the toast reads "<number> is approved by
  the System as VI-…"; the generated invoice leaves its table (Approved ones are hidden) and its Vendor Invoice row
  reads Approved. DB: Approved, `approved_by` System, `auto_approved` 1; the record Approved.
- `add_signed` Add Invoice whose AI-read number is a generated invoice still Generated, amount ± ₹1, signature
  signed or stamped: the same outcome as `upload`.
- `add_unsigned` the same with the box empty, amounts matching neither rule: the dialog shows "Generated invoice not
  signed" above its button, which stays enabled; the generated invoice reads Signed, its Vendor Invoice Pending,
  reasons "Generated invoice not signed" (`wo_generated_copy_not_signed`) first, then the WO total
  and Amount Paid ones with their figures.
- `add_unsigned_match` the box empty, and Approved invoices + it = the WO total (rule 2) or Amount Paid (rule 3):
  the same warning, then approved by the System as for `upload`. Walked with the WO's FINAL, after every Pending
  invoice on the WO is rejected and every generated one not uploaded voided (`BIN/wo_invoice_auto_approve_match_setup.py`).
- `add_ordinary` Add Invoice of any other number matching neither rule: Pending, reasons "Invoices + this ₹X ≠ WO
  total ₹Y" and "… ≠ Amount Paid ₹Z" (`wo_total_mismatch:<Y>:<X>`, `wo_paid_mismatch:<Z>:<X>`); the hover card's
  footer says the WO figures are checked again daily at 5 AM.
- `duplicate` Add Invoice of a number already Signed or Approved is refused (pinned by
  `api/service_requests/test_add_invoice_signed_copy`, not walked).
- `daily` the 05:00 re-check approves a Pending WO invoice that now matches, an unsigned copy included (and, by
  rule 1, a signed copy left Pending before ADR-0050 while its WO is GST-off; rules 2 and 3 once it turned GST-on), or
  rewrites its reasons (pinned by `api/invoices/test_wo_auto_approve.TestTheDailyRecheck`, not walked: it runs on the
  scheduler).
- `recheck` Pending Invoice Approvals › WO › Not Auto-Approved Reasons › Re-check (or a row's hover › Re-check), as
  an Accountant: the same check now, preview first; each invoice it will approve names its rule ("Rule 2 · invoiced
  ₹X = WO total ₹Y") (pinned by `api/invoices/test_wo_auto_approve.TestReCheckOnTheWorkOrderTab`, not walked yet).

## How to get to it (user POV)

- A Procurement Executive (may upload, may not approve): sidebar Work Orders › All WO › choose "WO ID" beside the
  search box › the WO's link › the Invoices card (Add Invoice; the generated invoices table's Upload signed).
- An Accountant: sidebar Vendor Invoice Recon › Pending Invoice Approvals › WO, the search box by PO/SR number, then
  the row's *Not Auto-Approved Reason* cell and its hover card.

## Driving it with drive.py

- **Whole walk.** `python3 BIN/walk_wo_invoice_auto_approve.py --task <task> --user <procurement email> --password
  <pw>`. It sets that password for the procurement user and `walk-accountant@example.com` on the env, runs
  `BIN/wo_invoice_auto_approve_seed.py` (three new generated invoices on an Approved GST-off WO the user can see),
  walks every sub-feature but `duplicate` and `daily`, reads the DB with `BIN/wo_invoice_auto_approve_db.py`, and
  exits 1 on any miss. For `add_unsigned_match` it runs `BIN/wo_invoice_auto_approve_match_setup.py` (the made-up
  Accountant rejects every Pending invoice on the WO, generated invoices not uploaded are voided, and the WO's FINAL
  is generated for the rest of its total), so run it on a throwaway env.
- Pick the procurement user with `DEVENV script <task> BIN/free_users.py "Nirmaan Procurement Executive Profile"`.

## Gotchas

- **The env has no Gemini key.** The walk answers the browser's `extract_invoice_fields` call itself (a Playwright
  route) with the number, amount and signature answer for the file it picked; the upload, the save, the link and
  the System's decision run on the env's backend.
- **A file must be a readable PDF, with bytes of its own.** The upload refuses anything else, and Frappe reuses the
  URL of a File with the same bytes; the walk writes one small PDF per number.
- **The WO list opens on New WO**, and its search box searches service descriptions until "WO ID" is chosen.
- **The Pending tab searches by PO/SR number**, not invoice number: search the WO, then find the invoice's row.
- **Every run adds invoices to a WO and ends by billing it in full** (the FINAL of `add_unsigned_match`), so the next
  run's seed takes another Approved GST-off WO with room left.
- **Add Invoice is greyed for about a second** after the number fills in, while the dialog's duplicate-number check
  runs; wait for it before reading the button.
