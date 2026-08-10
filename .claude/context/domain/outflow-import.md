# Bulk Import Outflow Transactions

An accountant uploads a bank statement of transfers that have **already left the bank** and maps
each one to the record it settles. Three ledgers: `Project Payments`, `Project Expenses`,
`Non Project Expenses`.

> **The import PAYS what someone has already approved. It never approves, and it never creates a
> `Project Payment`.**

All three settle `Approved → Paid` and nothing else. It is an *alternative bulk route chosen per
batch* (owner ruling Q12) — nothing about how the team works today changes, so a **half-hand-ticked
statement is the normal case**, not an edge case.

Spec: `docs/outflow-import/workflow.html` **section 0** (14 owner rulings; sections 1–12 describe the
superseded v2 design — history, not instructions).
Live status + slice record: `frontend/.claude/plans/outflow-import-plan.md`.

---

## Residence — concept → owner (ADR-0010)

This manifest names the **one owning module** for each concept in this feature. **No-new-scatter
rule:** an edit that touches one of these must route through its owner — or at minimum must not
create a *new* copy of the rule. An **UNASSIGNED** owner means no single home exists yet — do **not**
pick one ad-hoc; ask.

| Concept | Owner (module) | Nothing else may… |
|---|---|---|
| Row + batch status derivation | `services/outflow_import/status.py` (`derive_row_outcome`, `derive_staged_row_outcome`, `derive_batch_status`, `derive_batch_counters`) — B3 | compute a `row_status` or a batch `status`. The frontend mirror `outflowImportStatus.ts` is a CONVENIENCE pinned by a parity test; this file is the authority |
| Which record the screen pre-selects | `services/outflow_import/status.py` (`sole_suggestion`) | re-derive "exactly one candidate" anywhere else — the browser did, from a different candidate list than the note counted, and the two disagreed |
| The two amount windows (settle ±₹5, tier 1 ±₹1) | `services/outflow_import/amounts.py` (`AMOUNT_TOLERANCE`, `TIER1_TOLERANCE`, `amounts_match`) | hold a copy of either, **or add a comparison that is not on the list**. FIVE call sites: both SQL pool queries, the matcher, the settle guard, and the already-paid duplicate check. `TIER1_TOLERANCE ≤ AMOUNT_TOLERANCE` always — a tier wider than the settle window offers a record the confirm then refuses. The fifth site was *missing* until 2026-08-07 and flagged 8 of 26 rows in a live statement as discrepancies over sub-rupee rounding |
| What amount a settle WRITES (X1) | `services/outflow_import/amounts.py` (`rewrite_amount`) | decide it at a write site. It is **not a sixth window site**: the window already gated the pool and the write guard already re-asserted it, so this answers only "do these differ at all". ⚠️ Do not "finish" it by giving it a tolerance — that would put a second, quieter opinion about what may be settled inside a function whose job is to say what the number is |
| Does a remark name a project? | `services/outflow_import/project_match.py` (`build_project_index`, `ProjectIndex.sole_project`) | re-derive it. Tier 2 auto-suggests on this predicate, so a second copy is a second opinion about where money goes |
| What may be settled, and from which status | `services/outflow_import/ledgers.py` (`SETTLEABLE_STATUSES`, `settleable_statuses`) | carry its own Approved-only list. Read by `candidates.py` (what may be OFFERED) and `settle.py` (what may be WRITTEN) so the two can never disagree about one record |
| Bank row → target matching | `services/outflow_import/matcher.py` (`match_row`, `match_by_reference`, `match_payments`, `match_expenses`, `resolve_vendors`) | decide anything. It PROPOSES ranked candidates; `status.py` derives the outcome and a person makes the choice |
| The settlement write | `services/outflow_import/settle.py` + the one orchestrator `api/outflow_import/expenses.settle_row` | write to a ledger from anywhere else in this feature |
| Candidate pool queries | `services/outflow_import/candidates.py` | query a ledger for candidates inline in an endpoint |
| Browsable approved records (hand-linking) | `api/outflow_import/review.search_settleable_records` (+ `_search_one_ledger`) | reuse `get_row_candidates` for browsing — that is the MATCHER's output, and when the matcher finds nothing it is empty, which is exactly when hand-linking is needed |
| What counts as "decided" on the screen | `frontend/src/pages/outflow-import/outflowTableModel.ts` (`isConfirmable`) | gate a confirm button on its own predicate — the dialog and the bulk bar both read this one |
| Which rows the master table shows (X3) | `api/outflow_import/review.get_outflow_rows` (+ `_row_filters`, `_scope_clause`, `get_outflow_facet_values`) | filter, sort or search rows in the browser. ⚠️ `_row_filters` is ONE builder shared by the page query, its count, the tab counts and the facet values — a count computed under different filters than the page it labels is a lie that looks like a paging bug |
| What the screen ASKS for (X3) | `outflowTableModel.serverQuery` | build endpoint params at a call site. It owns the MEANING of a filter; SQL owns the application |
| One import's aggregate (X2) | `services/outflow_import/status.py` (`derive_import_summary`, `StatusTally`) | count or sum an import anywhere else. The DB does the `GROUP BY`; this assembles |
| Seeding decisions from the match run | `outflowTableModel.ts` (`suggestedDecision`, `seedDecisions`, `decisionOrigin`) | pre-select inside a component; the dialog used to, and it could only fire once a row was already open |
| Access | `api/outflow_import/permissions.require_outflow_access` | gate an endpoint any other way |

---

## Status vocabulary

Six row statuses. `status.py` is the only deriver.

| Status | Means | Reviewer does |
|---|---|---|
| `Pending match run` | staged from the sheet, nothing looked up | press Run match |
| `Matched` | ≥1 **approved** record found at this amount | confirm it |
| `Mismatched` | this transfer did not line up — **two causes, one status** | create or link one |
| `Settled` | we wrote; the record is now Paid and linked back | terminal |
| `Skipped` | nothing to do, and the reason says which nothing | terminal |
| `Error` | the write was attempted and rolled back | retry |

Batch: `Draft` → `In Review` → `Partially Settled` → `Completed`.

### ⚠️ `Unmatched` was merged into `Mismatched` (owner ruling 2026-08-10)

They were separate because their CAUSES differ — "the match ran and found nothing settleable"
versus "a record already recorded as Paid disagrees on amount beyond the rounding window". They are
the same JOB to the person holding the statement, and splitting them made a reviewer classify the
reason before they could act on either. **`Mismatched` went from the rarest status (0 on almost
every import) to the productive one carrying most of a statement's work** — which is why its
summary chip is now permanent instead of hidden-at-zero, and why the `unmatched_rows` /
`unmatched_value` summary keys are **absent, not zeroed** (a screen still reading them gets `None`
and breaks visibly, rather than reporting "0 transfers need a person").

**THE CAUSE IS NOT LOST — IT MOVED TO `outcome_note`.** `_nothing_found_note` and `_delta_note` are
unchanged and still say plainly which case a row is, in the sentence the Outcome column already
shows. Do not reintroduce a status to carry a distinction a sentence carries better. Two
consequences follow, and both are pinned by tests:

- `test_status.TestNothingFound::test_the_note_tells_this_apart_from_an_amount_disagreement` is the
  load-bearing test of the merge. The two sentences must never converge.
- `test_review::test_an_already_paid_payment_is_skipped_and_names_the_record` got **quieter**, not
  louder: before the merge, breaking the duplicate query produced a different STATUS from the
  correct behaviour; now both are `Mismatched` and only the note differs. Its note assertions are
  the whole test.

**Existing rows need `patches/v3_0/merge_outflow_unmatched_status.py`** — Frappe does not rewrite
stored values when a Select narrows, so pre-merge rows keep the retired string, invisible to every
tab and rendering as an untoned chip. Raw SQL, not per-row `set_value`: the status is DERIVED, so
there is nothing to audit, and a Version row per transfer would record a change nobody made. As
with `add_outflow_master_index`, **the `patches.txt` line is added by the maintainer, not the
patch**.

**Only `Settled` and `Skipped` are terminal** — narrower than v2, where a *finding* was terminal
because reporting it was the whole job. Under v3 the import settles, so a row that found something
and was never confirmed is unfinished work: `Matched` and `Mismatched` are both OPEN. That matters
MORE after the merge: `Mismatched` is now the bulk of the work, not the exception.

v2 → v3: `Reconciled` → `Skipped`/`Matched` · `Amount mismatch` → `Mismatched` ·
`Reference mismatch` → **deleted** · `Control exception` → **deleted** ·
`Completed with exceptions` → **deleted**. v3 → now: `Unmatched` → `Mismatched`.

---

## The matching rules, in one place

**Three tiers, owner-ruled 2026-08-07. The first that finds anything STOPS the ladder.**

```
1. STAGED     already imported / duplicate in file / not SUCCESS      -> Skipped
2. DUPLICATE  Paid payment with this reference, amounts agree         -> Skipped
                                              amounts differ          -> Mismatched
3. TIER 0     normalised UTR equal                     (finds fan-out; payments)
4. TIER 1     beneficiary account AND IFSC = a vendor's, amount +-Re 1 (payments)
5. TIER 2     amount +-Rs 5 AND the remark names the record's project  (payments + Project Expenses)
6. OUTCOME    >=1 approved candidate -> Matched     else -> Mismatched
```

**A lower tier never tops up a higher one.** Two candidates pre-select nothing, so reaching into
tier 2 after tier 1 found one would turn a confident row into an ambiguous one. Enforced in
`match_row`, which is why it orchestrates rather than calling both matchers.

**Vendor resolution** (≥2 survivors = ambiguous, nothing auto-recorded):
account+IFSC 0.95 · account 0.80 · exact name 0.75 · partial name 0.60×containment. Floor 0.35; a
name needs ≥2 non-noise words. **Containment, not Jaccard** — a statement name is routinely a subset
of the vendor name. ⚠️ **Only the `ifsc_matches` candidates admit anything to tier 1**; the name
scoring still runs and is still persisted as the row's resolved vendor, but it no longer MATCHES
anything. A name is a scoring form, never an identity.

**Project corroboration** (`project_match.py`): a remark names a project if it contains the project's
whole name (longest nested name wins — `Fujitsu Chennai` over `Fujitsu`), else a keyword unique to
one project. **Two projects named ⇒ nothing.** Distinctiveness is counted from the project list
itself, so cities self-tune; one small `GENERIC_PROJECT_TOKENS` list handles words common in English
but rare in the master (`site`, `office`, `work`). Measured: **172 of 194 live projects (88%) are
identifiable by their own name; the other 22 are all duplicate-named pairs** (two `Fidelity
Chennai`, two `SEBI Lucknow`, `ANSR` beside `ANSR - 2`).

**Never matches, by design:** non-Approved records · TDS payments (the bank sends `amount − tds`,
thousands off — neither window can reach it and **neither must be widened to**) · fan-out of a
settleable group (report-only, Q4) · `Non Project Expenses` (no project column, so nothing can
corroborate it) · a beneficiary whose account+IFSC resolves to no vendor and whose remark names no
project.

⚠️ **`match_expenses` REQUIRES the project — this REVERSED on 2026-08-07.** It used to match on
AMOUNT ALONE with the description only raising the score, which is why a round-number transfer with
an approved payment *and* an unrelated approved expense at the same amount honestly had **two**
candidates and pre-selected nothing. That was the practical ceiling on how often a row opened ready.
Description text (payee name / account / IFSC) still RANKS the candidates the project gate admitted.

⚠️ **DELETED, and not by oversight: the old Pass B** (vendor-by-name + amount + date ±3d). Rows it
used to catch now arrive `Mismatched` and are linked by hand. Owner's call, made with the loss stated.

---

## The invariants that break silently

0. **`_settleable_candidates` must read EVERY payment group, not `best_payment_group`.** This was
   the worst defect the feature has shipped, found on the first real 1,043-row statement
   (2026-08-10). `best_payment_group` is `payment_groups[0]`; taking only it collapsed N separate
   approved payments into ONE candidate, so `sole_suggestion` pre-selected an arbitrary record —
   breaking its own owner-locked "exactly one, or nothing" — and `_matched_note` announced *"One
   approved record at this amount"* when there were six. **Payment-vs-payment ambiguity, the common
   case on the main ledger, could not be represented at all**, which is why only 5 rows in 1,043
   ever read as ambiguous. Measured cost: 124 confirmations doomed before the button was pressed;
   58 of 117 rows claiming a sole record had several. ⚠️ **A fan-out group still counts ONCE** —
   its targets settle together, so there is nothing to choose between. ⚠️ **Every fixture built a
   single group, which is why a fully green suite said nothing.** `test_status._match_many` exists
   to build the N-separate-groups shape; use it for any new candidate test.

1. **Only `Approved` is ever matched.** `Requested` / `CEO Pending` → plain `Mismatched`. No status,
   no nudge, no approval deep link. This REVERSED an earlier goal (surfacing the 111 CEO-Pending
   payments); it was removed deliberately and must not be re-added.
2. **The already-Paid check is a SKIP, not a match** (Q14) — and it is the **only** route to
   `Mismatched`. Delete it and a hand-ticked payment reads `Mismatched` carrying the FOUND-NOTHING note, and the obvious next click
   books the same money twice.
3. **`Mismatched` is AMOUNTS ONLY, and only beyond the settle window.** The v2 `Reference mismatch`
   branch is deleted, not folded in. A reference is only ever *written into a blank*, never compared.
   ⚠️ This branch used **exact** equality until 2026-08-07, which made every hand-ticked payment
   carrying paise a "discrepancy" — 8 of 26 rows on a live statement, over gaps of 14 to 86 paise,
   each announced with a note suggesting TDS. `status.py` now imports `amounts.amounts_match`; that
   is its **one** permitted package import and the purity test was narrowed to say so.
   ⚠️ It reads the **settle** window (now ±₹5), not tier 1's ±₹1 — a duplicate guard asks the same
   question the write guard asks. Accepted consequence of the widening: a hand-ticked payment ₹4 off
   now reads `Skipped` rather than `Mismatched`.
4. **`for_update=True` must never carry `cache=True`.** Frappe skips the row lock on a cached read,
   which makes the concurrency guard decorative.
5. **Two payment hooks commit mid-save** — `update_parent_amount_paid` and the Approved→Paid
   notification cascade. Both are suppressed by `doc.flags.from_outflow_import` (set in exactly one
   place, read in exactly two). `amount_paid` is still recomputed, inside the same transaction. The
   test is not "is this side effect wanted" but **"does it commit"** — a commit inside the savepoint
   makes the rollback a silent no-op.
6. **Both amount windows live in ONE place** — see the residence manifest. ⚠️ **A fixture that pins a
   REFUSAL by amount must sit clearly OUTSIDE the settle window, never one step past its edge.** The
   edge has moved twice, and both times a `+1` / `+5` margin silently turned a refusal test into an
   acceptance test that still asserted a refusal (`test_expenses.py`, 2026-08-06 and 2026-08-07).
7. **`Outflow Row Match` records SETTLEMENTS ONLY.** A match run writes none. A suggestion stored
   there would take the `(transfer_id, target_doctype, target_name)` unique key before the settlement
   that needs it — failing the confirm on the happy path. The match run's suggestion therefore lives
   on **two read-only fields of the import row**, which go nowhere near that key. Do not "restore
   consistency" by moving them into the match table.
8. **The two expense doctypes are not twins.** `Project Expenses.amount` is a **Data** column of
   numeric strings; the non-project one is real **Currency**. `payment_by` exists only on the project
   side. `Non Project Expenses` has no vendor and no project column. Expense Type is **scoped** —
   `project=1` and `non_project=1` are disjoint, so switching ledger must clear the chosen type.
9. **Neither expense doctype has an approval date.** No field, no approver — only `Project Payments`
   records one (`approval_date` / `ceo_approval_date`). The search endpoint therefore returns
   `approved_on` for payments and `updated_on` (the modification timestamp) for expenses, under
   **separate keys**, and the screen labels them "approved" vs "updated". Merging them into one key
   would present a modification as an approval on two thirds of the list.
10. **`Outflow Import Row.remarks` must stay `Text`.** As `Data` it is `varchar(140)` and Frappe
    *throws* rather than truncating.
11. **A settle WRITES MONEY as of X1, and three things hold it safe.** The record takes the bank's
    amount whenever the two differ (`amounts.rewrite_amount`), both directions, all three ledgers.
    (a) **The ±₹5 guard still runs first** — the rewrite corrects what is written and never widens
    what may be written, so TDS is still unreachable. (b) **Every change is audited**, which is why
    the expense path had to move off `frappe.db.set_value` onto `doc.save()`: `set_value` skips the
    document lifecycle, so `track_changes` is inert for it and the rewrite would have left no record
    of who changed the figure or what it had been. (c) **The bank OVERPAYING rewrites too** — owner
    ruling, so this import can record spending slightly above an approval, and the Version log is
    the only thing that says so.
12. **That expense switch woke a third committer, and the suppression is narrow on purpose.**
    `project_cashflow_hold_update` is wired to `Project Payments` **and** `Project Expenses`
    `on_update`, and reaches a `frappe.db.commit()` in ONE branch — notifying the holder of a manual
    CEO Hold that has become releasable. `settle.py` sets `frappe.flags.outflow_import_settling`
    around its saves and that branch bails on it. ⚠️ **It guards the NOTIFY, not the RECOMPUTE:**
    `sync_cashflow_reason` never commits, so the gap still recalculates inside the import's
    transaction. A request-level flag rather than `doc.flags` because the commit sits in an inner
    helper that never sees the doc — restored in a `finally`, never blindly cleared. Two side notes:
    the payment path had been exposed to that same commit since V2 (X1 closes it, does not open it),
    and **settling an expense never moved the CEO-Hold gap at all before X1**, because `set_value`
    fires no hooks.

---

## The screen

**ONE screen (X3 + X4), and the shape reversed there.** Until X3 a SHEET was a place: a list of
imports → open one → see its rows, which existed only inside it. Now the **transactions** are the
thing — one master table across every import at `/bulk-import-outflow` — and an import is an
*attribute* of a row: a column, a filter, and the subject of the summary panel above.

- **The table is SERVER-paged, filtered, sorted and searched** (`review.get_outflow_rows`). The
  client filter engine (`matchesQuery` / `passesFilters` / `visibleRows` / `facetValues`) was
  **deleted, not bypassed** — two engines answering "which rows match" disagree the day one is
  edited. What survives in the pure model is `serverQuery`, which owns the *meaning* of a filter;
  SQL owns the *application*. `rowsForTab` / `tabCounts` went too: the tab numbers now come from
  the endpoint, computed **under the current filters**, so a search matching four rows can never
  show "Settled 812" beside it.
- **The per-column funnels survived the move**, and keeping them was deliberate — dropping them
  would have been a silent capability cut in a refactor. Their distinct values come from
  `get_outflow_facet_values` over the whole filtered table, fetched lazily on first open. ⚠️ That
  endpoint deliberately does **not** apply the funnel's own selection: a funnel that filtered its
  own options would collapse to whatever is ticked and offer no way back.
- **Default scope is the open work** (owner ruling) — a worklist first, an archive second.
- **`/bulk-import-outflow/:id` is KEPT** and renders the same page pre-scoped to that import, so
  every pre-X3 link still resolves. `/new` is gone; uploading is a dialog.
- **Three tabs — Pending / Settled / Skipped** — plus the per-row decision dialog, unchanged.
- **The summary panel above summarises ONE import while the table spans all of them.** That is the
  design: "how did that statement go?" and "what do I still owe a decision on?" are different
  questions. ⚠️ **The status figures REPORT; they do not scope (owner ruling 2026-08-10).** They
  used to be buttons that re-filtered the table to their own status set. Two things were wrong with
  that: a panel describing ONE import silently rewrote the filters of a table spanning ALL of them,
  and the click **moved the tab** as a side effect, so reading a figure navigated away from the work
  in progress. The `SummaryTile.statuses` field and `tabForStatus` are deleted with the click —
  scoping lives in the Status column's own filter, and nowhere else.
- **The import dialog runs the match itself** and closes only when it is done — there is no case
  where somebody imports a statement and does not want it matched. A manual **Re-run match** stays
  on the summary, because re-running is normal (payments get hand-ticked all day). ⚠️ If the upload
  succeeds and the match then fails, that is reported as a MATCH failure — the rows *are* staged,
  and saying "upload failed" would send someone to re-import a statement that is already in.
- **"Confirm all matched" is CONFIRM, never APPROVE** (owner ruling 2026-08-09). This feature never
  approves anything; a button saying otherwise would tell an accountant they are approving payments.
  It acts only on `Matched` rows **carrying a stored suggestion** — a row that matched several
  records has nothing to confirm against and is listed read-only as "needs you". It loops **one call
  per row**, preserving the per-row savepoint isolation, and shows each row's **amount delta before
  the click** (since X1, confirming rewrites amounts).
- ⚠️ **EVERY AMOUNT DELTA IS FORMATTED TO THE PAISE, never with `formatToRoundedIndianRupee`.** That
  formatter `Math.ceil`s, and **nearly every correction this feature makes is sub-rupee** — 313 of
  them on the first real statement, all under a rupee. Rounded, the confirm dialog's change notice
  read `₹27,504 → ₹27,504`: a warning showing no change, on the screen where the reviewer is being
  asked to authorise it; and the candidate tables read `off by ₹1` for a 31-paise gap. The three
  delta/gap sites (`ConfirmAllMatchedDialog`'s before→after pair, `SettleableRecordTable`'s
  `AmountMark`, `DecisionDialog`'s two "differs by" lines) use the exact `formatToIndianRupee`.
  Plain amounts elsewhere keep the rounded form — the rule is about **differences**, where the
  rounding is the entire signal.

Everything that is not a React semantic lives in the pure `outflowTableModel.ts`, because
there is **no DOM test environment in this repository, by deliberate choice**: the table, the dialog
and the selection behaviour are structurally untestable here and the honest verification is a live
browser walk.

- **Decisions are client state until confirmed.** A reviewer works down the list and confirms a batch
  of rows; nothing is written until they do. That is why the bulk bar counts **decided** rows, not
  selected ones — "Confirm 4 decided" when 5 are ticked.
- **A matched row is pre-selected before it is opened.** The match run stores its single pick on the
  row (`suggested_doctype` / `suggested_name`); the page seeds every untouched row's decision when
  the batch loads, and the outcome button NAMES the record. Seeding never overwrites a decision a
  reviewer made — including one they deliberately **cleared**, which leaves an entry with a null link
  and is what makes "cleared" distinguishable from "never touched".
- **Seeding is not settling.** It fills in the choice a person would have clicked; the row still has
  to be ticked and confirmed, and that confirmation is still the only thing that writes.
- **One "Link payment" list, not three ledger cards.** Picking a ledger first asks the reviewer a
  question the bank statement does not answer — a transfer to a vendor may have been raised as a
  Project Payment or booked as a Project Expense. The **ledger arrives with the chosen record**
  rather than from a card clicked beforehand.
- **That list is a RADIO TABLE, not a dropdown** (owner, 2026-08-07 — `SettleableRecordTable.tsx`).
  Type · Record · Vendor · Project · Approved/Updated · Amount are COLUMNS, so three approved
  records can be compared down the page instead of read as eight stacked facts three times over.
  The facts did not change; their arrangement did. Fixed **260px** height with the header sticky
  inside the scroll container, so the dialog's own height never moves however many records come
  back — a list that grows pushes Confirm, the one control the dialog exists for, out of reach. The
  column model lives in `outflowTableModel.RECORD_COLUMNS` so the header and body cannot drift, and
  it is a real `<input type="radio">` in a real radiogroup because this is the control that decides
  where money is written.
- **"Create a new expense" is HIDDEN, not deleted** — one `const` in `DecisionDialog.tsx`. The form,
  `RowDecision.newExpense`, the `new` branch of `isConfirmable` and the `create_expense` endpoint are
  all intact.
- **"Skip this row" is HIDDEN too** (owner ruling 2026-08-10), same treatment, same one `const`
  (`SHOW_SKIP_ROW`). `review.skip_row`, its required-reason guard, the `Skipped` status and the
  Skipped tab are untouched, and AUTOMATIC skips (failed transfer, already-recorded duplicate) still
  happen. ⚠️ **Consequence, stated rather than discovered:** linking an approved record is now the
  only way a person can resolve an open row, so a transfer with genuinely nothing to settle against
  — 145 of them on the first real statement — has no terminal state and keeps counting against
  "Still open". Closing the import does not change a row's status.
- **The Link payment table is FIVE columns, not six** (owner ruling 2026-08-10). The ledger label
  was its own `type` column and the sixth column pushed **Amount** off the right edge — the one fact
  that decides whether a record can be settled needed a horizontal scroll to reach. The label now
  stacks above the id it qualifies inside `Record`. A test pins the total width against the dialog.
- **Records outside the tolerance are shown and marked, never hidden.** Someone hunting a TDS payment
  needs to SEE the one that differs by ₹2,000 to learn it cannot be settled here; filtering it out
  looks like the record does not exist.
- **A manual skip requires a typed reason** (owner ruling). An automatic skip does not — making
  someone type "duplicate" forty times is theatre, not a control.

---

## Doctypes

| Doctype | Holds |
|---|---|
| `Outflow Import Batch` | one uploaded statement: source, period, counters |
| `Outflow Import Row` | one staged transfer + its derived outcome, resolved vendor, and the match run's `suggested_doctype`/`suggested_name` |
| `Outflow Row Match` | **settlements only** — a row here means money was written |

⚠️ **THERE IS NO "CLOSE IMPORT" (owner ruling 2026-08-10), and the reasoning is worth keeping so it
is not re-added as an obvious gap.** Closing stamped `closed_at` / `closed_by` / `close_reason` on
the batch and did nothing else: no row status changed, nothing froze, and once
`Completed with exceptions` was retired it stopped feeding the derived batch status too. The screen
showed a banner; no other code read the flag. At X3 an import stopped being a **place** — there is
one master table across every import — so "close this import" no longer marks anything as finished
with, and a control that writes three fields nobody reads is worse than no control, because people
reasonably assume it must do something. `close_batch` / `reopen_batch` / `get_close_preview` and
`CloseBatchDialog.tsx` are deleted; `test_close.py` went with them.

**The three fields stay on the doctype.** Dropping them is a migrate that destroys the close history
of every batch already closed, to save nothing. They are simply never written, and no longer
returned by `get_import_summary` or `list_imports`.

**Closing never converted open rows to `Skipped`** — a skip is a DECISION, and auto-skipping would
have manufactured decisions nobody made. That reasoning outlives the feature and is why no future
"finish this import" action may do it either.

---

## Known limits, accepted with numbers

- **TDS payments will not match.** 709 of 7,421 Paid payments carry TDS (9.6%). `tds` is written at
  fulfil time, so an approved unpaid payment has a blank one and `amount − tds` has nothing to
  subtract. A tolerance pass (Q11) and a TDS box (Q6) are **next version**.
- **No undo of a settle** from inside the import (Q9). Fix it in the payments screen.
- **Fan-out is report-only** (Q4) — which is why the existing UTR guard is never challenged.
- ~~**The paise difference is not recorded.**~~ **REVERSED 2026-08-09 (slice X1).** It used to say:
  *"Settling an ₹18,678.69 payment from an ₹18,679.00 transfer leaves the payment at ₹18,678.69.
  Accepted explicitly."* The record now takes the **bank's** amount, in **both directions**, on all
  three ledgers — see the invariant below. Kept struck through rather than deleted: both positions
  were held deliberately, and the next reader is entitled to see that.
- **There is no reverse view.** `get_reconciliation_report` was deleted at V5, and with it the answer
  to "is every payment we recorded backed by a real transfer?". The three tabs answer only "is this
  transfer recorded?". Deliberate scope decision, not an oversight.
- **Fixtures stay synthetic — the repo is public.** Real statements carry live beneficiary names,
  accounts and IFSC codes.

---

## Tests

| Suite | How |
|---|---|
| pure services (8 modules, 245 tests) | `python -m unittest discover -s nirmaan_stack/services/outflow_import -t . -p "test_*.py"` — no bench needed |
| api (`test_upload`/`test_review`/`test_expenses`/`test_settle_payment`) | `bench --site localhost run-tests --app nirmaan_stack --module nirmaan_stack.api.outflow_import.<module>` |
| frontend | `yarn test` (vitest, `node` environment — pure helpers only) |

⚠️ **Never run the bench suite and a browser session against localhost together** — they collide on
the `tabSeries` naming lock.
⚠️ **The api suites write to the LIVE dev database** and purge in teardown. If `setUpClass` raises,
residue survives — clean with `frappe.db.delete` on the three doctypes filtered to
`source_file LIKE '%test-statement.csv'`.
⚠️ **The api suites also SEE the live ledger.** An assertion that pins an exact candidate count will
fail when real data drifts; assert partitions and invariants, and where a specific amount matters,
assert the precondition so a drift reports itself instead of looking like a broken deriver.

⚠️ **Every fixture payment in `test_review` carries its own row's bank reference, so the bulk of that
suite exercises TIER 0 and nothing else.** `TestTheTierLadderEndToEnd` is the deliberate exception —
it plants junk-UTR payments plus a fabricated vendor and project to drive tiers 1 and 2 through the
real endpoint. It exists to cover the WIRING (that `_load_pools` loads a project index and that it
reaches `match_row`), which every pure test would pass without. Its **control** — row 0006, identical
in every respect except that its remark names no project, and which must stay `Mismatched` — is the
assertion that fails first if tier 2 ever stops requiring one.
