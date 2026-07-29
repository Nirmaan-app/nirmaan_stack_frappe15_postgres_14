### Phase 1.9o --- Tier A-merged pattern recognizer (3-change feat) ✅ COMPLETE

**Three coupled changes in two files:**

**Change 1 (_auto_guess.py):** Added `amount_supply` and `amount_install` to
`_SINGLETON_ROLES` frozenset (2 new entries). Prevents duplicate singleton
assignment when a bottom header row contains both a Supply Amount and an
Install Amount column.

**Change 2+3 (multi_area_detection.py) --- unified `_try_tier_a_merged()`:**
Single function handling two sub-shapes via a top+bottom row scan:
- Qty-merged-over-areas: merged Qty/Quantity/Nos family cell spanning N>=2
  distinct area-name cells in the bottom row yields areas + qty_columns.
- Rate/Amount-merged-over-Supply/Install: merged Rate or Amount family cell
  spanning a Supply-then-Install pair (N=2); when the col count equals n_areas
  the columns are paired left-to-right with area names into rate_columns /
  amount_columns (rate_combined_by_area convention, consistent with
  Pattern 2-rate).

Four new broad regexes added before the dataclass:
`_QTY_CELL_PATTERN_BROAD`, `_AMOUNT_CELL_PATTERN_BROAD`,
`_SUPPLY_CELL_PATTERN`, `_INSTALL_CELL_PATTERN`.
Strict-anchor `_QTY_CELL_PATTERN` and `_AMOUNT_CELL_PATTERN` untouched
(still used by Pattern 2 / Pattern 2-rate).

Routing: `_try_tier_a_merged` inserted as the first step in the 2-row path
(before `_try_pattern_2_rate`).

**Empirical verification:**

v1 (`multi_area_merged_header_v1.xlsx`, ELECTRICAL sheet, hrc=2):
- tier_a_merged fires.
- areas=["Area 1", "Area 2"], E/F=qty per area, G/H=rate_combined_by_area per
  area, I/J=amount_by_area per area. Singletons A/C/D assigned correctly.

v2 (`multi_area_merged_header_v2.xlsx`, ELECTRICAL sheet, hrc=2):
- tier_a_merged returns None (top-row merges have area-name values, not
  Qty/Rate/Amount family text).
- Falls through to Pattern 1 top-row fallback.
- areas=["Area 1", "Area 2"] via E+I qty columns. F=rate_supply, G=rate_install,
  H=amount_total assigned as singletons from bottom row. J/K/L unassigned
  (singleton guard blocks duplicates).

**Tests:** 357 total (baseline 337 + 14 TestTryTierAMerged +
8 TestPhase1_9oChange1SingletonGuard + 5 TestPhase1_9oTierAMergedAutoGuess).
1 existing test calibrated: `test_reserved_keyword_top_row_merges_rejected_for_pattern_2`
updated to assert `tier_a_merged` (not pattern 1) because tier_a_merged now
correctly fires first for a QUANTITY-merge-over-area-names top row.

**Metric-impact review (agreement #27):** No diagnostic script changes needed.
`_AMOUNT_FAMILY_ROLES` already covers amount_supply + amount_install (Change 1
singletons). tier_a_merged's per-area roles (rate_combined_by_area,
amount_by_area) are multi-area only and not tracked by the single-area metric.

**Feat commit:** `6f6214ba`

