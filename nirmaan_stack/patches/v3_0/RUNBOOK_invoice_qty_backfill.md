# Invoice Qty Backfill — Production Deployment Runbook

**Audience:** whoever runs the production deployment (not the author).
**File:** `nirmaan_stack/patches/v3_0/backfill_invoice_qty.py`
**Nature:** manual scripts — **NOT** wired into `patches.txt`, so they run **only** when you execute them (they will *not* fire automatically on `bench migrate`).

---

## 1. What this does (in one paragraph)

It fills `Purchase Order Item.invoice_qty` — "how much of each PO line has been invoiced" — for **all existing POs**.
- Most POs are filled **deterministically** (pure DB math, **no AI**): fully-invoiced / completed-project POs get their **ordered quantity**; POs with no invoices get **0**.
- The **under-invoiced ("mismatch") POs** get their **exact** invoiced quantity from a **pre-computed cache** (`extraction_cache.json`) that the test team already produced by reading the invoice images. So production needs **little or no** AI/Gemini.

---

## 2. Prerequisites (before you start)

1. ✅ **App code deployed** and **`bench migrate` run** — this creates the two new columns:
   - `Purchase Order Item.invoice_qty`
   - `Vendor Invoices.is_credit_note`
2. ✅ **`extraction_cache.json` copied into the bench directory** (same folder as your site's bench, e.g. `/workspace/development/frappe-bench/extraction_cache.json`). **The test team provides this file.**
3. ✅ In `backfill_invoice_qty.py`, the config line at the top:
   ```python
   PROJECT = None      # None = ALL projects (full production run)
   ```
   > It may currently be set to a single project (used for testing). **Set it to `None`** for the full production run. (Or set a project name to roll out one project at a time.)
4. ⚠️ Only needed **if the cache is incomplete** (some invoice not in it): **Document AI must be enabled** and the **invoice files reachable (S3)**. If the cache covers everything, this is not required.

Replace `<SITE>` below with your site name (e.g. `prod.nirmaan.app`).

---

## 3. Deployment steps — run IN THIS ORDER

### Step 1 — Backfill (fast, no AI, ~seconds)
```bash
bench --site <SITE> execute nirmaan_stack.patches.v3_0.backfill_invoice_qty.execute
```
- Classifies every live PO and writes `invoice_qty`:
  `COMPLETED`/`DIRECT` → ordered qty · `ZERO` → 0 · `EXACT` → summed line qty · **`MISMATCH` → left for Step 2**.
- Prints the bucket counts, e.g. `{EXACT: 1, COMPLETED: 2268, DIRECT: 2196, MISMATCH: 54, ZERO: 137}`.
- Safe and **idempotent** — re-running produces the same result.

### Step 2 — Import the extraction cache (replay, mostly no AI)
```bash
bench --site <SITE> console
```
then, inside the console:
```python
from nirmaan_stack.patches.v3_0 import backfill_invoice_qty as b

b.import_cache(apply=False)      # DRY RUN — prints HIT/MISS counts, writes NOTHING
b.import_cache(apply=True)       # APPLY — writes the mappings, recomputes -> EXACT
```
- **HIT** = the invoice is in the cache → its mapping is applied **without any AI call** (fast, cheap).
- **MISS** = invoice not in the cache → one Gemini read (needs Document AI + files). If Gemini can't read it, it's logged (see §6).
- After each PO's invoices are filled, `invoice_qty` is recomputed to the **exact** value.

> Always run `apply=False` first and eyeball the HIT/MISS numbers. HIT should be the large majority; MISS should be near zero if the cache is complete.

---

## 4. What to verify after

- Step 1 printed sensible bucket counts (no errors).
- Step 2 printed mostly **HIT**, few/no **MISS**, **0 failed**.
- Spot-check a few POs in the UI: `invoice_qty` on the PO's items looks right.

---

## 5. Safety guarantees (why this is low-risk)

- **Invoice files are READ-ONLY** — they are only downloaded to be read; **never** modified, replaced, moved, or deleted.
- **Does NOT bump `modified`** on any record (`update_modified=False` / modified-preserving saves everywhere). Nothing shows as "recently edited by System."
- **Idempotent** — safe to re-run any step.
- **`import_cache(apply=False)`** writes nothing — a true dry preview.
- **Not in `patches.txt`** — nothing runs on migrate; only your explicit commands do.
- Only two fields are ever written: `invoice_qty` (on PO items) and, on the invoices, `line_mappings` + the `autofill_*` fields.

---

## 6. If something fails

- A cache MISS that Gemini also can't read is appended to **`extraction_failures.log`** (in the bench dir) with the PO + invoice.
- Those POs simply keep the safe estimate; nothing breaks.
- To fix one later, in the console:
  ```python
  b.manual_fix("<vendor-invoice-name>", {"EXACT PO ITEM NAME": 1234, ...})
  ```
  This writes the mapping by hand and recomputes that PO.

---

## 7. Rollback

`invoice_qty` is a **derived** field — it's always recomputed from source. To re-derive at any time, just re-run **Step 1** (and **Step 2** if needed). There is no destructive change to undo.

---

## Quick reference

| Step | Command | AI? | Writes |
|---|---|---|---|
| 1. Backfill | `bench --site <SITE> execute nirmaan_stack.patches.v3_0.backfill_invoice_qty.execute` | no | invoice_qty |
| 2a. Preview | `b.import_cache(apply=False)` (in console) | no | nothing |
| 2b. Apply | `b.import_cache(apply=True)` (in console) | only for cache MISS | mappings + invoice_qty |

**Do NOT run** `run_extraction()` or `export_cache()` on production — those are **test-server** steps (they produce the cache that Step 2 consumes).
