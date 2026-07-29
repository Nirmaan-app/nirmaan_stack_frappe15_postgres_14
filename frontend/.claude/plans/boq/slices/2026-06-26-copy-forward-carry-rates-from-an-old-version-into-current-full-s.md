### Copy-forward -- carry RATES from an old version into current (FULL-STACK, NO migrate, base tip 863dceb5, 2026-06-26)

**The WRITE-side of version-view (slice 2 of 2).** From the read-only version-history view (slice 1), the user selects
priced rows on an OLD version and copies their RATES into the CURRENT version. RATES ONLY -- never structure / amount /
qty. THREE per-row outcomes, ALL shown in a review-before-apply dialog BEFORE any write: (1) HARD SKIP, (2) clean copy
(dest empty), (3) conflict (dest already priced -> overwrite/keep). **Build shape = Option B (owner): server-side plan +
ATOMIC apply.** Recon (read-only, CF1-CF5) preceded this build.

**Two owner-locked design calls (this session):** (a) **priceability RE-GATE** -- copy-forward writes WITHOUT the
override; a source-priced row that is NON-priceable in the current structure is a 4th HARD-SKIP reason (`non_priceable`),
shown + never written (highlight discrepancies, never silently fix). (b) **default selection** -- clean rows pre-ticked
to copy; conflicts pre-ticked but defaulting to KEEP (the destructive overwrite needs deliberate per-row or bulk intent).

**BACKEND (`pricing.py` only; NO migrate -- writes through existing BoQ Cell Pricing):**
- **Behavior-preserving extraction of `save_cell_price`** (the live write path stays byte-for-byte -- `test_pricing` 166
  unchanged & green): split its body into `_resolve_and_guard_cell(...)` (resolve + the three gates: deliberate lock,
  mandatory amount-formula, priceability) and `_write_cell_price_record(...)` (freeze-and-supersede + insert + the two
  re-arms, **NO commit**). `save_cell_price` calls them in the SAME order with `acquire_or_refresh` between (resolve+gate,
  lock, write, commit). The priceability rule is now a shared predicate `_node_priceable_without_override(node_type,
  node_name, qty)` (Line Item always; Preamble iff qty-bearing; else not) used by BOTH the guard AND the plan classifier
  -- no drift.
- **The CF3 safety rule -- `_current_rate_column_index(column_descriptors)`:** the RESTRICTED rate-role-only inverse
  `{(area, rate_kind): col_letter}`. Per-area rate descriptors key on `(value_key=area, rate_subkey)` -- rate_subkey is the
  SAME long-form spelling as the stored rate_kind (`supply_rate`/`install_rate`/`combined_rate`, verified in
  `classifier._RATE_ROLE_TO_KIND`); scalar rate descriptors key on `(None, <rate_kind>)` via `_SCALAR_FIELD_TO_RATEKIND`
  (`rate_supply` field <-> `supply_rate` kind). NON-rate roles EXCLUDED by construction (a generic inverse is ambiguous --
  `append_to_notes` maps one role+area to several letters, recon CF3 -- but the rate-role inverse is unambiguous); a
  duplicate key throws rather than guessing. **Copy-forward re-resolves the target column by (area, rate_kind), NEVER the
  bare source col_letter** (the column-drift hazard).
- **`get_copy_forward_plan(boq, sheet, from_version)`** (whitelisted, READ-ONLY): the SHARED classifier
  `_build_copy_forward_plan` runs for every priced cell on from_version -> `{excel_row, description, source_rate, area,
  rate_kind, outcome 1|2|3, skip_reason, target_col_letter, current_rate, reason}`. Classification order: exact-match
  (source_row_number + description vs current; absent/changed -> `non_match`) -> re-resolve target col (absent ->
  `no_rate_column`) -> priceability re-gate (`non_priceable`) -> dest empty (clean 2) vs filled (conflict 3, `is_filled`
  the authoritative signal). Returns `{plan, from_version, current_version, current_formulas_complete, counts}`.
- **`apply_copy_forward(boq, sheet, from_version, decisions)`** (whitelisted POST, ATOMIC): `decisions =
  [{excel_row, area, rate_kind, overwrite}]` -- presence = "copy"; `overwrite` matters only for a conflict. The server
  **RE-DERIVES** the plan (`_build_copy_forward_plan`, keyed by `(excel_row, area, rate_kind)`) -- a client outcome /
  target col / rate is NEVER trusted, so a crafted POST cannot write a wrong column or an outcome-1 row. Sheet-level gates
  (lock, formula) checked ONCE up front (a failure aborts the WHOLE apply). ONE `acquire_or_refresh` on the current
  version + ONE commit; `try/except -> frappe.db.rollback()` makes a mid-batch failure leave NOTHING written. Writes reuse
  `_write_cell_price_record`. Returns `{ok, copied, conflicts_overwritten, conflicts_kept, skipped:{non_match,
  no_rate_column, non_priceable, invalid}}`.

**FRONTEND (`SheetPricingPage.tsx` + NEW `CopyForwardDialog.tsx` + `VersionRibbon.tsx`):**
- **Trigger** = a "Copy rates forward" button in `VersionRibbon` (new optional `onCopyForward` prop), shown ONLY in
  read-only history mode -- the ONE write action reachable from history. It writes to the CURRENT version, not the viewed
  one; the slice-1 read-only spine + `locked` choke are UNTOUCHED. **`pricingRowPropsAreEqual` UNTOUCHED.**
- **`CopyForwardDialog.tsx` (NEW, self-contained like CommitDialog):** fetches `get_copy_forward_plan`, renders the
  per-row outcome table (clean/conflict selectable, hard-skips shown disabled with reason; conflict shows current->source
  with a per-row Keep/Overwrite + bulk "Overwrite all"/"Keep all"), collects decisions, POSTs `apply_copy_forward`. Apply
  disabled when `!current_formulas_complete` or nothing selected. PURE helpers (vitest): `cellKey` (per-area cells share
  an excel_row -> keyed by `excel_row|area|rate_kind`), `isWritable`, `initialSelection` (clean+conflict pre-ticked,
  conflicts default keep), `applyBulkOverwrite`, `buildDecisions`, `outcomeMetaKey`.
- **`SheetPricingPage`:** `copyForwardOpen` + `copyForwardMsg` state (reset on sheet switch); on `onApplied` it shows a
  transient emerald summary, returns to the live version (`setSelectedVersion(null)`), and `mutate()`s the live read so
  the copied rates appear. Types: `CopyForwardPlanRow` / `GetCopyForwardPlanResponse` / `CopyForwardDecision` /
  `ApplyCopyForwardResponse` on `boqTypes.ts`.

**Tests:** backend `test_pricing` 166 -> 176 (+10 `TestCopyForward`: plan classifies all 5 outcomes [clean / conflict /
non_match-desc / non_match-absent / non_priceable / no_rate_column] + counts; apply clean copy; conflict overwrite vs
keep; outcome-1 NEVER written even when the client sends them; invalid decision ignored; **column-drift re-resolution**
[source on col D, current rate role on col E -> the write lands on E, NOT D]; **atomic rollback** [monkeypatched mid-batch
throw -> first write rolled back, conflict cell unchanged]; arg + same-version guards). Seeded fixtures (custom scalar
role maps), NOT live data -- outcomes 1 & 3 don't occur in live data (recon CF2). Frontend vitest 330 -> 339 (+9 NEW
`CopyForwardDialog.test.ts`). tsc 3175 (0 new, 0 in touched). in-container Vite build exit 0. NO migrate. Frontend
vitest/tsc/build run IN-CONTAINER (win32-arm64 host can't start vitest -- linux-arm64 rolldown bindings). OWNER live-cert
pending on all three canonical BoQs, INCLUDING MANUFACTURED outcome-1/outcome-3 (live data is all outcome-2 clean): CF-live-1
Electrical v5->v6 clean copies land in current; CF-live-2 price a current cell that an old version also priced -> conflict
row -> overwrite replaces / keep preserves; CF-live-3 copy into a sheet where a row moved/was edited -> non_match hard-skip
shown + not written; CF-live-4 a non-priceable current row -> non_priceable hard-skip; CF-live-5 atomicity (no half-write).

---

