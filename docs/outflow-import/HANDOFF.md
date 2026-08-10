# HANDOFF — Bulk Import Outflow Transactions (v3)

**Date:** 2026-08-06 · **Branch:** `feature/outflow-import` (7 commits, **UNPUSHED**)
**Status: V0–V4 BUILT AND GREEN. V5 remains. The screen has NEVER been driven in a browser.**

> ⚠️ **This file replaced the pre-build handoff.** The version before this one said *"no v3 code
> exists yet, build V0→V5"*. That is done except V5. If you are reading a copy that says otherwise,
> it is stale.

---

## 0. Read these before touching anything

| # | File | What it is |
|---|---|---|
| 1 | **this file** | where the build actually is |
| 2 | `docs/outflow-import/workflow.html` — **section 0** | the spec. 7 tabs; tab F is the decision log (14 rulings). Sections 1–12 describe the **superseded v2** design — history, not instructions |
| 3 | `frontend/.claude/plans/outflow-import-plan.md` — **§A–§F** | the design spec and slice list. §Z down is the v2 as-built record |
| 4 | `docs/outflow-import/screen-prototype.html` | the signed-off screen, clickable. The specification for V4 |

⚠️ **The v2 code lived in this repo and its comments argued for the opposite spine.** Most are now
corrected in place. If you find one that still says the payment branch never writes, it is a
leftover — fix it, do not "restore consistency" with it.

---

## 1. The spine

An accountant uploads a bank statement of transfers that have **already left the bank** and maps
each to the record it settles. Three ledgers: `Project Payments`, `Project Expenses`,
`Non Project Expenses`.

> **The import PAYS what someone has already approved. It never approves, and it never creates a
> `Project Payment`.**

All three settle `Approved → Paid` only. It is an *alternative bulk route chosen per batch* (Q12) —
nothing about how the team works today changes, so a half-hand-ticked statement is the normal case.

---

## 2. What is built

Seven commits on `feature/outflow-import`, oldest first:

| Commit | Slice | What |
|---|---|---|
| `01dd3e43` | — | v2 baseline committed as-is, so the reversal is a reviewable diff |
| `9a68bc89` | — | the three spec docs + the owner rulings taken on 2026-08-06 |
| `b862b357` | **V0+V1** | the 7-status vocabulary + the Approved-only pool `[MIGRATE]` |
| `7927fb59` | **V2** | `settle_payment` — the write path v2 deleted |
| `5d5ab4c7` | **V3** | upload preview, period-narrowed duplicates, `.xlsx` |
| `c1c5ae51` | **V4** | the batch screen — table, three tabs, decision dialog |
| `9e9e937a` | **V4a** | the two live-data defects (below) |

**66 files, +17,169 lines vs `develop`.** Working tree clean.

### V0 + V1 landed together, deliberately
They were planned as two and are one semantic change: the vocabulary is *defined* in terms of
"Approved only". Splitting them meant either a red tree or tests pinning known-wrong behaviour.

### The two defects the first real import found (`OFI-26-00418`, 19 rows)

**1. Exact-amount matching matched nothing.** Three approved payments sat within a rupee of the
transfers that paid them (0.31, 0.68, 0.90). **31.4% of Project Payments carry paise** while the
bank sends whole rupees. It bit at **two layers** — the SQL pool query dropped them before the
matcher ever saw them, and Pass B would have dropped them again. Fixed with a **±₹1** tolerance
owned by `services/outflow_import/amounts.py` and shared by four call sites.

**2. The dialog could not link anything by hand.** Every dropdown was built from
`get_row_candidates`, which is the *matcher's output*. Matcher finds nothing → dropdown empty →
the escape hatch for everything the matcher cannot see was unusable. Fixed with
`search_settleable_records`, which browses approved records per ledger independent of the matcher.

---

## 3. The invariants that break silently

1. **Only `Approved` is ever matched.** `Requested` / `CEO Pending` → plain `Unmatched`. No status,
   no nudge, no approval deep link. *(This reversed an earlier goal — surfacing the 111 CEO-Pending
   payments. Removed deliberately; do not re-add.)*
2. **The already-Paid check is a SKIP, not a match** (Q14) — and it is the **only** route to
   `Mismatched`. Delete it and a hand-ticked payment reads `Unmatched` and gets booked twice.
3. **`Mismatched` is AMOUNTS ONLY.** The v2 `Reference mismatch` branch is deleted, not folded in.
   A reference is only ever *written into a blank*, never compared.
4. **`for_update=True` must never carry `cache=True`.** Frappe skips the row lock on a cached read,
   which makes the concurrency guard decorative.
5. **Two payment hooks committed mid-save** — `update_parent_amount_paid` and the Approved→Paid
   notification cascade. Both are suppressed by `doc.flags.from_outflow_import` (set in exactly one
   place, read in exactly two). `amount_paid` is still recomputed, inside the same transaction.
6. **The ±₹1 tolerance lives in ONE place.** Four call sites: both SQL pool queries, the matcher,
   the settle guard. A pool wider than the guard offers a record the confirm then refuses.
7. **`Outflow Row Match` records SETTLEMENTS ONLY.** A match run writes none. A suggestion stored
   there would take the `(transfer_id, target_doctype, target_name)` unique key before the
   settlement that needs it — failing the confirm on the happy path.
8. **The two expense doctypes are not twins.** `Project Expenses.amount` is a **Data** column of
   numeric strings; the non-project one is real **Currency**. `payment_by` exists only on the
   project side. `Non Project Expenses` has no vendor column. Expense Type is **scoped** —
   `project=1` and `non_project=1` are disjoint, so switching ledger must clear the chosen type.
9. **`Outflow Import Row.remarks` must stay `Text`.** As `Data` it is `varchar(140)` and Frappe
   *throws* rather than truncating.

---

## 4. Status vocabulary (the single deriver, ADR-0010 B3)

`Pending match run` · `Matched` · `Unmatched` · `Mismatched` · `Settled` · `Skipped` · `Error`
Batch: `Draft` → `In Review` → `Partially Settled` → `Completed`

Only `Settled` and `Skipped` are terminal — **narrower than v2**, where a finding was terminal
because reporting it was the job.

v2 → v3: `Reconciled` → `Skipped`/`Matched` · `Amount mismatch` → `Mismatched` ·
`Reference mismatch` → **deleted** · `Control exception` → **deleted** (now `Unmatched`) ·
`Completed with exceptions` → **deleted**.

---

## 5. The matching rules, in one place

```
1. STAGED     already imported / duplicate in file / not SUCCESS      -> Skipped
2. DUPLICATE  Paid payment with this reference, amounts agree         -> Skipped
                                              amounts differ          -> Mismatched
3. PAYMENTS   Pass A: normalised UTR equal            (finds fan-out)
              Pass B: vendor + amount ±Rs 1 + date ±3d + Approved
4. EXPENSES   amount ±Rs 1, corroborated by description text
5. OUTCOME    >=1 approved candidate -> Matched     else -> Unmatched
```

**Vendor resolution** (feeds Pass B; ≥2 survivors = ambiguous, nothing auto-recorded):
account+IFSC 0.95 · account 0.80 · exact name 0.75 · partial name 0.60×containment.
Floor 0.35; a name needs ≥2 non-noise words. **Containment, not Jaccard** — a statement name is
routinely a subset of the vendor name.

**Never matches, by design:** non-Approved records · TDS payments (bank sends `amount − tds`,
thousands off — ±₹1 cannot reach it and must not be widened to) · fan-out of a settleable group
(Q4, report-only) · a beneficiary resolving to no vendor.

---

## 6. Tests — all green

| Suite | Cases |
|---|---|
| `services.outflow_import` (pure, 7 modules) | **184** |
| `api.outflow_import.test_upload` | 25 |
| `api.outflow_import.test_review` | 21 |
| `api.outflow_import.test_expenses` | 21 |
| `api.outflow_import.test_settle_payment` | 14 |
| `api.outflow_import.test_close` | 13 |
| **backend total** | **278** |
| vitest (`outflowImportStatus` 19 + `outflowTableModel` 50) | **69** of 1,618 repo-wide |

`tsc` clean across `src/pages/outflow-import`; `vite build` succeeds.

⚠️ **Pre-existing and unrelated:** `api.projects.test_project_aggregates` has 1 error
(`get_invoice_totals_by_document` KeyError) on a file this branch never touches.

```bash
# pure layer, no bench
docker exec -w /workspace/development/frappe-bench/apps/nirmaan_stack \
  frappe_docker_devcontainer-frappe-1 /workspace/development/frappe-bench/env/bin/python \
  -m unittest discover -s nirmaan_stack/services/outflow_import -t . -p "test_*.py"

# one api module
bench --site localhost run-tests --app nirmaan_stack --module nirmaan_stack.api.outflow_import.test_settle_payment
```

⚠️ **Never run the bench suite and a browser session against localhost together** — they collide on
the `tabSeries` naming lock.
⚠️ The `api` suites **write to the live dev DB** and purge in teardown. If `setUpClass` raises,
residue survives — clean with `frappe.db.delete` on the three doctypes filtered to
`source_file LIKE '%test-statement.csv'`.

---

## 7. WHAT REMAINS

### 7.1 The live browser walk — **the real gate, not yet run**

⚠️ **There is no DOM test environment in this repo, by deliberate choice.** The table, the decision
dialog and the row selection are React semantics and are **structurally untestable**. Green tsc +
green vitest + a clean build prove the code compiles and the pure logic is right. They say nothing
about whether the screen works.

The prototype's own walk found five real defects a green suite could never have seen (wrapped
cells, a listener killed by a non-Element event target, orphaned focus after a skip, selection lost
to a body re-render, a dialog with no internal scroll).

**Walk at minimum:**
1. Upload a `.csv` **and** an `.xlsx` → preview shows period/counts/charges → confirm
2. Re-upload the same file → **refused**, naming the earlier batch, nothing written
3. Run match on `OFI-26-00418` → 4 rows go `Matched`
4. Open a Matched row → **record pre-selected**, vendor/project/amount/approval date on the option
5. Clear selection → re-pick → confirm → row `Settled`, payment `Paid`, PO `amount_paid` moved once
6. Open an Unmatched row → search an approved payment by vendor → link by hand
7. Create a new expense on an Unmatched row — Won projects only, CEO-Hold shown **disabled**
8. Tick 5 rows, decide 4 → bar reads **"Confirm 4 decided"** → bulk confirm
9. Sort + filter every column; global search highlights in-cell; hide/show columns
10. Dialog scroll: header and footer pinned, only the body scrolls

### 7.2 V5 — cleanup + docs (not started)

- [ ] Delete `components/ReconciliationReport.tsx` — **now orphaned**, nothing imports it
- [ ] Delete `review.get_reconciliation_report` + the `OutflowReconciliationReport` type
- [ ] Simplify close/reopen to one button
- [ ] Write `.claude/context/domain/outflow-import.md` with a `## Residence — concept → owner`
      manifest (§5 above is most of its content)
- [ ] Add one row to the root `CLAUDE.md` Reference Docs table — **not there yet**
- [ ] Append the as-built record to `frontend/.claude/plans/outflow-import-plan.md`
- [ ] `python3 scripts/residence_check.py` must not regress

### 7.3 Migrate obligation — **owed before any push**

Five doctype JSONs changed on this branch:

```
outflow_import_batch.json    status Select loses "Completed with exceptions";
                             reconciled_rows + exception_rows REMOVED
outflow_import_row.json      row_status Select -> the 7 new values, default "Pending match run"
outflow_row_match.json       match_kind Select -> "Settled" only
project_expenses.json        track_changes: 1
non_project_expenses.json    track_changes: 1
```

⚠️ Frappe does **not** drop PG columns on field removal — `reconciled_rows` and `exception_rows`
remain orphaned in the table. Harmless.

Dev bench is migrated. **Production is not**, and this rides on top of debt already owed to
teammates (4 new + 7 modified doctypes from the BoQ arcs). **One combined heads-up to Abhishek.**

### 7.4 Push

Nothing is pushed. 7 commits exist on one disk.

---

## 8. Known limits, accepted with numbers

- **TDS payments will not match.** 709 of 7,421 Paid payments carry TDS (9.6%; ~15% for most of the
  past year, ~3% Jun–Jul 2026). `tds` is written at fulfil time, so an approved unpaid payment has
  a blank one and `amount − tds` has nothing to subtract. Tolerance pass (**Q11**) and the TDS box
  (**Q6**) are **next version**.
- **No undo of a settle** from inside the import (Q9). Fix it in the payments screen.
- **Fan-out is report-only** (Q4) — which is why the existing UTR guard is never challenged.
- **The paise difference is not recorded.** Settling an 18,678.69 payment from an 18,679.00
  transfer leaves the payment at 18,678.69. Accepted explicitly.
- **Fixtures stay synthetic — the repo is public.** Real statements carry live beneficiary names,
  accounts and IFSC codes. `cashfree_sample.csv` / `.xlsx` are fabricated.

---

## 9. First commands in a fresh session

```bash
cd .../apps/nirmaan_stack
git log --oneline develop..HEAD          # 7 commits, unpushed
git status --porcelain | grep outflow    # should be empty
open docs/outflow-import/screen-prototype.html
```

**Start with the browser walk (§7.1).** V5 is documentation; if the walk finds something structural
in the dialog, you would rather know before writing the doc that describes it.
