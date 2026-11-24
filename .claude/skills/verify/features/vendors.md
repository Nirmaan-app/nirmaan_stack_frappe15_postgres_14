# Vendors

A vendor's page (`/vendors/<id>`) has a tab row: Overview, Vendor Ledger, Material Orders, Work Orders (a vendor that
takes service work), Payments, Cheques and more. Since PR #1731 its Work Orders tab downloads a PDF of what it shows,
the Work Order lists link each Project and Vendor cell to its page, and New / Edit Vendor hold the vendor's MSME
(Udyam) ID and certificate. Since PR #1732 its Payments tab splits the vendor's payments into three sub-tabs, and a
Cheques tab shows the Cheque Tracker narrowed to this vendor, read-only for PMO.

Last walked (walk_vendor_payments.py): 2026-11-23 UTC at 4fb4ccdea, passed.

Last walked (walk_vendor_cheques.py): 2026-11-24 UTC at 52f34a5c1, passed.

Last walked (walk_vendor_work_orders.py): 2026-11-23 UTC at 4fb4ccdea, passed.

Last walked (walk_vendor_msme.py): 2026-11-24 UTC at eb86b4b67, passed.

## Sub-features

- `wo_pdf` Vendor › Work Orders: sub-tabs All WO / Approved WO / Finalized WO with counts (Approved Service
  Requests, split by `is_finalized`). Download PDF saves the "Vendor Work Orders" print format of the open sub-tab,
  `<vendor name>_All_WO_<date>.pdf`, titled `VENDOR WORK ORDERS – ALL`, one row per WO.
- `wo_links` Work Orders (sidebar) and the vendor's Work Orders tab: the Project cell has an ⓘ link to
  `/projects/<id>?page=overview`, the Vendor cell one to `/vendors/<id>`; on the vendor's own page the Vendor ⓘ is
  hidden.
- `msme` Edit Vendor › MSME Details: a certificate upload and an MSME ID (`UDYAM-XX-00-0000000`). An ID without a
  certificate is refused with "Upload the MSME certificate for this MSME ID.", a certificate without an ID with "Enter
  the MSME ID from the certificate." Overview shows MSME ID (`--` when none), a link opening the certificate in a new
  tab.
- `msme_read` picking the certificate uploads it and asks Document AI (`api/vendor/msme_autofill.extract_msme_fields`)
  to read it and fill the MSME ID. Not walkable on an env (see Gotchas).
- `msme_cancel` the certificate is attached to the vendor on Update only (#1736): picked in Edit Vendor and then
  cancelled, it leaves no file on the vendor and the MSME fields empty.
- `payments` Vendor › Payments: sub-tabs Paid (status Paid), Cheque Pending (a Cheque payment at Reconciliation
  Pending) and Other Pending Payments (the rest), each with a count, a ₹ total (Other leaves Rejected out) and its
  own table. Rules: `frontend/src/utils/vendorPayments/paymentGroups.ts`. Counts follow the user's project filter.
- `cheques` Vendor › Cheques: tabs All Cheques / Cheque Issued – Reconciliation Pending / Security Deposits with
  badges, the summary strip (All, Approval Pending, Issued, Cleared, Cancelled) and one row per cheque. Row buttons by
  role (`utils/cheques/chequeRowActions.ts`): Admin, Accountant and Accountant Lead get View, Edit and (on an Issued or
  Approval Pending cheque) Cancel; Procurement gets Edit only on its own open cheque; PMO gets View only.
- `pmo` PMO opens the Cheques tab and a cheque's details (the read endpoints let it in), with no Edit or Cancel and
  no Cheque Tracker in its sidebar.
- `cheque_header` Cheque Tracker and a vendor's Cheques tab: the `Cheque/Payment Date` header is 185 px wide on two
  lines (#1747; 160 before), its words and its sort arrow inside its cell, clear of Issue Date's filter.

## How to get to it (user POV)

Accountant, Accountant Lead and Procurement: sidebar `Vendors`. Admin and PMO: sidebar `Admin Options` -> `Vendors`
(a sub-item). Then type the vendor's name in `Search by name...` and open its row's link. On the vendor's page the
tabs are buttons (`Work Orders`, `Payments`, `Cheques`); Edit Vendor is `Edit Vendor Details` on Overview. The Work
Order list is sidebar `Work Orders` -> `All WO <n>`.

## Driving it with drive.py

Each walk takes the env and an evidence folder, picks its users and records from the env DB at the start, sets the
walk password on the env only, and exits 0 only when every claim it walked passed:

```bash
python3 -I BIN/walk_vendor_work_orders.py <env> <out>   # wo_pdf, wo_links (Admin)
python3 -I BIN/walk_vendor_msme.py <env> <out>          # msme, msme_read, msme_cancel (Admin; writes two vendors)
python3 -I BIN/walk_vendor_payments.py <env> <out>      # payments (Admin, Accountant, Procurement Lead, PMO)
python3 -I BIN/walk_vendor_cheques.py <env> <out>       # cheques, pmo, cheque_header (Admin, Accountants, Proc. Lead, PMO)
```

Name functions after `<out>` to run only those (`wo_pdf wo_links`, `msme msme_cancel`, `payments_admin
payments_roles`, `cheques_admin cheques_roles pmo_view cheque_header`); such a run leaves the stamps below alone. They build on
`BIN/feature_walk.py`, the helper every graduated walk shares: the env DB read (`db/` under the out folder), one
unlocked user per role (`users.json`), the sidebar way to a vendor (`open_vendor`), and the PDF renderer. Every
expected number (sub-tab counts and totals, cheque badges and strip, WO ids) is read from the env DB for the walking
user.

## Gotchas

- **The env's Document AI key is refused.** The env DB is a copy of production's, whose stored Gemini key does not
  decrypt to a working key on an env: Google answers 401 "API key not valid", the read call answers 417 "Document
  extraction failed", and the form says "The certificate could not be read. Type the MSME ID yourself." The MSME
  walk then reports `msme_read` not walked with that answer and walks the rest by typing the ID. Never add a key to
  an env yourself.
- **Picking the certificate uploads it unattached**; Update attaches it to the vendor (`Vendors._attach_msme_file`).
  A cancelled pick leaves an unattached private File behind. Each MSME run uses up two vendors with no MSME ID, no
  certificate and no attached file, newest first.
- **The vendor's Work Orders table renders only the rows near the viewport.** Count rendered rows, not the
  footer's `of N`, when checking a per-row control; the footer's total is the sub-tab's count.
- **A Vendors search matches by name**: open the row by its `href` (`/vendors/<id>`), as two vendors can share a name.
- **A Procurement user's payment counts are its projects' only** (its user permissions); compare with
  `frappe.get_list` as that user, as `walk_vendor_payments.py` does.
