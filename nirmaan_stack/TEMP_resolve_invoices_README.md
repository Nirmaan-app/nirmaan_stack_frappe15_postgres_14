# TEMP — Resolve Invoices UI (~1 week, then remove)

A short-lived, **Admin-only** browser tool for the PM's team to clear the invoices that
**failed** during the `invoice_qty` extraction backfill. It replaces terminal fixing entirely —
there is no `manual_fix`/`run_extraction` anymore; all fixing happens here.

## What it does

Extraction (`run` / `import_cache`) maps most invoices automatically and marks the rest as
**`failed`** in `extraction_cache.json` (left unmapped, `invoice_qty` untouched). This UI lists
exactly those **extraction-failed** invoices and, per card, lets an Admin:

1. **🔍 Analyze with AI** — re-runs the same extraction the Add-Invoice dialog uses
   (`extract_invoice_fields`), reading the invoice image and proposing a line → PO-item mapping.
2. **Review & correct** — the app's `LineItemMappingReview` surface (reused) shows each
   extracted line with a PO-item dropdown (pre-set to the AI's best guess) **and an editable
   quantity**; the admin fixes the mapping/qty.
3. **Save & Resolve** — writes the corrected `line_mappings` **+ all `autofill_*` fields**
   (identical to a normally AI-autofilled invoice), re-runs `recompute_po_invoice_qty`, and
   **flips this invoice's `extraction_cache.json` entry `failed` → `mapped`** (best-effort) so
   the fix ships to prod with the cache.

If Analyze can't read the file / returns no line items, the card shows an error and **writes
nothing** — the invoice stays a `failed` cache entry and is handled manually, NOT here.

- **Read-only on the invoice file.** `analyze_invoice` only *reads* the bytes (presigned GET /
  local `get_content`). Nothing uploads, replaces, or modifies any invoice file.
- **`modified` is preserved** on save (backfill correction, not a user edit).
- **Population = extraction failures only:** active (Pending/Approved, non-credit-note) invoices
  on a MISMATCH PO with no line mappings. Use it AFTER the extraction batch runs.

## Access

- URL: **`/resolve-invoices`** (inside the main app layout).
- Visible only to **Administrator** or **Nirmaan Admin Profile**. The backend
  (`_require_admin`) enforces this too — a non-admin call `frappe.throw`s `PermissionError`,
  so the route being reachable is not a security hole.
- Optional project scope: the backend `get_unresolved_invoices(project=None)` lists all
  projects by default. (No project filter is wired into the UI — it shows everything unresolved.)

## Files (all self-contained; nothing else imports them)

| File | Purpose |
|---|---|
| `nirmaan_stack/api/invoices/temp_resolve.py` | Backend: `get_unresolved_invoices`, `analyze_invoice`, `resolve_invoice` |
| `frontend/src/pages/temp/ResolveInvoices.tsx` | The page component |
| `frontend/src/components/helpers/routesConfig.tsx` | 2 added lines (lazy import + route) |
| `frontend/src/pages/ProcurementOrders/invoices-and-dcs/components/LineItemMappingReview.tsx` | **Shared** component — gained an opt-in `editableQty` prop (revert on removal) |

## How to REMOVE after the window

1. Delete `nirmaan_stack/api/invoices/temp_resolve.py`.
2. Delete `frontend/src/pages/temp/ResolveInvoices.tsx` (and the now-empty `frontend/src/pages/temp/` folder).
3. In `frontend/src/components/helpers/routesConfig.tsx`, delete the two TEMPORARY lines:
   - `const ResolveInvoices = lazy(() => import("@/pages/temp/ResolveInvoices"));`
   - `{ path: "resolve-invoices", element: <ResolveInvoices /> },`
4. In `LineItemMappingReview.tsx`, remove the opt-in `editableQty` prop (the `editableQty` in
   `Props` + the signature default, the `qtyDraft`/`handleQtyChange` block, and the editable
   `<input>` branch in the Qty cell — leaving the original read-only `{m.quantity ?? "—"}`).
   *(Optional — it's inert when no caller passes `editableQty`; only the Resolve page did.)*
5. Delete this README.
6. Rebuild the frontend (`yarn build`) and restart bench.

No DB schema was added, so there is nothing to migrate on removal.
