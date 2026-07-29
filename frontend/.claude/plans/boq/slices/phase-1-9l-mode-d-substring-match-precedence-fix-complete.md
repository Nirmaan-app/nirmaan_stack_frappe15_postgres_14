### Phase 1.9l --- Mode D substring-match precedence fix ✅ COMPLETE

Single targeted fix per the 1.9j-1.9n locked plan. Parser source touched:
`_auto_guess.py` (Phase 1 assignment matcher) and `classifier_audit.py` (`_match_role()`
replica). `classifier.py` not modified — its HEADER_REPEAT checker iterates
per-column against already-assigned roles (different semantics, no role competition).
Test count 312 → 324. Phase 1.x Frappe tests 91 unchanged.

**Mode D (1.9i finding) — generic keyword beats specific:**

The old Phase 1 matcher in `_auto_guess.py` iterated `_HEADER_KW` in dict-insertion
order and broke on the first role whose keyword set had any matching substring.
Because substring matching makes shorter keywords match a strict superset of inputs
vs longer ones, generic keywords like `"rate"` (in `rate_combined`) would beat
specific compound keywords like `"supply rate"` (in `rate_supply`) whenever the cell
text contained both.

**Headline bug (1.9i target 8 Raheja Electrical):**
- Bottom-header cell text: `"Supply Rate"`.
- Old matcher: `"rate"` in `"supply rate"` → True → `rate_combined` wins (iteration
  order); `break`. Supply rate column mis-labeled as `rate_combined`. Install rate
  column dropped to NULL because no subsequent role's first-matching keyword was tried.
- New matcher: among all keyword matches across all roles, picks the role whose
  matched keyword is LONGEST. `"supply rate"` (11 chars) beats `"rate"` (4 chars) →
  `rate_supply` wins. Tie-break by iteration order (no second criterion).

**Implementation:**
- `_auto_guess.py` Phase 1 assignment loop (lines 111-121): replaced inner
  `if any(...): break` with a collect-all-matches loop tracking `best_kw_len`.
- `classifier_audit.py` `_match_role()` (lines 140-153): same longest-match-wins
  rewrite. Sync comment updated to cite Phase 1.9l Mode D + agreement #21.
- `classifier.py` HEADER_REPEAT checker: NOT modified. That checker iterates the
  already-assigned `col_map` and checks per-column whether the cell text matches
  that column's own role keywords — no role competition, so Mode D is irrelevant.

**Test calibrations (§9 #73 path-shift pattern):** None required. All existing tests
either used bare `"Rate"`/`"Amount"` headers (which only match one role family) or
pre-configured `column_role_map` objects (not derived from auto_guess). Zero tests
asserted the buggy first-match precedence.

**New tests** in `TestPhase1_9lModeDPrecedence`:
- `test_auto_guess.py` (10 tests): Supply Rate → rate_supply; Installation Rate →
  rate_install; Install Rate → rate_install; Supply Amount → amount_supply;
  Installation Amount → amount_install; Combined Rate → rate_combined (regression);
  bare Rate → rate_combined (regression); SITC Rate → rate_combined (regression);
  DSR Rate → rate_supply; NDSR Rate → rate_install.
- `test_classifier.py` (2 spot-check tests): Supply Rate in rate_supply col → HEADER_REPEAT;
  Install Rate in rate_install col → HEADER_REPEAT. Complementary guards that role
  assignment is in `_auto_guess.py` and tested fully there; classifier-level tests
  verify the HEADER_REPEAT checker works once columns carry the right roles.

**Audit-script regression check (agreement #25):**
- Top-level stats (expected near-flat since Mode D reassigns but does not unclassify):
  Before (Phase 1.9k): classified=3970, unclassified=10709, unique_unclassified=2536.
  After (Phase 1.9l): classified=3970, unclassified=10709, unique_unclassified=2536.
  Flat as expected — `"Supply Rate"` classified before (as wrong role) and after (as
  correct role); net classified count unchanged.
- Per-role breakdown: not surfaced in audit JSON structure (`summary` has no
  `classified_by_role` field). Role-flip detail visible only in `per_fixture`
  per-cell records; not summarized.

**§9 #54 ECHO check:** xlsx fixtures perturbed during two test runs (Step 1 and Step
7 checks); cleared via `git restore` before both the final test suite run and before
commit.

**Status:** CLOSED. Feat commit `f00cc6ca`. Docs commit see git log.

