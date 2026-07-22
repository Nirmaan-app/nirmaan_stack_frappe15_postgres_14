# Pricing Module — Plan & Status

**Last updated:** 2026-07-22 (PM-1 delivered). Standalone estimation-pricing module, **outside the BoQ
upload wizard**. This is the live status + decision record; per-slice detail accrues here, NOT in the
always-loaded `CLAUDE.md` (which carries only the stable summary).

> Skipping note: `boq-upload-plan.md` is deliberately NOT updated for this module — the plan-doc fold
> agreement applies to BoQ wizard work, and the Pricing Module is a separate surface.

---

## Goals

Give estimation users a real spreadsheet editor in-app for pricing work, with the workbook persisted
server-side, versioned, audit-logged, and protected against concurrent clobbering via a checkout lock.
Access is limited to administrators and estimation users.

---

## Decisions to date

- **Editor = Luckysheet mounted from static assets.** The spreadsheet grid is a mature JS spreadsheet lib
  (Luckysheet) shipped as static assets rather than a bespoke React grid. **Univer upgrade is DEFERRED** —
  Luckysheet first; migrate to Univer only if/when its limits bite.
- **Access = admins + estimation, by DB-discovered names.** The allow-list is the EXACT `role_profile_name`
  / Role strings found by querying the live DB (not guessed, not hardcoded from the frontend's broader BoQ
  gate): `Nirmaan Admin Profile`, `Nirmaan Estimates Executive Profile`, `Nirmaan Estimates Executive`, plus
  the `Administrator` user. DB-verified 2026-07-22.
- **Single-point API gate + SM-only doctype perms.** The three doctypes are `System Manager`-only; every
  user path goes through the whitelisted API, which is the sole gate (`_require_pricing_access()`). Endpoints
  use `ignore_permissions=True` internally. One place to reason about who can do what.
- **Watermark + access log.** Every open/save/checkout/release/create is written to `Pricing Access Log`
  (who / what / when). (Frontend watermarking of the editor surface is the UI half of the same intent.)
- **Checkout lock for concurrency.** One editor at a time per workbook via `checked_out_by` +
  `checked_out_at`, with a 30-minute auto-expiry so an abandoned lock self-heals. Saves require a live lock.
- **JSON is frontend-owned.** The backend validates only that `workbook_json` parses; it never inspects or
  enforces the spreadsheet structure.
- **Branch base.** `feature/pricing-module` was cut from `a7b8237c` (develop tip, v2.11.14) — the repo's
  feature→develop→main flow, and the explicit hash given in the PM-1 brief. (The brief's "main tip" label was
  a carried-over mislabel; `main`'s actual tip is `b92fd6b2`/v2.10.15. Base confirmed before building.)

---

## PM-1 — DELIVERED (backend)

- **Doctypes:** `Pricing Workbook`, `Pricing Workbook Version`, `Pricing Access Log` (all SM-only, hash-named).
  `bench migrate` clean; all three tables verified present.
- **API** (`nirmaan_stack/api/pricing/workbook.py`): `list_workbooks`, `get_workbook` (logs `open`, returns
  lock state), `checkout` (free / mine / >30-min-expired grant; else throws with holder), `release`,
  `save_workbook` (lock-guarded, version bump + Version row + prune-to-20), `create_workbook` (v1 + Version
  row). All gated by `_require_pricing_access()`; ACCESS SET is a DB-verified module constant.
- **Tests:** `nirmaan_stack/api/pricing/test_pricing_workbook.py` — **12 tests, all passing** (positive +
  negative: access denial for non-holders and Guest, create/get round-trip, lock acquire/block/expiry,
  save-without-lock rejection, version bump + row, prune-to-20, audit-log writes, invalid-JSON rejection,
  release). Run:
  `bench --site localhost run-tests --app nirmaan_stack --module nirmaan_stack.api.pricing.test_pricing_workbook`.

---

## PM-2 — PLANNED (frontend)

- Luckysheet static-asset bundle mounted in a dedicated route/page (inside the React SPA), gated by a
  `ProtectedRoute` guard mirroring the backend ACCESS SET, plus the sidebar entry (four-touch recipe in
  `NewSidebar.tsx`).
- Wire the editor to the PM-1 endpoints: load via `get_workbook`, acquire lock via `checkout`, autosave via
  `save_workbook` (lock-aware, surfacing the version + expiry), release on unload.
- Editor watermark (user + timestamp) over the grid.
- Version history browse/restore UI over `Pricing Workbook Version`.
- (Deferred) Univer migration evaluation.
