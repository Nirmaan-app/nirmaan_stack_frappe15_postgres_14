### Classification Engine -- electrical rule tuning pass #1 (2026-06-30)

Drove off the first rules-vs-AI PROVING RUN: the scratch eval harness (rules + an INDEPENDENT
Anthropic Option-B category pass over the same line context) was run on three structurally
distinct core-electrical BoQs from the live committed corpus -- BOQ-26-00022 (sectioned: DB /
EARTHING / SUB PANEL / CABLE&TRAY / POINT WIRING / SUB MAINS), BOQ-26-00024 (one consolidated
cabling sheet), BOQ-26-00007 (mixed). 657 line items; overall rules==AI agreement 66%, and --
the key validation -- agreement tracked the rule BAND monotonically: HIGH 78%, MED 66%, LOW 48%,
ABSTAIN 44%. So the confidence band is a working triage lever (trust HIGH, human-review LOW/
ABSTAIN). The disagreements were mostly SYSTEMATIC RULE GAPS, not AI noise -> this tuning pass.

FIVE FIXES (commit 47908443; tests 14 -> 27, all green; categories unchanged, classify_line
signature unchanged; every knob in scoring.json):
- FIX1 (rules): junction/pull/draw box added to cabletray_raceway (CT-TRAY) -- 49 junction-box
  fragments were abstaining (novel) while the AI confidently called them cabletray.
- FIX2 (rules): panels exclude_if extended (danger / sld / chart / fire extinguisher / name
  board / notice board / mat / shock treatment / first aid) -- panel-room accessories were
  false-friending onto Panels via 'panel'/'board'.
- FIX3 (rules + runner): new PW-WIRINGFOR rule ('wiring for ... point(s)', fan/light/plug/loop
  points) + a REGEX EXCLUSION on wiring_cabling (WC-EXCL-POINTWIRING) so a point-wiring lot is
  not pulled to wiring_cabling by its quoted cable size. Runner gained regex-exclusion support
  (exclude_tokens_by_cat + exclude_regex_by_cat; _excluded checks both).
- FIX4 (runner + scoring): FRAGMENT INHERITANCE. When a line ABSTAINS but its ancestor chain
  alone resolves to exactly ONE dominant category, it inherits that category DOWN-WEIGHTED
  (score = min(inheritance_cap 0.6, dominant_ancestor_raw * inheritance_weight 0.5)) -> never
  HIGH, reason 'inherited from parent section: <cat> -- review'. Triggers only on otherwise-
  novel lines; can never override an own-signal. (Ancestors that say 'cable tray' are already
  caught by the ancestor rule in normal scoring; inheritance is the fallback for item-style
  ancestor tokens like 'perforated'.)
- FIX5 (rules + runner + scoring): an industrial-socket line on a DB sheet no longer scores
  db_switchgear -- DB-BREAKER-BARE.exclude_if suppresses the incidental breaker mention; plus a
  small RANKING-ONLY direct_signal_bonus (0.05) so a direct on-the-line hit edges out an equal
  ancestor-only competitor.

Scratch harness + CSVs (NOT committed) live at /tmp/boq_category_csv/ (one CSV per sheet, the
17-column rules-vs-AI-vs-team schema). NEXT: re-run the harness post-tuning to confirm the
agreement lift, then widen to more electrical BoQs and let team verdicts recalibrate the
provisional weights/bands.

BUILD 1 -- category re-base to the frozen 15 + novel retired -> blank ABSTAIN (local, NOT
pushed; branch feature/boq-phase-5 tip c8226842; Rebuild Spec v2.0 §§1-3.1/6, Design doc §20):
STRUCTURAL re-base only -- rules_electrical.json UNCHANGED (Build 2 rewrites the rules), and the
confidence/scoring model is UNCHANGED (cap/agreement_bonus/conflict_margin/conflict_penalty/
bands/direct_signal_bonus/inheritance_weight/inheritance_cap all untouched).
- categories_electrical.json rewritten to the FROZEN 15: switches_sockets, db_switchgear,
  cabletray_raceway, wiring_cabling (now "Wiring, Cabling & Termination"), junction_box_raceway
  (NEW), earthing, conduit_piping, industrial_sockets, point_wiring, popup_boxes (NEW), ups,
  lighting_mgmt_system (NEW), miscellaneous (NEW, positive placement -- NOT an uncertainty
  fallback), light_fixtures (NEW), panels. PLUS 2 TRANSITIONAL ids retained ONLY so the
  unchanged Build-1 rules still resolve: termination (Build 2 merges -> wiring_cabling) and
  networking (Build 2 removes -> cross-discipline blank). version bumped to 2.0-frozen15-build1.
- "novel" is RETIRED as a category (removed from the list). ABSTAIN now returns a BLANK
  category_id (""), band still "ABSTAIN", reason "no category signal matched; routed to review
  (blank)." Wired in three places: scoring.json "novel_category_id":"" (data-driven; runner
  hardcodes nothing), runner.py abstain-return reason string + docstrings, tests. The FIX-4
  fragment-inheritance path is UNCHANGED -- it still returns its real inherited category (never
  blanked).
- No orphaned rule: all 12 category_ids referenced by the (untouched) rules resolve against the
  new list (10 frozen + termination + networking). The 5 new frozen ids carry no rules yet
  (Build 2 adds them).
- Tests: tests/test_runner_electrical.py contract tests updated to blank-on-abstain + the new
  frozen id set; count UNCHANGED at 27, all green (run in-container via
  env/bin/python -m unittest ... ; the bare-`python` interpreter lacks firebase_admin and fails
  at package import -- use the bench-env python or `bench run-tests`).
- runner.py still has NO frappe imports; classify_line signature unchanged.

BUILD 2a -- rules for the 5 new categories + FIX-1 reversal (local, NOT pushed; branch
feature/boq-phase-5 tip 088ee99f; Rebuild Spec v2.0 §3.2/§3.3/§3.6, Design doc §20). ADDITIVE
half of the rules rewrite: only rules_electrical.json + tests changed. scoring.json (confidence
model) and runner.py (algorithm) UNCHANGED; point_wiring / termination / networking rules
UNTOUCHED (Build 2b owns those). Rule count 35 -> 40.
- FIX-1 REVERSED: the junction/pull/draw box vocabulary ("junction box", "junction-box",
  "j-box", "j box", "pull box", "draw box") was removed from the cabletray_raceway rule CT-TRAY
  and moved into a NEW junction_box_raceway rule (JB-BOX). CT-TRAY now carries ONLY
  tray/raceway/trunking/ladder vocabulary; a plain cable-tray line still resolves
  cabletray_raceway (verified). A junction/pull/draw box line now resolves junction_box_raceway.
- 5 NEW item_keyword rules (weights on the existing 0.3-0.6 scale):
  JB-BOX (junction_box_raceway, 0.6, exclude_if floor box/pop up/popup),
  PU-BOX (popup_boxes, 0.55: pop up/floor/flip-flop/table box, floor outlet),
  LMS-KW (lighting_mgmt_system, 0.55: lighting management/control, DALI, occupancy/daylight
  sensor, lighting processor, scene controller),
  LF-KW (light_fixtures, 0.5: luminaire, led light, panel light, down light, batten,
  cove/street/flood/decorative light),
  MISC-KW (miscellaneous, 0.3 CONSERVATIVE: fixing accessory, gi frame for electrical,
  rcc cutting, chasing for electrical). miscellaneous is a POSITIVE placement only, deliberately
  low weight + few tokens so it never becomes an uncertainty catch-all -- blank ("") stays the
  uncertainty outcome (verified by test).
- No strong existing category regressed (db_switchgear / earthing / ups / industrial_sockets /
  switches_sockets / conduit_piping / panels / wiring_cabling / cabletray all still green).
- KNOWN GAP (owner note): LF-KW seed tokens are "led light" / "panel light" (adjacent), so a
  REVERSED phrasing like "2X2 LED panel" is NOT caught by light_fixtures and still ABSTAINs to
  blank -- this is intentional for 2a (it preserves the existing led-panel-excluded tests); if
  LED panels should read as light_fixtures, add "led panel" in a tuning pass and update those
  two tests.
- Tests: was 27 (Build 1) -> 34; all green in-container (env/bin/python -m unittest). Added:
  2 FIX-1-reversal tests + 6 new-category tests (5 positive + 1 no-signal-stays-blank guard);
  the old test_fix1_junction_box_is_cabletray was rewritten to the reversal contract.

BUILD 2b -- Point Wiring full precedence + termination merge + networking removal + cleanup
(local, NOT pushed; branch feature/boq-phase-5 tip 4164534f; Rebuild Spec v2.0 §3.4/§3.5/§2,
Design doc §20.3, owner rulings this session). BEHAVIORAL half of the rules rewrite -- changes
how existing lines resolve. scoring.json (confidence model) + the runner ALGORITHM UNCHANGED;
the DB-to-first-point seam is handled by LETTING those lines score low/blank, NOT by moving
thresholds. Rule count 40 -> 45; categories 17 -> 15 (exactly the frozen 15). Tests 34 -> 44.
- POINT WIRING FULL PRECEDENCE (owner: the point-frame overrides component words). Added three
  point-frame EXCLUSION rules -- WC-EXCL-POINTFRAME (wiring_cabling), SS-EXCL-POINTFRAME
  (switches_sockets), CP-EXCL-POINTFRAME (conduit_piping) -- each carrying the same point-frame
  token set (light/fan/plug/power/call-bell/loop point(s), point(s) controlled, controlled by
  mcb/switch, first light / to first light / mcb to first light). When a point-frame is present
  those three categories are ZEROED (exclusion machinery), so the surviving point_wiring wins a
  bundled line that also names conduit/switch/cable. Added PW-FIRSTLIGHT positive rule
  (first light / to first light / mcb to first light, 0.5) for the 'MCB -> first light' case.
- DB-TO-FIRST-POINT SEAM (owner: bare feeder, no named load -> review, not forced). Implemented
  by (a) DELIBERATELY NOT adding 'first point' as a point_wiring positive token, and (b)
  WC-EXCL-DBFIRSTPOINT ("db to first point"/"to first point") zeroing wiring_cabling. Net: a bare
  "DB to first point" sized feeder -> blank/ABSTAIN -> human review (verified: band != HIGH). A
  load-bearing "first light point" still reads point_wiring (the exact phrase "to first point"
  does not appear when a load word sits between).
- TERMINATION MERGED into wiring_cabling: TERM-END + TERM-ANC re-pointed termination ->
  wiring_cabling (tokens kept: lug/gland/end termination); "termination" category removed. A
  "Cable lugs and glands, end termination" line now reads wiring_cabling.
- NETWORKING REMOVED: NW-DATA rule deleted; "networking" category removed; PNL-ASSEMBLY
  ambiguous_with cleaned. Added WC-EXCL-NETWORKING (cat6/rj45/utp/patch panel/... ) so a data
  line's generic "cable" word does NOT read wiring_cabling -- these cross-discipline lines route
  to blank/review (Design doc §20.3). No rule references termination/networking as a category.
- LED PANEL -> LIGHT FIXTURES: added "led panel"/"led panel light" to LF-KW; PNL-ASSEMBLY still
  excludes led/panel light/luminaire, so "2X2 LED panel" reads light_fixtures and never panels.
  The two former led-panel-excluded tests now assert light_fixtures.
- CLEANUP: runner.py identifier novel_id -> abstain_category_id (both occurrences; it holds ""
  from scoring.json). No logic change; still NO frappe imports; classify_line behavior unchanged.
- Blast-radius NEGATIVE guards all green: plain "PVC conduit" -> conduit_piping, "Modular switch
  socket" -> switches_sockets, "3C x 2.5 sqmm XLPE cable" -> wiring_cabling (none read
  point_wiring). Strong existing categories (db/earthing/ups/industrial/panels/cabletray/conduit/
  switches/wiring) unchanged.
- OWNER NOTES: (1) the point-frame token set is intentionally the same list on all three
  competitor categories -- tune in one place per category if it over/under-reaches. (2) The
  networking suppression means a line literally saying "CAT6 cable" now goes to blank (review),
  not wiring_cabling -- this is the intended cross-discipline routing. (3) "first point" is a
  reserved review trigger; do not add it as a strong positive token without revisiting the seam.

RESIDUAL-43 TUNING -- plural-aware matcher + misc/light keywords (local, NOT pushed; branch
feature/boq-phase-5; feat c9b843a4). From the tree-fed Set-1 re-run (baseline rule 75.9% /
AI 89.8%, 43 abstains): two additive changes to the classification module, confidence model +
runner algorithm otherwise unchanged.
- (a) CONSERVATIVE PLURAL-AWARE MATCHER (runner.py _token_re -- the pattern fix, NOT a hardcoded
  plural list): a singular token now also matches a regular s/es plural of its FINAL word, so
  'junction box' hits 'junction boxes', 'cable tray' hits 'cable trays', 'raceway' hits
  'raceways', 'socket' hits 'sockets', 'cable' hits 'cables'. GUARDED: the optional (?:es|s)?
  suffix is added only when the final word is >= 3 chars and does NOT already end in 's' -- so
  gas/bus/class/glass/status/access/process/plus/cross and 2-char units ('mm') are never
  mis-stripped, and an already-plural token ('light points', 'socket outlets') stays exact. The
  suffix is optional so singular still matches (backward-compatible). Applies wherever _token_re
  runs: item_keyword + ancestor + exclusion matching alike (so plural exclusions like 'cable
  trays' also suppress wiring_cabling correctly). Recovers ~80 plural rows from the recon.
- (b) rules_electrical.json: NEW rule MISC-SAFETY (miscellaneous, weight 0.3) = first aid /
  hume pipe / shock treatment / danger notice / danger board / fire bucket / insulating mat /
  rubber mat / shock chart / single line diagram / sld chart / name board / notice board --
  collision-verified misc-only across the Set-1 corpus (0 non-misc hits); these mirror the panels
  exclude_if false-friend set, so a row panels already refuses now reads miscellaneous instead of
  abstaining/mis-firing. LF-KW gained one-word 'downlight' + 'led strip' / 'strip light' (the
  DOWNLIGHT / LED STRIP LIGHT product lines that abstained).
- DEFERRED (riskier recon items, NOT added): the DALI-vs-fixture guard and the
  socket-outlet-point point-frame token -- both ambiguous; left for a later, measured pass.
- Tests: runner suite 44 -> 62 green (18 new: plural forms, ss/short-word guards, misc + light
  keywords, panels->misc false-friend). Additive; no strong-category regression
  (db_switchgear/point_wiring/wiring_cabling/earthing/conduit_piping all still pass).

AI CATEGORY PROMPT -> TRACKED + v1.1 (local, NOT pushed; branch feature/boq-phase-5). The canonical
Option-B AI voter prompt was moved OUT of scratch into a version-controlled module location and
bumped to v1.1.
- LOCATION: now tracked at `nirmaan_stack/services/boq_category/prompts/electrical_ai_category_prompt.md`
  (single source of truth). The filename is version-FREE (stable path); the version lives in the
  file header ("v1.1 (2026-07-02) -- supersedes v1.0"). The prior scratch copy
  (_classification_review/BoQ_AI_Category_Prompt_v1_0.md) was deleted; the scratch harnesses
  (rerun_harness.py + rerun_harness_committed.py) were repointed to the tracked path. NOTE:
  `_classification_review/` is untracked scratch, so the harness repoint + scratch deletion are
  on-disk only (not committed) -- the ONLY tracked artifact is the new prompt file.
- v1.1 EDITS (surgical; frozen-15 categories + descriptions, the {category_id in 15 or "",
  confidence 0-1, brief_reason} output contract, and Option-B independence all preserved VERBATIM):
  (a) TREE-READING instruction -- the AI is told it receives each line WITHIN its full ancestor
  tree (sheet-name root -> section preambles -> parent, indented, with attached/append notes shown
  per node) and must read TOP-DOWN: the section/parent context governs a bare child ("300 X 40mm
  size" under a "CABLE TRAYS"/"JUNCTION BOXES"/"EARTHING" heading takes that category); the sheet
  name is context. Matches how the committed-tree harness now feeds the structured tree.
  (b) SWITCHES vs POINT-WIRING tightening -- a new boundary bullet: Point-Wiring precedence applies
  to a point/circuit framed as a unit, NOT to a line naming the SOCKET ACCESSORY itself (modular
  socket / socket outlet / spike-guard / switch-socket plate -> switches_sockets; IP-rated /
  3-phase / interlocked -> industrial_sockets). Fixes the one place the AI underperformed the
  rules (over-applying point-wiring precedence to socket lines). DALI-vs-fixture guard still
  DEFERRED.
- Not re-run here (that is the next AI re-run). Load-verified: both harnesses resolve PROMPT_PATH
  to the tracked file (7518 bytes, v1.1 header). No push, no migrate.

CLASSIFICATION HARNESS -> TRACKED (behavior-preserving move; local, NOT pushed; feat abdf5faf).
The committed-tree classification harness (previously scratch-only in _classification_review/) is
now version-controlled in the module, so it is not lost and other disciplines reuse the SAME
mechanism later.
- LOCATION: nirmaan_stack/services/boq_category/harness/ -- electrical_classification_harness.py
  (canonical name; moved from scratch rerun_harness_committed.py -- THE harness now) +
  classification_analysis.py (moved from analyze_rerun.py). The whole classification mechanism is
  now tracked in services/boq_category/: engine (runner.py) + rules_electrical.json +
  categories_electrical.json + scoring.json + prompts/electrical_ai_category_prompt.md + harness/.
- MINIMAL move: only file location + rename + internal-path repoints. NO logic/tree-walk/join/
  measurement change. Prompt resolved from the module (../prompts/); rules/categories/scoring are
  read by the runner (load_ruleset), not the harness. INPUT (env BOQ_HARNESS_INPUT) + OUTPUT (CLI
  arg) stay LOCAL and default OUTSIDE the repo -- a tracked harness never writes CSVs into the repo.
- DROPPED (not tracked): the superseded xlsx-input rerun_harness.py + the throwaway diagnostics
  (dbcheck/parentcheck/rootcheck/recon*.py) -- left in scratch.
- BEHAVIOR-PRESERVING PROOF: code diff scratch-vs-tracked = docstring + 4 path lines only; a fresh
  tracked-harness run over the 5 Set-1 BoQs reconciles row-math (2333 = 1296 LI + 305 Preamble +
  732 Other) and diffs ZERO on ALL structural columns + notes vs the tree-fed output (identical
  classify_line inputs). The rule-column diffs vs that older output are 100% the Prompt-2 committed
  runner tuning (plural matcher + misc/light keywords), NOT the move. Runner suite 62 green.
- DEFERRED: discipline-parameterisation (electrical BOQS + prompt hardcoded for now); the
  durable-address verdict re-join in classification_analysis.py (it currently reads a verdict-bearing
  CSV). No push, no migrate.
