## Classifier eval -- Build slice D1 (proximity-decay mechanism, rules side) COMPLETE

Rules-side proximity decay in the classification runner, on `feature/boq-classification-eval` (one
feat commit + this docs commit). Decay = ancestor influence weakens with degree of separation. Pure
mechanism only -- NO ruleset/prompt/scoring change, NO AI-side change, NO JSON `decay` block shipped
(both disciplines run the flat default), so electrical + HVAC are byte-identical. Backend-only
(runner.py + a new test module); frontend CLAUDE.md untouched (backend-only convention).

**Locked design (owner decisions 2026-07-11 -- electrical-first reversal, shape A multiplicative, no
hard veto, per-discipline config, separate rules/AI multipliers, AI side HELD):**
- **Config surface** -- `load_ruleset(discipline)` now returns an additive `"decay"` dict read from the
  discipline's `rules_<disc>.json` top-level `"decay"` key IF present, else the FLAT DEFAULT
  `{"rules_multiplier": 1.0}`. No shipped rules file carries a decay block this build.
- **Runtime override (the sweep lever)** -- `classify_line` gains a keyword-only `decay_override:
  dict|None = None`. `None` -> use the ruleset config (flat today); provided -> it WINS. Lets the
  offline sweep vary the multiplier in a pure loop with zero file edits.
- **Guaranteed-identical default path** -- effective `m = rules_multiplier`. `m >= 1.0` (or
  absent/malformed/`<= 0`) executes the EXISTING flat code path UNCHANGED (blob flatten + match),
  byte-identical by construction. The decay branch is a guarded early-`continue` prepended to the
  scoring loop; the flat block is verbatim pre-D1.
- **Decay path (active only `0 < m < 1.0`)** -- for `signal_type == "ancestor"` rules: iterate the
  ROOT-FIRST ancestor list (index 0 = sheet name = farthest, last = immediate parent `d=0`; distance
  `d = (len-1) - index`), match each ancestor individually (same token semantics + `headers_only`
  handling via the parallel `ancestor_headers` at the same index), and contribute ONCE at the NEAREST
  matching ancestor's decayed weight `weight * (m ** d)` (no summing across matches -- kills
  repeated-header double-count). The fired record carries `ancestor_distance` + `decayed_weight`.
  Same treatment inside the `_infer_from_ancestors` abstain fallback (`_infer_from_ancestors_decayed`),
  on TOP of the existing `inheritance_weight`/`inheritance_cap` knobs (decay multiplies, does not
  replace). Agreement bonus / conflict penalty / exclusion zeroing / banding / inherited-below-HIGH
  cap all downstream, unchanged. Helpers: `_rules_multiplier`, `_nearest_decayed_hit`,
  `_infer_from_ancestors_decayed`.
- **Known semantic difference (accepted, decay-mode only)** -- in decay mode a multi-token rule must
  match WITHIN a single ancestor's text; the flat blob could incidentally match tokens ACROSS the
  joined ancestors. Intentional (the cross-match is an artifact); exists only when `m < 1.0`.
- **AI side HELD** -- `ai_voter` untouched; AI-side proximity decay is a later, separate build.

**Tests:** new module `nirmaan_stack/services/boq_category/tests/test_decay.py` -- **12 tests, all
green** (pure unittest, no frappe; real electrical ancestor rules `FLOOR SERVICE BOXES`->popup w0.5 /
`SOCKET OUTLETS`->switches_sockets w0.4 against a proven-neutral line; expectations derived FROM the
flat run, not hardcoded weights). Coverage: config-surface flat default (Electrical + HVAC); (a) d=0
== flat; (b) d=2 -> weight*0.25, band MED->LOW; (c) near-beats-far winner flip vs flat; (d)
nearest-match-once (d=0 & d=3 -> one contribution at d=0); (e) silent-parent fall-through (signal at
d=1 -> m**1); (f) `None` and `{rules_multiplier:1.0}` both == pinned flat (ancestor + geometry inputs);
(g) malformed/`<=0`/`>=1.0` override -> flat, no crash; (h) inheritance fallback decays by distance +
stays below HIGH. **Regression (bench env python, from frappe-bench root): `test_runner_electrical`
82, `test_runner_hvac` 21, `test_hv2_voter_harness` 14 -- ALL unchanged and green (117 -> 117), + 12
new = 129.** Backwards-compat: `classify_line` still callable with all existing signatures (new param
keyword-only, default None); `load_ruleset` keys additive -- the DB suites `test_classify` 30 +
`test_row_category` 26 also green.


