# ADR-0020 — One transfer settles many payments, allocated incrementally

- **Status:** Proposed
- **Date:** 2026-09-09
- **Supersedes:** owner ruling **Q4** ("fan-out is report-only")
- **Feature:** Bulk Import Transactions (`outflow_import`)
- **Design spec:** `frontend/.claude/plans/outflow-fanout-allocation-plan.md`

---

## Context

A vendor working across several POs is paid one lump sum, and Nirmaan records a payment per PO.
The import screen cannot express this. One `Outflow Import Row` settles at most one document,
once, and then freezes.

The shape is real and already in the data. Measured on the live ledger 2026-09-09:

- **39 groups / 92 payments** already share one bank-shaped UTR (12+ digits, all numeric) —
  same vendor, same date, different POs. Largest observed: **6 payments, Rs 2,13,396**.
- The `Outflow Row Match` docstring records the historical measurement independently:
  **40 transfers covering 99 payments, 2.53% of settled value**, the largest being one IMPS
  transfer of **Rs 72,89,432 across 7 payments and 6 projects**.
- **Zero** UTRs carry any "part payment" marker. The existing manual convention is the
  **raw UTR repeated on all N payments**.

Accountants are already doing this by hand, outside the import.

Three facts made the change cheap rather than structural:

1. **The storage already permits it.** `Outflow Row Match`'s unique key is
   `(transfer_id, target_doctype, target_name)` — deliberately on the *(transfer, TARGET)* pair,
   not on the transfer alone. Its own docstring says fan-out is representable on purpose.
2. **The detection already ships.** `matcher.match_by_reference` (tier 0) groups N payments into
   one `PaymentGroup` with `is_fan_out`, and `review.py:1274` sends it to the browser. The
   frontend has the TypeScript type and **zero readers**.
3. **`update_parent_amount_paid` SUMS the Paid payments** rather than incrementing, so a PO paid
   by a fan-out reports the right `amount_paid` with no new code and no known N.

## Decision

**A bank row becomes a wallet drawn down over time, not a switch flipped once.**

A reviewer may allocate the transfer against several `Approved` `Project Payments`, in several
sittings. Each leg settles a **whole** payment. The row is finished when nothing is left.

### The three derived numbers — nothing is stored, nothing is counted

```
allocated = SUM(target_amount) WHERE transfer_id = X AND match_kind = 'Settled'
remaining = row.amount - allocated
row_status = 'Settled' if |remaining| <= AMOUNT_TOLERANCE else 'Partially Allocated'
```

**There is no leg counter and no group id.** "Have all the adjustments been made?" is answered by
a BALANCE, not a CARDINALITY — an aggregate over an open set needs no count, which is exactly what
makes an unbounded number of legs safe. This follows the standing rule in root `CLAUDE.md`: a
derived field is *recomputed from source, never incremented by a delta*.

### Five sub-decisions

| # | Decision | Rejected alternative |
|---|---|---|
| **D1** | A leg settles a **whole** payment. A leg that does not fit uses the EXISTING `settle_row_partial`, which splits the record first | An `allocated_amount` distinct from `target_amount`, giving a second per-payment balance and no valid status for a part-paid payment |
| **D2** | `Project Payments.utr` keeps the **raw bank reference** on all N payments. No decoration | `"<utr> (part 1/6)"` — makes the value invisible to the re-import duplicate guard and to tier 0, which both compare the raw string |
| **D3** | A wrong leg is **soft-reversed** (`match_kind = 'Reversed'`), never deleted | Hard delete — frees the unique key but loses the "this was tried and undone" fact |
| **D4** | The unique index becomes **PARTIAL**: `... WHERE match_kind = 'Settled'` | A plain unique index — a Reversed row would keep holding the key, so a correctly-reversed payment could never rejoin that transfer |
| **D5** | The new row status is **`Partially Allocated`**, and it is **OPEN *and* FROZEN** | `"Partially Settled"` — already taken by the BATCH status, and `derive_batch_status` returns `In Review` for such a batch, so the two words would contradict each other on one screen |

### D5 is the structural one

Today `open` and `frozen` are opposites. `Partially Allocated` is the first status where **money
is already written but work remains**, so it is:

| Set | Member | Consequence of getting it wrong |
|---|---|---|
| `_FROZEN_ROW_STATUSES` | **YES** | `match_batch` would reach the row and `review.py:433` would `frappe.db.delete` every settlement record for it — silently |
| `OPEN_ROW_STATUSES` | **no** | would enrol the row in cross-batch claim contention and stack pairing |
| `TERMINAL_ROW_STATUSES` | no | work remains |
| new `ACTIVE_ROW_STATUSES` | **YES** | the set meaning "still needs a human" |

Being in neither `OPEN` nor `TERMINAL` has a sharp consequence that `derive_batch_status` must
absorb: its first branch is `if not open_rows: return BATCH_COMPLETED`, so a batch of only
partially-allocated rows would read **`Completed`** and drop out of `match_period` forever. The
deriver therefore reads `ACTIVE_ROW_STATUSES` for "is there work left", and the same substitution
is needed for the summary's `open_rows` / `open_value`. Both are byte-identical on existing data,
since `ACTIVE == OPEN` until the first partial allocation exists.

## What is deliberately NOT changed

- **The matcher never auto-suggests a fan-out group.** Reviewer-initiated only, mirroring
  owner ruling R3 for partial settlement. Tier 0 keeps *detecting* fan-out; nothing acts on it.
- **`claims.py` is untouched.** It stops two ROWS claiming one PAYMENT — the opposite direction.
- **`settle_row` is byte-unchanged**, strict amount guard intact. `allocate_row` is a separate
  endpoint, and the screen keeps routing a single-tick settle through the old path.
- **`settle_row_partial` is untouched.** Once the row is non-terminal, a record-split leg simply
  becomes one more leg, for free.

## Consequences

**Accepted:**

- The allocation path **never rewrites a payment's amount**. `settle_payment`'s `rewrite_amount`
  takes the BANK's figure, which on a fan-out is the whole transfer — applying it to leg 1 would
  rewrite a Rs 55,819 payment to Rs 2,13,396. Paise gaps land in the +/- Rs 5 remaining tolerance
  instead. This is the pre-X1 behaviour, re-accepted here for this path only.
- **The per-leg amount guard is weaker than `settle_row`'s.** A leg must be `<= remaining`, not
  `~= the transfer`. A wildly wrong small payment is therefore no longer refused at the point of
  the tick. What catches it: the row never reaches `Settled` and sits at `Partially Allocated`
  with a visible leftover balance. **Visible, not silent** — that is the whole argument.

**Costs to pay:**

- The three `LIMIT 1` correlated subqueries over the match table (`ledgers.SETTLED_LEDGER_SQL`,
  `review._SETTLED_NAME_SQL`, `review._SETTLED_TARGET_AMOUNT_SQL`) become wrong. None carries an
  `ORDER BY`, so one export line could show one leg's name beside another leg's amount. Per the
  precedent set when `settled_by_ledger` was retired, the scalar keys are **replaced, not silently
  widened**, so a stale reader fails loudly.
- `_row_filters` has **six callers and nine statements** and cannot grow a JOIN without forking.
  Any fan-out-correct filter must be an `EXISTS` subquery.
- The status parity pins (`test_status.TestVocabulary` + `outflowImportStatus.test.ts`) both spell
  the six statuses literally and must be updated in the same commit. That is the pin working.

**Found, not caused:** `patches.txt` contains **zero** outflow lines, so all four outflow index
patches are unwired. `ofm_match_import_row_idx` exists on the dev DB but may be absent in
production. Verify against `pg_indexes` before this ships.

---

## Amendment A — the whole-branch review (2026-09-09)

Every task on `feature/outflow-fanout-allocation` passed its own gate; these are the things only a
cross-task view could see. The three that changed a DECISION rather than a line of code are recorded
here — the rest are documented at their call sites.

### A1 — allocation is serialised by a ROW LOCK, and D5's "visible, not silent" depends on it

`allocate_row` took no lock. `_live_legs` re-reads under READ COMMITTED, so it **cannot see another
transaction's uncommitted legs**: two reviewers ticking DIFFERENT payments on the same transfer each
measured the remainder against a picture with the other's legs missing, each passed
`allocation_fits`, and the post-loop `is_over_allocated` backstop is per-transaction and equally
blind. The row then derived as `Settled`, because `is_fully_allocated` is deliberately ONE-SIDED and
there is no fourth status for over-allocation.

**That failure is SILENT, which is precisely what this ADR trades against the weakened per-leg
guard.** The argument for D1's weaker window is that a wrong pick leaves a *visible* leftover
balance; an over-allocation that reads `Settled` leaves nothing to see. `_load_allocatable_row` now
reads the row `FOR UPDATE`, in the same read that decides eligibility, held to the commit.
`settle_payment`'s own `FOR UPDATE` and the partial index each stop a different thing (the same
payment twice; the same pair twice) and neither covers two different payments racing onto one
transfer. Lock order is ROW then PAYMENT.

The post-loop `is_over_allocated` check is now unreachable single-threaded. It is KEPT: it is the
only assertion that reads the final sum rather than a per-leg fit.

### A2 — D3 was being broken by a route this ADR did not consider

"A wrong leg is soft-reversed, never deleted" is the justification for D3 *and* for D4's partial
index. But once EVERY leg is reversed, `_refresh_row_allocation` returns the row to
`Matched`/`Mismatched` — deliberately, so it can be reconsidered — and it is then no longer frozen.
Both `match_batch` (via `_persist_row_outcome`) and `skip_row` ended in an unscoped
`frappe.db.delete(MATCH_DOCTYPE, {"import_row": ...})`, so **the most natural next action after a
reversal — "now re-run the match" — hard-deleted exactly the records D3 exists to keep.** Both
deletes are now scoped to `match_kind = 'Settled'`. Re-match semantics are unchanged: a `Reversed`
leg holds no unique key and contributes nothing to the sum. `get_batch_rows` gained the same filter
— it was the one read that never learned about `Reversed`, and the screen linked a reversed leg as
"Payments Done".

### A3 — Ruling O widened: two of the three reversal cases are now REFUSED

Ruling O documented ONE way a `Project Payments` leg can carry more than `reverse_allocation`
undoes: an amount rewritten by `settle_row` (slice X1). It is undetectable after the fact and stays
ACCEPTED. The endpoint's only target guard was the doctype, and the other two settle paths write
Project-Payments legs too:

| Case | Written by | Why a reversal cannot undo it | Now |
|---|---|---|---|
| Amount rewritten to the bank's figure | `settle_row` (X1) | Indistinguishable from an allocation leg — both leave `target_amount == amount` | **Accepted**, `reversed_amount` points at the Version log |
| `tds` written onto the payment | `_settle_as_deduction` | `_revert_payment` clears status / `utr` / `payment_date` only, so a withheld-tax figure would sit on a re-Approved payment | **Refused** |
| The payment was SPLIT | `settle_row_partial` | Reversing the settled half does not un-split: one sanction silently becomes two `Approved` payments | **Refused** |

Both refusals name the rule and the repair (the payments screen). A fourth guard refuses a leg whose
`target_amount` no longer equals the payment's own amount — an EXACT comparison, no window, because
both figures came from the same settle and any difference means a hand edit. The UI never offered
either case, but the endpoint is whitelisted and now refuses them itself.
