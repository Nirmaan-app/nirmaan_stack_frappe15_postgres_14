# ADR-0020 — One transfer settles many payments, allocated incrementally

- **Status:** Accepted (2026-09-11 — built and browser-verified, spec #1236 closed; Amendment B is the as-built decision record)
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
| **D1** | A leg settles a **whole** payment. ⚠️ **NARROWED BY AMENDMENT B1 — the second half of this sentence is FALSE in the shipped code and must not be read alone.** The record-splitting paths are refused once a transfer has legs | An `allocated_amount` distinct from `target_amount`, giving a second per-payment balance and no valid status for a part-paid payment |
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
- ⚠️ ~~**`settle_row_partial` is untouched.** Once the row is non-terminal, a record-split leg simply
  becomes one more leg, for free.~~ **FALSE — STRUCK BY AMENDMENT B1.** `settle_row_partial` shares
  `_load_settleable_row`, which refuses a `Partially Allocated` row. This sentence was written before
  that refusal existed and was never revisited; leaving it readable in isolation is the precise
  failure mode B1 and B2 both exist to record.

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

> ⚠️ **CORRECTED BY AMENDMENT B (2026-09-10).** The paragraph below names the wrong isolation
> level, and the conclusion it draws from it — that an unlocked `allocate_row` over-allocates
> silently — does not hold on this deployment. It is left standing rather than rewritten, because
> the fix it argues for is the right fix and the reasoning that produced it is worth reading beside
> the measurement that corrected it. Read Amendment B before acting on anything here.

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

---

## Amendment B — the settle selector splits by mode (2026-09-10)

**Status of this amendment:** Accepted. **Origin:** a `grill-with-docs` session on
`HANDOFF-outflow-fanout-selector-split.md`, 2026-09-10, 26 numbered decisions.
**Supersedes:** owner decision **D-D** (below, B6).

The arithmetic in the Decision section is sound and unchanged. Amendment B is entirely about the
**seams** where it meets the flows that were already there — every defect it records was invisible
to the branch's own suites, because each suite tested one side of a boundary. Root `CLAUDE.md`
predicted exactly this: *"A test on each side of a boundary is not a test of the boundary."*

### B1 — D1 is NARROWED, not merely clarified

D1 said: *"A leg that does not fit uses the EXISTING `settle_row_partial`, which splits the record
first"*, and the "NOT changed" section said *"`settle_row_partial` is untouched."*

**Both statements were false in the shipped code**, and had been since the Task 6 review added a
`Partially Allocated` refusal to the shared `_load_settleable_row` (`api/outflow_import/expenses.py`).
That loader serves `settle_row_partial` and `create_expense`, so on a partly-allocated row
part-payment, TDS deduction and create-expense were all refused. Nobody re-read D1 afterwards.

**D1 now reads: a leg settles a whole payment, full stop. Once a transfer has legs, the
record-splitting paths are not available against its remainder.**

The refusal is the correct behaviour and stays. The rejected alternative — giving part-payment and
TDS a remainder-aware route — was refused on the grounds that it multiplies two independent
arithmetics (the record split and the transfer split) at the one point where an error is silent, and
because a reviewer already has a complete route: reverse the legs, settle with the deduction,
re-allocate. Slower, never blocked.

⚠️ **The refusal block is pinned by no test.** Grepping its message across the repo returns only its
own definition. A future "cleanup" can delete it without any suite going red, and the consequence is
the Rs 160-against-Rs 100 hole below.

**And it must NOT be narrowed to `settle_row` alone.** Three callers write against the WHOLE transfer
amount with no leg-aware check behind them — `settle_row`, `settle_row_partial` and `create_expense`
(the last mints a Paid expense for `normalize_amount(row.amount)`). Nothing downstream catches it:
`allocation_fits`, `is_over_allocated` and the allocatable-row `FOR UPDATE` each have exactly ONE
call site and it is `allocate_row`; the payment/expense settle locks compare record-vs-bank and know
nothing about legs; the partial unique index stops the same target twice, not a different one. An
over-allocation then derives as **`Settled`**, because `is_fully_allocated` is one-sided and there is
no fourth status — the same silent shape Amendment A1 was written for.

### B2 — the ledger scope is PAYMENTS ONLY, and this ADR is now where that is written down

`allocate_row` refuses every target that is not `Project Payments`, per-target, before any write
(*"Only Project Payments can be allocated from one transfer. Settle a '<X>' on its own."*).
`reverse_allocation` carries the same refusal, and the frontend mirrors it including a
mixed-ledger block.

**That rule existed only in a Python docstring.** This ADR's title and body speak of payments
throughout but never excluded the two expense ledgers in words. B1's defect has the same shape — a
load-bearing rule living somewhere nobody re-reads — so the rule is recorded here, with its
reasoning: `Non Project Expenses` has no project column and cannot be corroborated, and an expense
fan-out has never been observed. **Widening it is a separate decision requiring its own evidence.**

Measured cost, 2026-09-10: **236 of 574 settled bank rows (41%) settled against an EXPENSE, not a
payment**, and the picker's candidate pool is never ledger-scoped. So the Split control is visible
but inapplicable on a large share of rows. Hiding it on such rows was **rejected as unimplementable**:
of 44 open rows, 26 give no amount signal in any ledger, so the control would be shown or hidden by
a guess. See B3.

### B3 — routing reads INTENT, not tick count

The defect: `chooseSettleEndpoint` read tick count and row status only. One tick on a fresh row went
to `settle_row`, whose guard demands the record equal the WHOLE transfer. The weaker,
remainder-bounded guard was reachable only via `allocate_row`, which required `ticks > 1` **or** an
already-partly-allocated row. **A first-leg-then-second-leg workflow had no path at all** — which is
the owner's primary complaint and the reason this amendment exists.

The settle dialog gains a mode radio: **"Normal"** (default) and **"Split across several payments"**.

| Decision | Value | Cost if wrong |
|---|---|---|
| Split allows a single tick SMALLER than the transfer as leg one | yes | this is the entire point; without it the workflow stays impossible |
| Mode decides the endpoint — Split ALWAYS routes via `allocate_row`, even on a full-amount tick | yes | an amount-based shortcut makes two identical-looking actions differ on UNDO, with nothing on screen saying which you got: `reverse_allocation` acts on legs, and `settle_row` writes none |
| Split lists **payments only**, with a line stating why | yes | see B2; the honest alternative to a guess |
| Split with no payment candidates shows an explanatory line, never a silent empty list | yes | a silent empty list reads as a broken screen |
| Switching mode CLEARS the ticks; mode is NOT remembered between rows | yes | the two modes store the tick in different fields and mean different things by it; a sticky mode is how a transfer gets split by accident |
| On a `Partially Allocated` row the mode is FORCED and LOCKED to Split | yes | the server refuses that row on the Normal path, so offering Normal is a lie |
| Bulk "Confirm all matched" stays **Normal-only, permanently** | yes | it has no dialog and therefore no mode; splitting a transfer is a judgement call and does not belong in a fifty-row action |

**Two implementation constraints that are load-bearing, not stylistic:**

- **`chooseSettleEndpoint` is the single home of the routing rule and it gains a MODE input.** Its
  existing test block asserts the tick-count rule that B3 replaces. Per the repo's standing rule,
  **retire that block by INVERTING it** — assert the new truth and keep it failing for anything else
  — never by deleting it. A deleted pin checks nothing.
- ⚠️ **`isConfirmable` and `decisionOrigin` are read by the BULK confirm path, which has no dialog
  and therefore no mode radio.** Keep BOTH `linkTo` (Normal) and `linkTargets` (Split) optional on
  `RowDecision` and make both readers accept either. `decisionOrigin` no longer compares `target` at
  all, and the fan-out picker CLEARS `target` on every tick — so a naive revert to
  `Boolean(decision.target && decision.linkTo)` **rejects every fan-out decision**. This is the
  riskier half of the split; the picker component itself is nearly free to revert.

⚠️ **The label must NOT be "partial payment".** The same dialog already renders a radio labelled
*"A part payment"* belonging to the INVERSE feature — one approved payment split across several
transfers. Two radio groups in one dialog with near-identical labels and opposite meanings is the
worst available outcome.

**The mode radio unlocks for free after a full reversal — verified, not assumed.** Every gate keys
off `row_status` alone, and `_refresh_row_allocation` recomputes from the live legs with an explicit
zero branch, returning the row to `Matched` (if its suggestion survived) or `Mismatched`. Confirmed
three ways: the code, an existing test
(`test_reversing_every_leg_returns_the_row_to_an_open_status`), and live data — row `OFR-26-002185`
carries two Reversed legs and sits at `Mismatched`. **No stuck-row trap exists and no new mechanism
is needed.** The status is RE-DERIVED, never restored from a remembered value, which is why it
survives a re-match.

**Known and accepted:** once the last leg is reversed the dialog shows no trace of the reversal (the
legs read filters to `match_kind = 'Settled'`). The audit record is durable and a one-off notice
fires at the time, but a reviewer reopening that row later sees a plain untouched row. Visibility
gap, not a correctness one.

### B4 — the balance-bar gate had made the part-payment detour unreachable

`confirmDisabled` included `isLinkDecision && bar.over`. On a fresh row `banked = 0`, so `bar.over`
reduces to *"the ticked record exceeds the transfer by more than the tolerance"* — **algebraically
identical** to the condition that opens the part-payment / TDS detour, since `SETTLE_WINDOW` and
`AMOUNT_TOLERANCE` are literally the same constant. The detour's only trigger sits inside the
confirm handler, which a disabled button never fires.

So every pick that could open the detour was a pick whose Confirm button was dead. The TDS deduction
and part-payment paths were live in source and unreachable from the product.

**Corrections to the record**, both material to anyone bisecting this:

- The clause was **NOT** introduced by the "six review fixes" commit, as the handoff states. That
  commit added only the `|| legsUnknown` disjunct. `bar.over` came from the **feature commit**
  (`47ddc2b1`, rebased twin `e92fa086`) and was present from the start.
- **It was plan-mandated, not a review finding.** The design spec says *"Over-ticking is ALLOWED;
  Confirm is not. Disabling the ROWS instead makes it a puzzle."* That rationale is entirely about
  WHICH control disables. Nothing in the plan, the task brief, the implementation report or any of
  the four review passes considered its effect on the single-tick path — and the implementation
  report and a code comment both assert the opposite, in good faith.

**Resolution: narrow, do not delete.** The gate applies only where allocation arithmetic governs —
the predicate already exists and is already single-homed as
`chooseSettleEndpoint(...) === "allocate_row"`. Nothing is lost on the server: `settle_row` keeps its
strict whole-transfer guard and refuses an oversized tick regardless. What is regained is the
`AmountOutsideWindowDialog`, whose own docstring describes the defect the gate had recreated:
*"a live control that did nothing — so the honest failure of a deliberate rule was indistinguishable
from a broken button."*

`legsUnknown` is **innocent and stays as-is**: it is already gated on `Partially Allocated`, so it is
always false on a fresh row. Ruling U — *never draw a confident balance over an unknown leg set* —
survives untouched, because its target is inside the narrowed set.

The red bar itself still renders on the narrowed path; only its instruction changes, from
*"untick something before confirming"* to text pointing at the button. And when `settle_row` refuses
a single tick, the message stops citing TDS on a row that has nothing to do with TDS and names the
Split mode instead.

**Parked with a ruling:** on a `Partially Allocated` row with a single tick, the detour's own
comparisons read the WHOLE transfer rather than the remainder. B1 makes that shape unreachable, so
the bug dies rather than being fixed. Recorded so it is not rediscovered as new.

⚠️ **None of B3 or B4 is testable by any suite in this repo.** Nothing pins `confirmDisabled`, and
there is no DOM test environment (`frontend/CLAUDE.md`, deliberate). The honest verification is a
live browser A/B — revert, reproduce, restore, re-verify.

### B5 — the picker measures the REMAINING balance, and it is one line

Every ranking and labelling surface compared against the FULL transfer. On a Rs 1,00,000 row with
Rs 70,000 banked, the Rs 30,000 payment that would COMPLETE it scored zero on the amount axis, was
flagged unsettleable, sorted below every record that could no longer fit, was marked *"off by
Rs 70,000"*, and on a single tick was refused with *"the bank moved more than this record is for"* —
untrue of the balance actually left.

**The handoff's "ten sites" over-states the work.** `search_settleable_records` derives the
comparison amount at exactly ONE line, and every consumer below it — the per-ledger SQL ordering, the
`suggested` flag, the ranker's hard settleable/unsettleable split, and the score axis — already takes
it as a parameter. **One substitution moves all four together**, which is what preserves the existing
invariant that there is one amount-opinion per record.

**Shape: an optional `compare_amount` parameter, NOT a new `get_row_allocation` endpoint.** The
frontend already holds the remainder (`allocationBar` computes it one line above where the wrong
number is used), so the parameter costs ZERO new requests; the endpoint would add a serialised
round-trip on the dialog's critical path to fetch a number already in memory, and would not even
remove the direct doctype read it appears to justify.

**The automatic matcher is structurally out of scope** — partly-allocated rows are frozen from
matching, and the ranker is architecturally forbidden from feeding the matcher (test-pinned).
**With one exception:** `get_row_candidates` re-runs the matcher LIVE, has no frozen-status guard,
and fires on every dialog open. On a partly-allocated row it marks records as matcher-found against
the full amount — including records already settled as legs of that same row. **Resolution: suppress
the marker client-side on such rows.** Making it remainder-aware is explicitly rejected: it would
push ranking into the matcher, which is the thing the pin forbids.

Ranking is computed ONCE per dialog open, against the banked remainder — never live per tick. A
round-trip per click, with the list reshuffling under the cursor mid-selection, is worse than the
static answer, and the balance bar already shows the live figure.

**Corrections to the handoff's site list:** the matcher comparisons are at `matcher.py:540` and
`:560` — `:529` is a variable binding, and `:560` was missed entirely. A comment in `DecisionDialog`
claims *"the legs a write returns only cover THAT write"*; **that is false** — `_live_legs` returns
every live leg for the row, so the write responses already carry an authoritative balance.

### B6 — owner decision D-D is REVERSED: no batch is exempted from matching

D-D exempted "the whole batch" from re-matching, on the grounds that a batch whose remaining work is
partly-allocated rows is counted in *"Re-run reaches N open imports"*, looped, and then skipped —
promising work it cannot do.

**Measured against the live database, all three candidate definitions fail:**

| Definition | Batches it exempts |
|---|---|
| every remaining ACTIVE row is `Partially Allocated` — the true no-op | **0** |
| at least one `Partially Allocated` row | **1**, and 9 of its rows are still matchable |
| batch status is `Partially Settled` | **16 — every open batch in the system** |

The cause is that exactly **one** `Partially Allocated` row exists among 2,511. And
`derive_batch_status` returns `Partially Settled` as soon as ANY row is terminal, with no threshold —
so **15 of the 16 contain no partly-allocated row at all**, reading that way purely because rows were
SKIPPED (two are literally one Mismatched row among 35 and 15 Skipped).

**Decision: implement nothing.** The correct definition fires on zero batches — code that never
runs, maintained forever — and the other two suppress re-matching on batches with real work. If the
caption's over-promise is the actual irritant, that is a separate and much smaller fix, and it is
about Skipped rows, not allocation. Revisit only if partly-allocated rows become common.

### B7 — found, and CAUSED by this branch: the inflow endpoints are broken

The Task 3 commit *"derive a row's status from its allocation, not from one write"* moved the
`Settled` flip out of `_record_settlement` and into `_refresh_row_allocation`. **It did not touch
`inflows.py`, which has never referenced either name.**

Measured, not deduced — `test_inflows`: **44 tests, 3 failures, 4 errors**, the first being
`AssertionError: 'Mismatched' != 'Settled'`.

Consequences: a credit row stays `Mismatched` after being recorded, so the "already settled" check
never fires on it either. `create_non_project_receipt` has no duplicate guard of its own — by design,
it relied entirely on that check — and can now be called repeatedly, minting a fresh negative
`Non Project Expense` each time. **The module header's own claim that no single staged row can write
twice is false today.**

Live blast radius is **zero**: the database holds no credit-direction rows and no inflow matches. It
is a loaded gun, not a wound. **It is fixed first, before any work in this amendment.**

⚠️ **The process failure is the more important finding.** The branch's stated gate was *"no NEW
failures vs BASE"*, and the handoff enumerated the pre-existing failures — `test_expenses`,
`test_settle_payment` — as though that list were complete. `test_inflows` was never run. A gate
phrased against a baseline is only as good as the baseline's coverage.

#### B7a — BUILT 2026-09-10, and the port was not the whole fix: `allocated_of` had to become a MAGNITUDE

The port itself is one line per endpoint — `_refresh_row_allocation(staged.name, actor, result)`
after `_record_settlement`, inside the same savepoint, exactly as the five outflow call sites do it.
That alone fixes `create_inflow`.

**It does NOT fix `create_non_project_receipt`, and the reason is a units mismatch nobody had cause
to notice before status became derived.** That endpoint writes a **negative** `Non Project Expense`
(owner ruling Q3 — this app has no non-project inflow doctype), and `SettleResult.amount` means "the
amount written", so the leg's `target_amount` is legitimately below zero. It is **test-pinned
negative**, deliberately, because it reaches the export's `settled_target_amount`. Meanwhile the
ROW's amount is a **magnitude** by equally explicit decision — ADR-0016 rejected a signed amount
column, so every source stores the positive figure and direction lives in its own column.

Subtracting one from the other is therefore not arithmetic, it is a category error: a signed sum of
`-X` against a row of `+X` makes `remaining_of` read `2X`, so a recorded receipt would sit at
`Partially Allocated` **for ever**, and the duplicate protection — which is nothing but "the row
stops being settleable" — would still never engage. The port would have looked done and left half
the defect standing.

**Decision: `allocation.allocated_of` sums `abs(target_amount)`.** Both operands of the subtraction
then mean the same thing — *how much money this transfer moved*. It is a **units fix, not a
loosening**: every outflow path writes a positive leg by construction (`create_expense_from_row`
refuses `amount <= 0`; the settle paths carry an approved record's own figure), so `abs()` is a
no-op on all of them, which is what makes it safe to state once in the pure module rather than at
each caller. Stated once, it also cannot drift.

⚠️ **A comment in `test_inflows` claimed the leg amount "is NOT summed anywhere".** That was true
when it was written and went stale the day row status became derived. It is corrected in the same
change, and the sign is now pinned from the pure side too (`test_allocation`: a negative leg counts
as the money it moved, and leaves its row fully allocated).

### B8 — the `Partially Allocated` refusal is dead code on the inflow paths

`create_inflow` and `create_non_project_receipt` share `_load_settleable_row` and therefore inherit
B1's refusal. An inflow blocked by an outflow's allocation state looks like an accident, and it is
one — but it is **unreachable**: both inflow endpoints require `direction == "Credit"` immediately
after loading, and `allocate_row` — the only writer of `Partially Allocated` — requires `Debit`. A
credit row can never become partly allocated.

**Decision: change nothing; add a comment.** Narrowing buys no behaviour, and B1 records how easily
a narrowing gets this wrong. The comment is the deliverable, because the branch is otherwise
unpinned and reads like a live rule.

### B9 — the blank-reference defect is LATENT, and smaller than reported

`settle_payment` reads one field, `row.bank_reference_no`, and writes it only `if reference:` — **a
blank reference is a silent skip, not an error.** The row also carries `reference_id`, the payment
gateway's own reference, which is extracted and unused.

**Corrections to the reported scope**, all measured 2026-09-10:

- The affected-row count is **61**, not 17.
- **All 61 are `Skipped`. Not one has settled.** Blank-`utr` payments in the live database: **zero**,
  out of 344 settled payment legs. The defect is real in the code and has **no live instances**.
- It is **five write sites**, not one — though only the payment site carries the silent skip; the
  other four already write `None` explicitly.
- The remedy is **Cashfree-only**. Cashbook populates NEITHER field and never will (a petty-cash
  wallet issues no bank reference); ICICI populates `reference_id` on roughly 2.5% of rows, and has
  no batches in the live database at all. Cashbook is already remedied differently — its expense
  path passes the wallet `transfer_id`, and all 222 settled Cashbook expenses carry it.
- ⚠️ **`reference_id` is NOT unique** — 2,237 Cashfree rows carry 523 distinct values.

**Decision: resolve ONCE AT INGEST into a new, WRITE-ONLY derived field**, read by the five write
sites and by nothing else.

⚠️ **THE PER-SOURCE FALLBACK LIVES IN THE INGEST RESOLUTION, NOT AT THE WRITE SITES.** That is the
whole point of resolving once: `bank_reference_no` if present, else `reference_id`, else — for
Cashbook — the wallet `transfer_id`. Every write site then reads ONE field and no path can diverge
from another. Putting the Cashbook case at a write site instead would reintroduce exactly the
per-path divergence this shape was chosen to remove, and would miss the payment path, which is the
one that is currently broken for Cashbook. Because there are no live instances, this is **sequenced
LAST**, after the seam repairs.

⚠️ **THE LOAD-BEARING CONSTRAINT — the matcher must never read it.** Tier 0 and the duplicate guard
compare the BANK's real reference; feeding a gateway id into that comparison risks matching an
unrelated stored value (`Project Payments.utr` already holds hundreds of non-bank references — PO
numbers, short numbers, the literal string `"refund"`). **FIVE surfaces must stay byte-unchanged**,
one more than previously listed:

| Surface | Reads |
|---|---|
| `normalize_reference` | caller's value — the field choice is the caller's |
| `candidates._payments_by_reference` | `Project Payments.utr` only |
| `matcher.match_by_reference` | `row.normalized_reference`, else `bank_reference_no` |
| `parser`'s stored `normalized_reference` column | derived from `bank_reference_no` alone |
| **`reference_guard.assert_reference_is_free`** | filters `Project Payments` on `utr` |

The guard is the one the earlier record missed, and given the non-uniqueness above it is where a
mis-wire bites first. **Name the field so it cannot be mistaken for a bank reference** — that is
worth more than a comment.

Accepted cost, unchanged: a gateway id written into `utr` is invisible to tier 0 and to the
duplicate guard. Invisible-but-present loses nothing against today's blank and gives an accountant
something to reconcile with.

#### B9 as built (#1244, 2026-09-11) — the name, and one decision this section did not anticipate

The field is **`Outflow Import Row.settlement_reference`**. It names what the value is FOR — what a
settlement writes — rather than where it came from, so a reader looking for the bank's reference does
not land on it. The ladder lives in the pure leaf `services/outflow_import/settlement_reference`, and
its third rung asks `sources.source_transfer_id_is_its_reference` (set
`TRANSFER_ID_REFERENCE_SOURCES = {"Cashbook"}`), following that module's own "capabilities are named
questions" convention. Both per-caller reference overrides — `create_expense_from_row(payment_ref=…)`
and `create_inflow_from_row(utr=…)` — were DELETED, since a per-caller override is the divergence
this decision removes.

⚠️ **IT IS FIVE WRITERS AND ONE READER — this section's "five write sites" undercounts.**
`expenses.reverse_allocation` reads back what the payment site wrote: `_revert_payment` refuses to
unwind a payment whose `utr` is not this transfer's, and it compared `bank_reference_no`. After B9 a
blank-bank-reference row settles with its GATEWAY reference, so that guard sees `GW-…` against an
expected `""` and refuses — **the exact 61 rows this decision is about would settle and then be
permanently UN-REVERSIBLE**, blaming a third party for re-pointing the payment. It now reads the
resolved value. Found by review; no suite settled such a row and then reversed it.

⚠️ **A DEPLOY-WINDOW FLOOR HAD TO BE ADDED, AND WITHOUT IT THIS SLICE IS A REGRESSION.** This section
assumed the backfill and the code land together. They do not: by this repo's convention a patch's
`patches.txt` wiring is added separately by the maintainer, so there is a window in which the code is
live and the column is still NULL on every existing row — and a reader taking the new field ALONE
would settle every one of them with a BLANK. Strictly worse than the defect, and silent.

The floor is `settlement_reference_of_row(doc)`: the stored column, else the ladder **recomputed
through `resolve_settlement_reference`** — one function, called by both api readers. ⚠️ A first draft
floored on `bank_reference_no` alone; it looked harmless and silently dropped the WALLET rung, so a
pre-backfill wallet row would have written a blank where the deleted per-site override wrote its
transaction id. **Removal condition:** delete the recompute once the backfill is wired into
`patches.txt` and has run everywhere. Pinned by an existing test
(`test_allocate_row.test_every_leg_carries_the_RAW_bank_reference`) whose fixture predates B9 — it was
that test, not reasoning, that surfaced the window in the first place.

Backfill measured on the live dev database: 2,511 rows, blanks 2,511 → 0, idempotent on re-run, and
all 61 of the blank-bank-reference rows resolved on rung 2 — none needed rung 3. Full as-built:
`.claude/context/domain/outflow-import.md`.

### Order of work

| # | Slice | Rationale |
|---|---|---|
| 0 | B7 — the inflows regression | caused by this branch, has failing tests, blocks an honest baseline |
| 1 | B3 + B4 — the mode split and the narrowed gate | the owner's actual blocker. ✅ This amendment was written FIRST, deliberately: B1 and B2 are both records of a rule that lived where nobody re-read it |
| 2 | B5 — the remainder-aware picker | |
| 3 | B9 — the derived reference | latent, zero live instances |

Independently, and before slice 0 ships: the whole-branch fix-wave review that was prepared and never
run. The manual browser walk lands at the end of slice 1, since slice 1 rebuilds the screens it
covers — **except** the two-browser concurrency check, which exercises the A1 server lock and is
pulled forward.

---

## Amendment B — the fix-wave review, and the concurrency check it was gated on (2026-09-10)

Amendment A's ten fixes were committed and never reviewed. This is the review. Nine of the ten stand
as written; the tenth (A1, the row lock) is CORRECT CODE resting on a WRONG PREMISE, and the premise
is what this amendment replaces. Every claim below was measured, not reasoned.

### B1 — the isolation level is REPEATABLE READ, and reading the server setting gets it wrong

`SHOW transaction_isolation` from a bench connection returns **`repeatable read`**. Frappe sets it
per SESSION; the server's `default_transaction_isolation` is `read committed`, so anyone who checks
the *server* — or assumes Postgres's documented default — reads the opposite of the truth. That is
how A1 came to state READ COMMITTED four times over as the mechanism its whole argument rests on.

The BLINDNESS A1 describes is real under either level: `_live_legs` reads its own transaction's
snapshot and cannot see another transaction's legs. What changes is what happens next.

### B2 — the two-browser check: no over-allocation, with or without the lock

Two processes, each its own connection, one Rs 100 transfer, a different Rs 60 approved payment
ticked in each, confirmed together. The winner was made to hold its transaction open for five
seconds after the row read, so the loser was GUARANTEED to contend rather than merely arrive late —
a race left to chance proves nothing when the failure it is looking for is a silent one.

| | winner | loser | row afterwards |
|---|---|---|---|
| **with `FOR UPDATE`** | 60 of 100 written, `Partially Allocated` | blocks ~6 s at the row read, then `SerializationFailure: could not serialize access due to concurrent update` | **60 of 100. No over-allocation.** |
| **`for_update` removed** | 60 of 100 written, `Partially Allocated` | runs its work, then `InFailedSqlTransaction: current transaction is aborted` | **60 of 100. No over-allocation.** |

So **snapshot isolation, not the lock, is what prevents the silent over-allocation on this
deployment.** Postgres refuses the loser's UPDATE of a row the winner has already updated, and the
loser's whole transaction — including the payment it had flipped to `Paid` — goes back.

### B3 — the lock is KEPT, and the reason is the shape of the failure, not the fact of it

A1's fix is retained, and this amendment is not a licence to remove it:

* **It fails EARLY.** With the lock, the loser stops at the one read that decides eligibility,
  before a single payment is touched. Without it, the loser settles a payment, writes a match
  record, and only then discovers its transaction has been dead for some time.
* **It names the ordering.** Row then payment, stated once, at the read.
* **It is the only guard that survives a move to READ COMMITTED**, where A1's silent
  over-allocation genuinely would be reachable. A future Frappe upgrade, or a site that sets its
  own isolation level, would make A1 true again — and would find the lock already there.

### B4 — neither failure is fit for a reviewer's screen (✅ CLOSED for the locked shape, #1246)

> **Resolved 2026-09-11, issue #1246, on the owner's wording:** *"just put a message about some
> other user might have resolved this."* `allocate_row` now turns the `SerializationFailure` — and
> ONLY it (`services/outflow_import/concurrency.is_concurrent_writer_refusal`) — into *"Another user
> may have already resolved this transfer, so nothing you selected was saved."* The refusal itself is
> unchanged. The lockless `InFailedSqlTransaction` is deliberately NOT translated: any earlier
> swallowed error produces it too, so it cannot be given a cause — one more reason B3's lock stays.
> Re-reading the transfer for the loser and carrying their ticks over were DEFERRED by the same
> ruling and are not built. The translation ENDS AT THE COMMIT: after it, "nothing was saved" would
> be false, so a failure there stays raw. Each translated race writes one `outflow_import` log line,
> so a refusal the screen now hides as a sentence still leaves a server-side trace.
> ⚠️ **OUT OF SCOPE, NOT FIXED: `settle_row`** (the single-tick path). It takes no row lock and has no
> translation, so a reviewer single-ticking a transfer while a colleague's allocation on it commits
> first can still see the raw `SerializationFailure` (found by the #1246 code review, from reading the
> code — not reproduced live). B4 named `allocate_row`'s boundary; widening it is its own ticket:
> **#1250**.
> The original finding is kept below as it was written.

`SerializationFailure: could not serialize access due to concurrent update` is what the second
reviewer sees. It is a raw psycopg2 error. D5's "visible, not silent" is technically satisfied —
nothing is written, the reviewer is stopped — but a sentence that reads as a database crash does not
tell a person that a colleague is allocating the same transfer and they should reopen it.

**Parked, deliberately, and not fixed in this review.** The fix is a translation at `allocate_row`'s
boundary, and its wording is a product decision rather than a correctness one; folding it into a
review of somebody else's ten fixes would smuggle a new behaviour in under a verdict. It wants its
own ticket. Recorded here so the next reader does not rediscover it as a bug.

### B5 — two defects found on the way, both PRE-EXISTING, both fixed

* **`_resolve_stacks` returned a bare `0` on both abstain paths** while its only caller unpacks a
  2-tuple — `TypeError: cannot unpack non-iterable int object`, uncaught, killing the whole match.
  Reachable on ordinary data: `stack_key` yields `None` for a row with a blank
  `normalized_account`, so a statement carrying no counterparty account empties `keys`. Introduced
  2026-08-11 (`a5ff7bdc`, already on `develop`), and found only because Amendment A's own
  `test_a_re_match_keeps_them` had to swallow the `TypeError` to assert anything at all. Fixed;
  that test no longer catches it, so it now pins the fix as well as the delete scoping.
* **`test_expenses`' two `Requested` refusal tests had been dead.** Both expense controllers
  auto-approve on create (`0 < amount <= Rs 10,000`), a feature added independently of this module,
  and the fixture plants from a statement row's own amount — so the "Requested" record it planted
  was `Approved` before the guard ever saw it. They failed for a reason unrelated to what they
  pin. The fixture now re-asserts the status after insert; both tests are red again when the
  status guard is removed. Amendment A's report attributed these two to the `validate_won` fixture
  problem — that attribution was wrong, though its conclusion (pre-existing, not the wave) was right.

### B6 — two red gates that are NOT this branch's, parked with their causes named

Amendment A's report listed both as pre-existing. Both claims were re-checked here and both hold —
but neither had a stated cause, and an unexplained red gate is one nobody can clear.

* **`scripts/residence_check.py` is red on F5 (116 → 119) and F2 (207 → 223).** Measured cause: the
  branch adds **zero** lines matching either rule's pattern — `git diff be9b592a..HEAD -- frontend/`
  yields no `JSON.parse`, `useFrappeUpdateDoc` or `updateDoc(` addition at all, and neither does the
  fix wave on its own. The gap is inherited from a `develop` merge whose baseline was never
  reconciled; `scripts/residence_baseline.json`'s own history is a run of exactly such reconcile
  chores. **Not re-baselined here, deliberately:** re-ratcheting inside a review would absorb this
  drift and hide whatever arrives next behind the same number. It is a maintainer chore commit, on
  that file's own precedent.
* **`frontend/src/pages/POAdjustment/writeOffControl.test.ts` fails in the full run and passes
  alone.** Not random: it is a deterministic TIMEOUT. Its one slow case `await import()`s
  `SheetPricingPage`, which costs ~2.5 s on its own against vitest's 5 s default and ~5.1 s once the
  suite is running in parallel. Introduced on `develop` (`944441f2`), unrelated to this feature.
  **Parked, not fixed:** the repair is an explicit per-test timeout on a POAdjustment test, and a
  review of an outflow branch is the wrong commit to retune another module's gate in.
