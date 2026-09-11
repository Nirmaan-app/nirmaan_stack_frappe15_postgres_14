# Browser walk — issue #1245: the mode split, the narrowed gate, and the copy

**Date:** 2026-09-11 · **Branch:** `feature/outflow-fanout-allocation` @ `e88e6815`
**Environment:** localhost:8080 (vite in container) + backend :8000 · batch **OFI-26-00079**
(the `scripts/outflow_test_fixtures` ZTEST world) · signed in as Administrator.

> ## ⚠️ NONE OF THIS IS COVERED BY ANY AUTOMATED TEST
> This repo has **no DOM test environment, deliberately** (`frontend/CLAUDE.md`). The mode radio,
> ticks clearing on a switch, the forced-and-locked mode, the picker ranking, the balance bar and
> every piece of copy below are **structurally untestable here**. A green suite proves nothing
> about any of them. Everything recorded below was observed in a real browser, and every write was
> verified by reading the database directly afterwards.

---

## Result summary

| # | Step | Verdict |
|---|---|---|
| 1 | Fresh row, Normal — ordinary one-to-one settle | **PASS** |
| 2 | Bulk "confirm all matched" on an ordinary row | **PASS** |
| 3 | Fresh row → Split narrows the list, with the reason | **PASS** |
| 4 | Split on a row with no payment candidates | **FINDING — scenario does not exist** |
| 5 | Tick one payment smaller than the transfer → lands as a leg | **PASS** |
| 6 | Reopen → locked to Split, Normal not offered | **PASS** (tested by attempt) |
| 7 | Allocate a second payment against the remainder | **PASS** |
| 8 | Tick more than the remainder → red bar, Confirm refuses | **PASS** (tested by attempt) |
| 9 | Switch mode with ticks present → ticks clear | **PASS** |
| 10 | Open a different row → mode reset to Normal | **PASS** |
| 11 | Single oversized tick in Normal → Confirm live, dialog opens | **PASS** |
| 12 | Part-payment and TDS both reachable and completable | **PASS** (both completed) |
| 13 | Amount-mismatch message names Split, not TDS | **HALF PASS — FINDING** |
| 14 | Reverse every leg → row reopens, mode unlocks | **PASS** |
| 15 | **BULK** confirm, record larger than transfer → direction-aware refusal | **PASS** |
| 16 | The completing payment ranks near the TOP | **PASS** |
| 17 | The "off by" mark measures the REMAINDER | **PASS** |
| 18 | Match-run marks gone on a partly-allocated row | **PASS**, with an evidence limit |
| — | Over-allocated row → picker falls back | **PARTIAL** (see below) |
| — | Failed legs fetch → no "Loading records…" hang | **NOT EXERCISED** (see below) |

Two defects found, both **copy**, neither affecting money. Details in "Findings".

---

## Findings

> ## ✅ BOTH FINDINGS ARE FIXED AND RE-VERIFIED LIVE (2026-09-11, commit `f676a99b`)
>
> Fixed on `fix/outflow-1245-copy`, fast-forwarded into `feature/outflow-fanout-allocation`.
> **Not pushed.**
>
> Each sentence was given ONE owner in `outflowTableModel` so it could be pinned, rather than left
> inline in the JSX where this repo can never test it:
> - `settleBlockRemedy(block)` owns the dialog's closing line (F2); `settleBlockText` keeps owning
>   the reason. The Split label is **bound** from `SETTLE_MODE_LABEL.split`, not typed — the same
>   constant `settleModeLabelParity.test.ts` pins `settle.py` against — so the radio, the dialog and
>   the server cannot drift apart.
> - `AMOUNT_GAP_HINT_SPLIT` + `amountGapHint(mode)` own the gap sentence (F1). **Normal is
>   byte-identical**: `SettleableRecordTable` still reads the original `AMOUNT_GAP_HINT`.
>
> ⚠️ **One subtlety found while fixing, not during the walk:** `bank_paid_more` fires for EXPENSES
> too (pinned by an existing test), but splitting works on approved Project Payments only. Naming
> Split there would send an expense reviewer to a mode that would never list their record. So
> `SettleBlock` now carries `targetDoctype` and the REMEDY is ledger-gated while the REASON stays
> ledger-blind — with the same fail-open the reason already uses (an absent doctype is never read as
> an expense).
>
> **Re-verified in the browser after the merge, on the same rows the defects were found on:**
> - F2, ZTEST-TR-C4 in Normal, picking PAY-00254-021 (₹30,000 against ₹50,000) — the dialog now ends
>   *"To settle it as one part of this transfer, choose 'Split across several payments' on the row."*
>   "Nothing has been recorded, and nothing will be." still stands, and the DB confirms nothing was.
> - F1, the same row in Split, ticking the same record — the line now reads *"PAY-00254-021 differs
>   by ₹20,000.00 — smaller than the balance left on this transfer — tick it to allocate it as one
>   part"*. Nothing was confirmed, so no leg was written.
>
> Gates: **650 frontend tests** (639 + 11 new pins in `settleBlockRemedy.test.ts`) and a clean
> `tsc --noEmit` for `outflow-import`, both re-run on the merged tree.
> ⚠️ `residence_check.py` fails on rules F5/F2 — **identically on the unmodified branch at HEAD**,
> so the baseline is stale and predates this change; these four files add zero instances of either
> pattern.

### F1 — Normal-mode advice leaks into Split mode on a deliberate first leg (steps 5 + 7)
Ticking a payment smaller than the transfer in **Split** mode renders, under the table:

> ⚠ PAY-00254-023 differs by ₹70,000.00 — too far apart to settle at this amount — pick it and
> confirm to see the options    Open ↗

The **arithmetic is right** (and on a partly-allocated row it correctly measures the *remainder* —
at step 7 it read "differs by ₹49,000.00" = 70,000 − 21,000). The **wording is wrong**: in Split
mode this pick is not "too far apart", it is a legitimate first leg, and "confirm to see the
options" is untrue — confirming *allocated* it, with no options dialog. It tells a reviewer their
correct action is a mistake at the moment they take it. Fix is copy-only, in the Split branch.

### F2 — The client block never names Split, while the server's message for the same case does (step 13)
On ZTEST-TR-C4 (₹50,000) in **Normal**, picking PAY-00254-021 (₹30,000) — the "bank paid more"
direction — the **client** intercepts before the server:

> **This record cannot be settled here**
> PAY-00254-021 is for ₹30,000.00, but ₹50,000.00 left the bank — a difference of ₹20,000.00.
> The bank moved more than this record is for. An import only ever settles a record for the amount
> that actually left the bank, so it cannot record this transfer against a smaller record — the
> overpayment has to be sorted out on the record itself first.
> **Nothing has been recorded, and nothing will be.**
> Pick the record that matches this transfer instead.

✅ It does not mention TDS — #1242's goal holds here too.
❌ It never mentions **Split**, and "pick the record that matches this transfer instead" is the
wrong remedy on a fan-out transfer: no single record matches, and the answer is the Split radio two
inches above in the same dialog.

⚠️ **The two messages for the same condition disagree.** The server's refusal for this direction
(verified at step 15b) reads *"To settle it as one part of this transfer, choose 'Split across
several payments' on the row."* Because `settleBlocker` sits inside the confirm **handler**, the
dialog path **always** shows the client one — so a reviewer working the normal way never sees the
sentence #1242 was written to give them. The server sentence is only reachable via **bulk** confirm,
which has no dialog to intercept it.

*(Both findings are the same class: the remainder/direction logic was updated, the copy was not.)*

---

## The steps, as observed

### 1 — PASS. Ordinary one-to-one settle
ZTEST-TR-B6 (₹7,139), fresh. Dialog opened on **Normal**, pre-selected, with the specced copy:
"Normal / One approved record settles this whole transfer." and "Split across several payments /
Allocate this transfer across several approved payments, over as many sittings as you need."
Pool 51 records; the matching ₹7,139 record carried a green settleable tick. Ticked it →
**Confirm → Paid became ENABLED** (no dead button). Confirmed.
**DB:** row `Settled`, note "Fully allocated. Settled Project Payments PAY-00254-010.",
reference 624400000016; PAY-00254-010 → Paid; one `Settled` leg.

### 2 — PASS. Bulk "confirm all matched"
Made a genuine Matched row the honest way — the "stale suggestion" case `get_confirmable_rows`
documents: set PAY-00254-005 to 44,393 via the document layer, pressed **Re-run match** on screen →
ZTEST-TR-B2 became **Matched** (rule `sole`). Then summary-panel **"Confirm 1 matched"** →
"Confirm 1 transfer" → **"Confirmation results · 1 settled"**, no failures.
**DB:** B2 `Settled`, ref 624400000012; PAY-00254-005 → Paid @ ₹44,393; one leg.
Screen: 0 Matched / 8 Settled, button back to "Confirm 0 matched".

### 3 — PASS. Split narrows the list, with the reason
ZTEST-TR-C10 (₹50,000, pool deliberately holds a Project Expense). Normal: "the one approved record
this transfer paid — payment or expense", **49 records**, radio picker. Switching to Split:
- header → "the approved payments this transfer is being split across"
- pool → **14** (49 → 14, the narrowing visible as a number)
- picker → **checkboxes** (`settlePickerFor` composition, live)
- and above the search box, verbatim:
  > Splitting a transfer works on approved Project Payments only, so expenses are not listed here.
  > To settle an expense, switch back to Normal.

### 4 — FINDING. The no-candidates scenario does not exist
Walked on ZTEST-TR-B7 (₹6,543.21, "unknown payee" — the fixture designed to have no candidates at
all). It still shows **49** records in Normal and **14** in Split, identical to C10.
`review.search_settleable_records`'s own docstring says why: *"IT RETURNS THE WHOLE APPROVED POOL"*
(`limit=0` = everything). 14 is exactly the number of Approved Project Payments in the entire
database. So `SPLIT_NO_CANDIDATES_NOTE` renders only when the **whole site** has zero approved
Project Payments — it cannot be produced by picking a row, however candidate-less. I did not force
it, because the only way to empty the pool was to alter the 3 **real** approved payments.
**What the step was really guarding — "not a silent empty list" — is satisfied by the always-on
note from step 3**, which is present on every Split row including this one.
The reachable neighbour *was* exercised: a nonsense search gave "Showing 0 of 14 approved records" +
**"No approved record matches the filters you have set."** with a Clear filters button — the
deliberate "nothing matches ≠ there is nothing" distinction, correctly worded.

### 5 — PASS. First leg smaller than the transfer
ZTEST-TR-C5 (₹90,000), fresh. Split → ticked PAY-00254-023 (₹20,000). Button read
**"Allocate 1 record"** (correctly without "· completes this transfer"). Allocated.
**DB:** `Partially Allocated`, note "Partly allocated: 20000.0 of 90000.0, 70000.0 still to
allocate."; one leg; PAY-023 → Paid. Screen: Partly Allocated tab 1 → 2.
*(F1 observed here.)*

### 6 — PASS, tested by attempt. Locked to Split
Reopened C5. "Already allocated" block listing the ₹20,000 leg with a **Reverse** button, and:
> This transfer already has money allocated against it, so it can only be settled by splitting.
> Reverse every allocation above to get the choice back.

Split pre-selected; Normal greyed. **I clicked Normal** — Split stayed selected, nothing changed.
Genuinely non-selectable, not merely styled so. Pool 14 → 13 (PAY-023 is now Paid and has left it).

### 7 — PASS. Second leg against the remainder
Ticked PAY-00254-024 (₹21,000). Balance bar read **"allocated ₹41,000 · left ₹49,000"**. Allocated.
**DB:** two `Settled` legs, remainder ₹49,000; PAY-024 → Paid carrying the **same UTR** as the first
leg — the sibling exemption working.

### 8 — PASS, tested by attempt. Over-ticking
On C5 (remainder ₹49,000) ticked ₹30,100 + ₹30,000 = ₹60,100. Bar turned red:
**"allocated ₹1,01,100 · left ₹-11,100"** + "— untick something before confirming"; button
**"Allocate 2 records" disabled**. **I clicked it anyway** — nothing happened.
**DB afterwards — nothing was written:** C5 unchanged with the same two legs, and both over-ticked
records still `Approved` with `utr` NULL.

### 9 — PASS. Mode switch clears the ticks
On C4: Split → ticked ₹30,000 → "Allocate 1 record" + "Clear selection". Clicked **Normal**: picker
reverted to radios with **nothing selected**, footer back to "Confirm → Paid" **disabled**, pool
back to 47, payments-only note gone. (The two modes store the pick in different fields, so a
surviving tick would be invisible on screen yet still counted as decided.)

### 10 — PASS. Mode resets per row
Left C5 forced to Split, opened C4: **Normal**, pre-selected, both options offered.

### 11 — PASS. Oversized single tick in Normal
ZTEST-TR-B3 (₹98,000); top candidate PAY-00254-006 (₹1,00,000) marked "off by ₹2,000". Selected it →
**Confirm → Paid ENABLED** (AC1 — this is the exact pick that used to be dead) → clicking it
**opened the amount-window dialog** (AC2):
> **This record is larger than the transfer** … Which of these happened?
> ( ) **A part payment** — ₹98,000.00 left the bank. ₹2,000.00 is still owed and stays approved.
> ( ) **A deduction (TDS or similar)** — The payment was settled in full and ₹2,000.00 was withheld.
> [amber] ₹2,000.00 is 2.00% of the payment — a common TDS rate. Check before choosing a part payment.

### 12 — PASS. Both detours reachable **and completed**
**TDS (B3):** choosing the deduction added "This records ₹2,000.00 as TDS on PAY-00254-006 and marks
it Paid. The payment amount stays ₹1,00,000.00." and relabelled the button to **"Record ₹2,000 TDS
and settle"**. Completed.
**DB:** PAY-00254-006 **amount stays ₹1,00,000**, `tds` = '2000.0', Paid. The leg records ₹98,000
(what the bank moved) — the documented asymmetry.

**Part payment (B4):** ZTEST-TR-B4 (₹2,00,000) + PAY-00254-007 (₹5,00,000). Here the **TDS option was
disabled** with its reason inline — *"Only a shortfall of about 1–2% can be recorded as TDS here —
use the payments screen."* (₹3,00,000 is 60%) — the exact contrast to B3's amber nudge. Choosing
part payment showed "This settles ₹2,00,000.00 and creates a new approved payment of ₹3,00,000.00
for the balance." Completed.
**DB:** PAY-00254-007 rewritten ₹5,00,000 → **₹2,00,000 Paid**, and a new **PAY-00254-027 ₹3,00,000
Approved** minted for the balance.

### 13 — HALF PASS / FINDING → see **F2**.

### 14 — PASS. Reverse every leg; the mode unlocks
Reverse dialog: "PAY-00254-023 (₹20,000.00) goes back to Approved… **Reason (required)**".
**Tested by attempt:** clicking Reverse with an empty reason did nothing; typing a reason enabled it.
Leg one → green page banner: *"Reversed ₹20,000 from PAY-00254-023. It is back to Approved. ₹69,000
of this transfer is still unallocated."*
Leg two → the other branch: *"…Nothing is allocated against this transfer now."*
**DB:** C5 back to **`Mismatched`**; **both match rows still exist** as `Reversed` with their typed
reasons (nothing hard-deleted); PAY-023 **and** PAY-024 back to `Approved` with `utr` and
`payment_date` cleared.
Reopened: **no** allocated block, **no** lock sentence, **Normal pre-selected**, pool back to 48.

### 15 — PASS. The one arrival #1242 could not discharge
Reached through **BULK confirm, with no dialog in front of it**. Set PAY-00254-005 to ₹60,000 against
the ₹44,393 transfer, then "Confirm 1 matched" → "Confirmation results · 0 settled · 1 could not be":

> Amounts differ: PAY-00254-005 is for 60000.0 but 44393.0 left the bank, a difference of 15607.0.
> **This record is larger than the transfer. Open the row and confirm the pick to see the options
> for the difference.**

✅ Correct remedy for this direction. ✅ **Does not suggest Split.**

**15b (extra, not asked for — it is what makes "direction-aware" a real claim).** Flipped the record
*below* the transfer and bulk-confirmed again:
> …a difference of 5193.0. **To settle it as one part of this transfer, choose 'Split across several
> payments' on the row.**

So the two branches genuinely differ, and the quoted label is byte-identical to the radio's.

### 16 + 17 — PASS. The ranking and the mark both follow the remainder
ZTEST-TR-C2: ₹1,00,000, banked ₹65,000, **remainder ₹35,000**; bar read "allocated ₹65,000 · left
₹35,000". Order as rendered:

| rank | record | mark |
|---|---|---|
| 1 | **₹35,000** (PAY-00254-025 — exactly completes) | **green ✓ settleable** |
| 2 | ₹30,100 | off by ₹4,900 |
| 3 | ₹30,000 | off by ₹5,000 |
| 4 | ₹21,000 | off by ₹14,000 |
| … | ₹20,000 / ₹18,500 / ₹16,500 / ₹15,000 | off by ₹15,000 / ₹16,500 / ₹18,500 / ₹20,000 |
| near-last | **₹3,00,000** (PAY-00254-027 — cannot fit) | off by ₹2,65,000 |
| near-last | **₹49,000** (PAY-00190-015 — cannot fit) | off by ₹14,000 |

**Step 16:** the completing payment ranks **first**; the two records too large to fit rank near the
**bottom**. Before #1243 it scored zero against the whole ₹1,00,000, came back unsettleable, and sank
below them.
**Step 17:** every "off by" is computed against the **₹35,000 remainder** (each figure checks out
exactly), in both directions, and the completing record carries a **green settleable tick** rather
than a warning — i.e. the client mark and the server's settleable flag **agree on the same row**,
which is the cross-seam join only the running screen can show. Under the old behaviour this row
would have read "off by ₹70,000".

### 18 — PASS on the visible claim, with an honest evidence limit
On C2 there is **no matcher count sentence** and no "matcher found this" badge on any row; the only
per-row subtext is the ranker's similarity reason ("the vendor name matches exac…"), which is a
different thing and belongs there. Consistent with `matcherMarksVisible(rowStatus) === false`.
⚠️ **Limit:** I could not show the positive contrast — a row where the marks *do* appear — because
every remaining ZTEST row is one the matcher finds nothing for, so no candidate line renders on those
either. The absence on C2 is consistent with the fix but is not by itself proof the suppression caused
it. Proving that needs a row with live matcher candidates that is *also* partly allocated.

### The two named fallbacks
**Over-allocated row — PARTIAL.** `pickerComparisonAmount` ignores ticks and reads banked legs only,
so "over-allocated" means *banked > transfer*, which the server refuses to create; I could not reach
it through the UI. What I *did* observe (step 8) is the adjacent, reachable half: with ticks exceeding
the transfer the picker kept listing normally — it did not go empty or nonsensical — while the bar
went red and Confirm refused.

**Failed legs fetch — NOT EXERCISED.** I tried to simulate it by patching `window.fetch` to reject
the `Outflow Row Match` read. The dialog opened with the legs loaded and my block counter stayed at
**0**: frappe-react-sdk's data layer uses **XMLHttpRequest, not `fetch`**, so the intercept never
fired. **I am not claiming this path was tested.** Doing it properly needs an XHR-level intercept, a
devtools request-block rule, or a temporary server-side failure.
*(The patch was reverted afterwards; the browser was left unmodified.)*

---

## ⚠️ Environment incidents found during the walk (unrelated to this branch's code)

Both were discovered *because* the walk was run, and both would have made walk results misleading.

### I1 — a patch from another feature silently rewrote payment amounts mid-walk
`nirmaan_stack.patches.v3_0.backfill_sr_payment_tds_deductions` **ran at 10:12:45 during this walk**
(Patch Log). It reduced every still-`Approved` Service-Request payment by the vendor's
`tds_deduction_percentage` and banked a `Payment TDS Deduction` row holding the gross.
- It wrote with **no Version row and no `modified` bump** — invisible to a `track_changes` audit.
  This is exactly root `CLAUDE.md`'s "raw SQL / `set_value` bypasses the document lifecycle" trap.
- All ZTEST vendors carry 2% because `api/create_vendor_and_address.py:77` **defaults** it to 2.
- Its source file is **not in this branch** — only a stale `__pycache__` `.pyc`, and `patches.txt`
  does not list it. `bench migrate` later reported *"Orphaned DocType(s) found: Payment TDS
  Deduction"*, confirming it belongs elsewhere.

**Rectified:** all 11 ZTEST approved payments restored to their `spec.py` values through the document
layer, each guarded by an assertion that the current value was exactly `spec × 0.98` before writing.
✅ Independently confirmed: every restored figure equals the `gross_amount` the patch itself recorded
on its own PTD row.

**Left alone, deliberately — for the owner to decide:**
1. **A real payment was reduced too.** `PAY-00190-015` (BENGALURU-PROJ-00190) reads ₹49,000 while
   `PTD-26-00627` records gross ₹50,000 / TDS ₹1,000, dated 2026-08-24. It is the only non-ZTEST
   Approved SR payment affected. This looks like the other feature's **intended** behaviour (638 PTD
   rows go back to July at 1% and 2%), not damage — so I did not touch it.
2. **12 ZTEST PTD rows still exist** and now disagree with the restored gross amounts. They are
   another feature's audit records, not mine to delete unasked.

### I2 — the site schema had been reverted to the other branch, breaking 17 tests
The same branch-switch re-synced every doctype from the *other* branch's JSON:
- `Outflow Row Match.match_kind` allowed only **`Settled`** — while the table already held 2
  `Reversed` rows.
- `Outflow Import Row.row_status` was **missing "Partially Allocated"** — while a row sat in it.
- `settlement_reference` had **2,511 populated rows but no field definition at all**.

That alone failed `test_reverse_allocation` (12 errors) and `test_settle_payment` (5 failures), and
**would have broken walk steps 5–8, 14 and 16–18** — which would have read as product defects.
**Remedy (owner-approved):** `bench --site localhost migrate` on this branch. Schema restored;
fixture amounts untouched by it.

### I2b — the legacy unique constraint came back with it
After the migrate one error remained: `duplicate key value violates unique constraint
"ofm_match_target_unique"`. Both indexes existed — the correct partial
`ofm_match_settled_target_unique … WHERE match_kind = 'Settled'` **and** the legacy non-partial
constraint the other branch had re-created. Because `outflow_match_partial_unique` is already in the
Patch Log it could never re-run to remove it, so it could not self-heal.
⚠️ This is the **ADR-0020 C7** case — that constraint is exactly what stops a previously-reversed
payment being allocated again, so it would have broken step 14 and the re-allocate after it.
**Remedy:** re-invoked that patch's own `execute()` (it is idempotent by construction) rather than
hand-writing SQL. Result: *"healed: nothing to demote (data already clean)"* and the legacy
constraint dropped; the partial index survives with its predicate intact.

---

## Test gate after the environment repair — all green

| Suite | Result |
|---|---|
| `services.outflow_import.test_allocation` | 38 OK |
| `services.outflow_import.test_partial_settle` | 32 OK |
| `api.outflow_import.test_allocate_row` | 17 OK |
| `api.outflow_import.test_reverse_allocation` | 19 OK *(was 12 errors)* |
| `api.outflow_import.test_settle_payment` | 63 OK *(was 5 failures)* |
| `api.outflow_import.test_expenses` | 45 OK |
| `api.outflow_import.test_review` | 258 OK (1 skipped) |
| vitest `src/pages/outflow-import/` | 12 files / 639 tests OK |

**472 backend + 639 frontend, all passing** — and, per the banner at the top, **none of them cover
any of the 18 walk steps.**

---

## Fixture world as left

Batch **OFI-26-00079** reads **Partially Settled** (correct — C2 is still partly allocated, the C14
case). All ZTEST payment amounts are back at their `spec.py` values, except the two the walk
deliberately changed: `PAY-00254-007` is ₹2,00,000 (split by step 12) with `PAY-00254-027` ₹3,00,000
holding its balance. 4 `Reversed` legs are preserved. Rows: C2 `Partially Allocated`; A5, B7, C4, C5,
C10 `Mismatched`; the rest `Settled`/`Skipped`.

To reset: `scripts/outflow_test_fixtures/teardown.py` then `seed.py` (see that folder's README).
