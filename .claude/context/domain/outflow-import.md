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
| The two amount windows (settle ±₹5, tier 1 ±₹1) | `services/outflow_import/amounts.py` (`AMOUNT_TOLERANCE`, `TIER1_TOLERANCE`, `amounts_match`) | hold a copy of either, **or add a comparison that is not on the list**. SIX call sites: both SQL pool queries, the matcher, the settle guard, the already-paid duplicate check, and (N1) `similarity._amount_score`. The sixth decides NOTHING — it shapes the order of a browse list — and is listed anyway, because the rule is "every amount comparison in this feature", not "every one that writes". `TIER1_TOLERANCE ≤ AMOUNT_TOLERANCE` always — a tier wider than the settle window offers a record the confirm then refuses. The fifth site was *missing* until 2026-08-07 and flagged 8 of 26 rows in a live statement as discrepancies over sub-rupee rounding |
| What amount a settle WRITES (X1) | `services/outflow_import/amounts.py` (`rewrite_amount`) | decide it at a write site. It is **not a sixth window site**: the window already gated the pool and the write guard already re-asserted it, so this answers only "do these differ at all". ⚠️ Do not "finish" it by giving it a tolerance — that would put a second, quieter opinion about what may be settled inside a function whose job is to say what the number is |
| Does a remark name a project? | `services/outflow_import/project_match.py` (`build_project_index`, `ProjectIndex.sole_project`) | re-derive it. Tier 2 auto-suggests on this predicate, so a second copy is a second opinion about where money goes |
| Which words count when comparing free text to a master name | `services/outflow_import/project_match.comparable_tokens` (public since N1) | grow a private twin. Two readers now — tier 2's project index and the browse ranking — and a second copy would drift: change the length floor in one and the ranked list quietly stops agreeing with the matcher about what a word even is. ⚠️ Sharing the TOKENISER is not sharing a POLICY |
| How the browse list is ORDERED | `services/outflow_import/similarity.py` (`SimilarityPolicy`, `build_row_signals`, `score_record`, `ranked_records`) — N1 | let it reach anything that SETTLES. `matcher`, `disambiguate` and `status` must not import it, directly or transitively (pinned by a test both ways). Its weights exist to be tuned against reviewer feedback; a tweak made because a list felt wrongly ordered must not change which transfers move money unattended. It also must not reuse `matcher.VendorScoringPolicy` — sharing the dataclass retunes the matcher every time the list is retuned |
| Filtering + sorting that list on screen | `frontend/src/pages/outflow-import/recordPickerView.ts` — N1 | re-score a record in the client. The server sends the pool already ranked; `sortRecords(records, null)` MEANS "keep that order". A second scoring implementation here would be free to drift, and the symptom — a list ordered differently from the reasons printed on it — is invisible to every test on either side |
| What may be settled, and from which status; and WHEN a record was decided | `services/outflow_import/ledgers.py` (`SETTLEABLE_STATUSES`, `settleable_statuses`, `DECIDED_ON_SQL`, `decided_on_sql`) | carry its own Approved-only list. Read by `candidates.py` (what may be OFFERED) and `settle.py` (what may be WRITTEN) so the two can never disagree about one record |
| Bank row → target matching | `services/outflow_import/matcher.py` (`match_row`, `match_by_reference`, `match_payments`, `match_expenses`, `resolve_vendors`) | decide anything. It PROPOSES ranked candidates; `status.py` derives the outcome and a person makes the choice |
| Choosing BETWEEN several admitted candidates | `services/outflow_import/disambiguate.py` (`pick_from_several`, `pick_note`, `RULE_*`) — the pure half; `review._disambiguate_matched` owns the writes | add a fourth way to separate candidates. It is **not a tier** and must never live in `matcher.py` — it cannot introduce a record the ladder did not admit |
| Which row keeps a contested record | `services/outflow_import/claims.py` (`resolve_claims`, `claim_note`) — pure; `review._enforce_single_claim` owns the writes | let two rows hold one record. `sole_suggestion` answers per row and cannot see the contest |
| How a suggestion was chosen | the `suggestion_rule` field + `disambiguate.RULE_LABELS` | invent a label. BLANK means "no suggestion", never "no rule" |
| Reading approved-and-unpaid across the three ledgers | `services/outflow_import/ledger_read.py` (`LEDGER_SOURCES`, `approved_rows`, `approved_count`, `approved_projects`) | write a fourth query that knows the three ledgers' asymmetries. `review._search_one_ledger` is the OTHER caller and stays separate deliberately |
| The settlement write | `services/outflow_import/settle.py` + the one orchestrator `api/outflow_import/expenses.settle_row` | write to a ledger from anywhere else in this feature |
| Candidate pool queries | `services/outflow_import/candidates.py` | query a ledger for candidates inline in an endpoint |
| Browsable approved records (hand-linking) | `api/outflow_import/review.search_settleable_records` (+ `_search_one_ledger`, `_rank_browse_records`, `_browse_cap`) | reuse `get_row_candidates` for browsing — that is the MATCHER's output, and when the matcher finds nothing it is empty, which is exactly when hand-linking is needed. Since N1 it returns the WHOLE approved pool by default and `limit` is a safety ceiling, not a page size |
| What counts as "decided" on the screen | `frontend/src/pages/outflow-import/outflowTableModel.ts` (`isConfirmable`) | gate a confirm button on its own predicate — the dialog and the bulk bar both read this one |
| Which rows the master table shows (X3) | `api/outflow_import/review.get_outflow_rows` (+ `_row_filters`, `_scope_clause`, `get_outflow_facet_values`) | filter, sort or search rows in the browser. ⚠️ `_row_filters` is ONE builder shared by the page query, its count, the tab counts and the facet values — a count computed under different filters than the page it labels is a lie that looks like a paging bug |
| What the screen ASKS for (X3) | `outflowTableModel.serverQuery` | build endpoint params at a call site. It owns the MEANING of a filter; SQL owns the application |
| One import's aggregate (X2) | `services/outflow_import/status.py` (`derive_import_summary`, `StatusTally`) | count or sum an import anywhere else. The DB does the `GROUP BY`; this assembles |
| Seeding decisions from the match run | `outflowTableModel.ts` (`suggestedDecision`, `seedDecisions`, `decisionOrigin`) | pre-select inside a component; the dialog used to, and it could only fire once a row was already open |
| Grouping + pairing interchangeable transfers | `services/outflow_import/stacks.py` (`stack_key`, `group_into_stacks`, `pair_stack`, `stack_note`, `stack_surplus_note`) | decide a stack's membership, its pairing, or why it did not pair, anywhere else. `review._resolve_stacks` owns the DATABASE half and nothing more |
| Access | `api/outflow_import/permissions.require_outflow_access` | gate an endpoint any other way |

---

## Status vocabulary

Six row statuses. `status.py` is the only deriver.

| Status | Means | Reviewer does |
|---|---|---|
| `Pending match run` | staged from the sheet, nothing looked up | press Run match |
| `Matched` | ≥1 **approved** record found at this amount | confirm it |
| `Mismatched` | this transfer did not line up — **three causes, one status** | create, link, or pick one |
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

### ⚠️ A THIRD cause joined `Mismatched` (owner ruling 2026-08-11)

`_sweep_unresolved_to_mismatched` moves a row that found **several** approved records and had none
picked out of `Matched` — which shares a tab with `Settled` under the reviewer's heading *"this
transfer has a record"* — and into the Not-Matched worklist, where the decision is.

    _nothing_found_note   nothing matched at all          -> record or link one
    _delta_note           already Paid, amounts disagree   -> a deduction such as TDS
    several_found_note    several matched, none chosen     -> pick which one

**The dangerous pair is the FIRST and THIRD**, and it is why the third sentence had to exist before
the sweep could ship: telling a reviewer *"no approved payment or expense matches this transfer"*
about a transfer that matched six sends them to create a duplicate expense for money that is already
approved and waiting. Pinned by `test_status::test_all_THREE_mismatched_causes_stay_distinguishable`.

⚠️ **THE SWEEP NEVER TOUCHES A FAN-OUT, AND THAT COST A RED TEST TO FIND.** A fan-out is `Matched`
with no suggestion **by design** — one transfer covering several payments, carrying no
`suggested_name` only because a `(doctype, name)` pair cannot hold a GROUP. It is report-only by
ruling Q4, so it is meant to sit in `Matched` and say what it found. The guard reuses
`_disambiguation_candidates`, which already abstains on a set containing a fan-out, rather than
re-deriving "is this a fan-out" — the second opinion that list's docstring exists to warn about. A
single-candidate row is skipped on the same terms.

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

## The match run, in order — one per-row loop and FOUR global passes

`review.match_batch` is the only orchestrator. **The order is load-bearing at every joint** and each
comment in that function says which defect the position prevents.

```
for each unfrozen row:  match_row -> derive_row_outcome -> _persist_row_outcome
1. _enforce_single_claim         (claims.py)        a record is claimed once
2. _disambiguate_matched         (disambiguate.py)  Option B: separate several candidates
3. _resolve_stacks               (stacks.py)        pair interchangeable sets
4. _sweep_unresolved_to_mismatched                  leftovers read as Not-Matched
   _refresh_batch_rollup + commit
```

- **All three run AFTER the loop, never inside it.** `_persist_row_outcome` CLEARS every suggestion
  it does not re-find, so anything written mid-loop is wiped by the next row's clear.
- **Claims before Option B.** The claim pass frees records up; choosing between candidates while
  another row still held one would only produce a pick for the claim pass to release.
- **Option B before stacks.** The stack pass reads a `claimed` set built from the suggestions that
  now exist, so it must see a set already made consistent.
- **The sweep is LAST and could not be anywhere else.** "Several candidates and nobody picked one"
  only becomes a fact once every pass entitled to pick has declined, which is why it cannot live in
  `derive_row_outcome` — that runs in the per-row loop, before three passes have had their say.
- The run returns `stack_paired_rows` / `released_rows` / `rule_picked_rows` /
  `swept_to_mismatched_rows` beside the counters, so a run leaning hard on any pass is **visible
  rather than silent**.

---

## Several candidates, and the rules that tell them apart (Option B)

`sole_suggestion` pre-selects only when the matcher found EXACTLY ONE record. That refusal is right,
and on the first real statement it left **56 transfers with no pre-selection**. Measuring them showed
the evidence to separate the candidates was already on the row and nothing was looking at it.

**`disambiguate.py` decides BETWEEN candidates. It is not a fourth tier.** Every candidate it sees
was already admitted by the ladder and already passed the settle window, so it cannot widen what may
be matched — which is exactly why it does not live in `matcher.py`. It cannot widen what may be
SETTLED either: a pick is a PRE-SELECTION, the person still confirms, and `settle_row` still
re-asserts status and amount under a row lock.

| Rule | Fires when | The fence, and why |
|---|---|---|
| **M1** `project-in-remark` | the remark names exactly one project and exactly one candidate is on it | the ONLY rule allowed to fire across projects — it is the only one holding evidence about *which* project |
| **M2** `nearest-amount` | one candidate is strictly nearer the bank's amount than every other | **FENCED to a single project.** Across projects, 8 paise closer is not evidence about which job the money was for; within one project the worst case is the wrong document on the right job |
| **M3** `interchangeable` | every candidate is on the SAME project at the SAME amount | **FENCED HARDER** — and switched OFF for stack members (below) |
| **M4** `nearest-decision-date` | one candidate was decided strictly nearest the day the money moved, within **±3 days** | **NOT FENCED** — an owner ruling, held as the flippable `NEAREST_DATE_FENCE_TO_ONE_PROJECT` |

Measured: ready **807 → 833**, needs-a-person **56 → 30**.

### M4 — the nearest decision date (2026-08-11)

**Where the date comes from is `ledgers.DECIDED_ON_SQL`, the one owner:** payments use
`COALESCE(ceo_approval_date, approval_date)` (CEO first — a payment needing that signature is not
payable until it exists, and the two differ by days on exactly the high-value rows); **both expense
doctypes use `modified`, because neither has an approval date, an approver, or an approval step at
all.**

⚠️ **THAT MERGE IS FORBIDDEN ON THE APPROVED INBOX AND PERMITTED HERE, AND THE DIFFERENCE IS THE
WHOLE LICENCE.** `ledger_read.py` keeps `approved_on` and `updated_on` apart because a human reads
that column and a modification timestamp is not a sanction. `decided_on` is a MATCHING input nobody
reads as a label — **so every note built from it MUST name which date it used** (`_date_source`).
Without that, a reviewer cannot tell an approval from someone fixing a description, on the screen
where money is authorised.

⚠️ **M4 RUNS LAST, WHICH IS WHAT MAKES IT PURELY ADDITIVE** — it fires only where
`pick_from_several` previously returned None, so no M1/M2/M3 pick already in the database moves
because of it.

⚠️ **THE SINGLE-PROJECT FENCE HAD TO BECOME A BRANCH.** It used to `return None`, so a cross-project
set left the function outright and **no rule written below it could ever see one**. M4 is unfenced,
so it sits outside that branch — inside, it would have been silently reduced to the single-project
half of its own measurement.

⚠️ **A STACK MEMBER STILL REACHES M4.** M3's fence used to `return None`, short-circuiting it — but
declining M3 says only *"do not pick ARBITRARILY between interchangeable records"*, which is why M1
and M2 were always left on for stack members. M4 is evidence, so it belongs on the same side of that
line. Measured cost of the bug: two rows whose candidates were decided **seven days apart** were
handed to a person as though nothing distinguished them.

⚠️ **MEASURED HONESTLY, IT RESOLVES 2 OF 30 — not the 8 first projected.** Nearly every ambiguous row
is in a stack sharing one candidate pool, so the first row takes the nearest record and its siblings
find it gone. **A measurement that does not accumulate claims as the real pass does overstates this
by a factor of three**; two successive estimates (8, then 6) were wrong for exactly that reason. The
rest are batch approvals — identical dates, where the rule is silent by construction.

⚠️ **A BLANK PROJECT IS NOT A PROJECT.** If any candidate has no project the single-project fence
FAILS, so M2 and M3 stay out. Treating blanks as equal lets a missing value stand in for evidence,
which is the whole failure the fence exists to prevent.

⚠️ **M3 MUST BE OFF FOR A STACK MEMBER, AND THIS IS AN OWNER RULING, NOT A DETAIL.** An unbalanced
stack pairs NOTHING, not even partially; M3 applied per row does exactly that partial pairing — the
first six transfers each take a record and the seventh finds them all claimed. **Measured when it
shipped unfenced: 62 of 65 interchangeable picks landed on stack members and the leftovers screen
fell from 6 stacks to 3, because the pass had quietly consumed the difference.** The caller passes
`allow_interchangeable=False` for any row in a stack. **M1 and M2 stay ON for stack members**, and
that distinction IS the ruling: they act on evidence about one specific transfer; arbitrary-among-
interchangeable is the case the stack machinery owns.

⚠️ **CLAIM-AWARENESS IS WHAT MAKES M3 WORK.** Seven transfers against eight twin records only resolve
if each takes a DIFFERENT one, so the caller feeds back what it has already handed out. Without it
every twin row picks the same record and `_enforce_single_claim` releases all but one — turning the
best-covered rule into the worst.

### A record is claimed once (`claims.py`)

`sole_suggestion` asks a question about ONE row and answers it independently for every row, so **two
transfers can each correctly find the same single record**. Five records were in that state across 15
rows on the first real statement; **ten of the 807 confirms were doomed with `AlreadyPaidError`
before anybody pressed the button.**

⚠️ **THE VENDOR ROLLUP IS WHY THIS BECAME URGENT RATHER THAN MERELY WRONG.** The rival transfers are
usually to DIFFERENT beneficiaries — one record was suggested to four of them. A flat list sorted by
amount puts them near each other, so a person could notice. **A tree grouped by vendor puts them in
four separate branches and the conflict becomes invisible from every screen position.** The rollup
does not create the defect; it removes the last chance of seeing it.

- ⚠️ **`_resolve_stacks` already guarded this, and only for itself** — it reads a `claimed` set so the
  stack pass cannot take a record a 1:1 row holds. Nothing protected the per-row loop from itself.
- **`releasable` is the scope fence.** The pass READS across imports and WRITES only inside the batch
  being matched: clearing another import's pre-selection is not filling a blank, so it does not get
  the licence `_resolve_stacks` has. An unreleasable claim always wins.
- Contenders are ordered by `(added_on, row name)` — the name is unique, so no tie survives to be
  broken by query order, the same guarantee `pair_stack` relies on.

### ⚠️ `suggestion_rule`, `match_basis` and `auto_matched` answer THREE different questions

Blank used to mean both "no rule" **and** "no suggestion", and that ambiguity filed **112 arbitrary
stack pairings under "Only candidate"**.

| Field | Answers | Vocabulary |
|---|---|---|
| `suggestion_rule` | **how** was this one record chosen? | `sole` · `stack-pairing` · `project-in-remark` · `nearest-amount` · `interchangeable` |
| `match_basis` | **which tier** found the counterpart? | the tier ladder |
| `auto_matched` | Check, **stored** not derived, so Desk can filter on it | written in the SAME `set_value` as the pair at every site, so it cannot drift |

**Blank `suggestion_rule` now means only that there is no suggestion.** `RULE_SOLE` and
`RULE_STACK_PAIRING` live in `disambiguate.py` although it never produces them, because the FIELD
needs one vocabulary rather than one per writer.

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
13. **A FAILED transfer is excluded from every figure the import summary reports** (owner ruling
    2026-08-10, "option B", chosen over dropping the row entirely). It is money the bank refused to
    move: counting it in `total_value` overstates the statement by exactly the amount that never
    left the account, and counting it in `total_rows` makes `decided_percent` a percentage of work
    that does not exist. ⚠️ **THE ROW IS STILL STAGED** — that is the whole of what option B chose
    over option A, and the evidence that the bank rejected a transfer survives on it. What was
    removed is its effect on the numbers, never its existence.
    - The split happens in the **aggregate**: `get_import_summary` groups by `(row_status, failed)`,
      because `Skipped` covers three different facts (failed at the bank, a duplicate, a payment
      hand-ticked Paid) and only the first leaves the figures.
    - ⚠️ **`StatusTally.failed` tallies are excluded from `by_status` TOO**, so
      `sum(by_status counts) == total_rows` still holds *in the aggregate*.
      **⚠️ THE SKIPPED CHIP NO LONGER RENDERS THAT FIGURE (owner, 2026-08-11).** `derive_import_summary`
      is UNCHANGED — `skipped_rows` is still 20 — but `summaryTiles` renders
      `skipped_rows + failed_rows`, because `row_status` is `Skipped` on all 47 and the chip is now a
      **door**: it opens the Skipped dialog, which holds 47. A chip reading 20 that opened a list of
      47 read as a bug however right both numbers were. The accepted cost is the one this bullet
      originally forbade — the four chips now sum to `total_rows + failed_rows` — and it is paid down
      by the split line beneath them (`N refused by the bank · N auto-skipped · N by hand`), which
      accounts for the chip exactly. **The failed footnote had to change with it:** it used to say
      "excluded from every figure above", which stopped being true the moment the chip counted them;
      it now names the MONEY figures only. Anything that reverts the chip must revert that sentence
      too, or the panel contradicts itself again in the other direction.
    - **`get_outflow_rows` takes `failed`** (tri-state: absent = both halves) so the two facts inside
      `Skipped` can be asked for separately — the Skipped dialog's `All / Already paid / Bank refused`
      control. It binds `parser.BANK_SUCCESS_STATUS` rather than spelling `'SUCCESS'` a second time,
      and it lives in `_row_filters`, so a filtered view's tab counts move with it.
    - ⚠️ **`auto_skipped` excludes them on the same terms**, or `manually_skipped_rows`
      (`skipped_rows - auto_skipped`) subtracts rows its minuend no longer contains.
    - `status.py` stays ignorant of the bank's vocabulary. The single definition of "successful" is
      `parser.is_success_status` / `parser.BANK_SUCCESS_STATUS`, which the SQL **binds** rather than
      spelling `'SUCCESS'` a second time. `RawRow.is_success` calls the same function.
    - **`gross_amount` already excluded failed rows at parse time and always had** — do NOT subtract
      them again anywhere downstream, or the same money is deducted twice.
    - Reported only as `failed_rows` / `failed_value`, which the summary panel renders as a
      footnote. ⚠️ **If that line goes, option B silently becomes option A.**
14. **`get_confirmable_rows` returns THREE buckets, and the third exists because two screens
    disagreed.** The summary panel's button reads `confirmable_rows` from `get_import_summary`,
    which counts `Matched` rows carrying a `suggested_name` **without checking the name still
    resolves**; the dialog checks. A row whose suggested record was deleted since the match ran was
    therefore inside the button's count and silently absent from the dialog — live-observed as
    *"button 688, table 893"*, where both numbers were right and nothing on screen reconciled them.
    - `matched_rows = ready + stale + needs_you`; `confirmable_rows (the button) = ready + stale`.
    - `needs_you` = the matcher found SEVERAL records and deliberately picked none. `stale` = it
      picked one and that record is gone. **Different problems, different fixes** — folded together,
      the gap was unexplainable from the screen.
    - ⚠️ **The fix is NOT to make the two numbers equal.** They measure different things and should
      not be forced to agree; the fix is that the funnel is now stateable, and the dialog states it.
15. **The settled record takes the statement as its `payment_attachment`, into a BLANK ONLY** (owner
    ruling 2026-08-10). All three ledgers spell the field the same way; the write is
    `settle.apply_statement_attachment`, called **before** `doc.save()` so the attachment rides the
    same save, the same audit Version and the same savepoint as the settlement — a write afterwards
    could survive a rolled-back settle.
    - ⚠️ **Blank-only is the same rule the `utr` write follows** (Q5b), for the same reason:
      `payment_attachment` is where an accountant puts the proof of THIS payment. Replacing that
      with a thousand-row statement swaps specific evidence for general evidence on a field nobody
      asked us to touch. A record that already has a proof keeps it.
    - ⚠️ **Copying the URL copies a link, not a permission.** The statement is `is_private=1` and
      attached to the *import batch*; Frappe authorises a private file through the document it is
      attached to. `expenses._link_statement_file_to_target` creates the second `File` row that
      makes it openable from the payment or expense.

16. **The browse ranking must never reach anything that SETTLES** (N1). `similarity.py` orders a list
    a person reads and then confirms; `matcher`, `disambiguate` and `status` decide what moves money.
    The weights in `SimilarityPolicy` exist **precisely to be tuned** against reviewer feedback — so
    if the two were connected, a tweak made because a list *felt* wrongly ordered would change which
    transfers settle unattended, and nothing would report it. Pinned **both ways** by
    `test_similarity.TestThePolicyIsSeparateFromTheMatchers`: `similarity` imports none of them, and
    none of them mentions `similarity`.
    - ⚠️ **The same reasoning forbids reusing `matcher.VendorScoringPolicy`.** The numbers are
      deliberately similar — they came from the same vendor master and it would be perverse to
      disagree with them for no reason — but sharing the dataclass would retune the matcher every
      time the browse list is retuned, which is the connection this invariant exists to prevent.
    - ⚠️ **Sharing the TOKENISER is not sharing a POLICY.** `project_match.comparable_tokens` is
      public and read by both, on purpose: "which words count" must have ONE owner or the ranked list
      quietly stops agreeing with the matcher about what a word even is. The WEIGHTS are what stay
      apart.
    - ⚠️ **That `File` insert runs AFTER the commit and outside the savepoint, and must never
      raise.** A `File` insert wakes the cloud-attachment hook, which commits inside the request —
      inside the caller's savepoint that would make the per-row rollback a silent no-op. And by the
      time it runs the money is already written, so failing the request would report a successful
      settlement as an error and invite a retry against a record that is already Paid. It logs and
      swallows; the degraded outcome is "the attachment may 403", which is far smaller.
    - A newly created expense always takes it — a record born from a statement should carry it.

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
- **Default scope is the work, not the archive** (owner ruling) — a worklist first. Since the retab
  that default is `not_matched`, **narrower than the old `open`**, which also held `Matched`.
- **`/bulk-import-outflow/:id` is KEPT** and renders the same page pre-scoped to that import, so
  every pre-X3 link still resolves. `/new` is gone; uploading is a dialog.
- **Three tabs — All / Not-Matched / Matched & Settled** (owner ruling 2026-08-10, replacing
  Pending / Settled / Skipped) — plus the per-row decision dialog, unchanged.

  | Tab | Scope | Holds |
  |---|---|---|
  | All | `all` | everything **except Skipped** |
  | Not-Matched | `not_matched` | `Pending match run` · `Mismatched` · `Error` |
  | Matched / Settled | `matched` | `Matched` · `Settled` |

  ⚠️ **`Skipped` HAS NO TAB, AND IS EXCLUDED FROM `all` TOO.** "All" means everything a person might
  still act on, not every row. Skipped rows are bookkeeping — a failed transfer, a duplicate, a
  payment already ticked Paid by hand — and **the import summary panel's auto/manual split line is
  now the ONLY place they are reported.** Delete that line and a skipped transfer becomes invisible
  rather than merely out of the way. Pinned by `test_no_scope_will_show_a_skipped_row`.

  ⚠️ **`all` CARRIES A REAL WHERE CLAUSE NOW.** It used to fall through to "no clause", correct when
  it meant every row. `_scope_clause`'s unknown-scope fallback had to change with it — it falls back
  to **`all`**, not to no-clause, or a typo'd scope leaks skipped rows into the one view nobody
  would think to check.

  ⚠️ **`Matched` AND `Settled` SHARE A TAB, pairing an OPEN status with a TERMINAL one.** That is
  the reviewer's grouping ("this transfer has a record"), not the vocabulary's, and it has a
  consequence: **row selection is PER ROW, not per tab.** The old table took one `selectable`
  boolean because the tabs partitioned open from terminal; they no longer do, so the page passes
  `selectableRowNames` (derived from `OPEN_ROW_STATUSES`) and select-all acts only on those. The
  checkbox `<td>` still renders — empty — for an unselectable row, or every later cell in that row
  shifts one column left.

  `tab_counts` is keyed by SCOPE name, and every count is derived from `_SCOPE_STATUSES` rather than
  a second hand-written list — a count that disagrees with what its tab shows is worse than none.
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

## The confirm dialog is a TREE, and the Skipped chip is a DOOR

**833 rows in a flat list with one checkbox each is not a thing anyone reviews; grouped by vendor it
is.** `buildConfirmTree` / `confirmSelectionSummary` / `toggleNode` are pure and vitested — the rest
is a browser walk, because there is no DOM test environment here.

- **The project level renders only when it has something to say.** 147 of 210 vendors sit on exactly
  ONE project and 79 have a single transfer, so a rigid three-level tree was two expands to reach one
  row, past a middle level repeating what the vendor row already said. A single-project vendor reads
  inline: `Sri Sai Enterprises - Nagarjuna Olive`.
- **The summary bar is a SAFETY CONTROL, not a status line.** It states what the button will WRITE at
  all times, including the one figure that appears nowhere else: **how many approved AMOUNTS the
  confirm will rewrite** (312 of 807 on the real statement, nearly all sub-rupee). It also carries
  *"N selected are hidden by these filters"* — **selection survives filtering**, so without it you
  could narrow to one vendor, read 12, and confirm 142.
- ⚠️ **THE SHARED CHECKBOX CANNOT SHOW "PARTIAL", and it fails in the dangerous direction.** Radix
  mounts the Indicator for `indeterminate` too, so a half-selected vendor rendered with a **TICK**.
  `components/ui/` is shadcn-generated and not ours to edit, so the third state is drawn in this
  dialog — Radix keeps the state, the keyboard behaviour and `aria-checked="mixed"`; only the mark is
  ours.
- The confirm payload carries **which order** the record is against — 602 Procurement Orders against
  193 Service Requests on the real statement, so it is never labelled "PO" wholesale.

**`useOutflowRows` extracts the table's whole query** so the Skipped dialog can share it. Selection
and decisions deliberately stayed on the page: it is a worklist, the dialog is read-only, and folding
those in would hand the dialog affordances it must not have behind a flag. **The dialog is read-only
BY CONSTRUCTION** — `Skipped` is terminal so the table renders no action, and an empty
`selectableRowNames` removes the checkbox column. Its `All / Already paid / Bank refused` control is
what makes the split inside `Skipped` actionable.

---

## The Resolve dialog's record list — the whole pool, ranked (chunk N1, 2026-08-11)

The Link-payment table inside `DecisionDialog` is the ONE way a person resolves a Not-Matched
transfer. It is a **browse** list, not the matcher's output, and until N1 it was ordered by amount
alone.

### What was wrong, in two parts

`search_settleable_records` asked each ledger for **50 rows ORDERED BY AMOUNT CLOSENESS** and cut the
merge to 50. Both halves bit:

- **The right record was INVISIBLE unless its amount happened to be near.** The vendor could be right
  and the project could be right and it still would not appear. Typing in the search box was the only
  way to reach it — and that box re-queried the SERVER on every keystroke.
- **A whole ledger could vanish.** 50 near-amount payments filled the merge before the 14 approved
  project expenses could get in, from a list that claims to span all three.

### The ranking (`services/outflow_import/similarity.py`)

Owner priority, 2026-08-11: **project > vendor name > vendor nickname / contact person > amount.**

| Owner decision | Ruling |
|---|---|
| **Q1b** | A **weighted sum**, not a strict tier ladder. The project signal comes from free-typed remark text — the noisiest input in this feature — so an exact vendor name plus a nickname plus an identical amount must be able to outrank one loose shared project word. |
| **Q2** | **Settleability is a HARD SPLIT above the score**, not a fifth axis. A record `settle.py` would refuse can never sit above one it would accept. Unsettleable records are still **returned and ranked among themselves** — a TDS hunter has to SEE the one that cannot be settled in order to learn that it cannot. |
| **Q3** | **Both bank fields feed both text axes.** The matcher keeps `beneficiary_name` and `remarks` apart because each tier stands on one clean signal; a browse list that refuses to look in both just fails to find things. |

Sort key, and every part is load-bearing:
`(not settleable, -total, |amount − bank|, doctype, name)`. **It ends in a unique field on purpose** —
`(doctype, name)` is unique across the three ledgers, so the order is TOTAL and two loads of the same
dialog cannot disagree.

⚠️ **IT READS `ProjectIndex.projects_mentioned`, NOT `sole_project`.** `sole_project` abstains the
moment two projects fit — exactly right for tier 2, where inventing an answer settles money on a coin
flip. Ranking is under no such obligation: it boosts **both** and lets the reviewer choose. **The
asymmetry is deliberate and must not be "made consistent".**

⚠️ **A MISSING FIELD SCORES ZERO AND IS NEVER A PENALTY.** Non Project Expenses have no vendor and no
project *at all* — no column, no join to make — so every one of them scores on amount alone.
Penalising them would push an entire ledger to the bottom for having a different shape, which is a
fact about the data rather than evidence about the transfer.

**Measured end to end** on a real transfer (beneficiary `CoolFreez Systems Private Limited`, remark
`Alorica materials`, ₹5,00,000): 322 records returned against 322 approved on file, and the record
that transfer actually paid ranks **first**, on vendor-exact plus project-named. By amount it sits
₹88,000 away and would not have been in the old list at all.

⚠️ **HOW BIG THE POOL IS, IS NOT A FIXED FACT.** Measured twice on 2026-08-11, five hours apart:
**1,164 records, then 322** — the same pool, after a batch was settled. It drains as an import is
confirmed and refills as approvals happen. Both readings are far inside `_MAX_BROWSE` (5000). What
would NOT be fine is sizing a future decision on one reading of a number that moves 4× in an
afternoon.

### The screen (`recordPickerView.ts`, `RecordColumnHeader.tsx`)

Vendor, Project, Approved and Amount each carry a sort arrow and a filter — facets for the first two,
ranges for the last two. The pure model is `recordPickerView.ts`; the whole pool arrives in ONE call
so every narrowing is local, and the SWR key is stable per row (it used to carry the search text).

- **Q4 — the Approved column sorts a payment's approval date and an expense's update date TOGETHER.**
  ⚠️ `recordDateLabel` still renders them **apart** ("approved …" vs "updated …"). Ordering makes no
  claim about what a value MEANS; a LABEL does. Neither expense doctype has an approval date, an
  approver, or an approval step at all. **If `recordSortDate` ever feeds a label, that ruling has been
  broken.**
- **Q5 — Clear filters resets the filters AND the sort.** "Normal" is the similarity ranking, so
  `hasActiveFilters` counts a sort as active; otherwise a reviewer who has only sorted has no way
  back.
- Search is **token-AND across every field, in any order** — `hakimi 4471` finds what the old
  `LIKE '%needle%'` could not, because that needed the words in the order the record stored them.

---

## The approved inbox — what is sanctioned and not yet paid

A button on the tab strip (`ApprovedRecordsPanel`), opening `approved.list_approved_records` over
**`Project Payments` + `Project Expenses` + `Non Project Expenses`**. Filters: ledger, project,
search, sort. **Nothing here writes** — settling is still reached from a transfer, through
`settle_row`. A screen that could mark an approved payment Paid with no transfer in front of it would
be a second, quieter way to spend money.

⚠️ **THIS IS NOT THE DELETED REVERSE VIEW, and the two are one step apart.**
`get_reconciliation_report` went at V5 and read BACKWARDS from records already Paid — *"is every
payment we recorded backed by a real transfer?"*. This reads FORWARDS from records still Approved:
the queue this import exists to consume. It answers "what is waiting", not "what did we get wrong".

⚠️ **A BUTTON, NOT A FOURTH TAB (owner, 2026-08-11).** The three tabs are three SCOPES over ONE
population — `Outflow Import Row` — so their counts sit in a row precisely because they can be
compared and subtracted. This opens a view over three OTHER doctypes with no import row in it at all.
**`ml-auto` is load-bearing, not alignment taste**: pushing it to the far right is what stops it
reading as the next item in the sequence.

**`ledger_read.py` is ONE PLACE THAT KNOWS THE ASYMMETRIES, NOT ONE QUERY THAT HIDES THEM.** Each
ledger keeps its own `LedgerSource` — joins, amount expression, date expression, searchable columns —
written out in full; what is shared is the SHAPE every row comes back in. It is a second caller
alongside `review._search_one_ledger`, which stays separate deliberately. Each asymmetry below has
already caused a defect somewhere in this feature:

1. ⚠️ **Only `Project Payments` has an approval date.** `approved_on` and `updated_on` are SEPARATE
   KEYS and a row fills exactly one — a modification timestamp is not an approval and must never be
   rendered as one. One column would have presented it as one on 82 of 1,164 records.
2. ⚠️ **`Project Expenses.amount` is a DATA column of numeric strings.** The cast is **REGEX-GUARDED**
   so junk yields NULL rather than taking the whole page down: the record still appears with a blank
   where the number would be. There is no junk today (measured: zero); the column permits it, and the
   test plants some.
3. ⚠️ **`Non Project Expenses` has NO vendor and NO project column.** Selecting either is a hard SQL
   error, not a blank, so the literal NULLs are spelled out. **A project filter drops that ledger
   entirely** rather than contributing an always-false predicate — "which of these are on project X"
   has one honest answer for a doctype that records no project.

**Two defects the new tests caught before the screen did.** The project filter built its options from
ONE page of 200 rows against a set of 332, so a project could appear in the table and be missing from
its own filter — it is a DISTINCT query now. And the first union filtered OUTSIDE the subquery, where
`p.name` and `v.vendor_name` do not exist; every predicate now sits where its columns are, which also
lets the index on `status` work.

⚠️ **The totals are computed under the SAME filters as the page** — the `_row_filters` rule, on the
other side of the feature. **This feature has already shipped that defect once.** `by_ledger` is
returned beside the total because the three are not comparable.

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

## Stacks — several interchangeable transfers, several interchangeable records (chunk E)

A vendor with six approved payments of ₹9,000 and six transfers of ₹9,000. Row by row the matcher
correctly refuses to pick one; for the SET there is exactly one sensible outcome. 58 rows were in
that state on the first real statement.

**Membership** is `(normalized_account, EXACT amount)`, and both halves are load-bearing:

- **The account, never the beneficiary name.** A row with **no account is never stacked** — grouping
  on amount alone would put two unrelated vendors who both happened to be paid ₹9,000 into one
  stack, and a "balanced" stack of those auto-pairs strangers to each other's payments. It is the
  worst failure this module could produce and it is one missing guard away.
- **The amount is EXACT**, deliberately narrower than the ±₹1 window used everywhere else. A
  tolerance window **is not an equivalence relation** (1.00/1.90/2.80 overlap pair-wise but do not
  form a group), so grouping by one depends on iteration order. And there is nothing to absorb: the
  window exists for bank rounding between a transfer and a RECORD.

**Balanced stacks auto-pair (owner ruling 2026-08-10).** ⚠️ **This is an accepted risk, not a safe
inference.** Six payments of one amount may sit on six DIFFERENT PROJECTS, and nothing in a bank
statement says which transfer paid which. The owner took it against hand-pairing 58 rows a
statement. Two mitigations are part of the ruling and must not be dropped as cosmetic:

1. **Every auto-paired row says the pairing was arbitrary** and tells the reader to check the
   project (`stacks.stack_note`). Pinned at both the pure and endpoint layers.
2. **Pairing is deterministic** — by DECISION DATE first (below), else transfers by
   `(added_on, name)` and records by `(doctype, name)`, then zipped. Both keys end in a UNIQUE field, so no tie survives to be broken by query order. A
   reshuffle between runs would move a suggestion out from under a reviewer mid-decision.
   ⚠️ `pair_stack` re-sorts **both** sides itself rather than trusting `stack.transfers`; a function
   whose contract is "same input, same pairing" cannot delegate half of it to its caller.

**Unbalanced stacks pair NOTHING** — not even partially. With 7 transfers and 6 records, SOME
transfer settles nothing, and choosing which is a judgement about money.

### ⚠️ The "Resolve N stacks" screen is DELETED (owner ruling 2026-08-11)

`get_unpaired_stacks`, `_load_unstacked_open_rows`, `_stack_payload`, `UnpairedStacksDialog.tsx`, the
page button and the eight stack helpers in `outflowTableModel.ts` are all gone. Unbalanced stacks now
fall into the ordinary worklist as `Not-Matched` and are resolved like any other row.

⚠️ **THE EXPLANATION IT CARRIED HAD TO SURVIVE IT.** That dialog stated the surplus in words —
*seven transfers, six records, one settles nothing*. A row sitting in the worklist with a generic
"could not choose" tells a reviewer nothing about WHY it is unresolvable, and they would hunt for a
seventh record that does not exist. `stacks.stack_surplus_note` is that sentence, written by
`_resolve_stacks` onto every member. **Deleting a screen is allowed; deleting the reasoning it
carried is not.**

⚠️ **THE NOTE IS ONLY CORRECT COMPUTED ACROSS IMPORTS**, which is why the pass writes it from a read
that spans them — the other six transfers may sit in last month's batch, and a per-batch count would
state a surplus that is not the real one. Pinned by
`test_review::test_the_stack_pass_spans_imports`, which matches only the SECOND batch and asserts a
FIRST-batch row now carries the cross-import count.

⚠️ **IT IS NOT WRITTEN WHEN THE STACK HAS NO RECORDS AT ALL.** Empty means either "every record was
claimed by another transfer" or "the stack was DISQUALIFIED by a fan-out" — and the pass cannot tell
them apart. In the second case the row is a perfectly good fan-out MATCH carrying `_matched_note`,
and a surplus note would replace a true statement with a false one. **A note that cannot tell two
cases apart must assert neither.**

### The pairing key is DECISION DATE first, the arbitrary zip second (2026-08-11)

`pair_stack` builds every `(transfer, record)` pair that carries dates on both sides, sorts by
`(gap, transfer index, record index)` over already-ordered sequences, and assigns greedily; whatever
the date pass cannot speak for is zipped in the original order. It returns `StackPair` objects
carrying a **basis** — `date` or `arbitrary` — because a pairing decided by evidence and a coin flip
between twins are different facts, and a caller that cannot tell them apart must either waste the
evidence or overclaim on the majority.

⚠️ **NO DATES, OR EVERY GAP TIED, REPRODUCES THE OLD ZIP EXACTLY** — not by luck, but because the
greedy is keyed on the indices of already-ordered sequences, so a total tie IS the zip. The dateless
fixtures in `test_stacks` are the guard, and they assert the same pairings they always did.

⚠️ **EVIDENCE MEANS "STRICTLY NEARER THAN EVERY OTHER RECORD IN THE STACK", not than the ones still
free** — judged against the free ones, the LAST pair of any stack could never be evidence, and the
note it produced then claimed the records were *"interchangeable on amount"* about records decided a
week apart. Whether another transfer got there first has no bearing on whether the dates favour
**this** pairing. A transfer that LOST a nearer record to a rival still comes out arbitrary, which is
correct: it took what was left.

⚠️ **THE DATE VARIANT OF THE NOTE STILL ASKS FOR THE PROJECT CHECK.** A decision date says the
records are distinguishable; it does not say the pairing is on the right project. The evidence
changes the claim, never the caution.

**Measured, and smaller than it sounds:** of 112 live stack pairings, **25 come out evidence-decided
and 76 arbitrary — but only TWO point at a different record than the zip already chose.** Most of
what this buys is a TRUE SENTENCE about a pairing that was already right. Do not let a later reader
mistake the 25 for 25 corrections.

⚠️ **THE PASS WRITES ACROSS IMPORTS, and that is the point of it.** A stack does not respect batch
boundaries, so matching batch B can change rows in batch A. Safe because it only ever fills a BLANK
suggestion on an OPEN row, changes no status (so no other batch's rollup goes stale), and both
batches compute the same pairing. Pinned by a test that matches a second import and asserts the
first import's rows paired.

⚠️ **A record is claimed once, globally.** `zip` covers one stack; an explicit claimed-set covers
across stacks and against the per-row matcher. Without it two transfers get the same payment and the
second confirm fails with `AlreadyPaidError` — the exact failure the candidate-collapse fix exists to
prevent.

⚠️ **A REAL LIMIT, pinned on purpose:** the stack key is an exact amount but the candidate set uses
the ±₹1 tier-1 window, so a payment 50 paise away is a candidate **without being a member** — 3
transfers, 4 records, unbalanced, nothing pairs. Correct, not a defect. Near-identical amounts fall
through to a person, which is the right side to fail on.

⚠️ **A FAN-OUT DISQUALIFIES A WHOLE STACK.** One transfer covering several payments is report-only
(ruling Q4) and cannot be one end of a 1:1 pairing, so `_stack_records` returns nothing and the stack
falls to a person untouched.

---

## Known limits, accepted with numbers

- **TDS payments will not match.** 709 of 7,421 Paid payments carry TDS (9.6%). `tds` is written at
  fulfil time, so an approved unpaid payment has a blank one and `amount − tds` has nothing to
  subtract. A tolerance pass (Q11) and a TDS box (Q6) are **next version**.
- **No undo of a settle** from inside the import (Q9). Fix it in the payments screen.
- **Fan-out is report-only** (Q4) — which is why the existing UTR guard is never challenged. Chunk E
  did NOT change this: a fan-out disqualifies its whole stack rather than being paired.
- **N transfers summing to ONE record is not built** (analysed 2026-08-10, deferred by the owner).
  It cannot reuse `settle_row`: transfer 1 of ₹2L against a ₹5L payment fails `AmountMismatchError`,
  and transfers 2..N would fail `AlreadyPaidError`. It needs one new atomic write taking N rows, a
  group id on the row (the per-row `suggested_*` pair cannot express a group), and a bounded search
  — finding which transfers sum to a payment is subset-sum, where the danger is false positives,
  not compute. `Project Payments.utr` is `varchar(140)`, so ~10 slash-joined references before
  Frappe hard-fails.
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
| pure services (12 modules, 409 tests) | `python -m unittest discover -s nirmaan_stack/services/outflow_import -t . -p "test_*.py"` — no bench needed |
| api (`test_upload`/`test_review`/`test_expenses`/`test_settle_payment`/`test_approved`) | `bench --site localhost run-tests --app nirmaan_stack --module nirmaan_stack.api.outflow_import.<module>` — `test_review` is 121 |
| frontend | `yarn test` (vitest, `node` environment — pure helpers only). 226 in this feature. |

⚠️ **Both runners must be invoked INSIDE the dev container.** The host has no `firebase_admin`, so
`python -m unittest` fails at `nirmaan_stack/__init__.py` before reaching a test; and the host
`node_modules` is linux-arm64, so `yarn vitest` dies on a missing rolldown binding. Neither failure
looks like a test failure.
⚠️ **`tsc --noEmit` over the whole project is NOT a gate** — the repo carries ~3,200 pre-existing
errors elsewhere. Grep the output for the paths you touched.

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
