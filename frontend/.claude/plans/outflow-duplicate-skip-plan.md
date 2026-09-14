# Bulk Import Transactions — "already in the system" skip rules

**Status:** PLAN WRITTEN + GRILLED (3 rounds) 2026-09-14 — awaiting owner confirmation. **No code written.**
**Opened:** 2026-09-13
**Source map:** `/tmp/HANDOFF-outflow-matching-rules-2026-09-13.md` (second-hand; module docstrings win).
**Branch:** work in place on the current branch (root `CLAUDE.md`: no worktree). Commit per slice locally. **Never push.**

---

## 1. The ask (owner, 2026-09-13)

A record-level DUPLICATE GUARD: a statement row whose money is already recorded in a ledger is SKIPPED.
It is NOT a new settle tier — nothing new settles unattended.

| Statement | Direction | Ledger checked | Ledger fields | Before this work |
|---|---|---|---|---|
| ICICI | Debit | Project Payments | `utr` + `amount` | EXISTS (Paid, exact normalised narration ref, ±₹5, ignores direction) — widen |
| ICICI | Debit | Project Expenses | `payment_ref` + `amount` (Data, CAST) | NEW |
| ICICI | Debit | Non Project Expenses | `payment_ref` + `amount` | NEW |
| ICICI | Credit | Project Inflows | `utr` + `amount` | NEW as a skip (today only blocks `create_inflow`, exact) |
| Cashfree | Debit | Project Payments | `utr` vs `bank_reference_no` | EXISTS — unchanged |
| Cashfree | Debit | Project Expenses | `payment_ref` vs `bank_reference_no` + amount | NEW (43 dev pairs, all amount-exact) |
| Cashfree | Debit | Non Project Expenses | `payment_ref` vs `bank_reference_no` + amount | NEW (11 dev pairs, all amount-exact) |

## 2. Owner rulings

- **R1 — ICICI reference match:** a ledger reference hits when it equals the row's transfer id, OR it is a
  partial/full SUBSTRING of the row's bank remarks. **This is a fresh owner ruling that supersedes, for the
  ICICI guard only, `matcher.match_by_reference`'s "the guard must never skip on a heuristic"** — record it in
  the new module's docstring.
- **R2 — Amount:** within ±₹5 (`amounts.AMOUNT_TOLERANCE`). A reference hit outside ±₹5 → `Mismatched` + note.
- **R3 — Status:** only **Paid** ledger records count. Project Inflows has no status → every inflow counts.
- **R4 — Credit scope:** a Credit row checks **Project Inflows only** (not negative NPE receipts, not negative
  Paid Project Payments / vendor refunds).
- **R5 — Bank settle writes the full text:** when an ICICI row is settled or creates a record (by a person or the
  system), the ledger `payment_ref` / `utr` stores the row's **full bank remarks** (see G2 for cheque rows).
- **R6 — Field types:** `payment_ref` (PE, NPE) and `utr` (PP, PI) → **Text**.
- **R7 — `Project Inflows.amount`:** Data → **Currency**, zero-loss migration proven by count + SUM.
- **G1 — Contains-guard shape:** normalise both sides (upper-case, remove ALL whitespace); a ref is eligible only
  if its normalised length **>= 6 AND it contains a digit**; `DUMMY-` refs excluded explicitly.
  Measured on the full 1,274-row ICICI statement (869 after exclusions): **193 skips vs 40 today, 13 Mismatched
  notes, 0 false skips found.**
- **G2 — Cheque twins:** when a row's remarks contain **no run of 6+ digits** AND its cheque column
  (`reference_id`, "Cheque. No./Ref. No.") is filled, the stored text AND the match surface are
  **remarks + cheque number together**. (3 measured twin pairs: `CLG/STELLAR ECOENERGY SOLUTI/KMB` ₹10L ×2,
  `CLG/MR SAYED ALI/SBI` ₹1.15L ×2, `CLG/DIGIMRO DISTRIBUTION INDI/UTI` ₹1L ×2.)
- **G3 — When:** the guard runs at match time AND as a refusal on `create_expense`, `create_inflow`,
  `create_non_project_receipt`.
- **G4 — Desk-only reports:** fixed on localhost by us; production fixed by the owner in Desk from exact text we hand over.

### Grilling round 1 (owner, 2026-09-14)

- **Q1 → R5 is ICICI ONLY.** Cashfree keeps writing its clean `bank_reference_no` (its remarks carry no UTR).
- **Q2 → display accepted:** the full narration shows wherever UTR / payment_ref renders; truncate + tooltip (A7).
- **Q3 → LINK IS REFUSED TOO:** `settle_row` / `allocate_row` refuse a row that duplicates a Paid record, exactly
  like the Create endpoints (dev example: Cashfree `623320892027` ₹5,000 already Paid on PE `h0g5cno0l7`).
- **Q4 → no undo for a wrong skip in this plan.** An admin fixes it in Desk. See FW3.
- **Q5 → build order:** Slice 0 → 4 → 3 → 2 → 5 → 6 → 1 → 7.

### Grilling round 2 (owner, 2026-09-14) — backed by measurement on the full statement

- **Q6 → date window ±15 days:** a hit counts only when the record's `payment_date` is within ±15 days of the row
  date. Measured: skips stay 193, noise Mismatched 13 → 6; every real skip was ≤ 7 days apart (one at −6).
- **Q7 → tokenised stored refs:** a stored ref is split on non-alphanumerics; any token (len ≥ 6, has a digit, not
  `^BULD\d+$`) may hit. Measured +4 correct skips (incl. ₹64,38,443 fan-out, `610415565123 ICICI`), 0 false.
- **Q8 → one record justifies at most one row.** Costs 0 skips today; blocks the latent wrong skip from a
  counterparty ACCOUNT number stored as utr (`42260332027`).
- **Q9 → no cross-row fan-in logic now.** A hit whose amount is off → Mismatched note AND the Create endpoint
  requires an explicit "create anyway" confirmation naming the record (dev case: PAYIN-00076-03 ₹4,21,606 =
  three separate credit lines). Cross-row summing → FW4.

### Grilling round 3 (owner, 2026-09-14)

- **Q10 → the ±15-day window applies to the ICICI contains-guard ONLY.** Exact guards (existing Cashfree ↔ Paid
  Payments; new Cashfree ↔ Paid expenses) keep no date check.
- **Q11 → "one record ⇒ one row" is enforced ACROSS ALL BATCHES.** A record already used as a skip basis (or
  settled/created by an import row) cannot justify skipping a different row later; that row stays Mismatched with a
  note naming the record. (Re-importing the SAME line is still caught by `duplicates.row_identity` at upload.)
- **Q12 → Cashfree expense guard is WHOLE-STRING exact** (`upper(btrim(payment_ref)) == normalized_reference`);
  no tokenising on the Cashfree side.
- **Q13 → production preview:** a read-only script lists every row that WOULD newly skip on production before the
  first match run there. Owner eyeballs it; only then the match is run.

### Assumptions closing the tree (owner may override)

- **A10 — Q8/Q11 scope:** the one-record-one-row claim applies to the ICICI contains-guard only (consistent with
  Q10); the existing exact guards keep today's behaviour.
- **A11 — Q9's "create anyway" confirmation** also applies to Link (`settle_row` / `allocate_row`), consistent with Q3.
- **A12 — the refusals (Q3, G3)** use the SAME predicate as the match-time guard, per source: ICICI → contains-guard,
  Cashfree → exact guard.

## 3. Future work (owner-noted, NOT in this plan)

- **FW3:** an admin-only "Not a duplicate" action for rows skipped by the heuristic guard (puts the row back to
  Mismatched and remembers the override). Owner deferred 2026-09-14.
- **FW4:** cross-row fan-in — one ledger record whose reference lists several statement lines (sum across rows).

- **FW1:** two NEW doctypes will replace the negative Non Project Expense "receipts" booked for bank credits.
  When they land, the Credit-row guard extends to them (R4 is "for now").
- **FW2:** Cashfree vs an ICICI-written full-text record needs "stored utr CONTAINS bank_reference_no".
  Measured overlap today: 0. Not built.

## 4. Assumptions taken (owner did not object, 2026-09-13)

- **A1 — grouping:** skip if ANY single hit record, OR a same-reference group sum, OR the sum of all hits is within
  ±₹5. Each shape is needed at least once in the measured statement.
- **A2 — separate ICICI predicate;** `matcher.match_by_reference` (Cashfree settle + guard) is NOT widened.
- **A3 — Cashfree expense guard is EXACT, whole string** (`upper(btrim(payment_ref)) == normalized_reference`) — confirmed by Q12.
- **A4 — `reference_guard.assert_reference_is_free`** also refuses when a stored `utr` CONTAINS the typed reference.
- **A5 — vendor refunds** booked as negative Paid Project Payments stay Mismatched (R4).
- **A6 — messages name the doctype;** links widen to all four ledgers (incl. a Project Inflows branch).
- **A7 — long refs** truncated + tooltip on screen; voucher PDF filename caps the utr part.
- **A8 — the R7 migration** is a guarded `[pre_model_sync]` patch (§6 Slice 1).
- **A9 — `Outflow Import Row.settlement_reference`** (Data 140) → Text, since R5 routes remarks through it.

## 5. Tripwires this plan must respect (from the handover)

- `candidates.py` is the ONLY DB module; pure modules (`matcher`, `status`, the new predicate module) import no `frappe`.
- **Pool never narrower than the guard:** the loader filters only on containment/equality + length + digit +
  Paid + ledger-for-direction; amount + grouping + verdict stay in pure code.
- New amount comparison sites go in `amounts.py`'s docstring list; no `Decimal` constant elsewhere.
- **Clearing is load-bearing:** every match run rewrites suggestion/skip fields, including as `None`.
- `Skipped` is frozen with no unskip → every new skip path must be proven RED against a reverted rule.
- A test that passes before and after a behaviour change proves nothing; pins on changed wording are in scope and are INVERTED, never deleted.
- PostgreSQL: quote table names; explicit `IN` placeholders; CAST Data amounts.

---

## 6. Slices

**Build order (owner Q5):** Slice 0 → 4 → 3 → 2 → 5 → 6 → 1 → 7 → 8. Numbers are identities, not order.

⚠️ **Slice 5 (R5 writes full text) must NOT land before Slice 4 (contains-guard)**: every exact-match guard goes
blind to a full-text reference. Slice 2 (Text columns) must land before Slice 5.

### Slice 0 — Re-verify + baselines (no code)

1. Re-read the docstrings of `matcher.py`, `status.py`, `review.py` (`_guard_duplicates_only`,
   `_paid_duplicate_for`, `_related_paid_payments`), `settlement_reference.py`, `reference_guard.py`,
   `candidates.py`, `amounts.py`, `api/outflow_import/inflows.py`, `cashbook.py` — correct §1/§4 of this file if they diverge.
2. Run the pure suite + `test_review`, `test_inflows`, `test_upload` inside the container → green baseline.
3. Measure: how many ICICI rows have remarks with no 6+ digit run AND a blank cheque column (residual twin risk G2 cannot cover).
4. Save the localhost `Project Inflows` count + SUM (484 / 532,471,152.36) and the two Desk reports' current SQL to the job tmp dir.

### Slice 1 — `Project Inflows.amount` Data → Currency (R7) — independent

- **Patch** `patches/v3_0/project_inflows_amount_to_currency.py`, listed under `[pre_model_sync]`:
  skip if the column is already numeric (`information_schema`); `frappe.throw` naming every row whose value fails
  `^\s*-?[0-9]+(\.[0-9]+)?\s*$` (never coerce junk to 0); record count + SUM; `ALTER ... TYPE decimal(21,9)
  USING NULLIF(btrim(amount),'')::decimal(21,9)`; re-assert count + SUM; commit.
- **JSON:** `project_inflows.json` `amount` → Currency (minimum diff).
- **Code, same commit:** `api/outflow_import/inflows.py:446-451` (`BTRIM(amount)` errors on numeric →
  `amount::text`); `api/reports/customer_receivable_report.py:9-14`; drop `INFLOW_DOCTYPE` from
  `settle._DATA_AMOUNT_DOCTYPES` (`settle.py:389`) so a float is written; invert `test_inflows.py:229` (+ `:386`).
- **Migrate** localhost; verify column type, count, SUM, Customer Receivable report runs, inflow create still works.
- **Desk reports (G4):** fix "Client Invoice vs inflow" and "Projects stats create on or before 31-MAR-2026" on
  localhost (`NULLIF(pin.amount,'')` → numeric-safe); hand the owner the exact before/after SQL for production.
- **Tests:** a patch test on a varchar fixture table (junk value → refuses, nothing altered; clean → count + SUM equal).
- **As-built (#1255, 2026-09-14):** patch landed as `patches/v3_0/project_inflows_amount_to_currency.py` (first
  `[pre_model_sync]` entry). "Clean" is stricter than the regex above: surrounding whitespace is allowed, but it must
  also fit `decimal(21,9)` exactly (< 10^12, ≤ 9 decimals) — `''`, `1,000`, `NaN`, `1e3` all refuse. NULL stays NULL.
  SUM is compared as exact Decimal (read `::text`; Frappe's PG adapter returns numerics as floats). Localhost
  re-measured before migrate: 484 rows, 0 junk, SUM 532,471,152.36 → identical after. Readers fixed: `inflows._already_booked`
  (`amount IS NOT NULL`), `customer_receivable_report` (`COALESCE(amount, 0)`), `settle._DATA_AMOUNT_DOCTYPES` is
  `{Project Expenses}` only. Tests: `api/outflow_import/test_inflow_amount_patch.py` (3) + `test_inflows` (two string
  pins inverted, a Customer Receivable delta test added; shown red on the pre-fix SQL). Desk reports fixed on localhost
  (both outputs byte-identical to before by row hash); production SQL handed to the owner on #1255.

### Slice 2 — Reference columns → Text (R6, A7, A9)

- **JSON:** `project_payments.utr`, `project_inflows.utr`, `project_expenses.payment_ref`,
  `non_project_expenses.payment_ref`, `outflow_import_row.settlement_reference` → Text. Migrate; verify with `has_column` + `information_schema`.
- **Frontend:** truncate + `title` tooltip in the cells that render these raw — `InFlowPayments.tsx:293-313`,
  `AllPayments.tsx:379`, `SRPaymentsSection.tsx:82-91`, `VendorPaymentsTable.tsx:65-84`,
  `InflowReportTable.tsx:153-158`, `ProjectFinancialsTab.tsx:493,497`, `CustomerFinancials.tsx:175,179`,
  `TransactionDetailsCard.tsx:357,363`, `approved-sr.tsx:734,739`, `projectInvoices.config.tsx:229,266`, the
  delete dialogs; cap the utr slice in `PaymentVoucherActions.tsx:135` filename. Browser check (no DOM test env).
- **Root `CLAUDE.md`:** add the five fields (+ R7's `amount`) to the sanctioned fieldtype-exception note.

### Slice 3 — Cashfree: Paid expense guard, exact (A3, A6)

- `candidates.py`: a loader for **Paid** Project Expenses + Non Project Expenses keyed on
  `upper(btrim(payment_ref))` (PE amount CAST), joined into the `paid_duplicates` pool (`review._load_pools`).
- `status.py`: skip/mismatch messages name the doctype; "as Paid" + TDS tail made ledger-correct.
  Invert the ~12 backend pins and the frontend copy pins (`outflowTableModel.ts:1088`, `SkippedRowsDialog.tsx:164,202`,
  `outflowTableModel.test.ts:2251-2294`, `outflowExport.test.ts:158`).
- `review._related_paid_payments` → per-row lookup across ledgers; response key `related_payments` → `related_records`;
  `OutflowImportBatch.ts:150` type + `outflowTableModel.settlementLink` gains expense + inflow branches.
- **Tests (RED against reverted loader):** a Cashfree row whose ref equals a Paid PE → Skipped; an Approved PE with
  the same ref → NOT skipped; amount off by > ₹5 → Mismatched. Report on dev data: which open rows newly skip.

### Slice 4 — ICICI contains-guard (R1–R4, G1, G2, A1, A2)

- **New pure module** `services/outflow_import/bank_reference_match.py` (no `frappe`):
  - `normalise_text(s)` — upper, strip all whitespace.
  - `reference_tokens(ref)` — split the stored ref on non-alphanumerics (Q7); keep the whole normalised ref too.
  - `eligible_reference(token)` — len >= 6, has a digit, not `DUMMY-`, not `^BULD\d+$`.
  - `within_window(row_date, record_date)` — ±15 days (Q6). The `15` is a named constant in THIS module (it is a
    day count, not an amount, so `amounts.py` is not its home) — confirm against the `amounts` purity test.
  - `claim_records(rows, hits, already_used)` — one record justifies at most one row, across all batches (Q8/Q11);
    `already_used` = records named by earlier Skipped-as-duplicate rows + `Outflow Row Match` Settled targets.
  - `row_match_text(remarks, cheque)` — THE one builder of both the stored text (R5) and the match surface (G2):
    remarks, plus ` / Chq <cheque>` when remarks have no 6+ digit run and the cheque column is filled.
  - `reference_hits(row, refs)` — equality with the normalised transfer id OR containment in `row_match_text`.
  - `pick_duplicate(row, hits)` — A1 grouping (single / same-ref group / all) within `amounts.AMOUNT_TOLERANCE`;
    returns a group with `.targets` so `status._failed_or_already_paid` / `derive_duplicate_guard_outcome` keep working.
  - Docstring records R1 as a fresh owner ruling + the measured numbers. Purity fence test added.
- **`candidates.py`:** `load_bank_duplicate_candidates(rows)` — one SQL: normalised refs in a materialised CTE
  (len/digit/DUMMY filter), batch rows as `VALUES` with explicit placeholders, `strpos(surface, ref) > 0` OR
  equality with transfer id, ledger-for-direction (Debit → Paid PP / PE / NPE; Credit → all PI). ~0.7s measured.
- **`review._guard_duplicates_only`** (ICICI path) uses the new loader + picker; Cashfree path untouched.
- `amounts.py` docstring: add the new comparison site.
- **Tests (pure, TDD, each proven RED against the reverted rule):** junk refs `ICICI`/`refund`/`0003` never hit;
  a 6-digit cheque number hits; CLG twins with different cheque numbers do NOT match each other; the same row's own
  stored text matches itself; direction scoping (a credit never hits a Paid payment); SGST/CGST twin legs sharing a
  transfer id; fan-in group sum; amount off by > ₹5 → Mismatched; a hit 16 days apart does not count; `BULD…`
  tokens never hit; `610415565123 ICICI` hits via its token; a record already used by an earlier batch's row does
  not skip a new row. **API:** replay the real statement → expect ~197 skips / ~6 Mismatched notes (measured with
  Q6 + Q7), 0 false skips; explain any divergence before accepting.
- **Persisting the skip basis:** the record(s) a duplicate-skip used must be stored durably so Q11 can read them in a
  later batch (decide at build time: an `Outflow Row Match` row with a new `match_kind`, or a field on the row —
  check the partial unique index `WHERE match_kind='Settled'` is not disturbed).

### Slice 5 — R5: bank settles write the full text (R5, G2, A4)

- `settlement_reference.resolve_settlement_reference`: ICICI rung returns `bank_reference_match.row_match_text(...)`
  via a new named predicate in `sources.py`; reword its docstring + `settle._settlement_reference_of` (they say "never
  the bank's reference, never a guard key").
- ICICI rows already staged hold the old value → resolve ICICI at read time from the row (no backfill write).
- All five write sites follow automatically (`settle.py:538, 677-678, 914, 1088, 1225`); the reversal compare
  (`expenses.py:678`) goes through the same resolver.
- `reference_guard.assert_reference_is_free` (A4): also refuse when a stored `utr` CONTAINS the reference (same
  eligibility filter) — covers the manual fulfil at `api/payments/project_payments.py:376`.
- `inflows._already_booked` → replaced by the Slice 4 predicate.
- **Tests:** a settled ICICI row writes the full text; re-importing that line later → Skipped; a CLG twin → not skipped;
  a hand-typed UTR inside a stored full-text `utr` → refused.

### Slice 6 — Refuse duplicates on Create AND Link (G3, Q3, Q9, A11, A12)

- Endpoints: `expenses.create_expense`, `inflows.create_inflow`, `inflows.create_non_project_receipt`,
  `settle_row`, `allocate_row`. Under the row lock, run the same per-source predicate (ICICI → Slice 4, Cashfree →
  Slice 3):
  - **duplicate (would skip)** → `frappe.throw` naming the record(s); nothing written. Closes `inflows.py:61-69`.
  - **hit but amount off (would be Mismatched)** → refuse unless the call carries an explicit `confirm_duplicate_risk`
    flag; the error names the record(s). Frontend shows a "Create/Link anyway?" confirm and re-calls with the flag.
- **Tests:** each endpoint refuses a duplicate and writes nothing; the amount-off case refuses without the flag and
  succeeds with it; a clean row still creates/links. Frontend: the confirm path, browser-checked.

### Slice 7 — Docs

- `.claude/context/domain/outflow-import.md`: the new guard in "The matching rules, in one place", run order, the
  silent-breakage list (stored text = match surface; ordering of R5 vs guard), the owner-ruling register.
  Fix two drifts: frozen statuses are `(Skipped, Settled, Partially Allocated)`; `expenses._load_settleable_row`'s
  "Re-run the match to reconsider it" is untrue.
- Correct the handover file in place where it diverged. Per-slice as-built detail goes in this plan, NOT in `CLAUDE.md`.

### Slice 8 — Production preview (Q13) — before the first production match run

- A read-only script (SELECT only, no `frappe.db.commit`, no row writes) that runs the Slice 3 + Slice 4 predicates
  over every open (Mismatched / Pending) row on the target site and prints, per row: batch, row, date, amount,
  remarks (truncated), the would-be verdict (skip / Mismatched note), and the record(s) named.
- Handed to the owner with the exact `docker exec` / `bench execute` command. The owner reviews; the match run on
  production happens only after an explicit go.

## 7. Gates per slice

- Pure suite + touched api suites green inside the container; each new rule's test shown RED against a revert.
- `python3 scripts/residence_check.py` from the app root.
- Frontend slices: vitest for touched files + a browser check (no DOM test env).
- Commit locally with the attribution line. **No push without the owner's explicit yes.**

## 8. Flags for the owner (existing data, not this plan)

- 2 Settled Cashfree rows share a bank reference with a Paid Project Expense they did NOT settle — possible double-booking.
- 8 Project Inflows store an ICICI `Tran. Id` as their `utr`; 3 are in the current statement (the transfer-id rung catches them).

## 9. Discovery facts (2026-09-13 survey)

- ICICI `transfer_id` = bank `Tran. Id` (`S47648361`), not a UTR; repeats across SGST/CGST legs.
- Parser extracts a narration ref into `bank_reference_no` (`parser._icici_counterparty`); `reference_id` = cheque column (32 of 1,274 rows).
- ICICI remarks max 99 chars today; all four reference fields are varchar(140), no indexes.
- `Project Inflows.amount`: 484 rows, 0 blank, 0 non-numeric, max scale 2, SUM 532,471,152.36 (localhost).
- Frappe v15 Postgres migrate ALTERs Data→Currency with NO `USING` → crashes without the patch.
- Existing precedent: `api/outflow_import/cashbook._already_booked` (exact ref + exact amount + date).
