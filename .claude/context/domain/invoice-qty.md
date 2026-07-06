# Invoice Qty — how much of each PO line has been invoiced

**Status:** production. **Owning field:** `Purchase Order Item.invoice_qty` (Float).
**One-line model:** `invoice_qty` is a **derived cache** — never edited by hand, always **re-derived from source** by `recompute_po_invoice_qty(po)` on every invoice event, so it can never drift.

This doc is the single reference for the whole feature: the derived field + its self-classifier, the AI line-item mapping, credit notes, the one-time backfill + Gemini extraction + cache, and the admin Resolve UI. Read it before touching any of the files in the [File map](#file-map).

---

## 1. TL;DR / mental model

- Each `Purchase Order Item` row carries `invoice_qty` = "how much of this ordered line has been invoiced so far."
- It is **derived**, not stored-and-incremented. One function — `recompute_po_invoice_qty(po_name)` — recomputes **every row of a PO from scratch** and is the **single source of truth**. It runs inside the transaction of every invoice create / approve / reject / edit / delete, and inside the backfill.
- The value comes from **Vendor Invoice Line** rows (the AI-extracted invoice lines mapped to PO items). When those aren't available yet, it falls back to an **estimate**.
- A one-time **backfill** seeds history: deterministic buckets for the easy cases, then a **Gemini extraction** pass (cache-first) for the under-invoiced ("MISMATCH") POs, with a browser **Resolve UI** to clear whatever the AI couldn't map.

---

## 2. Data model

| Field | Doctype | Meaning |
|---|---|---|
| `invoice_qty` | Purchase Order Item | Derived: invoiced quantity of this line. **The output.** |
| `quantity` | Purchase Order Item | Ordered quantity (the input / natural cap). |
| `category` | Purchase Order Item | `"Additional Charges"` rows are freight/P&F/etc → **always `invoice_qty = 0`**. |
| `line_mappings` (child = **Vendor Invoice Line**) | Vendor Invoices | Per-invoice extracted lines, each mapped to a PO row (`po_item_row`) with `match_status` ∈ Matched / Unmatched / Non-Item, `quantity`, `is_over_billed`. |
| `is_credit_note` (Check) | Vendor Invoices | 1 = credit note → **excluded** from `invoice_qty`; also stored with a **negative** `invoice_amount`. |
| `autofill_used` + `autofill_*` | Vendor Invoices | AI-autofill metadata (processor id, extracted no/date/amount, GSTINs, confidence/entities/line-items/line-match JSON). Set whenever the mapping was produced/verified via AI. |
| `status` | Vendor Invoices | `Pending` / `Approved` / `Rejected`. **Counted** = Pending + Approved. **Rejected is void** (ignored). |

**"Counted" invoices** (the billing exposure of a PO) = `status IN (Pending, Approved) AND is_credit_note = 0`.

---

## 3. The core: `recompute_po_invoice_qty` (self-classifying)

File: `nirmaan_stack/api/invoices/_item_billing_sync.py`.

Per PO it gathers its **counted** invoices (each with `n_lines` = its Vendor Invoice Line count, `status`, `invoice_amount`), then resolves **every PO row** by **trust level** to one of four states. `mapped` = counted invoices that have ≥1 line.

```
trusted_full = (every counted invoice Approved AND Σ amount ≥ po_total − TOL)  OR  project Completed
```

| # | State | Trust | Condition | invoice_qty |
|---|---|---|---|---|
| 1 | **EXACT** | full | **every** counted invoice is mapped | Σ **signed Matched** line qty per row (a return note's negative qty subtracts) |
| 2 | **TRUSTED-FULL** | full | `trusted_full` (all Approved & amount ≥ total, or Completed) | ordered `quantity` per row |
| 3 | **DELIVERED** | partial | has counted invoices, but **not** all mapped **and not** `trusted_full` | **`received_quantity`** (delivered qty) per row |
| 4 | **ZERO** | none | no counted invoices and project not Completed | 0 |

Plus the wrapper rule: **Additional Charges rows are forced to 0 in every state** (short-circuit in the `_write` helper).

The checks run **in that order** — EXACT (complete line data) beats TRUSTED-FULL beats DELIVERED. Only EXACT runs the line-sum SQL (Σ Matched qty grouped by `po_item_row`); the other states read a single per-row field.

**Why self-classifying (re-derive, don't increment):** there is no stored intermediate, so nothing goes stale. A reject/delete of an old invoice, or an edit long after the backfill, just re-runs `recompute` and the PO re-derives correctly (e.g. rejecting an approved invoice on a TRUSTED-FULL PO drops it to the right value automatically). Writes use `frappe.db.set_value(..., update_modified=False)` so the PO's `on_update` controller does **not** fire — this is a cache write, not a PO edit.

### The trust ladder — why DELIVERED is the partial fallback (important history)
The middle state has changed twice. It started **all-or-nothing**: EXACT only when *every* counted invoice was mapped, else the ordered-qty estimate. Then it briefly became **PARTIAL** — Σ the *mapped* invoices' matched qty, "growing to exact" as each was resolved. PARTIAL had a real defect: on a PO with a **mix** of mapped and permanently-unmapped invoices it *undercounts*, because the unmapped invoices contribute 0 matched qty. The trigger is common — a PO **backfilled DIRECT** (fully billed → ordered qty, invoices never line-mapped) that is later **revised** and gets one new line-mapped invoice: PARTIAL would drop every old row to ~0. So the middle state is now **DELIVERED**: when we can't fully trust the line data *and* the PO isn't fully billed, fall back to the **received (delivered) quantity** — the real-world amount that actually arrived. It avoids **both** failure modes: the ordered-qty **over**-count (ordered ≥ delivered) and the mapped-only **under**-count. It still converges to **EXACT** the moment every invoice on the PO is line-mapped (resolve them all in the Resolve UI). `received_quantity` is live-maintained by the Delivery Notes controller (`_recompute_received`), so it's a reliable source, not a mostly-empty field.

> This function is app-wide — it runs on **every** runtime invoice event, not only in the backfill. Any change to it changes both.

---

## 4. AI line-item mapping (how a Vendor Invoice Line gets a PO row)

- **`extract_invoice_fields(file_url, docname=po)`** (`api/invoice_autofill.py`) reads the invoice file (READ-ONLY — presigned GET / local `get_content`, never writes the file), calls Gemini, and returns `line_match` + `po_items` + scalars. The mapping is **fuzzy-first, Gemini-resolves-the-residue**, every model suggestion re-verified numerically (`api/invoices/_line_match.py`).
- **`build_line_mapping_rows(line_match_json, po_doc)`** (`api/delivery_notes/update_invoice_data.py`) converts the (user-verified) `line_match` into `Vendor Invoice Line` child rows, resolving each `po_row` index → the real `Purchase Order Item.name`.
- Freight/P&F/tax lines are classified **Non-Item** by the matcher (regex) and never force-matched → they don't add to any PO row's `invoice_qty`.
- **Frontend review surface:** `LineItemMappingReview.tsx` — the shared table (extracted line → PO-item dropdown + editable qty, over-billing flags). Reused by the Add/Edit Invoice dialog **and** the Resolve UI (via the opt-in `editableQty` prop).
  - **Radix modal gotcha:** the dropdown menu is portalled to `document.body`; a modal Radix dialog sets `pointer-events:none` outside itself, so the portalled menu needs `menuPortal: { pointerEvents: "auto" }` or options are only keyboard-selectable.

---

## 5. Credit notes & Additional Charges

**Credit notes** (`is_credit_note = 1`):
- Entered via a dedicated **"Add Credit"** button next to "Add Invoice" (`DocumentAttachments.tsx`, PO only — SR has no Add Credit). The button seeds `is_credit_note`; the checkbox is a **read-only indicator shown only in Edit mode** (in Add mode the button decides it). A dialog opened for a Service Request is always non-credit (guard: `docType === "Procurement Orders" ? flag : false`).
- Stored with a **negative `invoice_amount`** (forced on submit) and **excluded** from `invoice_qty` (recompute filters `is_credit_note = 0`).
- **Sign logic** in the autofill handler: `is_credit_note` (Add Credit) → amount negative, qty unchanged. `is_credit_note = false` **+ Gemini detects a credit note** → amount **and** qty negative (a "return note" that reduces invoiced qty). The autofill callback **must** list `invoiceData.is_credit_note` in its deps (else it reads a stale flag).

**Additional Charges** (`category == "Additional Charges"`): never a real quantity → **`invoice_qty = 0`** in both writers (recompute's `_write` + the backfill's `_write_bucket`). Always Non-Billable (see `additional_charges_non_billable`).

---

## 6. The one-time backfill + extraction

File: `nirmaan_stack/patches/v3_0/backfill_invoice_qty.py`. Scope = the module `PROJECT` constant (a project id = that project; **`None` = all projects** — set to `None` for prod).

**Wiring:** **NOT in `patches.txt`** — run it deliberately with `bench execute` (it calls Gemini, so it must never fire on a routine `bench migrate`). `bench migrate` only creates the `invoice_qty` / `is_credit_note` **columns**; it does not populate them.

**One command (does both steps):** `run()` = `execute()` (Step 1, deterministic) then `import_cache(apply=True)` (Step 2, Gemini) in a single pass:
```bash
bench --site <site> execute nirmaan_stack.patches.v3_0.backfill_invoice_qty.run
```
Or run the steps separately — `…backfill_invoice_qty.execute`, then `…import_cache --kwargs "{'apply': True}"` (import_cache defaults to `apply=False`, a dry preview that writes nothing).

- **`execute()` — deterministic, no AI.** Classifies every live PO (excl. Merged) via its **own** classifier `_po_bucket` and writes with `_write_bucket`:
  - `EXACT` (all counted mapped) → line sums · `COMPLETED` (project done) / `DIRECT` (all Approved & amount ≥ total−TOL) → ordered qty · `ZERO` (no invoices) → 0 · **`MISMATCH` (under-invoiced / pending) → left UNWRITTEN** for the extraction step.
  - `_po_bucket`/`_write_bucket` are **independent of `recompute`** — do not assume they share code. (They stay consistent: EXACT↔EXACT, DIRECT/COMPLETED↔TRUSTED-FULL, and MISMATCH is refined by the recompute in `import_cache`.)
- **`import_cache(apply=True)` — extraction on the MISMATCH POs.** For each still-unmapped invoice: **HIT** (mapped entry in the cache) → replay, no AI; **FAIL** (failed entry) → skip, no retry; **MISS** (not cached) → Gemini reads it **once** → registers a `mapped` or `failed` entry. Then calls `recompute_po_invoice_qty(po)` per PO (→ EXACT once fully mapped, else DELIVERED). Non-interactive; **builds the cache as it goes**.

There is **no terminal fixing** — all human fixing is the Resolve UI.

### Running it (test → prod)

Command (in the dev container, prefix `docker exec -w /workspace/development/frappe-bench frappe_docker_devcontainer-frappe-1 …`):
```bash
bench --site <site> execute nirmaan_stack.patches.v3_0.backfill_invoice_qty.run
```

1. **Prereqs:** app deployed + `bench migrate` (creates the `invoice_qty` / `is_credit_note` columns — it does **not** run the backfill). Set `PROJECT` (a project id to pilot one project, `None` for the full run). Gemini/Document AI enabled — only cache **MISSES** call it.
2. **Test server:** `run()` builds `invoice_qty` **and** the cache (mapped + failed entries) in one pass. Fix the `failed` ones in `/resolve-invoices` (Analyze → correct → Save; each Save flips its cache entry `failed → mapped`). Repeat until no `failed` entries remain.
3. **Ship the cache:** it lives in the app dir, so it **travels with the app** to prod — deploy the app, or copy `extraction_cache.json` in. (`export_cache()` optionally re-snapshots mapped invoices from the DB, preserving `failed` entries.)
4. **Prod:** confirm `PROJECT = None`, deploy, `bench migrate` (columns only), then `run()` — cache **HITs replay with no Gemini**; any MISS gets one Gemini read; failures surface in prod's `/resolve-invoices`.

**Ops notes:**
- **Idempotent** — safe to re-run / interrupt (recompute re-derives from source; `execute` re-buckets). A failed invoice is Gemini'd **at most once**, then left for the UI.
- **Read-only on invoice files** — extraction only *reads* the bytes; never uploads / replaces / deletes.
- **Never bumps `modified`** — all writes use `update_modified=False` / modified-preserving saves.
- **Gemini cost** ≈ one call per MISMATCH invoice MISS. Failures → `logs/extraction_failures.log` (via `frappe.logger`) + the Frappe **Error Log** (traceback) for exceptions.
- **Rollback:** `invoice_qty` is derived — just re-run `run()` (or `execute()`); nothing destructive to undo.

---

## 7. The extraction cache (`extraction_cache.json`)

The durable record of every MISMATCH invoice's outcome — a `test → prod` bridge so prod replays without re-paying for Gemini.

- **Location:** the **app backend dir** (`apps/nirmaan_stack/nirmaan_stack/extraction_cache.json`) so it **travels with the app** to prod. (The failure **log** goes to `logs/extraction_failures.log` via `frappe.logger`, NOT the app dir.)
- **Entry shape:** `{invoice, po, invoice_no, status: "mapped"|"failed", content_hash, line_mappings[], autofill_*}`. A `mapped` entry replays the full mapping; a `failed` entry is an empty marker.
- **Keyed by `invoice`** = the Vendor Invoices **docname** (`VI-2026-04448`) — stable, unique, and identical across test↔prod (dev is a restore of the prod DB), so replay/upsert are fast and unambiguous. `_entry_key()` falls back to the legacy `(po, invoice_no)` composite for pre-docname entries; `_store()` upgrades them in place (no duplicates).
- **Self-building + write-once-Gemini:** `import_cache` writes entries as it runs. A `failed` invoice is Gemini'd **at most once**, then skipped on later runs (cheap) and surfaced in the Resolve UI.
- **UI writes back:** resolving in the browser flips the entry `failed → mapped` with the fixed data (best-effort) — so a fix done on test ships to prod with the cache.
- `export_cache()` is optional (re-snapshot mapped invoices from the DB, preserving `failed` entries).

---

## 8. Resolve Invoices UI (admin)

Browser tool to clear the invoices the AI couldn't map. **Nirmaan-Admin only** (route-guarded with `AdminRoute` + backend `_require_admin` + in-page `isAdmin`).

- **Route:** `/resolve-invoices` → `src/pages/temp/ResolveInvoices.tsx`. **Backend:** `nirmaan_stack/api/invoices/temp_resolve.py` (whitelisted: `get_unresolved_invoices`, `analyze_invoice`, `resolve_invoice`).
- **Population:** extraction-failed invoices only = active, non-credit-note invoices on a **MISMATCH** PO with **no** line mappings.
- **Flow per card:** **Analyze** (re-runs `extract_invoice_fields`, read-only on the file) → correct the mapping + qty in `LineItemMappingReview` → **Save** (`resolve_invoice`): writes `line_mappings` + full `autofill_*` (`_apply_autofill`, `modified` preserved) → `recompute` → flips the cache entry `failed → mapped`. The card is removed **optimistically** (the `get_unresolved_invoices` refetch is expensive).
- Naming note: the module/page still use the `temp_resolve` / `pages/temp` names (kept during development); the feature itself is permanent.

---

## 9. Admin editing an Approved invoice's mapping

Normally the Add/Edit dialog only shows the editable AI mapping for **Pending** PO invoices. A **Nirmaan Admin** may also edit it on **Approved** invoices:
- Frontend: `canReExtract = isEditMode && (status === "Pending" || (isNirmaanAdmin && status === "Approved"))` (`InvoiceDialog.tsx`).
- Backend mirror: `update_invoice_data` rebuilds `line_mappings` when `status == "Pending"` **OR** the caller is a Nirmaan Admin (`_admin_can_rebuild`). `recompute` runs after → `invoice_qty` resyncs.

---

## 10. Design decisions & rationale (the WHYs)

- **Derived, self-classifying, re-derive-not-increment** → no stale state; every event self-corrects (reject/delete/edit included). §3.
- **Trust ladder: EXACT → TRUSTED-FULL → DELIVERED → ZERO** → when line data is complete use it (EXACT); when the PO is fully billed use ordered qty (TRUSTED-FULL); when only partially trustable fall back to **delivered (received) qty**, not the mapped-only sum (undercounts a mixed PO) nor ordered qty (overcounts). Replaced the earlier PARTIAL sum, which dropped a DIRECT-then-revised PO's old unmapped rows to ~0. §3.
- **`received_quantity` as the partial-trust fallback** → the PO has invoices but no complete line data and isn't fully billed; delivered qty is the real amount that arrived (`received ≤ ordered`), so it's a tighter, honest estimate that converges to EXACT once every invoice is mapped.
- **MISMATCH left unwritten by `execute()`** → the deterministic pass can't call Gemini; extraction/recompute fills it.
- **Cache in the app dir, self-building, Gemini-once** → test→prod replay without re-paying for AI; failures are remembered, not retried.
- **Credit notes = negative amount + `is_credit_note` + excluded** → a credit reduces billing; it must not add qty. Two exclusion paths agree (recompute uses the flag, the backfill's `_active_invoices` uses `amount ≥ 0`).
- **Additional Charges = 0** → not real quantities.

---

## 11. Gotchas / invariants (don't break these)

1. `recompute` is **shared** by runtime + backfill — changing it changes both.
2. `execute()`/`_po_bucket` are **separate** from `recompute` — keep them consistent, but they are not the same code.
3. `set_value(..., update_modified=False)` everywhere `invoice_qty` is written — never bump `modified`.
4. Credit-note **sign** logic depends on `invoiceData.is_credit_note` being in the autofill callback's deps (stale-closure bug otherwise).
5. `LineItemMappingReview` dropdown needs `menuPortal.pointerEvents:auto` inside the modal dialog (else click-dead).
6. Any `lazy()` route element **must** be wrapped in `<Suspense fallback={null}>` (React Router) — an unwrapped lazy route throws "A component suspended while responding to synchronous input."
7. `Purchase Order Item` reads that need `category` must include it in `fields=[...]` (it's not returned by default).
8. Additional Charges → 0 must live in **both** writers (recompute `_write` **and** backfill `_write_bucket`).

---

## 12. File map

| Concern | File |
|---|---|
| **Core deriver** (EXACT/TRUSTED-FULL/DELIVERED/ZERO) | `nirmaan_stack/api/invoices/_item_billing_sync.py` |
| One-time backfill + extraction + cache | `nirmaan_stack/patches/v3_0/backfill_invoice_qty.py` |
| Read-only classification/extraction PREVIEW | `nirmaan_stack/dry_run_invoice_qty.py` |
| Fuzzy+Gemini line matcher | `nirmaan_stack/api/invoices/_line_match.py` |
| AI extract endpoint (read-only) | `nirmaan_stack/api/invoice_autofill.py` |
| `build_line_mapping_rows`, create/edit invoice, admin-rebuild guard | `nirmaan_stack/api/delivery_notes/update_invoice_data.py` |
| Resolve UI backend (admin) | `nirmaan_stack/api/invoices/temp_resolve.py` |
| Resolve UI page | `frontend/src/pages/temp/ResolveInvoices.tsx` |
| Shared mapping review surface | `frontend/src/pages/ProcurementOrders/invoices-and-dcs/components/LineItemMappingReview.tsx` |
| Add/Edit Invoice dialog (+ Add Credit, admin approved-edit) | `frontend/src/pages/ProcurementOrders/invoices-and-dcs/components/InvoiceDialog.tsx` |
| Add Invoice / Add Credit entry buttons | `frontend/src/pages/ProcurementOrders/invoices-and-dcs/DocumentAttachments.tsx` |

---

## 13. Future / open items

- **"Too many re-renders" crash** in the Add-Invoice path (opening PO Attachments + Add Invoice) — not located statically; needs the browser console's component name to fix.
- **DELIVERED is a proxy, not the exact billed qty** — a partially-trustable PO reads at its delivered (received) qty until every invoice is line-mapped (then EXACT). `received` can slightly exceed the truly-invoiced qty (goods received but not yet billed); resolving all invoices removes the approximation. If a "provisional" indicator is wanted, it belongs in the read/display layer, not `recompute`.
- **`dry_run` mirrors the backfill buckets, not `recompute`** — its Stage-1 preview predicts what `execute()`/`_po_bucket` writes; it does not model the runtime DELIVERED fallback (that only applies after a live invoice event / `import_cache` recompute).
- **Resolve UI naming** (`temp_resolve` / `pages/temp`) could be promoted to a permanent name in one pass (backend module + page path + the 3 method strings + route) — deferred.
