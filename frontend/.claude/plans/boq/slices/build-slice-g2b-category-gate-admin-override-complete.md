## Build slice G2b (category gate + admin override) COMPLETE

FULL-STACK BACKEND, MIGRATE-CARRYING. Branch `feature/boq-pricing-helper`, base tip `3bf756df`.
**PULLERS MUST RUN `bench migrate`** (four new BoQ Sheet fields). Abhishek needs a migrate heads-up.

**What it does.** (1) A rate write (`save_cell_price`) is REJECTED while any RATE-EDITABLE row on the sheet
has a blank RESOLVED category (the G2a `rate_editable` population -- Line Item always; qty-bearing Preamble).
(2) An ADMIN-ONLY, PERSISTED, per-sheet-per-committed-version override unlocks the gate, recording who/when +
an OPTIONAL short reason. (3) The override state is surfaced through `get_priced_rows`. The gate + its escape
ship TOGETHER (a lock with no escape must never exist, not even for one slice).

**Doctype fields (MIGRATED, verified via has_column + information_schema).** New
`category_override_section` on `BoQ Sheet`, AFTER `classification_freeze_section` and BEFORE
`revision_provenance_section`, mirroring the freeze trio: `category_gate_override` (Check, default 0),
`category_override_by` (Data, read_only), `category_override_at` (Datetime, read_only), `category_override_reason`
(Small Text, OPTIONAL, not read_only). Added to BOTH `fields` and `field_order`; top-level `modified` bumped.

**The gate.** `_guard_categories_complete` in `pricing.py`, inserted in `_resolve_and_guard_cell` AFTER the
mandatory amount-formula gate and BEFORE the priceability block -- i.e. OUTSIDE `if not
_coerce_bool(allow_non_priceable):`, so **the "Price any row" priceability override can NEVER bypass it**
(owner ruling; ABSOLUTE like the formula gate). Guard order is now: resolve-cell -> deliberate-lock ->
mandatory-formula -> **category** -> priceability -> (transient-lock acquire) -> write. The gate reuses the
G2a helper `blank_category_eligible_rows(..., population="rate_editable")` -- the SAME function
`get_priced_rows` surfaces the count from, so the gate and the banner can NEVER disagree (no short-circuit
reader, no consistency-pin needed). Distinct throw title "Categories incomplete". **Blank = any rate-editable
row without a resolved category, classified-and-blank OR never-classified -- ONE definition, no special cases**
(owner ruling).

**NO GRANDFATHERING (owner ruling).** The gate applies uniformly to EVERY committed sheet, including
already-priced ones -- a rate revision on an uncategorised sheet requires categorising first (that is the
entire point). NO backfill patch was written; NO override was set on any real sheet. The admin override is
the ONLY exception path.

**The override endpoints.** `set_category_override(boq_name, sheet_name, committed_version, reason=None)` and
`clear_category_override(boq_name, sheet_name, committed_version)` in `pricing.py`. ADMIN check REUSES the
EXISTING `_is_nirmaan_admin` (Administrator OR `Nirmaan Users.role_profile == "Nirmaan Admin Profile"`) -- NOT
a new admin definition, NOT the Pricing Module's `_require_pricing_write_access` (wrong module/copy); it
matches the frontend's role source (`useUserData().role` reads the same `Nirmaan Users.role_profile`) by
construction. A non-admin is rejected with `frappe.PermissionError`. Reason optional, capped server-side at
its own constant `_CATEGORY_OVERRIDE_REASON_MAX_LEN=250` (mirroring `_REMARK_MAX_LEN`), stored NULL when
absent; clearing clears the reason too. Write pattern = `frappe.db.set_value(update_modified=False)` + explicit
`frappe.db.commit()` (NEVER doc.save -- the list-valued `area_dimensions` JSON throws on a full save); actor =
`frappe.session.user` (user id, not display name); `now_datetime()` for the timestamp.

**Surfacing (ADDITIVE) in `get_priced_rows`** -- read in the SAME get_value as the freeze fields (one query for
all seven): **`category_gate_override`** (bool), **`category_override_by`**, **`category_override_at`**,
**`category_override_reason`**. Existing keys stay present + same-typed. G3 renders these.

**Measured per-save gate cost (largest real sheet BOQ-26-00009 `ELECTRICAL WORKS` cv2, 1093 nodes, warm):**
OFF-path (override not set) = **6 SQL queries / ~15.4 ms** added per `save_cell_price` (override read 2q/1ms +
blank check 4q/14.4ms). ON-path (override SET) short-circuits (confirmed: `blank_category_eligible_rows`
called 0 times) = **2 queries / ~1 ms** (override read only). ~15ms on the largest sheet is NOT material for an
interactive save (which already does freeze-and-supersede + insert + re-arms + lock-acquire + commit; the
network round-trip dwarfs it). No DB index added (per spec).

**COPY-FORWARD FINDING (fact-finding, no behaviour changed).** `apply_copy_forward` (pricing.py) does NOT go
through `_resolve_and_guard_cell` -- it checks the lock + formula gates INLINE up front, then writes via
`_resolve_committed_cell` + `_write_cell_price_record`, so it **BYPASSES the category gate**. An uncategorised
sheet's re-commit carries rates forward with NO block and NO failure (clean success -- not partial, not
silent). Live proof: `TestCopyForward`'s `apply_copy_forward` tests pass on an UNcategorised destination v2.
**Whether copy-forward should also be gated is an OWNER DECISION for a follow-up slice** (it was NOT changed
here -- Task 3 is fact-finding only). Recorded so it is not lost.

**Test fixtures satisfy the gate by CATEGORISING, never by override (owner ruling, option B).** New shared
helper `_categorise_fixture_rate_editable_rows` (test_pricing.py, mirroring `_declare_fixture_amount_formulas`)
writes REAL category rows for a fixture's rate-editable rows via the normal `persist.write_row_categories`
path -- production-plausible, and the fixtures drive THROUGH the live gate every run rather than disabling it
(a permanently-disabled tripwire is what the override would have been). Called from the setup of each affected
save-path class (TestCellPricing, TestGetPricedRows [+ its scalar sheet], TestSingleEditorLock,
TestLockPerSheetIsolation [both sheets], TestPriceabilityGuard, TestPreambleQtyBearingGuard, TestCellDismissal,
TestSheetLock, TestGetVersionPricedRows [before its setUpClass saves], TestReconciliationChoice,
TestMandatoryFormulaGate). **No existing assertion was changed -- only setup.** `TestCategoryGate` +
`TestRateEditableBlankCount` are DELIBERATELY not categorised (they must see blanks). `TestCopyForward` is NOT
categorised (it proves the copy-forward bypass).

**Tests (bench-verified):** `test_pricing` 204 -> **214** (+10, new class `TestCategoryGate`: (a) reject when
blank; (b) succeed when all categorised; (c) "Price any row" does NOT bypass; (d) override unlocks; (e) clear
re-locks; (f) admin predicate [explicit users] + endpoint PermissionError [mock, no set_user] + admin success;
(g) qty-less Preamble blank does not gate; (h) formula gate wins precedence; (i) reason cap/NULL/clear; the
get_priced_rows override surfacing). Regression `test_classify` **62** unchanged. Both suites moved ONLY by the
new tests (the 38 existing save-path tests that the gate initially broke are green again via the setup
categorisation, no assertion changed).

**Browser cert RAN + PASSED** (owner session survived the migrate; mandatory de-stale run -- 1 SW unregistered,
storage cleared, tab closed+reopened, bare root first). Synthetic sheet `BOQ-26-00136 | G2B CERT ` (trailing
space), committed v1, rows 50 (LI qty, blank), 51 (LI zero-qty, blank), 52 (Preamble qty-less, blank), 53 (LI
qty, categorised), 54 (Other). C1: typed a rate on Line Item 50 -> REFUSED with a VISIBLE red banner ("Some
priceable rows on this sheet do not have a category yet...") + "Save failed", nothing saved. C2: Price-any-row
ON, retried -> STILL REFUSED (same banner). C3: admin `set_category_override` -> the save SUCCEEDED ("Saved as
of 19:54", green priced dot, "1 of 2 priceable lines priced"). C4: `clear_category_override` -> REFUSED again
(banner returned). C5: the qty-less Preamble (52) never gated (count=2 not 3; read-only). C6 REGRESSION on the
REAL fully-categorised sheet `BOQ-26-00114 | Electrical `: `save_cell_price` on cell excel_row 313 (orig
45000) succeeded, then RESTORED to 45000 with the pricing row-set identical to before; the browser showed NO
gate banner (gate invisible on a categorised sheet). C7: Category column rendered ("Point Wiring" /
"DB and Switchgear"). Synthetic BoQ + project DELETED + verified (0 residual). (Setup note: a transient
single-editor lock left by save_amount_formula was cleared before each browser view; unrelated to G2b.)

**OVERRIDE REMOVAL CONDITION (dated commitment, 2026-07-25):** the category-gate override is TEMPORARY BY
DESIGN -- REMOVE it (fields + endpoints + surfacing) once classification engines cover ALL disciplines.

**OWED / follow-ups:** G2c (clear the override on re-classify) is OWED -- deliberately out of this slice.
Whether copy-forward should be gated (the bypass above) is an owner decision for a follow-up.

---

