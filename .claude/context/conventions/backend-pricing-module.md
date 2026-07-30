<!-- Carved from CLAUDE.md on 2026-07-30 (structural carve).
     CLAUDE.md is a router; this file holds the detail it points to.
     Load when: Touching the pricing module backend -- APIs, workbooks, rate resolution -->

## Pricing Module

Standalone estimation-pricing module (separate from the BoQ wizard). Frontend serves a spreadsheet
editor (Luckysheet-as-static-assets planned) whose workbook state is persisted server-side. Live status
+ roadmap: **`frontend/.claude/plans/pricing-module-plan.md`**.

- **Doctypes** (`nirmaan_stack/nirmaan_stack/doctype/`): `Pricing Workbook` (title, `workbook_json`,
  `current_version`, `checked_out_by`/`checked_out_at`), `Pricing Workbook Version` (per-save snapshot),
  `Pricing Access Log` (open/save/checkout/release/create audit). **All three are `System Manager`-only** —
  the whitelisted API is the single-point access gate, so endpoints read/write with `ignore_permissions=True`.
- **API** (`nirmaan_stack/api/pricing/workbook.py`): `list_workbooks` / `get_workbook` / `checkout` /
  `release` / `save_workbook` / `create_workbook`, all `@frappe.whitelist()` and all gated by
  `_require_pricing_access()`.
- **Transport (FR-5/FR-6):** `create_workbook(title)` and `save_workbook(name)` take **NO `workbook_json`
  param**. They are thin wrappers that read + gunzip the `workbook_json_gz` **`multipart/form-data`** file from
  the request (`_read_gzip_payload` / `_gunzip_payload`, with a 200 MB decompressed guard) and delegate to
  `_create_workbook` / `_save_workbook`, which hold all logic unchanged. Single path, no fallback — the old
  nested-JSON body escaped every quote (1.23x) and 413'd a real workbook against the 25 MiB `max_file_size`;
  gzipped it is ~0.7 MB. Other endpoints unchanged.
- **Access rule — READ/WRITE SPLIT (owner decision, DB-discovered names; PW-2a):** two gates, the write one
  LAYERED on the read one so an outsider and an in-module read-only user get different, honest messages.
  - **READ** (`_require_pricing_access`, used by `list_workbooks` / `get_workbook`): ALLOW if session user is
    `Administrator`, OR `role_profile_name` is in `PRICING_ACCESS_SET`, OR `frappe.get_roles(user)` intersects
    it. The set holds the EXACT DB-verified strings (2026-07-22): `Nirmaan Admin Profile`,
    `Nirmaan Estimates Executive Profile`, `Nirmaan Estimates Executive` — **admins + estimation**.
  - **WRITE** (`_require_pricing_write_access`, used by `checkout` / `release` / `_save_workbook` /
    `_create_workbook`): read gate first, then `Administrator` OR profile/role in
    `PRICING_WRITE_SET = {"Nirmaan Admin Profile"}` — **admins only**. Estimation users get read + the
    client-side Sandbox (a local, never-persisted edit session) and no write path at all.

  Re-query the DB before editing either set. The frontend mirrors the split for UX only — **this module is the
  enforcement boundary**, and `PricingRoute` stays wide (estimation users must still enter the module). Only
  `workbook_json` parsing is validated; structure is frontend-owned.
- **Lock semantics:** `checkout` grants when the lock is free, already the caller's, or held >30 min
  (auto-expiry) — otherwise it throws naming the holder. `save_workbook` requires a live (non-expired) lock,
  bumps `current_version`, writes a Version row, and prunes to the newest 20 snapshots. `release` clears the
  lock for the holder or Administrator.
- **Tests:** `nirmaan_stack/api/pricing/test_pricing_workbook.py` (**20 tests**). Run:
  `bench --site localhost run-tests --app nirmaan_stack --module nirmaan_stack.api.pricing.test_pricing_workbook`.
  Writes run as admin-role fixtures (`ADMIN_USER`/`ADMIN_USER2`); `POS_USER` is the estimation actor used for
  the read + negative-write assertions. Every workbook creation MUST go through `_create_as` — the suite runs
  against the LIVE site DB and its purge is scoped to rows it created.

---
