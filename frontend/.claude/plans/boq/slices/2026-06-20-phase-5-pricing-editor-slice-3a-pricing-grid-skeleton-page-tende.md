### Phase 5 Pricing Editor -- Slice 3a -- pricing grid skeleton + page + TenderingDialog (FRONTEND, READ-ONLY, feat pending, 2026-06-20)

**Goal.** The FIRST on-screen pricing surface: a NEW hub-reached, READ-ONLY page (a 5th sibling wizard route) that opens
a COMMITTED sheet, calls `get_priced_rows`, and renders the committed rows + current saved rates + a basic priced/
un-priced marker, via a NEW `PricingGrid.tsx` that REUSES the Slice-2 `reviewRender` helpers (design v1.3 Sec.4 path b --
it does NOT import/reuse/retune the ReviewTree component). NO editing (3b), NO Save/Export/Finalize (3c/5), NO backend,
NO migrate.

**Route.** `upload-boq/hub/:boqId/pricing/:sheetName` -> lazy `SheetPricingPage` (exports `{ SheetPricingPage as
Component }`). 5th wizard sibling; sheetName `encodeURIComponent`'d on nav, RR v6 auto-decodes -> verbatim sheet_name.

**`SheetPricingPage.tsx` (NEW) -- shell mirrors SheetReviewPage.** `useFrappeGetDoc("BOQs", ...)` header +
`useFrappeGetCall("...get_priced_rows", {boq_name, sheet_name}, gate)`. Header = Back + title ONLY (`{boq_name} ·
V{version} · Pricing · committed v{commit_version}`); NO Save/Export (nothing to save read-only); muted read-only note.
`editable`/`lock_info` read from the payload + passed to PricingGrid as INERT reserved props (the future lock hook).

**`PricingGrid.tsx` (NEW) -- the read-only grid.** Imports `computeDepths` / `resolveDescriptorValue` /
`renderDescriptorCell` / `ClassificationPill` from `./reviewRender` + `ROLE_LABELS` from `./boqTypes`. **Does NOT import
ReviewTree** (the locked path-b call) -- `FIXED_ROLE_DEDUPE` is defined LOCALLY (a 2-role `Set(["sl_no","description"])`,
documented kept-in-sync mirror) and `INDENT_PX=20` mirrored locally. Fixed anchors **Excel Row / Sl.No / Parent**
(parent's source_row_number, muted "↑ N", NO scroll-to) **/ Classification** (`<ClassificationPill>`, NO chevron) **/
Description** (depth indent from computeDepths), then `displayDescriptors = columnDescriptors.filter(d =>
!FIXED_ROLE_DEDUPE.has(d.role))`. Omitted (minimal): detail panel, inline edit, reclassify, AI columns, restructure,
remarks, search/filter, subset selector, collapse, per-area header tint.

**PRICED MARKER (Q4 -- basic, IN for 3a).** Each RATE cell with a saved price renders a subtle emerald tint + dot, driven
SOLELY by the overlay's `priced_*` markers -- per-area `priced_by_area[area][kind] === true` or scalar
`priced_rate_<kind> === true` -- **NEVER a zero-check** (a committed 0.0 rate can be a valid priced value). Two PURE
exported helpers: `isRateDescriptor(d)` (rate cell iff `value_field === "rate_by_area"` or in
`{rate_supply,rate_install,rate_combined}`) + `isCellPriced(row, d)`. Only RATE cells get a marker.

**NEW types (boqTypes.ts, additive).** `PricedRow extends ReviewRow` (adds optional `priced_by_area` /
`priced_rate_supply/install/combined`) + `GetPricedRowsResponse`. `extends ReviewRow` so the ReviewRow-typed
reviewRender helpers accept it with no retyping.

**Hub entry (CORRECTED by the 3a-fix).** A global **"Tendering"** button in the hub bottom action row (gated on
`committedMap.size > 0`) opens `TenderingDialog.tsx` (NEW) -- a RADIO single-select picker (CommitDialog is multi-select
checklist) of eligible committed sheets; Confirm -> `handleOpenPricing` navigates to the pricing route. The initial 3a
per-card "Price" button + the `onOpenPricing` prop were REMOVED from `SheetCard` (clean revert).

**Tests + verification.** Vitest **20/20 GREEN** (12 Slice-2 + 8 NEW marker tests incl. the ZERO-RATE-IS-PRICED proof);
tsc 3178 (== baseline), 0 in touched; Vite build exit 0 (PWA 166, +2 lazy chunks). Slice 3a unblocks 3b. (See frontend
CLAUDE.md `**Status (... Slice 3a ...)**`.)

