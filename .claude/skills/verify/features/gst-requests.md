# GST Payment Requests

A Work Order's GST is paid as its own payment, and only through a GST Payment Request (ADR-0030). Anyone who may
request a payment sends one from the Work Order's Request Payment dialog (Pay for: GST); it holds that GST until an
Accountant, Accountant Lead or Admin decides it in Project Payment & Expense › GST Requests. Approving creates the GST
payment already Approved, at any amount, with no L1 or CEO step (ADR-0030 Amendment B, #1738), so it goes straight to
Payment need to paid; Admin-profile users get a for-information bell. Rejecting needs a reason, creates nothing and
frees the GST. Base payments, PO payments and expenses keep the amount rule (under ₹15,000 auto, ₹15,000-₹50,000 L1,
over ₹50,000 L1 then CEO).

Last walked (walk_gst_requests.py): 2026-11-24 UTC at 52f34a5c1, passed.

## Sub-features

- Raise: Request Payment › Pay for GST, held to GST left (`services/work_order_payment_limit.py`); the dialog's note
  says it goes to the Accountant and then is ready to pay. Over GST left, Send to Accountant stays disabled.
- Decide: GST Requests › Pending, Approve (dialog: no L1 or CEO approval) or Reject (needs a reason).
- The tab: status pills Pending / Approved / Paid / Rejected / All; a Reviewed column (who decided, when, also in the
  CSV) on every pill but Pending, at least 155px wide on All and Approved too; Actions on every pill but Approved,
  "—" where a row has no button; the vendor name opens the vendor card. Work Order IDs and Status payment IDs stay
  on one line (#1747).
- The payment: Approved, `approval_date` and `ceo_approval_date` stamped, `auto_approved` 0; counted at once in
  Payment Summary's Approved But not Paid; Admins (the CEO included, owner 2026-11-24) get "GST payment PAY-…
  approved by … from GPR-….", with no "Ready to pay: no L1 or CEO" line (#1747).
- Patch `v3_0.gst_payments_waiting_to_approved` (B2): a one-time move of GST payments left at Requested / CEO Pending
  by an approved request; dry run with `run --kwargs "{'dry_run': True}"`.

## How to get to it (user POV)

- Raiser (e.g. Procurement Lead): Work Orders › All WO › Approved WO › search by WO ID › the Work Order › Request
  Payment › Pay for GST › Custom amount › Send to Accountant.
- Accountant / Accountant Lead / Admin: Project Payment & Expense › GST Requests (its badge counts Pending).
- L1: Project Payment & Expense › Payment Pending Approval. CEO: Payment Pending CEO Approval.
- Paying it: Payment need to paid › Mark as Paid › Yes, mark as Paid, then Payment Done / Reconciliation Pending ›
  Mark Reconciled › receipt, UTR, date › Confirm Payment.

## Driving it with drive.py

`BIN/walk_gst_requests.py <env> <out dir>` walks it end to end. Its `setup` picks the Approved Work Order with the most
GST left (at least ₹1,00,000) that a Procurement Lead sees, and raises a ₹25,000 and a ₹10,000 request and a ₹20,000
base payment through the app's own calls; the ₹60,000 request is raised on screen. Locators that hold:
`button "GST Requests N"` and the other payment tabs are buttons named with their count; status pills are
`tab "Pending"` etc.; row actions are `button "Approve GPR-…"` / `"Reject GPR-…"`; the decision dialog is the page's
`alertdialog`, its reason box `#gst-reject-reason`; the Custom amount box is the number input beside `#custom`.

## Gotchas

- Each run uses up about ₹85,000 of a Work Order's GST; a fresh backup has few Work Orders with ₹1,00,000 left
  (2 on the 17 Nov 2026 backup), so a third run on one env may find none: reset the env.
- The Work Orders search box defaults to "Item in WO": switch its combobox to WO ID first.
- A Playwright regex with "/" (Payment Done / Reconciliation Pending) must use "." for the slash.
- Envs have no Gemini key: Mark Reconciled's receipt read fails ("Auto-fill failed"), then the UTR form shows.
- Envs serve no realtime (Socket.IO): the badge's live update across windows cannot be walked.
- A fresh env's vite compiles on first open; the first login may time out once.
