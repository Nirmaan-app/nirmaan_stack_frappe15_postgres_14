## Build slice G2c (gate BOTH rate carry-forward paths) COMPLETE

BACKEND, NO MIGRATE. Branch `feature/boq-pricing-helper`, base tip `de517961`. Owner ruling: rate
carry-forward IS subject to the category gate in BOTH flavours; the **DESTINATION** sheet's categories
govern; the admin override is the only escape, exactly as on the save path. (This CLOSES the G2b
copy-forward-bypass follow-up. The clear-override-on-reclassify item is renamed **G2d** and remains OWED.)

**What it does.** Both rate carry-forward paths now refuse a carry while any RATE-EDITABLE row on the
DESTINATION has a blank resolved category, unless the admin override is set on that dest sheet:
- **Flavour 1 -- WITHIN-BoQ version carry** (`apply_copy_forward`, `pricing.py`): rates carry from a prior
  committed version of the SAME sheet into the CURRENT version. Gate added to the EXISTING up-front
  sheet-level block, AFTER the mandatory-formula gate and BEFORE `acquire_or_refresh`, evaluating the
  current (destination) version. Uses this file's THROW idiom.
- **Flavour 2 -- CROSS-BoQ revision carry** (`cross_boq_carry._apply_sheet_carry`): rates carry from another
  BoQ (the original) into its revision. Gate added to the EXISTING up-front block, AFTER the formula check
  and BEFORE the transient lock, evaluating `ctx.dest_boq`/`dest_sheet_name`/`dest_version` (the revision,
  NEVER the source). Uses this file's REASON-TUPLE idiom (`return None, "categories_incomplete"`) mapped to
  a friendly message.

**ONE shared condition (single source of truth).** `pricing._categories_gate_ok(boq, sheet, version) -> bool`
= override set OR no rate-editable blank category. It REUSES the G2a
`blank_category_eligible_rows(..., "rate_editable")` -- the SAME function `get_priced_rows`, the save gate,
and the banner all read, so nothing can disagree. `_guard_categories_complete` (the SAVE path throw) was
refactored to delegate to it (save behaviour + message BYTE-UNCHANGED). The blank-count logic is NOT
re-implemented in `cross_boq_carry.py` (it imports `pricing` and calls the shared predicate).

**Per-file messaging over the one condition (SCOPE §6 -- refusal-message quality).** Each path keeps its own
idiom and neither reuses the save-path wording ("rate editing is locked", which is owner-locked and wrong for
a batch carry). Both messages carry all four required points -- (i) the DESTINATION sheet is named, (ii)
nothing was copied / existing rates untouched, (iii) re-runnable after categorising, (iv) an admin override
exists:
- F1 throws inline (title "Categories incomplete"): *"Nothing was copied. The destination sheet '<sheet>' has
  priceable rows with no category yet, and rates cannot be copied onto it until every rate-editable row is
  categorised. Your existing rates are untouched -- categorise the destination, then run the copy-forward
  again and the rates will come across. An admin can override this to copy before classification is complete."*
- F2 maps `"categories_incomplete"` in `_APPLY_BLOCK_MESSAGE`/`_APPLY_BLOCK_TITLE`; the endpoint FORMATS the
  dest sheet name in (the only templated block -- two BoQs are in play so "this sheet" would be ambiguous):
  *"Nothing was copied. The destination sheet '<sheet>' has priceable rows with no category yet, and rates
  cannot be carried onto it until every rate-editable row is categorised. Your existing rates are untouched --
  categorise the destination, then run the carry again and the rates will come across. An admin can override
  this to carry before classification is complete."*

**Sheet-level, not per-row.** Neither carry loop calls `_resolve_and_guard_cell`; the gate is checked ONCE up
front (the gate is inherently sheet-level). Per-row was rejected on cost (~15 ms x K, Recon 4) + failure-shape
mismatch (F2 returns a reason tuple, the guard throws). Both paths stay ATOMIC (rollback, nothing written on a
block) and fully REPLAYABLE + idempotent (freeze-and-supersede -- a re-run overwrites with the same value, no
double-apply; nothing is stranded). The admin override unlocks carry too. **Precedence: the mandatory-formula
gate still wins** (checked before the category gate on both paths) -- pinned by a test on each flavour.

**Stale docstring fixed.** `_resolve_and_guard_cell` (pricing.py) claimed copy-forward "reuses the IDENTICAL
resolve+gate path per cell" -- FALSE. Corrected to describe the real behaviour (per-cell SAVE path; the two
carry paths gate ONCE up front at the sheet level and loop over `_resolve_committed_cell` + the shared writer).

**Tests (bench-verified).** `test_pricing` 214 -> **221** (+7 `TestCopyForwardCategoryGate`: negative / atomic /
positive / override / source-irrelevant / replay+idempotent / formula-precedence). `test_cross_boq_carry` 40 ->
**48** (+8 `TestCrossBoqCarryCategoryGate`: same seven + the FLAVOUR-2 SHAPE test proving the endpoint surfaces
the MAPPED friendly message, not a raw throw). `test_classify` **62** unchanged (no regression). Existing carry
tests adapted by CATEGORISING the destination fixtures (shared `_categorise_fixture_rate_editable_rows`,
imported into `test_cross_boq_carry.py` -- one source of truth), NEVER the override, NEVER an assertion change.
**Amendment-D guard re-expressed (owner-decided).** `TestApplySheetCarrySynchronous.test_a_carry_writes_no_annotation_of_any_kind`
asserted zero `BoQ Row Category` rows on the dest after a carry -- impossible under G2c (the dest MUST be
categorised to carry). Its CATEGORY leg (only) was re-expressed to two checks over the SAME Amendment-D intent:
(1) the dest category COUNT is unchanged across the carry (catches an ADD), and (2) the source's distinctive ids
('elec_machine'/'elec_human') never appear on the dest (catches an OVERWRITE); Remark/Color/Dismissal legs stay
`== 0` unchanged.

**Browser live-cert RAN + PASSED** (owner session `admins@nirmaan.app`; mandatory de-stale done -- SW/caches
cleared, tab closed+reopened, bare root then deep route). Synthetic data (deleted + verified zero residual after):
- FLAVOUR 1: BoQ `BOQ-26-00136`, sheet `G2C CF ` (trailing space), rows 10/11, v1 priced (100/200) + current v2
  uncategorised. C1: Copy-forward apply -> REFUSED, red in-dialog message quoted verbatim (all four points
  on-screen, full, not truncated). C2: 0 dest v2 pricing rows. C3: categorise dest -> "Copied 2 rates". C4:
  re-run Overwrite-all -> "overwrote 2", values still 100/200, exactly one current row per cell (pv=2).
- FLAVOUR 2: orig `BOQ-26-00137` + revision `BOQ-26-00138`, sheet `G2C XB ` (trailing space), rows 10/11. C5:
  "Carry rates from original" apply -> REFUSED with the MAPPED friendly message (naming 'G2C XB ', verbatim,
  all four points). C6: 0 rev filled rows + source has 0 categories. C7: categorise dest -> "Carried 2 rates".
  C8: rev carried 10->100/11->200 while SOURCE stayed uncategorised (source did not block; only dest gated).
- C9 REGRESSION: real fully-categorised `BOQ-26-00114` / `Electrical ` cv1, cell excel_row 313 col K (orig
  45000): save 45111 SUCCEEDED (gate did not block a categorised sheet), then RESTORED to 45000, rowset
  identical.

**OWED / follow-ups:** **G2d** (clear the override on re-classify) is OWED. `apply_copy_forward`'s sibling
gap noted at G2b -- `apply_copy_forward` was previously the bypass -- is now CLOSED by this slice.

---

