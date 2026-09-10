# 21. The statement import records no tax

Date: 2026-09-10

## Status

**Accepted.** Supersedes the slice-TD owner rulings **T-R1 / T-R2 / T-R4 / T-R5 (2026-08-12)**,
which are hereby retired.

Build record: this repo's working tree. As-built detail:
`.claude/context/domain/outflow-import.md` § *"⚠️ REMOVED: recording the shortfall as TDS"*.

Direct precedent: **[ADR-0015](0015-cashbook-import-creates-expenses.md)** and
**[ADR-0016](0016-bank-statement-import-creates-inflows.md)**, which scope this module's prime
directive per source and per direction. This one scopes it per **fact recorded**: the import settles
money that moved; it does not record tax.

## Context

Bulk Import Outflow's mismatch dialog asked the reviewer a question with two answers. A transfer
short of the record it matched is **either** a part payment (the balance is still owed) **or** a
deduction such as TDS (nothing more is owed, the difference was withheld). Nothing stored on the
payment separates them, so a person declared which it was.

Slice TD (2026-08-12) made the second answer actionable: on a `Service Requests` payment whose
shortfall landed in a measured 0.95–2.05% band, the import derived `tds = amount − bank`, wrote it to
the legacy **Data** column `Project Payments.tds`, left `amount` GROSS, and marked the payment Paid.
The invariant it maintained was `bank = amount − tds`, matching `_fulfil_payment`.

**Then SR tax withholding moved upstream.** `services/payment_tds.py` now fires on the transition
into `Approved`: it writes one `Payment TDS Deduction` row (gross amount, snapshotted vendor rate,
tds amount) and **rewrites `Project Payments.amount` to the NET figure**. `Service Requests.amount_due`
became `total_amount − amount_paid − total_tds`.

That put two mechanisms on **exactly the same population** — `DEDUCTIBLE_PARENTS` is
`{"Service Requests"}`, and slice TD's gate was `Service Requests` only — with **opposite storage
conventions**: net-stored at approval, gross-stored in the import.

## Decision

**The statement import records no tax.** A shortfall has one answer here — a part payment — and
`intent="deduction"` is refused outright.

Removed: `deduction_eligibility`, `DeductionEligibility`, `SERVICE_DOCTYPE`, `TDS_BAND_MIN_PCT`,
`TDS_BAND_MAX_PCT`, `REFUSAL_NOT_SERVICE`, `REFUSAL_RATE_OUT_OF_BAND`, `INTENT_DEDUCTION`,
`_settle_as_deduction`, `_assert_deduction_recordable`, `_record_deduction_provenance`,
`_DEDUCTION_REFUSALS`, `settle_payment(tds=…)`, `format_tds`, `SettleResult.tds_written`, and the
frontend's `deductionOffer`, `deductionRefusalText`, `BAND_EDGE_EPSILON` and `PartialIntentChoice`.

`settle_payment`'s flat rule **"NO TDS IS EVER WRITTEN"** — reversed by slice TD — is restored, and
`rewrite_amount` runs unconditionally again.

**`intent` survives with one legal value.** `VALID_INTENTS == {"part_payment"}` is the allowlist that
makes a missing or garbage intent throw on a money-out endpoint; dropping the parameter would leave a
door accepting a bare "split this" with nothing to reject, and would strip the declaration
`_record_partial_provenance` writes onto both halves.

## Consequences

### What this fixes

On a payment the new module has already netted, the old dialog would still offer *"Record ₹X TDS and
settle"* whenever the bank came in short by 0.95–2.05% of the **net** figure — withholding a second
time against an `amount_due` that already subtracts the first, and leaving one payment carrying two
TDS figures from two mechanisms that disagree about whether `amount` is gross or net. Nothing
prevented it.

### What it costs — stated, because it is real

Slice TD existed for a reason recorded in `deductionOffer`'s own docstring: *a reviewer looking at a
genuine 2% TDS on a materials PO, offered only "part payment", will take it — and that creates an
approved balance for money nobody owes.*

**That risk returns, for POs.** `payment_tds.DEDUCTIBLE_PARENTS` does not cover
`Procurement Orders`; PO tax is still hand-entered at fulfilment by `_fulfil_payment`. SR payments
are safe because they now arrive net and match their transfer outright.

**Mitigation:** `partial_settle.looks_like_tds` and the dialog's amber banner are now the whole
guard, so the banner **instructs** instead of observing — *"…a common TDS rate. If tax was withheld
rather than part of the money being unpaid, do not split this: record it in the payments screen.
Splitting would create an approved balance nobody owes."* It remains a WARNING and must never gate,
default or pre-select. Widening `DEDUCTIBLE_PARENTS` to POs is the proper fix and is a separate,
larger change.

### Why the removal was cheap

- **Deduction settlements ever performed: ZERO.** `Outflow Row Match` by basis — account+IFSC 18,
  cashbook remark 16, project in remark 3, Manual 2.
- **No schema field or Select option ever named a deduction** (`row_status`, `settlement_origin`,
  `match_basis`, `match_kind` are all untouched), so there is **no patch and no migrate**.
- `settle_payment(tds=…)` had exactly one caller — the branch removed — and
  `SettleResult.tds_written` was written but never read.

### What did NOT change

- **`Project Payments.tds` is still written, just not here.** `_fulfil_payment` (manual PO
  fulfilment) remains its writer. 625 Paid SR payments hold ₹6,34,002 of legacy `tds` and are **not**
  backfilled.
- **`settleBlockText` / `AMOUNT_GAP_HINT` were deliberately not reverted.** Their destination-free
  wording became unconditionally true again, but it was also chosen for an independent reason — point
  at the affordance, not the outcome (browser walk, 2026-08-13).
- The part-payment split (slice PS) is untouched.

### Regression fences

Three inverted pins, not deletions — a deleted pin checks nothing:

- `test_partial_settle.TestTheIntentVocabulary.test_the_deduction_answer_is_gone_and_this_pin_keeps_it_gone`
  — the module exports none of the removed names.
- `test_settle_payment.TestPartialSettlementRefusals.test_a_declared_deduction_is_now_refused_outright`
  — the literal wire value `"deduction"` throws and writes nothing.
- `test_settle_payment.TestTheImportWritesNoTaxAtAll` — no `tds` is written and `rewrite_amount`
  always runs.

The frontend mirror is pinned by an exported-surface loop in `outflowTableModel.test.ts`.
