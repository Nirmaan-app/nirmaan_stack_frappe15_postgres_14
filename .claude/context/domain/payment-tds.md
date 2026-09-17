# Payment TDS — tax withheld, and the challan it is paid under

⚠️ **"TDS" HERE IS TAX DEDUCTED AT SOURCE.** This repo also uses "TDS" for **TECHNICAL DATA SHEET**
(`TDS Items`, `TDS Repository`, `Project TDS Setting`, the `/tds-repository` + `/tds-approval`
routes). Same three letters, unrelated concepts, different owners. A grep for `tds` lands on both
families and they must never be reconciled with each other.

Two halves: **withholding** the tax from a vendor payment (`services/payment_tds.py`, pre-existing)
and **paying** it to the department under a challan (this doc's additions, 2026-09).

---

## WHEN tax is withheld — an approval FROM AN EARLIER STEP, not any save into `Approved`

**The rule (#1288, retiring ADR-0022's "TDS on Approved" ruling; ADR-0022 Amendment A).** A deduction
is recorded when a Work Order payment is **approved from an earlier step**:

| Path | Records? |
|---|---|
| `Requested` → `Approved` | **yes** |
| `CEO Pending` → `Approved` | **yes** |
| `Rejected` → `Approved` | **yes** — a payment rejected before its first approval is still taxed |
| created already `Approved` (auto-approve below the threshold) | **yes**, via `after_insert` |
| `Reconciliation Pending` → `Approved` | no |
| `Paid` → `Approved` | no |
| anything else into `Approved` | no |

⚠️ **THE RULE IS A NAMED SET, NOT "anything except the settled statuses"** —
`payment_tds.APPROVAL_SOURCE_STATUSES`. A status inserted into the lifecycle later must be considered on
its merits rather than silently inheriting the tax.

**Why it changed.** "Any save into `Approved` withholds" was correct only while `Approved` could be
reached in one direction. The lifecycle gained `Reconciliation Pending` after it (#1282), and Bulk
Import's Unreconcile writes `Paid → Approved` — so an ordinary undo read as a fresh approval and
withheld the tax a SECOND time. Both bugs were reproduced on the local site through the real endpoints:
a payment with no tax row was netted 50,000 → 49,000 by an unreconcile, and a part payment's leftover
38,000 → 37,240 on top of the original's tax — after which the first line could not be unreconciled at
all ("Leftover taxed"), and **nothing in the app can remove a tax row**.

**Where it lives.** `payment_tds.is_approval_from_an_earlier_step(previous, new)` — pure, no database —
with exactly ONE call site, `controllers/project_payments.on_update`. ⚠️ **The insert path is
deliberately NOT routed through it**: an insert has no previous status, so the predicate answers False,
which is right for a transition and would be wrong for an insert. `after_insert` calls
`record_deduction_if_eligible` directly.

**Unchanged by this:** the bulk-approval exemption (`bulk_actions._record_bulk_deductions` deducts
post-commit, and bulk approve is itself an earlier-step approval), the `from_adjustment` exemption, and
tax already withheld — nothing here removes or restates an existing deduction.

**A CEO part-approval is the deliberate exception.** Its leftover waits at `CEO Pending` and is taxed at
its own approval, so a payment the CEO splits can carry one tax row per part. That is correct: each part
is paid only after its own approval. A leftover split off in **Bulk Import** is different — it never
passes through `Approved` again and never carries its own deduction; the tax stays withheld once, on the
original.

---

## Company-borne Work Orders — the payment is NOT reduced (owner ruling 2026-09-17)

A Work Order whose `service_category_list` holds **only** `Miscellaneous Services` and/or
`Transportation Services` still gets a deduction row at approval, but its payment keeps the requested
figure — the company pays the tax on top:

| | Request | TDS row | `Project Payments.amount` after approval |
|---|---|---|---|
| ordinary Work Order | 800 | 16 | 784 |
| company-borne Work Order | 800 | 16 | **800** |

- **"ALL", not "ANY"** — one other category (Electrical, …) makes it ordinary; no categories is ordinary.
- **ONE rule, `payment_tds.COMPANY_BORNE_CATEGORIES` + `is_company_borne`**, mirrored on the frontend by
  `tdsForecast.COMPANY_BORNE_CATEGORIES` + `isCompanyBorneWorkOrder`. Change both or neither.
- **Decided in `record_deduction`**, the one function every approval route shares (single approve, a
  split's approved half, auto-approve at insert, bulk approve post-commit) → `write_deduction(reduce_payment=False)`.
  `write_deduction` defaults to reducing, so the historical backfills are unchanged.
- **Every reader that rebuilds the gross branches on the same rule:** `amount_due` skips `total_tds`
  (`_item_billing_sync.recompute_document_amount_due`); an amount edit taxes the new figure directly
  (`tds = amount × rate`, no inversion); the WO page's Amount Paid / request cap don't add the tax;
  the approve + bulk-confirm previews show "Vendor receives" at the full amount.
- ⚠️ **DERIVED FROM THE CATEGORIES EVERY TIME, NOT STORED** (owner chose no new field). So the rule
  also re-reads deductions taken BEFORE it existed: measured 2026-09-17, **37 settled company-borne
  Work Orders** (₹65,182 of TDS, already netted) now read that TDS as still payable — on the WO page at
  once, in the stored `amount_due` at its next recompute — and the request cap allows it to be raised
  again. Changing a Work Order's categories later also moves how its existing deductions are read.

---

## The two doctypes

**`Payment TDS Deduction`** — one deduction, one payment.

| Field | Note |
|---|---|
| `project_payment` | Link → Project Payments. **UNIQUE, and that constraint IS the idempotency guarantee** — only the first qualifying approval can write a row, which is also what stops the amount being netted twice. |
| `gross_amount` | The amount BEFORE tax. ⚠️ The only surviving record of it: `Project Payments.amount` is rewritten to the net. |
| `tds_percentage` | The rate AS APPLIED, snapshotted. Never re-read from the vendor — 561 of 629 rows differ from their vendor's rate today. |
| `tds_amount` | `gross × rate / 100`. What `Service Requests.total_tds` sums (Paid payments only). |
| `payment_approved_on` | The day the payment was **approved** — the day this row was written, which is the approval that withheld the tax. Not "the day it last entered Approved": a later `Paid → Approved` save writes nothing (see the rule above) and moves nothing here. Renamed from `deducted_on` (2026-09-12). |
| `deducted_on` | ⚠️ **RETIRED, READ-ONLY, FROZEN.** The pre-rename copy, kept until the owner drops the column by hand. Nothing writes it, so rows created after the rename leave it empty — never read it as the live date. |
| `status` | `Pending` → `Paid`. Written by the Pay TDS action, never by hand. |
| `tds_challan` | Link → TDS Challan Attachment. |

**`TDS Challan Attachment`** — one ITNS 281 receipt.

Carries financial year, amount, mode of payment, bank + bank reference, date of deposit, BSR code,
challan no, tender date and the attachment.

- **Duplicate key: Amount + Bank Reference Number + BSR Code + Challan No.** All four matching means
  the same receipt uploaded twice. The site is Postgres (case-sensitive), so the text parts are
  trimmed and the bank reference upper-cased before the lookup.
- `bsr_code` / `challan_no` are **Data, not Int** — both carry meaningful leading zeros (`00069`).
- `reconciled_amount` is **read-only and server-owned** (see below). Remaining balance is
  `amount - reconciled_amount`, derived at the point of use, never stored.

**`Project Payments.payment_tds`** — Link → Payment TDS Deduction, **read-only**. A MIRROR, not the
authority: `project_payment` above is the real link. The service writes it when the deduction is
recorded and repairs it on the next save if blank. ⚠️ The self-heal only fills a BLANK one; it does
not correct a wrong value.

---

## `reconciled_amount` — the one rule, and the bug it already caused

**A challan's `reconciled_amount` IS the sum of the deductions pointing at it.** It is always
**RECOMPUTED FROM SOURCE, never adjusted by a delta** — a `+=` on pay and a `-=` on delete would be
two arithmetic paths that must agree forever.

The rule lives in **`services/payment_tds.recompute_challan_reconciled`** — in the service, not in
`api/`, because a CONTROLLER must be able to call it and a controller may not import from `api/`.
It is the **only writer** of that field.

Three callers, and none is redundant:

| Caller | Covers |
|---|---|
| `api/tds_challan/pay_tds` | Paying. Adds its own over-application guard before writing. |
| `controllers/project_payments.on_trash` | The payment cascade, which deletes the deduction with **raw SQL that fires no hooks**. |
| `controllers/payment_tds_deduction.on_trash` | A doc-layer delete (Desk, REST) — the route the raw delete bypasses. |

⚠️ **MEASURED BUG (2026-09-15), fixed:** deleting a payment deleted its deduction, but nothing
recomputed — a challan sat at ₹150 used with **zero** deductions behind it, permanently ₹150 short
of usable balance. That is what the second and third callers exist for.

---

## Paying — `api/tds_challan/pay_tds.py`

- `pay_tds(deductions, challan)` — spend an existing challan's balance.
- `create_challan_and_pay(deductions, challan_data)` — mint the challan and pay in the **same
  transaction**, so a challan is never left created-but-unused.

Both take a `SELECT ... FOR UPDATE` lock on the challan **before reading anything**, then re-check
every selected deduction inside that lock (still Pending, still unlinked). ⚠️ **The client's total
is never trusted** — the amount is summed from the database rows, because the browser's figure was
computed before the lock existed. A selection exceeding the challan's remaining balance is refused,
naming the shortfall; there is **no partial payment and no splitting one deduction across two
challans**.

---

## Editing a payment that already carries a deduction

⚠️ **THE EDITED AMOUNT IS THE NET.** Once a deduction exists, `Project Payments.amount` IS what left
the bank, so an edit to it is an edit to the net. `restate_deduction_on_amount_change` re-derives:

```
gross = net / (1 - rate/100)        tds = gross - net
```

at the deduction's **own snapshotted rate**, then recomputes the challan and re-syncs the parent's
`total_tds`.

- ⚠️ **It must NOT re-net the payment.** `write_deduction` rewrites `amount` once, at creation;
  doing it again would shrink the payment on every edit, compounding.
- ⚠️ **It sits ABOVE the status early-return in `on_update`**, which returns when the status has not
  changed — an amount edit changes no status, so everything below that line is unreachable for it.
  Same placement reason as the `after_insert` call.
- A **raise** that would over-apply a challan already paid is **refused**, aborting the edit. A
  reduction always fits.

---

## Reading the challan off a receipt (Gemini)

`doc_kind="tds_challan"` on the shared `services/extraction/` seam plus
`api/tds_challan_autofill.extract_challan_fields`. Nothing is persisted — the response fills a form
the user corrects.

- `bsr_code` / `challan_no` stay **strings** so leading zeros survive.
- `mode_of_payment` is **snapped to the doctype's Select options**, else blank — an unrecognised
  value fails Frappe's own option check on insert.
- ⚠️ The extracted **amount is cross-checked against the receipt's own tax breakup**, because that
  figure becomes the ceiling on what can be paid against the challan; a misread would cap every
  later payment silently. The financial-year check is format-only, so an Assessment-Year misread
  (`2026-27`) passes it — the prompt and the amber tint are the only guards there.

---

## Frontend

Reports hub → **Payment TDS Deduction** tab (report type "TDS Deduction"), gated by
`PAYMENT_TDS_ACCESS`. `/payment-tds-deductions` redirects into it.

- Checkbox selection is limited to **Pending** rows; a paid row's checkbox is disabled and
  select-all skips it. ⚠️ Turning selection on also re-aims **Export** at the selection (the shared
  DataTable gates both on one prop).
- **Pay TDS** button carries the count and rounded total; the dialog has two arms — old challan, or
  upload → Gemini → create + pay. The upload shows the drop zone alone until a file lands: a failed
  **upload** keeps the form hidden (no receipt, no challan), a failed **read** opens it blank with
  the reason.
- **View Challans** lists every challan *including fully-used ones* — the picker answers "what can I
  pay from?", this answers "what have we deposited?".
- Project / Payment / Gross / Net columns are **hidden by default**, not deleted (⚠️ hiding `project`
  also removes its facet dropdown).

---

## Patches

| Patch | Does |
|---|---|
| `rename_deducted_on_to_payment_approved_on` | Copies the dates across. **Drops nothing** — the owner drops the old column by hand. |
| `backfill_payment_tds_deduction_link` | Fills `Project Payments.payment_tds` for the 626 existing rows. |

Both are idempotent and fill only what is still empty.

---

## Testing — reach the tax code, or you test nothing (#1284)

⚠️ A payment planted by raw SQL with **no vendor** can never be taxed (`is_deductible` needs one), so
a suite built that way cannot see a tax bug. The Bulk Import and payment-split suites were built that
way, and that is how the double-TDS bugs in #1283 went unseen.

Use **`api/payments/taxed_work_order_fixture.TaxedWorkOrderFixture`**: a Service Request payment with a
2% vendor, approved through the real `ceo_approve_payment`, so the deduction row and the netted amount
come from production code (50,000 → 49,000 by default). It refuses to return a payment with no tax row,
and `attach(test)` registers a purge that also sweeps split leftovers minted under its projects. Pinned
by `api/payments/test_taxed_work_order_fixture.py`.

---

## Known gaps

- **No reversal or unlink path.** A deduction is deleted with its payment; nothing detaches one from
  a challan. Any future unlink must reuse `recompute_challan_reconciled`, never subtract.
- The mirror self-heal fills a blank, not a wrong value.
- A challan that drifted before the fix stays wrong until something is paid against it (the pay path
  recomputes). One such row exists on localhost by owner decision.
- Gemini challan extraction has never run against a real challan file; none of the UI has been
  verified in a browser.
- The TDS register's **Net Paid** column is still `gross − tds`, so a company-borne row reads 784 where
  the vendor received 800.
