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

## PM-2 — DELIVERED (frontend)

- **Vendored engine** at `nirmaan_stack/public/pricing_libs/` (served `/assets/nirmaan_stack/pricing_libs/`):
  luckysheet@2.1.13 dist (css, plugins, assets/iconfont, `plugins/js/plugin.js`, `luckysheet.umd.js`),
  luckyexcel@1.0.1 `luckyexcel.umd.js`, jszip@3.10.1 `jszip.min.js`. Excluded `*.map`, `demoData`, the esm
  build, `expendPlugins`. **Completeness note:** `fonts/` (fontawesome, referenced by `css/luckysheet.css` +
  `plugins/plugins.css` via `../fonts/…`) and `plugins/images/` are INCLUDED — they are runtime deps of the
  included CSS and are not in the exclude list; dropping them ships a broken toolbar. ~6.8 MB, 47 files.
  Fetched via `npm pack` in the container and committed. Vendoring (~7 MB) is the MVP tradeoff; npm-proper /
  CDN is deferred with the Univer upgrade. The libs are **script-injected at runtime, NOT bundled by Vite**
  (verified: the `HvacPricingPage` chunk is ~8.6 KB; the 3 MB luckysheet UMD is not inside it).
- **Page** `frontend/src/pages/pricing/HvacPricingPage.tsx` (+ local `pricingLibs.ts` helper) — lazy module,
  named `Component` export (M1.59). On mount: inject CSS + scripts (plugin.js before luckysheet.umd.js; jszip
  before luckyexcel), then `list_workbooks`. Empty → "Import Excel (.xlsx)" via `LuckyExcel.transformExcelToLucky`
  → `create_workbook`. Exists → `get_workbook` → `luckysheet.create` (read-only first, `showinfobar:false`).
  **Lock flow:** "Edit" → `checkout` → re-init `allowEdit:true` + "You hold the edit lock" banner + Save/Release;
  checkout held-by-another → "Locked by <holder>", stay read-only. Save → `save_workbook(getAllSheets())`, shows
  saved-at; keeps lock. Unmount + `beforeunload` → best-effort `release` (fetch keepalive w/ CSRF). PermissionError
  → Access Denied panel; script-load failure → visible error (never blank).
- **Watermark:** pointer-events-none data-URI-SVG background overlay, ~30° tiled full-name + email at low
  opacity; applies in read-only AND edit modes.
- **Guard** `PricingRoute` in `ProtectedRoute.tsx` (NewProjectRoute single-source pattern): Administrator OR
  role_profile `Nirmaan Admin Profile` / `Nirmaan Estimates Executive Profile`. **Route** = one lazy entry
  `hvac-pricing` wrapped by `<PricingRoute />`. **Sidebar** = four-touch M1.57 recipe (`Table2` icon), same
  access strings as the guard.
- **Verification:** tsc (in-container) 0 new errors in slice files; `yarn build` clean (2m49s), known-benign
  warnings only (large chunks, caniuse, PWA). No Frappe-test harness on this slice (frontend) — tsc + build +
  manual matrix stand in.

### On record

- **Recon correction:** `a7b8237c` is `develop`'s tip (v2.11.14), NOT `main`'s (`main` = `b92fd6b2`, v2.10.15).
  The PM-1 brief's "off main tip (a7b8237c)" carried a mislabel from the earlier recon writeup; the branch is
  correctly rooted at `a7b8237c` per the explicit hash + the repo's feature→develop→main flow.
- **Report delivery standing rule:** every run's full report is also written to the owner's Desktop as a dated
  `.md` (resolve Desktop via the environment, never hardcode) for upload — not relied on via inline paste.
- **Access asymmetry surfaced (STEP 0):** two Project Leads (`aseem@`, `bhanu@`) carry the *Role* "Nirmaan
  Estimates Executive" but a Project-Lead *profile* — the backend admits them, the frontend guard (profile-only)
  does not. Intentional (backend is the enforcement layer); flagged for owner review.

## PM-3+ — deferred

- Role tightening / reconciling the profile-vs-role asymmetry above (owner call).
- A `patches.txt` entry if any data migration becomes needed (none this slice).
- Version history browse/restore UI over `Pricing Workbook Version`.
- Real-time co-edit (multi-user live), beyond the single-editor checkout lock.
- npm-proper (bundled) or CDN assets instead of vendored; **Univer** migration evaluation.
