# Bulk Import Outflow — Resolve-dialog repairs + partial settlement

**Status:** ⚠️ **BUILT AND GREEN, 2026-08-12. Owner rulings R1–R6 accepted as recommended.**
**The browser walk is DONE** — run at the end of Part 2 (TD), covering both this part and that one
in a single pass over six seeded cases; see § "The browser walk" at the end of Part 2. The one seam
it did NOT cover is a live BULK confirm on a mixed batch (the `split_child` commit trap), which
remains the only outstanding live check.
**Date drafted / built:** 2026-08-12.

### As built — what changed against the plan

⚠️ **THE COUNTS IN THIS TABLE ARE PS-ERA AND ARE NOT THE FINAL NUMBERS.** Part 2 (TD) landed
afterwards and moved every one of them. They are kept as written because each records the delta of
*its own slice*, which is what makes the table readable — but do not quote them as the state of the
suites. **The current totals are in `.claude/context/domain/outflow-import.md` § Tests**, and as of
the TD walk they are: pure services **441** · `test_review` **143** · `test_settle_payment` **54** ·
`test_payment_split` **31** · frontend **2,484** (297 across this feature).

| Slice | Result |
|---|---|
| N2 | `recordPickerView.reasonCaption` + a sub-caption in the Record cell. vitest 35 → **39** |
| N3 | `get_row_candidates.settleable_candidates` (additive) + a neutral `candidate` chip + `suppressOutcomeNote`. `test_review` 137 → **143** |
| PS-0 | Baseline **26**, green. **Conclusion: the suite already pinned every axis PS-1 parameterises**, so no new pins were written here — the one genuinely missing pin (defaults == CEO behaviour) could only exist once the function did, and landed in PS-1 |
| PS-1 | `split_payment(…, expect_status, remainder_status, stamp_ceo_approval)`; `split_and_approve` is a wrapper. **3 parameters, not the 6 the plan sketched** — `kept_status` / `kept_term_status` coincide for both callers, and `remainder_term_status` was folded into `remainder_status` because the controller's own contract is that a term tracks its payment 1:1. `test_payment_split` 26 → **31** |
| PS-2 | `services/outflow_import/partial_settle.py`, pure. Pure suite 409 → **428** |
| PS-3 | `settle_row_partial`. `test_settle_payment` 25 → **39** |
| PS-4 | `partialOffer` + the two-answer dialog + `SHOW_PARTIAL_SETTLE`. vitest **287** across the feature |
| PS-5 | domain doc, `settle.py` spine restatement, this record |

**Three things the plan did not predict:**

1. **`TDS_HINT_TOLERANCE` was rejected by a pre-existing guard** — `test_amounts` fails any such
   constant bound to a `Decimal` outside `amounts.py`, and it scans SOURCE TEXT, so the explanatory
   comment tripped it too. Renamed `TDS_HINT_NEARNESS_PCT`, which reads better anyway: it is
   percentage points, not money. The guard did exactly its job.
2. **`PaymentSettlementFixture` plants each row's payment carrying that row's own bank reference**,
   so a partial settlement of a *different* payment was refused by the fan-out UTR guard rather than
   by anything under test. The partial fixture clears those references; the rollback test plants its
   own decoy deliberately.
3. **Trap T3 resolved in favour of the simple design.** The plan said the double PO save could not be
   settled by reasoning. It is now pinned: the split writes both terms and saves, then
   `_find_and_update_po_term`'s fresh `get_doc` sees that write, and the terms come out `Paid` +
   `Approved` still summing to the original. The fallback design was not needed.
**Live feature status:** `frontend/.claude/plans/outflow-import-plan.md`.
**Domain reference:** `.claude/context/domain/outflow-import.md`.

---

# PART 2 — TD: the deduction branch becomes a write (PROPOSED, 2026-08-12)

Today `intent="deduction"` throws and routes to the payments screen. This turns it into a real
write — **fill `Project Payments.tds` and settle** — but only where that is safe: a **1–2% shortfall
on a Service Request payment**.

**Status:** PROPOSED. Awaiting the rulings in §T2. No code written.

---

## T0. What the measurement says (live DB, 2026-08-12)

Everything below is measured, not assumed. 7,642 Project Payments; **671 carry a non-zero TDS**.

| Question | Answer |
|---|---|
| Is TDS a service thing? | **Yes, overwhelmingly. 584 Service Requests vs 87 Procurement Orders** (87%) |
| What rates actually occur? | **505 at exactly 1.00%, 60 at exactly 2.00%.** Then a separate cluster of ~81 rows near **0.1%**, and 4 stragglers above 2.5% |
| Is TDS computed on a pre-GST base? | **No — I checked and it is not.** `tds / amount` lands on clean 1.0 / 2.0. Dividing by 1.18 gives 1.18% / 2.36%, which is the *wrong* shape. This matters because `amount` is exactly what the import can see |
| How much does a 0.95–2.05% band capture? | **584 of 671.** Widening to 0.5–2.5% adds **2 more rows** — so the tight band costs almost nothing and keeps the 0.1% cluster out |
| What does "service only" cost? | **5 rows.** Of the 584 in-band, 579 are Service Requests |
| How many approved-unpaid payments could this feature act on today? | **75 Service Request payments** (vs 168 Procurement Orders, which this rule excludes) |

### ⚠️ THE INVARIANT: `tds` IS EMPTY ON AN APPROVED PAYMENT (owner, 2026-08-12)

**The 39 approved rows carrying a TDS figure are DATA INCONSISTENCIES, not a case to design for.**
I initially read them as a second legitimate state and proposed a verify-don't-overwrite branch for
them. That was wrong, and the owner corrected it.

**What the evidence shows they actually are** — worth recording, because it says why the field must
not be read:

- **33 of the 39 have a `Version` row reading `Approved → Paid`**, yet their current status is
  `Approved`. The forward transition is audited; the backward one is **not in the log at all**.
- **0 of the 39 have a `utr`. 0 have a `payment_date`.** Both were cleared.
- No code path in this app reverts `Paid → Approved`.

So these were fulfilled, then **un-fulfilled by a hand write outside the document lifecycle** —
which clears the field but mints no `Version` row, exactly the silent-write failure the root
`CLAUDE.md` already documents for Single doctypes. Whoever did it cleared `utr` and `payment_date`
and **missed `tds`**. The stored figure is residue from a fulfilment that was undone.

**The design consequence is a SIMPLIFICATION, not an extra branch: the gate must not read `tds` at
all.**

- Residue carries **no authority** — the row is not Paid, so nothing about it is a recorded fact.
- The authoritative number is forced by arithmetic from the transfer that actually happened:
  `tds = amount − bank`. It is derived, always, whatever the field contains.
- Reading the field to "reconcile" it would **enshrine the inconsistency in the logic** and design
  for a state the business says cannot exist.
- Refusing on residue was the other option and is worse: it blocks **16% of the approved population**
  for a reason the reviewer cannot see on that screen and could not fix from it.

**The overwrite is not silent.** `Project Payments` carries `track_changes: 1` and the settle saves
with `ignore_version=False`, so replacing residue lands in the Version log with its user and
timestamp — which is more audit than the hand write that created it ever produced.

⚠️ **This still falsifies the comment I wrote at PS-2** (*"`tds` is blank on every approved-unpaid
payment"*) and the matching claim in the domain doc. The sentence is right as an INVARIANT and wrong
as a statement of fact about the current table; TD-6 rewrites it to say which it is.

**The 39 rows are a data-cleanup item for someone, and are out of scope here.**

### ⚠️ AND A NAME COLLISION, LOUDLY

`TDS Items`, `TDS Repository`, `Project TDS Setting`, `TDS Items Child Table` are **Technical Data
Sheets** — materials approval, with `make`, `work_package` and `Verified / Not Verified`. The
"TDS Approval" tab and its Admin+PL approver set in `frontend/CLAUDE.md` are **that** feature.

`Project Payments.tds` is **Tax Deducted at Source** and is unrelated to any of it. Same three
letters, two concepts, and a grep for "TDS" lands on both — the same trap the codebase already
documents for "BCS". **This plan touches only the tax one, and no approval gate applies to it.**

---

## T1. How it works today (so the change is a change to something known)

`_fulfil_payment` (`api/payments/project_payments.py`) is where a human records TDS:

```python
pay.status = "Paid"
pay.utr    = utr
pay.tds    = flt(args.get("tds") or 0)     # ⚠️ `tds` is a **Data** column — a string
pay.payment_date = ...
```

Three facts follow, and all three shape the design:

1. **`amount` is NOT touched.** It stays the approved/invoiced figure and `tds` records the
   withholding, so the bank moves `amount − tds`. Therefore **`tds = amount − bank`**, which is
   exactly the gap the dialog already computes as `implied_pct`.
2. **`tds` is a `Data` field**, stored as `'1000.0'` and sometimes `'1000'` — the `flt()`-then-string
   shape. Same class of trap as `Project Expenses.amount`. (Measured: **zero** junk values today.)
3. **The entry box has no validation at all** — no rate check, no service check. This plan is
   *stricter* than the manual path, deliberately: an import writes without a human looking at the
   receipt.

`update_parent_amount_paid` sums **`amount`**, not `amount − tds`, so a TDS payment contributes its
full amount to the parent's `amount_paid`. That is existing behaviour on the manual path and is
carried over unchanged — **not a new decision, and not to be "fixed" here.** Service Requests carry
`amount_paid` and `latest_payment_date` just as POs do, and **no SR payment has a PO payment term**
(measured: 0), so the term machinery is never reached on this path.

---

## T2. Rulings needed before code

| # | Question | My recommendation |
|---|---|---|
| **T-R1** | **The band.** | **0.95% – 2.05%**, inclusive. Captures 584 of 671 historical; widening to 0.5–2.5% buys 2 rows and starts reaching toward the 0.1% cluster. Named constants, not literals |
| **T-R2** | **Service only?** | **Yes, as you asked** — `document_type == "Service Requests"`. Cost stated: 5 historical in-band rows on POs. ⚠️ But see T5: the option must stay **visible and disabled** on a PO, not hidden |
| **T-R3** | ~~Stored TDS that disagrees~~ **WITHDRAWN — the question does not arise.** `tds` is empty on an approved payment by rule; the 39 rows that carry one are residue from an out-of-lifecycle un-fulfil. **The gate does not read the field.** The value is derived from the transfer and written, and `track_changes` records the replacement | — |
| **T-R4** | **Does writing TDS need a new approval gate?** | **No.** Same actor set as `_fulfil_payment` (any accountant) and the same set as the rest of outflow. It records a fact about money that has already left |
| **T-R5** | **Does the amount ever change on this path?** | **Never.** `rewrite_amount` is skipped entirely. The X1 rule ("the record takes the bank's figure") is about a record that should EQUAL the transfer; here the record is deliberately larger by the withholding |

---

## T3. The gate (`services/outflow_import/partial_settle.py`, extended)

`deduction_eligibility(...)` **layers on `partial_eligibility` rather than repeating it** — the shape
conditions are identical (payment, Approved, record strictly larger, gap beyond the settle window,
both positive), and a second copy is how the two branches come to disagree about the same row.

It adds exactly **two** conditions:

```
REFUSAL_NOT_SERVICE        document_type != "Service Requests"
REFUSAL_RATE_OUT_OF_BAND   implied_pct outside [0.95, 2.05]
```

and returns `tds` (always **derived**: `amount − bank`) plus `implied_pct`.

⚠️ **IT TAKES NO `stored_tds` PARAMETER, AND MUST NOT GROW ONE.** `tds` is empty on an approved
payment by rule (§T0); a signature that accepts it would be designing for a state the business says
cannot exist, and the 39 rows that currently carry one are residue from an un-fulfil that bypassed
the document lifecycle. **The field is an output of this path, never an input.**

### ⚠️ `looks_like_tds` AND THE BAND ARE DIFFERENT QUESTIONS AND MUST NOT BE MERGED

They already exist side by side and answer different things:

- **`looks_like_tds` (1 / 2 / 5 / 10%)** — *"does this look like a deduction?"* It warns a reviewer
  before they choose **part payment**, because that is the choice that creates a phantom balance.
  Unchanged.
- **the band + service** — *"may we record that deduction here?"* It gates the **button**.

A 5% gap therefore still warns, and still cannot be written here — and the message says exactly that,
which is more useful than either silence or a button that refuses.

---

## T4. The write (`services/outflow_import/settle.py`)

`settle_payment(..., tds: Decimal | None = None)`. **`None` is byte-identical to today**, which is
what keeps all 39 existing tests in `test_settle_payment` as the proof.

When set, three things change and nothing else:

1. **The amount assertion compares the RIGHT figure.** `_lock_and_assert_payment_settleable` asserts
   `|amount − tds − bank| ≤ AMOUNT_TOLERANCE` instead of `|amount − bank| ≤ AMOUNT_TOLERANCE`.
   ⚠️ **This is NOT a bypass of the settle window — it is the same window applied to what the bank
   was actually expected to move.** Widening the window, or skipping the assertion, is the thing that
   must never happen.
2. **`rewrite_amount` is skipped.** The record keeps its approved figure by design (T-R5).
3. **`doc.tds` is written**, matching `_fulfil_payment`'s `flt()` shape exactly so the two writers
   cannot produce different-looking values for the same number.

### ⚠️ THIS REVERSES A STATED INVARIANT, AND THE REVERSAL MUST BE WRITTEN DOWN

`settle_payment`'s docstring currently says:

> **4. NO TDS IS EVER WRITTEN**, and X1 does not change this. `tds` is recorded at fulfilment by a
> human who knows the deduction; this import does not know it and must not invent one.

The second sentence is the real rule and **it survives**: the import still does not *invent* a
deduction. What changes is that in one narrow, measured case it can *derive* one — the arithmetic is
forced (`tds = amount − bank`), the rate must land in a band 87% of real deductions occupy, the
ledger must be a service, and a person must say so. The docstring gets rewritten to say that, with
the numbers, rather than being quietly deleted.

---

## T5. The screen

The two options become **independently gated**, and this is the part with a real failure mode.

| State | Part payment | Deduction |
|---|---|---|
| SR payment, gap 1–2% | offered | **offered** — records the TDS |
| SR payment, gap 40% | offered | disabled — *"only a 1–2% shortfall can be recorded as TDS here"* |
| **PO payment, gap 2%** | offered | **disabled** — *"TDS is recorded here only on service payments"* |

### ⚠️ THE DISABLED OPTION MUST STAY VISIBLE, AND THAT IS THE WHOLE SAFETY ARGUMENT

Hiding it looks tidier and is dangerous. A reviewer looking at a genuine 2% TDS on a **Procurement
Order** payment, offered only "part payment", will take it — and that creates an approved balance of
money nobody owes, which is precisely the phantom the PS slice was built to avoid. **Showing the
option greyed, with the reason and a pointer to the payments screen, is what stops that.**

The confirmation names what will be written — **one wording, because there is only one case**:

> *"Records ₹1,000 as TDS on PAY-… and marks it Paid. The payment amount stays ₹1,00,000."*

Payload: `search_settleable_records` gains **`document_type` only**, additively. (The earlier draft
also sent `tds`; that is dropped — the client has no reason to read a field the gate ignores.)
⚠️ **`document_type` (the parent PO/SR) is NOT `target_doctype` (the ledger).** Two similarly-named
keys one line apart; the comment must say so, because a mix-up would gate on the wrong field and
silently offer the deduction on everything.

---

## T6. Slices

| Slice | Work | Test surface |
|---|---|---|
| **TD-1** | `deduction_eligibility` + the band constants, pure. Rewrite the PS-2 comment so it reads as an INVARIANT, not a claim about the table | pure suite (428 → ~442) |
| **TD-2** | `settle_payment(tds=...)` + the docstring reversal | `test_settle_payment` |
| **TD-3** | `document_type` on the browse payload | `test_review` |
| **TD-4** | Endpoint: the deduction branch writes instead of throwing; re-asserts under the row lock | `test_settle_payment` |
| **TD-5** | Dialog: independent gating, disabled-with-reason, both confirmations | vitest |
| **TD-6** | Docs + the three corrections below | — |

**Corrections owed in TD-6:**
1. `partial_settle.py` — *"`tds` is blank on every approved-unpaid payment"*. **Right as a rule,
   wrong as a description of the table.** Reword to state the invariant and note that 39 rows
   violate it as residue, so nobody later "fixes" the code to accommodate them.
2. `settle.py` — *"NO TDS IS EVER WRITTEN"*. Reversed, with the numbers and the narrow conditions.
3. domain doc Known limits — same reword as (1). Also: it records **709 of 7,421** Paid payments
   carrying TDS; I measure **671 of 7,642** today. Not worth chasing, but the fresh figure should be
   the one on the page.
4. A short note that the 39 residue rows exist and are a **separate data-cleanup item** — including
   how to spot the class (`status='Approved'` with a non-empty `tds`, no `utr`, no `payment_date`).

---

## T7. The traps

| # | Trap | Consequence | Guard |
|---|---|---|---|
| **TD-T1** | **Reading `tds` as an input** — "reconciling" against whatever the field holds | Designs for a state the business says cannot exist, and enshrines 39 rows of residue as if they were records. Blocking on them costs 16% of the population for a reason invisible on that screen | The gate takes no `stored_tds`; the value is always derived. `track_changes` records the replacement |
| **TD-T2** | Hiding the disabled deduction option | Reviewer takes "part payment" on a PO-side TDS → phantom approved balance | Visible + disabled + reason |
| **TD-T3** | Gating on `target_doctype` instead of `document_type` | Every ledger passes the service check | One is the ledger, one is the parent; named and commented |
| **TD-T4** | Widening `AMOUNT_TOLERANCE` to "make TDS fit" | Destroys the settle window for all three ledgers | The window is applied to `amount − tds`, never relaxed |
| **TD-T5** | Writing `tds` as a float into a `Data` column in a new format | `'1000.0'` vs `1000` vs `'1,000'` — a column with no type to defend it | Match `_fulfil_payment`'s `flt()` shape exactly; pin it |
| **TD-T6** | Treating the 0.1% cluster as TDS | 81 rows at a tenth of the expected rate get auto-written | Out of band by construction — **but see the open question below** |

**Open observation, not a blocker:** the ~81 rows near **0.1%** are a real cluster and I do not know
what they are — a different withholding, or a data-entry slip where a rate was typed as an amount.
They are excluded by the band, which is right either way. Worth someone looking at separately.

---

## T8. What this does not do

- **Only Service Requests.** 168 approved-unpaid PO payments are outside it (T-R2).
- **Only 1–2%.** A 5% or 10% deduction still goes to the payments screen.
- **No TDS on expenses.** Neither expense doctype has the field.
- **Undo is better here than for the split**, and worth saying: a wrong TDS is repairable through the
  existing `EditFulfilledPaymentDialog` (amount / tds / utr / date on a fulfilled payment). Unlike a
  wrong split, nothing new was created.

---

## T9. The browser walk (run 2026-08-12, covers BOTH parts)

There is no DOM test environment in this repo, so the dialog's behaviour is only provable live.
Six dummy cases were seeded, imported as a real statement through the UI, driven by hand, verified
against the database, and then **fully purged** (0 rows remaining of every kind).

| Seeded case | Result |
|---|---|
| Service, **1%** short | Deduction offered → `tds = 1000.0`, amount **stayed** ₹1,00,000, Paid, `amount − tds` == bank exactly, SR `amount_paid` = full 1,00,000, **0** balance payments, Version row present, provenance comment naming the deduction and the rate |
| Service, **2%** short | Offered (left unsettled) |
| **PO, 2%** short | Deduction **greyed** — *"TDS is recorded here only on service payments"*. ⚠️ The TDS warning **still fired**, and clicking the greyed radio did nothing |
| Service, **40%** short | Greyed with the **rate** reason; took the part-payment path → trimmed to ₹3,00,000 Paid + a ₹2,00,000 Approved balance created |
| Service, **0.1%** short | Greyed (rate) — the unexplained cluster stays out |
| Service with **₹77,777 residue** | Button offered **₹1,000** (derived), and the write **replaced** the residue. The invariant held |

**The server gate was then tested DIRECTLY, bypassing the UI entirely** — `settle_row_partial`
called in a script for: PO + deduction, 0.1% + deduction, missing intent, bogus intent. All four
refused with their own messages; **nothing was written in any of them.**

⚠️ **STILL NOT COVERED: a live BULK confirm on a mixed batch.** The `split_child` flag (the
commit-inside-a-savepoint trap) is covered by unit tests and by the single-row walk, but an 8-row
bulk confirm containing a partial and a deduction has not been run in the browser. That is the one
remaining live check.

⚠️ **Two walk lessons worth keeping.** (1) `Escape` closes only the INNER `AlertDialog`, not the
outer decision dialog — a second Escape is needed, and mis-reading that wasted a cycle. (2) The
dialog's layout SHIFTS when a record is selected (a verdict banner appears), so fixed click
coordinates taken before selection land on the wrong control; use `find` by role/text instead.

---

## 0. What this plan covers

Three defects on the Not-Matched decision path, in one arc because they all land on the same screen
and the first two de-risk the third.

| Slice | Fixes | Reach |
|---|---|---|
| **N2** | The similarity ranking's REASONS are computed, shipped and never rendered | frontend only |
| **N3** | A row swept for "several candidates" does not say WHICH several | 1 additive backend key + frontend |
| **PS-0 … PS-5** | A transfer that pays PART of an approved payment cannot be resolved at all | service + api + frontend |

**What it deliberately does NOT do:**

- It does **not** close gap 3 as a whole. A transfer with genuinely nothing to link (145 on the
  first real statement) still has no terminal state, because `SHOW_SKIP_ROW` and
  `SHOW_CREATE_NEW_EXPENSE` are both `false` in `DecisionDialog.tsx`. Flipping those is a separate,
  one-line decision and is **out of scope here** — folding it in would let a "we could not decide"
  outcome ride in on a slice about a "we decided to pay it in parts" outcome.
- It does **not** build the deferred N-transfers-sum-to-one-record search (subset-sum). PS makes that
  design unnecessary rather than implementing it — see §3.
- It does **not** touch the matcher. No partial is ever auto-suggested. See ruling **R3**.

---

## 1. Slice order, and why this order

```
N2  ──► N3  ──►  PS-0 ──► PS-1 ──► PS-2 ──► PS-3 ──► PS-4 ──► PS-5
(read-only)      (pin)    (service) (policy) (api)   (screen)  (docs)
```

N2 and N3 are read-only, independently shippable, and each is worth having on its own. They go
first because PS changes what a reviewer does on this screen, and changing a screen nobody can read
properly is how a good feature gets blamed for a bad one.

PS-0 comes before PS-1 for the repo's standing **pin-first-change-second** rule (EA-7): the CEO
partial-approval path is live and untested against the change we are about to make to it.

---

## 2. Owner rulings needed BEFORE PS-1

Do not start PS-1 without answers. Each of these changes what gets built, not merely how.

| # | Question | Options | My recommendation |
|---|---|---|---|
| **R1** | **Who may partially settle?** Outflow access is Accountant / Accountant Lead / Admin. The CEO split is CEO-only. | (a) same as outflow access (b) Admin only (c) CEO only | **(a).** A partial settle changes **no approved total** — it re-partitions money already sanctioned. It is not an approval, so it does not need the approval gate. |
| **R2** | **`settle.py`'s spine says "it cannot create a payment".** PS creates one (the balance half). Is that a violation or a restatement? | (a) restate the spine (b) forbid PS | **(a), with the narrower wording:** *this import never approves, never increases what is sanctioned, and never creates a payment REQUEST — it may re-partition one already approved.* The balance half inherits `document_type` / `document_name` / `project` / `vendor` / `approval_date` from the original; it is not new money. |
| **R3** | **May the matcher ever auto-suggest a partial?** | (a) never — reviewer-initiated only (b) suggest when confident | **(a), firmly.** The entire write safety rests on "the ±₹5 settle window gates the write". A partial is by definition outside it. Keep the matcher byte-unchanged; a human opens the door each time. |
| **R4** | **Is the balance half's status `Approved`?** | (a) `Approved` (b) a new "Balance" status | **(a).** The money was already approved. A new status means every consumer of `Project Payments.status` has to learn it, and there are many. |
| **R5** | **Is a partial settle allowed on a Service Request payment (no PO terms)?** | (a) yes (b) PO-backed only | **(a).** The CEO split already has this exact ruling recorded: *"Service Requests carry no payment terms at all… the payment still splits (owner ruling)."* Match it. |
| **R6** | **Expenses?** `Project Expenses` / `Non Project Expenses` have no split machinery, no `split_from`, no terms. | (a) Project Payments only (b) all three | **(a).** Payments only. State it as a scope fence, not an oversight. |

---

## 3. Why the split shape, and not the shelved subset-sum design

The 2026-08-10 analysis (recorded in the domain doc's *Known limits*) rejected N-transfers-to-one
record on four grounds. **The split shape answers all four by construction**, because it converts one
N-to-1 problem into N independent 1-to-1 problems the existing write path already handles:

| Shelved design's wall | Under PS |
|---|---|
| `settle_row` fails: transfer 1 raises `AmountMismatchError`, 2..N raise `AlreadyPaidError` | Each half is settled at its exact amount by `settle_payment`, **unchanged** |
| Needs a group id on the row — `suggested_doctype`/`suggested_name` cannot express a group | Each transfer points at one record. No new row field |
| Needs bounded subset-sum search; danger is false positives | No search. The reviewer states which record and the bank states the amount |
| `Project Payments.utr` is `varchar(140)` — ~10 slash-joined refs before Frappe hard-fails | Each half carries **one** UTR in its own field |

Two further invariants survive untouched, and this is the strongest argument for the shape:

- **`_enforce_single_claim` ("a record is claimed once")** — after the split there are two records, so
  two transfers claim two different records. Nothing to change.
- **`Outflow Row Match`'s unique key `(transfer_id, target_doctype, target_name)`** — the two
  settlements address two different `target_name`s. No collision.

---

## SLICE N2 — render the similarity reasons

**Defect.** `similarity.py`'s docstring says *"The screen renders `reasons`"*. It does not.
`search_settleable_records` computes `similarity` + `similarity_reasons` per record,
`_rank_browse_records` attaches them, `SettleableRecord` declares them — and a grep across all of
`frontend/src/` finds **zero** readers outside the type declaration and one test fixture. So a record
sits third in a ranked list and nothing on screen says why.

**Scope.** Frontend only. No endpoint change, no payload change, no test-fixture change on the
Python side.

**Design.**

1. In `SettleableRecordTable.RecordRow`, render the reasons as a **one-line, muted sub-caption under
   the Record cell's id** — the same slot the ledger chip already occupies, which is the only cell
   with vertical room. Truncated with the full list in the `title`.
2. Show it **only when the reasons are non-empty AND no explicit sort is active**. Under a
   user-chosen sort the list is no longer in similarity order, so a "why it ranks here" caption would
   be describing an order that is not on screen. `sort === null` is exactly the "this is the ranking"
   state (`recordPickerView.nextSortState` already treats `null` that way).
3. Do **not** render the numeric `similarity`. It is a weighted sum on an arbitrary scale; a reviewer
   cannot calibrate `1.35` against `0.9`, and printing it invites someone to treat it as a
   confidence. The sentences are the readable half — that is why they exist.

**Pure helper to add** (`recordPickerView.ts`, so it is vitestable):

```
reasonCaption(record, sort) -> string     // "" when sort !== null or reasons empty
```

**Do not** re-derive or re-score anything client-side. The module header rule stands: *the server
ranks, this file arranges.*

**Tests.** vitest: caption empty under a sort; caption empty with no reasons; caption joins multiple
reasons in payload order (never re-sorted — the order is the axis priority).

**Verification.** Browser: open a Not-Matched row, confirm the top record's caption explains its
position; click the Amount header, confirm captions disappear; click back to unsorted, confirm they
return.

---

## SLICE N3 — mark the candidates the matcher actually found

**Defect.** `_sweep_unresolved_to_mismatched` writes `several_found_note(count)` — *"6 approved
records match this transfer and nothing could separate them. Open the row and pick which one it
settled."* The reviewer opens the row and is shown the **whole approved pool** (322–1,164 records),
ranked, with those 6 **unmarked**. The instruction "pick which one" points at nothing.

**Design — reuse the endpoint that already exists.**

`get_row_candidates` is whitelisted, already returns `payment_groups` + `expense_candidates`, and has
had **no frontend caller since slice R1**. It is the natural source.

But it must not become a *second opinion*. The note's count came from
`review._disambiguation_candidates(result)` — the same list `sole_suggestion` and `_matched_note`
read. So:

1. **Backend (additive only).** Add one key to `get_row_candidates`'s return:
   ```
   "settleable_candidates": [{"doctype": ..., "name": ...}, ...]
   ```
   computed by calling **`_disambiguation_candidates(result)`** — never by re-deriving from
   `payment_groups` in the client, and never by a new list-building function. Every existing key is
   untouched, so no existing caller can break.

2. **Frontend.** `RecordPicker` fetches it alongside the pool (its own SWR key, `row.name`-scoped,
   same as the pool's). Build a `Set` of `recordKey(...)` and pass a per-row boolean
   `matcherCandidate` into `SettleableRecordTable` → `RecordRow`.

3. **Render.** A small neutral chip in the Record cell — e.g. `matched`. **Not emerald**: emerald in
   this screen means *settleable / priced / succeeded*, and being a matcher candidate is neither a
   verdict nor a permission.

4. **One number on screen, not two.** When the marked block renders, **suppress the
   `several_found_note` sentence in `WhyThisSuggestion`** and let the picker state the live count
   itself (*"The match run found N records it could not separate — marked below."*). Reason: the note
   was frozen at match time and the live list is fetched now; between the two, another row may have
   settled one of the candidates. Two counts on one screen that disagree is worse than one count that
   is current.

**⚠️ Trap to write into the code comment.** `get_row_candidates` re-runs `match_row` live and does
**not** apply the claims / Option-B / stack passes. So a marked record may already be claimed by
another open row. That is honest (it *was* a candidate) but it must not read as "this one is
available". Wording must be *"the match run found these"*, never *"you may pick these"*.

**Tests.** Python `test_review`: the new key equals `_disambiguation_candidates` for a
several-candidate row; `[]` for a fan-out (the existing abstention); `[]` for a single-candidate row.
vitest: the key-set builder; the suppression predicate for the note.

**Verification.** Browser: find a row whose note says *N records… nothing could separate them*, open
it, confirm exactly N rows carry the chip and that the sentence is not printed twice.

---

## SLICE PS-0 — pin the CEO split before touching it

**Nothing ships in this slice.** It exists so PS-1 is provably non-breaking.

1. Run `nirmaan_stack.api.payments.test_payment_split` and record the pass count as the baseline.
2. Read the suite for gaps against what PS-1 will parameterise, and **add tests for anything
   unpinned**: the `Approved` status written on the trimmed original, `CEO Pending` on the remainder,
   the `(Balance)` label suffix and its re-split guard, the exact sum invariant, the
   `split_from` link, the SR path (no PO, still splits), the negative/refund refusal, the CEO Hold
   refusal.
3. Only when the suite is green **and** covers those does PS-1 begin.

The rule this serves is the repo's own: *pin first, change second, so the diff shows exactly what the
behaviour was before and after.*

---

## SLICE PS-1 — generalise `services/payment_split.py`

**Do not fork this module.** "Split one Project Payment into two, preserving the sum exactly and
re-writing the PO's payment terms" is **one concept**, and ADR-0010 B1 gives a concept one owning
module. A second copy would put two implementations of the sum invariant and the term surgery on
either side of the app, free to drift — the exact failure this repo keeps paying for.

**Change shape: add parameters whose DEFAULTS reproduce today's behaviour byte-identically.**

```
split_payment(
    payment_name,
    keep_amount,                       # what stays on the ORIGINAL doc
    *,
    expect_status   = "CEO Pending",   # refuse unless the payment is here now
    kept_status     = "Approved",      # status written on the trimmed original
    remainder_status= "CEO Pending",   # status written on the balance half
    stamp_ceo_approval = True,         # write ceo_approval_date on the kept half
    kept_term_status    = "Approved",
    remainder_term_status = "CEO Pending",
) -> dict
```

`split_and_approve(payment_name, approved_amount)` stays as a thin wrapper calling
`split_payment(...)` with the defaults above, so **every existing caller and every PS-0 test is
untouched.**

The outflow caller passes:
`expect_status="Approved"`, `kept_status="Approved"`, `remainder_status="Approved"`,
`stamp_ceo_approval=False`, both term statuses `"Approved"`.

**Everything below stays exactly as it is** and is the reason the module is worth reusing:

- `SELECT … FOR UPDATE` on the payment row **and** the parent PO row.
- One savepoint around all three documents.
- `remainder = original - approved`, a plain subtraction, **never independently rounded**.
- `MIN_SPLIT_AMOUNT` on both sides.
- The CEO-Hold refusal — which is also what keeps the savepoint isolated (its comment says so).
- The negative/refund refusal.
- `_split_po_term`'s shrink-and-append, and its `(Balance)` re-split guard.
- The orphan-term `log_error` fallback (not fatal — the payments are the financial record).

**⚠️ The two hook-suppression flags are load-bearing and must be set on the outflow path too.**

| Flag | Set on | Without it |
|---|---|---|
| `remainder.flags.split_child` | the balance half | `after_insert`'s `if doc.status == "Approved":` branch fires `_notify_accountants_payment_ready` **and** `_notify_admins_auto_approved`, both of which `frappe.db.commit()` per recipient — ending the outflow savepoint's isolation. "Confirm 8" could then leave 4 rows written and 4 not, with no record of which. |
| `pay.flags.split_approval` | the trimmed original | `_find_and_update_po_term` re-loads the PO and saves it on top of the copy we hold locked. |

Note the second is currently *harmless by accident* on the outflow path — `on_update` early-returns
when the status has not changed, and the outflow trim is `Approved → Approved`. **Set it anyway.**
Relying on an early return in a different function to keep a lock safe is precisely the
agreement-by-coincidence this codebase documents as surviving until someone tightens the other side.

**Tests.** PS-0's suite must stay green **unchanged**. New tests for the outflow parameter set:
`Approved → Approved + Approved`, `ceo_approval_date` untouched, both PO terms land `Approved`, sum
exact to the paise.

---

## SLICE PS-2 — the outflow eligibility policy (pure)

New module `services/outflow_import/partial_settle.py`. **Pure** — no `frappe`, no DB, no request
context, same shape and the same reason as `matcher.py` and `similarity.py`.

It owns exactly one question: *may this transfer partially settle this record, and what would the
two halves be?*

```
PARTIAL_PART_PAYMENT = "part_payment"
PARTIAL_DEDUCTION    = "deduction"      # NOT settleable here — routed away

partial_eligibility(record_amount, bank_amount, target_doctype, record_status) -> Eligibility
    # .eligible: bool
    # .refusal:  a named reason, never a bare False
    # .keep:     Decimal  (== bank_amount)
    # .remainder: Decimal (== record_amount - bank_amount)
    # .implied_pct: Decimal   the shortfall as a % of the record — for the TDS warning

looks_like_tds(implied_pct) -> bool     # near 1 / 2 / 5 / 10 %
```

**The eligibility gate, all conditions:**

1. `target_doctype == "Project Payments"` (ruling **R6**).
2. `record_status == "Approved"` — the settleable set, unchanged.
3. `record_amount > bank_amount` **strictly**. The reverse (more left the bank than the record
   claims) is an overpayment, a different problem, and explicitly not this.
4. The gap exceeds `AMOUNT_TOLERANCE` (₹5). Inside the window the ordinary settle already handles it
   and rewrites the amount (X1) — offering a split there would create a sub-₹5 phantom payment.
5. `remainder >= MIN_SPLIT_AMOUNT` (₹1). Guaranteed by 4, asserted anyway.
6. `record_amount >= 2 * MIN_SPLIT_AMOUNT` and `record_amount > 0` — no refunds.

**⚠️ `looks_like_tds` WARNS. It NEVER DECIDES.** TDS and a part payment are indistinguishable in the
data: `tds` is blank on every approved-unpaid payment because it is written at fulfilment by a human
who knows the deduction. 709 of 7,421 paid payments carry one (9.6%). A percentage near a statutory
rate is a hint for a person, not a rule for a machine.

**Tests.** Pure unittest, no bench needed. Every refusal reason by name; the ₹5 boundary from both
sides; the exact-sum property over a table of amounts including paise; `looks_like_tds` at 1.00,
2.00, 2.01, 10.00, 40.00.

---

## SLICE PS-3 — the endpoint

New whitelisted POST in `api/outflow_import/expenses.py`, beside `settle_row`:

```
settle_row_partial(row: str, target_name: str, intent: str)
```

**`intent` is REQUIRED and has no default.** A missing or unrecognised value throws. This is the
"never inferred" rule made structural rather than promised. Only `intent == "part_payment"`
proceeds; `"deduction"` throws a message routing the reviewer to the payments screen (the same
guidance today's block dialog gives).

**There is no `amount` parameter, and that is the single biggest safety difference from the CEO
split.** The kept amount **is** the bank amount. The reviewer types no figure, so there is no typo to
make and no way to approve a number nobody sanctioned.

**Order of operations, one savepoint (mirroring `settle_row` exactly):**

```
actor = require_outflow_access()                    # R1
staged, doc = _load_settleable_row(row)             # refuses Settled / Skipped
statement_file_url = _statement_file_url(batch)

savepoint
  1. re-read the payment UNDER A ROW LOCK; re-assert Approved + amount   (server-side, never trust the client)
  2. partial_eligibility(...) -> refuse by name if not eligible
  3. split_payment(target_name, keep_amount=bank_amount, expect_status="Approved", ...)
  4. settle_payment(staged, target_name, actor, statement_file_url)      # UNCHANGED
  5. _record_settlement(staged, doc, result, actor)                      # UNCHANGED
except -> rollback(savepoint); raise
release
_refresh_batch_rollup; commit
_link_statement_file_to_target
_post_partial_side_effects(...)                     # AFTER the commit
```

Why steps 3 and 4 must share one savepoint: a split that succeeded with a settle that failed would
leave a payment partitioned for a settlement that never happened. Recoverable, but it is a document
nobody asked for. One savepoint makes it impossible.

Why step 1 re-asserts even though PS-4 checks client-side: `settle.py`'s whole reason for existing is
that expense writes have zero optimistic-concurrency protection, and the status re-assertion under
`for_update` (no `cache=True`) is what closes the read-check-write race.

**`_post_partial_side_effects`, after the commit** — copy the shape of
`api/payments/project_payments._post_split_side_effects`, best-effort and never fatal:
- a comment on **both** halves naming the transfer, the amount settled and the balance carried;
- **the declared intent, in words**, so the choice between "part payment" and "TDS" is attributable
  and not merely implied by the existence of a balance.

**⚠️ The bulk-confirm path must be structurally unable to reach this.** It is a different endpoint
name that the bulk tree never calls, and `get_confirmable_rows` only offers rows carrying a
`suggested_name` — a partial has none. Add a test asserting `settle_row` still raises
`AmountMismatchError` for an out-of-window payment, so the ordinary path is proven un-widened.

**⚠️ PO-term interaction — verify live, do not assume.** After PS-1 writes the terms and saves the
PO, `settle_payment` flips the status to `Paid`, which fires `_find_and_update_po_term`, which does a
fresh `frappe.get_doc` on the PO and saves it a second time. A fresh read inside the same transaction
sees the split's write, so this should be correct. **It is the one joint in this plan that reasoning
cannot settle** — prove it in the browser against a real PO and check `payment_terms` afterwards. If
it misbehaves, the fallback is: have PS-1 write the kept term as `Paid` directly and leave
`split_approval` set on the doc `settle_payment` saves, so exactly one PO save happens.

**Tests** (`test_settle_payment`, bench): the happy path end to end (two docs, sum exact, PO
`amount_paid` correct, one `Outflow Row Match`, row `Settled`); every refusal; a settle failure
rolls the split back with **no** orphan payment left behind; `intent` missing → throw.

---

## SLICE PS-4 — the dialog

**Today's dead end.** `handleConfirmClick` → `settleBlocker(picked, row.amount)` → if blocked, the
`AmountOutsideWindowDialog` says *"This record cannot be settled here… Nothing has been recorded, and
nothing will be."* It ends there.

**The change.** When the block is *partial-eligible*, that dialog gains a decision instead of only an
explanation.

**Pure model first** (`outflowTableModel.ts`, vitestable — the repo has no DOM test environment, so
anything not pure is unprovable here):

```
partialOffer(record, bankAmount) -> PartialOffer | null
    // null  => today's dialog, byte-identical
    // else  => { keep, remainder, impliedPct, tdsLike }
```

It must mirror PS-2's gate. **The server is the authority**; this is UX convenience only, exactly as
`isRateEditableRow` mirrors the pricing gate.

**The dialog, when an offer exists.** Title stops asserting the dead end. Body states the two facts
(record ₹5,00,000 · bank ₹2,00,000 · difference ₹3,00,000) and then asks **one question with two
answers, neither pre-selected**:

- **Part payment** — *"₹2,00,000 of this payment left the bank. ₹3,00,000 is still owed and stays
  approved."* → primary action `Settle ₹2,00,000 and carry ₹3,00,000 forward`.
- **A deduction (TDS or similar)** — *"The full ₹5,00,000 was settled and ₹3,00,000 was withheld."*
  → **no action here**; the existing guidance to use the payments screen.

**⚠️ Neither option may be pre-selected, and the primary button stays disabled until one is.** These
two are indistinguishable in the data. A default is the system guessing, and the wrong guess creates
a payment that will never be paid and inflates what the PO thinks it still owes, forever.

**⚠️ When `tdsLike` is true, say so in-line:** *"₹3,00,000 is 2.00% of the payment — a common TDS
rate. Check before choosing Part payment."* A warning beside the choice, never a change to the
choice.

**The confirmation must name what will be created**, because there is no undo (§7). One line, on the
button's own dialog: *"This creates a new approved payment of ₹3,00,000 against PO/…"*.

**Kill switch.** `const SHOW_PARTIAL_SETTLE = true` at the top of `DecisionDialog.tsx`, in the same
place and the same style as `SHOW_SKIP_ROW` / `SHOW_CREATE_NEW_EXPENSE`. Flipping it to `false`
restores today's dialog exactly.

**Memo / identity discipline.** Anything new passed into `SettleableRecordTable` must be a per-row
boolean or a reference-stable callback. `EMPTY_FILTERS` is a module-level frozen constant for this
reason; do not mint a fresh object per render.

**Tests.** vitest on `partialOffer`: null in every ineligible case (expense ledger, bank ≥ record,
gap ≤ ₹5, remainder < ₹1, negative record); correct `keep`/`remainder`/`impliedPct`; and a pinned
case proving `partialOffer` and today's `settleBlocker` never both claim the same record.

**Verification (browser — this is where the real gate is).**
1. A Not-Matched transfer + a larger approved payment → the offer appears; TDS option leads nowhere
   destructive; Part payment settles.
2. Afterwards: two payments exist, amounts sum exactly, PO `amount_paid` correct, PO `payment_terms`
   sum to the PO total, one `Outflow Row Match`, row `Settled`.
3. Re-run the match on a later batch → the balance half is found on tier 1 and settles normally.
4. Confirm a **bulk** confirm of 8 ordinary rows still writes 8 and commits once per row (the
   `split_child` flag trap).
5. Pick a record **smaller** than the transfer → no offer, today's dialog.

---

## SLICE PS-5 — docs

Per the DOCS-UPDATE RULE, per-slice detail goes to the plan + domain docs, **not** to `CLAUDE.md`.

1. `frontend/.claude/plans/outflow-import-plan.md` — the as-built record for N2, N3, PS-1…PS-4.
2. `.claude/context/domain/outflow-import.md`:
   - **Residence manifest** — add `Partial settlement eligibility → services/outflow_import/partial_settle.py`
     and `Splitting a Project Payment → services/payment_split.py` (one owner, both callers).
   - **Known limits** — rewrite the *"N transfers summing to ONE record is not built"* entry.
     Keep the old text **struck through, not deleted** — the repo did exactly this for the paise
     entry at X1, and the next reader is entitled to see that both positions were held deliberately.
   - The three Mismatched causes gain a fourth resolution route.
3. `services/outflow_import/settle.py` module docstring — the spine restatement from ruling **R2**.
   Anything in the repo still reading *"this import cannot create a payment"* is history from PS on.
4. Root `CLAUDE.md` — **minimal touch only** if R2 changes a load-bearing invariant sentence. No
   changelog entry. The `guard_claude_md.py` hook will block one anyway.

---

## 4. The trap register — carry these into code comments

| # | Trap | Consequence if missed | Guard |
|---|---|---|---|
| **T1** | TDS is indistinguishable from a part payment | A phantom balance payment that will never be paid, inflating the PO's pending allocation forever | `intent` is required, never defaulted; no pre-selected option; `looks_like_tds` warns |
| **T2** | The balance half inserts as `Approved` | `after_insert` commits per recipient → the outflow savepoint's isolation ends → "Confirm 8" writes 4 and loses 4 silently | `remainder.flags.split_child` |
| **T3** | Two writers want the PO | Term rows overwritten or `TimestampMismatchError` | `pay.flags.split_approval`; one PO save in the split; **live-verify** the settle's second save |
| **T4** | Split succeeds, settle fails | An orphan partitioned payment nobody asked for | One savepoint over both |
| **T5** | Client-side eligibility trusted | The read-check-write race `settle.py` exists to close | Server re-asserts under `for_update`, no `cache=True` |
| **T6** | `get_row_candidates` re-runs the match without the claims/Option-B/stack passes | A marked candidate may already be claimed | Wording is *"the match run found these"*, never *"you may pick these"* |
| **T7** | The remainder is independently rounded | The PO's terms stop summing; `finance.get_total_pending`'s ceiling silently widens | Plain subtraction only — inherited from `payment_split.py`, must not be "tidied" |
| **T8** | Someone widens `AMOUNT_TOLERANCE` to "make partials easier" | The whole settle-safety spine goes, on all three ledgers | PS never reads the window as a knob; it requires the gap to **exceed** it |

---

## 5. Test & verification matrix

| Layer | Command | Baseline today |
|---|---|---|
| pure services | `python -m unittest discover -s nirmaan_stack/services/outflow_import -t . -p "test_*.py"` | 409 |
| outflow api | `bench --site localhost run-tests --app nirmaan_stack --module nirmaan_stack.api.outflow_import.test_review` | 137 |
| settle api | `… --module nirmaan_stack.api.outflow_import.test_settle_payment` | — |
| CEO split | `… --module nirmaan_stack.api.payments.test_payment_split` | record at PS-0 |
| frontend | `yarn test` | 309 |

⚠️ **Both runners must run INSIDE the dev container** — the host has no `firebase_admin`, and host
`node_modules` is linux-arm64. Neither failure looks like a test failure.
⚠️ **Never run the bench suite and a browser session against localhost together.**
⚠️ `tsc --noEmit` is not a gate (≈3,200 pre-existing errors elsewhere); grep for touched paths.

**The browser walk in PS-4 §Verification is a GATE, not a formality.** There is no DOM test
environment in this repo, so the dialog's behaviour, the two hook-suppression flags and the PO-term
interaction are all structurally unprovable by unit test.

---

## 6. Rollback

| Slice | How to back out |
|---|---|
| N2 | Revert the caption render. No data written. |
| N3 | Revert the frontend; the additive backend key is inert. No data written. |
| PS-1 | Defaults reproduce today's behaviour — PS-0's suite is the proof. |
| PS-3 / PS-4 | `SHOW_PARTIAL_SETTLE = false` removes the only entry point. The endpoint is then unreachable from the product. |

**Data already written by a partial settle does NOT roll back.** See §7.

---

## 7. Accepted limits, stated up front

- **No undo, and a wrong partial is worse than a wrong settle** because it created a document. Q9
  already says a settle cannot be undone from inside the import. Manual repair is: delete the balance
  payment in the payments screen (`on_trash` reverts its PO term), then correct the original's
  amount. **After that repair the PO's terms will not sum to the PO total until someone fixes the
  remaining term** — the PO card warns, but nothing fixes it automatically. A reverse-split utility
  is a reasonable follow-up and is **out of scope**.
- **Partial settlement is manual only.** The matcher is byte-unchanged (ruling R3), so a statement
  full of part payments is still N dialogs.
- **Payments only.** Neither expense ledger can be partially settled (ruling R6).
- **Only the "record is bigger than the transfer" direction.** An overpayment is untouched.
- **This does not give a terminal state to a transfer with nothing to link.** That is the other half
  of gap 3 and is deliberately not in this plan.
