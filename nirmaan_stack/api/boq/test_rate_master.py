# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""RM-1 backend tests: the rate-master import loader + the two read endpoints.

Runs against the LIVE site DB (like test_pricing). Every test loads under its OWN synthetic
discipline (prefix TEST_RM_) so it is isolated from the real 'Electrical' production import and
from every other test; tearDownClass purges only the disciplines this suite created.

Coverage map (behavior -> test):
  - loader counts land exactly (292 cable / 296 termination / 1 config)      -> test_01
  - one shared import_batch stamped on every row; provenance populated        -> test_01
  - the three cleaned lug rows (Termination 117/217/228) store 106.04         -> test_01
  - normalization: mixed-case material/insulation -> canonical UPPERCASE      -> test_02
  - the DB holds zero mixed-case attribute values after a real load           -> test_03
  - idempotency: a non-replace re-run REFUSES cleanly, counts unchanged       -> test_04
  - --replace supersedes: old batch inactive, new active, no dup active rows  -> test_05
  - endpoints: shape + kind filter + active-only                             -> test_06
  - endpoints: login required (Guest denied)                                 -> test_07
  - config integrity: attribute defs + all four pipelines survive round trip -> test_08
  - RM-4a param-value edits (config param + item rate/attr + create + deactivate) -> test_09..14
  - RM-4b whole-config replace: valid replace audited + seeds goldens          -> test_15
  - RM-4b validation: unknown step type rejected, no write                     -> test_16
  - RM-4b validation: malformed condition predicate / non-number param         -> test_17
  - RM-4b: non-admin PermissionError, no write                                 -> test_18
  - RM-4b reference guard: removing a referenced definition rejected (named)   -> test_19
  - RM-4b validation: unknown top-level key rejected                           -> test_20
  - RM-4b: identity repoint (discipline/category_id) rejected                  -> test_21
  - RM-4b: a valid add-step + add-param replace persists                       -> test_22
  - EA-1: multi-config load -- counts, shared batch, 10 configs, goldens merge -> test_23
  - EA-1: SCOPED replace supersedes only the E-ALL scope, WIRING UNTOUCHED     -> test_24
  - EA-1b: retired-scope (ups) also deactivated on replace, else untouched     -> test_25
  - EA-1c: update_rate_config accepts a top-level item_kinds (Data-tab scope)   -> test_26
  - EA-2: relaxed validator -- empty pipelines accepted; bad non-empty rejected -> test_27
  - EA-2: pass-through keys (matching_mode/identity_attribute_id/notes/
    pipeline_labels) accepted + a pipeline_labels edit audited (Version doc)     -> test_28
  - EA-2c: the earthing config's component_ref step round-trips through the
    RM-4b validator (accepted); a component_ref missing ref.kind is rejected     -> test_29

SELECTED-ROW RUNS (only_rows + the carry-forward write). Plain-English coverage:
  - normalize_only_rows: JSON string / list / scalar all parse; duplicates collapse
    and the result is sorted; a NON-INTEGER member is REJECTED, never dropped      -> test_73
  - G6 PIN: an ABSENT or EMPTY only_rows normalises to None, which every downstream
    branch reads as "whole sheet" -- the unscoped path is unchanged by this slice   -> test_73
  - serialize_run_results is THE byte-identity guarantee: re-serialising a parsed
    blob reproduces the ORIGINAL TEXT character-for-character, `defaulted` flags
    and float confidences included (POSITIVE); and a formatting-only change to the
    dump would break it (NEGATIVE, asserted against indent/sort_keys variants)     -> test_74
  - G5 CARRY-FORWARD: replacing ONE row leaves every OTHER row's serialised text
    byte-identical -- proven by substring identity, not by parsed-value equality    -> test_75
  - run_extraction's only_rows scopes the PROCESSING and NEVER the population:
    population_rows stays the whole sheet while results carry only the scoped rows
    (POSITIVE); only_rows=None processes everything (NEGATIVE half, the G6 pin)     -> test_76
  - skip_rows and only_rows COMPOSE -- a row in both is skipped, which is what
    makes a resume of a halted scoped run finish the right rows                     -> test_77
  - _guard_only_rows REJECTS (never silently narrows) a row outside the run's
    population, and names it; a fully-eligible selection passes                     -> test_78
  - _guard_only_rows refuses resume+only_rows together, and refuses a scoped run
    when AI is off (it would blank the picked rows) or when there is no completed
    run to carry forward from                                                       -> test_79
  - pass_attempted_count reads THIS PASS's rows off the envelope, and is NOT the
    document-level attempted_count a carried scoped run inflates (POSITIVE +
    NEGATIVE); absent/empty envelopes yield 0 rather than raising                    -> test_80
  - the worker PUBLISHES pass_attempted_count on the terminal payload, and on a
    carried scoped run it differs from attempted_count -- which is what makes the
    halted-scoped three-way split derivable at all                                   -> test_81
  - ADDITIVE ONLY: publishing the new key leaves every pre-existing payload key
    byte-identical, on both a complete and a halted pass                              -> test_81
"""

import base64
import collections
import io
import copy
import json
import os
from unittest import mock

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq import rate_master
from nirmaan_stack.services.boq_rate_master import csv_importer, extraction, freeze, loader

# The UTF-8 BOM the CSV writer prepends so Excel renders non-ASCII correctly.
BOM = "\ufeff"

PIPELINE_KEYS = {"cable_boq", "termination_boq", "cable_bcs", "termination_bcs"}

# THE current Electrical asset -- named ONCE, here, and nowhere else. Three separate "current"
# pins had drifted independently (_ASSET on v22, _EALL_CURRENT on v27, an inline v29), which is
# the exact C4 trap _EALL_CURRENT's own docstring warns about and had itself fallen into twice.
# One constant is the whole point: a mint bumps this line and every current-asset test follows.
# F-16 (2026-08-13) minted v31: cable tray install moved ON-ROW. Every cable_tray row gained an
# `install_rate` rate key holding the FINAL effective per-metre figure (the old x4 baked in), and
# the 10-row `tray_install_rate` parallel kind was RETIRED BY DECLARATION (retired_kinds), so the
# asset carried 1372 items, not 1382. (F-17 then took it to 1364 -- see below.)
# F-17 (2026-08-13/14) minted v32: db_switchgear install became a plain RATIO of the calculated
# supply (20%, roundup tens), the 8-row `db_install_rate` table was RETIRED BY DECLARATION, and
# the Finding-B db_shell was repriced 12,133 -> 12,881 (R1). Asset carries 1364 items, not 1372.
# F-3 (2026-08-15) minted v33: junction_box_raceway prices by FACE SIZE. The `size` choice
# ("150x50mm") became `face_mm` (number_choice, values_from junction_box.face_mm) and the six
# catalog rows swapped their `size` string for a numeric `face_mm` -- the depth was never a
# pricing dimension and the composite string could not be matched against a three-dimensional
# BoQ line, so all 12 live junction-box rows extracted blank. NO row added, NONE retired, no
# rate moved: the count stays 1364 and golden j1 keeps 430/90 (an INPUT re-mint, not a
# repricing). New estimator rule R11 carries the face-size reading instruction.
# F-5 + F-6 (2026-08-15) minted v34: industrial_sockets gained estimator rule R12 (how to pair an
# MCB with a socket -- BoQ-stated wins, else derive amperage from the row TEXT and pole from the
# pin count, else "None"; C curve by default; exact-or-next-higher at that pole, with "80 FP MCB"
# named for the above-63A four-pole case the curve grid cannot reach) and an `enclosure`
# extraction default of IP44/54 with text_overrides for IP67 / IP 67 / waterproof / water proof.
# CONFIG-ONLY: no item added, none retired, no rate moved -- the count stays 1364 and all 12
# configs are unchanged apart from industrial_sockets. Goldens 26 -> 28 (new i2, i3).
# v35 (same day) REWORDED R12 steps 3/4/5 ONLY -- v34 was never committed. The v34 re-extraction
# showed the model constructing catalog names that do not exist (e.g. "20A FP MCB C CURVE", which
# the FP grid does not carry from 25A down), which coercion then dropped to null; a null is NOT the
# "None" sentinel, so `@paired_mcb` could not bind and the WHOLE row went unpriceable. Step 5 now
# leads with "your answer MUST be a name from the allowed values list", step 4 says the curve is
# "always C, never D", and step 3 says never invent an MCB. Steps 1 and 2 are byte-unchanged.
# SLICE 2b (2026-08-15) minted v36: the MCB choice moved OUT of the prompt and INTO the pipeline.
# Two new interpreter steps -- `map_attribute` (a CONVERSION: pin count -> pole, stated pole winning)
# and `catalog_fit` (fit the stated amperage onto a catalog-derived ladder, exact else next higher) --
# replace every substitution sentence R12 used to carry. The 106 `family: Switchgear` rows were MINTED
# with `device` / `pole` / `amp_a` / `curve` (curve "NA" where a device carries none, including the one
# grammar exception `80 FP MCB`), because a ladder can only filter on STORED attributes and those four
# discriminators lived inside the item NAME. 106 rows EDITED, none added: the count stays 1364 across
# 12 configs. ⚠️ `extraction_defaults.paired_mcb` was DELETED in the same mint -- an injected default is
# a STATED value, so it would win on every row forever and make the ladder inert while every test
# stayed green. Goldens 28 -> 30 (i4 the ladder hop, i5 the no-MCB absence).
# v37 (same day, owner rulings A + B on the Phase-6 re-extraction): TWO corrections, no data move.
# (A) R12 step 2 REVERTS to the original semantics -- a socket's stated current serves the MCB when
# the text gives no separate MCB current. Under v36's stricter "stated FOR that MCB" the model left
# `mcb_amp_a` blank on rows whose only current is the socket's, and `catalog_fit` then refused the
# WHOLE row (row 78 had priced under v35). Paired with a new per-step opt-in
# `catalog_fit.on_missing_fact: "none"` -- an unreadable fact binds the None sentinel so the socket
# still prices with its MCB honestly unpriced, instead of discarding a row that priced perfectly
# well. DEFAULT UNCHANGED: absent the key the step still refuses.
# (B) R12 gains step (0) -- "`paired_mcb`: ALWAYS return null" -- because the model kept naming a
# catalog item on the sheet whose text names one, and stated-wins then PRE-EMPTED the ladder on 4 of
# 6 rows. This is the ONE compliance sharpening; if pre-emption survives it, the fix is structural
# (per-surface attribute hiding) and becomes its own slice, not a third wording.
# The count pins below follow this constant.
# SLICE 2d: v38 = v37 + `panel: false` on the four industrial_sockets MCB FACT attributes
# (hidden from the pricing panel ONLY -- still extracted, still driving the pipeline) + the
# R12 literal-mention rewrite of step (1) and its steps-(2)-(4) guard. Nothing else moved.
# DEPLOYMENT RE-MINT (2026-08-18): v41 = v40 with the PRODUCTION cable list prices. This mint did
# NOT come from a slice -- it came from the DATABASE. v40 was loaded into production, the cable
# prices were re-entered there, and the result was exported and committed here VERBATIM. It is the
# first asset in this lineage whose content originates in production rather than in a dev mint,
# which is precisely why it had to be committed: the live prices existed in NO asset, so every
# future export from dev would have silently reverted them.
# Exactly ONE field moved -- `cable.list_price_per_mtr`, on 265 of 292 rows. All 12 category
# configs, every golden, both retirement lists and all 1,364 item_uids are byte-identical to v40;
# no item was added, removed or re-keyed, and NO other rate on any kind changed.
# 234 rows restored the pre-load live price, 31 previously-0.0 rows became NULL (an absent rate
# REFUSES, where 0.0 silently priced supply at zero -- a correction, not a loss).
# ⚠️ FOUR WIRING GOLDENS ARE NOW STALE AGAINST THIS DATA (g1, g2, g3, g5 -- g4 is
# termination-only and unaffected). They still carry the values the OLD cable prices produced, so
# the RM-4b preview gate will show deltas on wiring_cabling. That staleness is REAL and lives in
# PRODUCTION already; committing this asset records it faithfully rather than creating it. The
# goldens must be re-banked in-product and re-exported -- they are ORACLES and must never be
# recomputed from our own interpreter, which would make them pass by construction and pin nothing.
# DEV SYNC (2026-08-19): v43 = PRODUCTION's current export, adopted VERBATIM. Like v41 this did
# NOT come from a slice -- it came from production's DATABASE, and it is the SECOND asset in this
# lineage whose content originates there. Dev's DB was still on v40 (v41 was committed but never
# loaded here), so the load moved TWO independent rate sets at once:
#   - 265 `cable.list_price_per_mtr` values -- the v40 -> v41 production cable re-mint, finally
#     landing in dev's database rather than only in the repo.
#   - 55 of 58 `switch_socket_item.list_price` values -- production's switch/socket revision, which
#     existed in NO asset before this file. This is the change the sync exists to capture.
# Plus the four wiring goldens g1/g2/g3/g5, RE-BANKED IN PRODUCTION against the corrected cable
# prices. The v41 note below predicted this: it recorded those goldens as stale and said they must
# be re-banked in-product and re-exported. They were. g4 is termination-only and is unchanged.
# NOTHING ELSE MOVED: all 12 category configs are byte-identical (checked key by key -- pipelines,
# attribute definitions, item_kinds, rules, extraction_defaults), all 1,364 item_uids are unchanged,
# no item was added, removed or re-keyed, both retirement lists and every other golden are identical.
# A load-then-re-export reproduced production's file BYTE-FOR-BYTE (sha256 5d17cf7d...), so the DB,
# the repo asset and production provably agree.
# ⚠️ v42 IS ABSENT FROM THIS REPO BY CONSTRUCTION. Production minted it (the goldens re-bank) and
# dev never received it; this file is production's NEXT mint. `mint_completeness_check` will
# therefore report v42 as UNINSPECTABLE, which is true and is exactly what that report is for.
# ✅ THE TWO STALE switches_sockets GOLDENS ARE RE-BANKED (slice 4, 2026-08-19, v44).
# s1 supply 110 -> 120; ss1 740/150/510 -> 820/170/570, against the switch/socket rates adopted with
# v43. The 2026-08-19 reclassification governs: goldens are REGRESSION CANARIES, not oracles, and
# re-banking one from our own interpreter is CORRECT -- Deployment Mode v1.1 is the authority. (The
# superseded "they are ORACLES, never recompute" wording stood here until that ruling.) Both values
# were derived twice and agreed: by hand from the catalog list prices x the rate stages, and by the
# product's own RM-4b preview gate. The vitest interpreter pins are unaffected -- they carry their
# own inline catalogs and read no asset.
# ✅ SLICE 5 (2026-08-21, v45). Per-SKU module widths on all 61 family SKUs; the three combined
# "1M & 2M" containers SPLIT into single-size SKUs at identical rates (the combined ones retired by
# freeze-and-supersede, absent from the payload); four socket slots; the popup composite.
# ⚠️ THREE GOLDENS WERE RE-BANKED MECHANICALLY AND EVERY EXPECTED VALUE IS UNCHANGED -- s1
# 120/30/80, ss1 820/170/570, p1 10800/1200. Only their INPUTS grew: `module_fit` refuses a term
# whose quantity is ABSENT ("blank is unknown, not zero"), so a golden predating `socket3`/`socket4`
# bails before computing anything. The slots were added as positively absent, which is the state a
# real extracted row is in. Values moving would have been a regression; inputs growing is the schema.
# ✅ CONDUIT IN THE CABLE RATE (2026-08-23, v47). wiring_cabling gains THREE attributes
# (conduit_included / conduit_type / size_mm) and a conduit component on `cable_boq` ONLY, plus
# `synonyms.conduit_type = {GI: MS}` mirroring conduit_piping.
# sha256 de4f6a2e1c551fc67f41510b3e4a0f82aa612d8f8dc4cfffc923a28860d78515.
# ⚠️ EACH map_attribute's `prefer_attr` IS THE ATTRIBUTE ITSELF -- the cabletray_raceway
# `thickness_mm` precedent, and the ONLY shape whose PANEL DISPLAY works. A first cut split each
# fact into a `panel: false` raw attribute plus an `extract: false` resolved one; pricing was
# correct but `applyDerivedDisplay`'s STATED branch publishes no display value and falls back to the
# TARGET attribute's own extracted value -- which is empty when nothing extracts it, so all three
# conduit fields rendered blank while pricing used real values. That breaks the attribute-panel
# invariant. Caught in the browser cert, not by a test.
# ⚠️ The slice note lives under `notes`, an ALLOWED pass-through key. A first cut invented a
# `conduit_component` key and `_KNOWN_CONFIG_KEYS` (api/boq/rate_master.py:1303) rejected the whole
# config -- the whitelist is closed, so a new top-level key is a code change, never a config one.
# ⚠️ EVERY WIRING GOLDEN IS UNCHANGED, AND THAT IS THE REGRESSION PROOF, NOT A COINCIDENCE. None of
# g1-g5 carries a conduit attribute, so `conduit_type` resolves to the "None" sentinel, `none_skips`
# zeroes the component, and the two added `scale` steps add 0. The supply leg's new `roundup` to UNITS
# is an identity on the tens-rounded integers cable_boq already produced. If a wiring golden ever moves,
# the conduit component has leaked onto a row that names no conduit.
# ⚠️ TERMINATION IS UNTOUCHED (owner ruling ii): `termination_boq` has a ZERO-LINE DIFF at v47.
# ✅ PW-CIRCUIT-STRETCH (2026-09-02, v51). point_wiring gains the CIRCUIT (submain) run from the DB:
# eight panel attributes (circuit_wire_included; circuit wire 1 and 2 core/runs/thickness;
# circuit_wire_length_m) plus the hidden circuit_qty_m, two circuit components on EVERY existing
# pipeline, and two DISPLAY-ONLY pipelines that give the circuit its own labelled block.
# sha256 cf91f29460c00381de34b9c13249d13487ffc9b91f86f09181bfa6e79b9e4595 (the WORKING-TREE form,
# the same recipe v50's c7fe2961... was taken over). ONE config changed; `items` is byte-identical.
# ⚠️ ONE RATE, TWO PARTS -- AND THAT IS WHY THE BLOCK IS NOT A SECOND RATE. `pw_circuit_supply` /
# `pw_circuit_install` output `circuit_supply` / `circuit_install`, which `kindForOutput` maps to NO
# rate kind, so they can never reach `values` and the collapsed headline stays the single point rate.
# The money is added by the two circuit components INSIDE pw_boq_supply / pw_boq_install, which is
# the only place a cross-pipeline sum could otherwise have come from -- there is no such mechanism.
# ⚠️ THE FOUR NO-CIRCUIT GOLDENS pw1-pw4 KEEP EVERY EXPECTED VALUE AND THAT IS THE REGRESSION PROOF.
# Only their INPUTS grew, exactly as the v45 slot mint did: they now state the circuit wires as
# positively absent ("None"), `none_skips` zeroes both components and the flat add is 0. If a
# no-circuit golden ever moves, the circuit stretch has leaked onto a row that carries none.
# ⚠️ BOTH CIRCUIT THICKNESSES CARRY `allow_none` AND NO DEFAULT, AND THE WORDING IS WHAT MAKES THAT
# SAFE -- see `TestPointWiringCircuitStretch` and the config's `extraction_none_guidance`. "None"
# means the DOCUMENT says there is no such wire (price nothing); BLANK means the model COULD NOT READ
# the gauge (the row REFUSES and a pricer supplies it). Without `allow_none` the string "None" cannot
# survive `coerceForMatch` on a number_choice, both cases collapse into blank, and EVERY point wiring
# row stops pricing -- measured 0 of 251. Conflating them in the other direction turns the owner's
# ruled LOUD failure into a silent under-quote. The distinction is the owner's, dated 2026-09-02.
# ⚠️ `circuit_length_m` IS UNTOUCHED. It holds the POINT stretch (15/5 by point type) and is merely
# misnamed; the circuit stretch is `circuit_wire_length_m` and its panel label is deliberately
# different ("Circuit wiring stretch (m)" vs "Circuit length (m)").
# ✅ SLICE A (2026-09-03, v52). TWO CORRECTIONS, both found on screen after a green cert.
# sha256 45ba1ff634b5dcfe429d35ddb1912ca20ee9d5f81f9030d71062da502d0bea4d (WORKING-TREE form).
# ⚠️ F2 -- A WORKED EXAMPLE INSIDE A RULE BECAME A FALSE FRIEND, AND THAT IS THE LESSON. R12 read
# "'recessed/surface existing conduit' ... so the answer there is Yes". Rows reading
# 'recessed/surface 16SWG MS conduit' matched that SURFACE FORM while lacking the load-bearing word
# `existing`, so `conduit_handoff` came back Yes and 36 rows silently dropped a conduit they supply.
# The example OVERRODE the rule's own closing clause ("Answer No when the run uses a conduit this
# line supplies"), which was correct all along. An example is as load-bearing as the rule around it.
# Measured UNSTABLE, not merely wrong: BOQ-26-00086 r51 and r53 share a word-for-word identical
# grandparent and near-identical text, and one priced its conduit while the other dropped it, both
# at 0.6 confidence. The example now CONTRASTS the two phrasings; the decision table is unchanged.
# ⚠️ F5 -- A REACHABILITY REGRESSION, INTRODUCED 2026-09-02 AND NOW REMOVED. The four circuit
# CORE/RUNS fields lose `allow_none`. A None on runs never had a pricing effect: `none_skips` reads
# ONLY the component's `ref` bindings (core, thickness_sqmm) and `runs` feeds `absentMeansOne`,
# which maps "None" to 1. The checkbox promised a drop it could not deliver. Removal is MEASURED
# INERT -- the REAL shipped helper prices 190 / refuses 61 over the 251 run-covered rows both with
# the flags and without, on the IDENTICAL row set with identical blank tallies, because
# `disables_when_none` on the THICKNESS already greys and clears that wire's core and runs.
# ⚠️ BOTH THICKNESSES KEEP `allow_none` AND NO DEFAULT. Thickness is the working drop control and
# the owner's loud-failure ruling rests on it. Honouring a None on RUNS instead would mean widening
# `none_skips` to consult `mult_from_attr` -- an interpreter change to machinery every category runs
# through. That was the rejected alternative; it is recorded, not built.
# ✅ SLICE B (2026-09-03, v53). THE RULE ITSELF WAS REVISED BY MEASUREMENT -- record WHY.
# sha256 925369219c09205ae2a8bcc0e479b7127da120ea3f8b0b3f5ada0bd24887354e (WORKING-TREE form).
# ⚠️ F1 -- R9 IS A CONDUCTOR FLOOR, NOT A RUN COUNT. The invariant is `core x runs` SUMMED ACROSS
# THE WIRES THAT EXIST, raised UP to three and NEVER reduced. The FIRST formulation coerced RUNS,
# and measuring it is what killed it: on the 31 corpus rows reading `3 core, 1 run` -- already three
# conductors, and the bills say so in words ("one each for phase, neutral and earth") -- coercing
# runs to 3 would have bought NINE conductors (+Rs 133,792, rows up to +194%); on 5 rows whose text
# states "three phase" it would have HALVED the copper (-Rs 27,535). Measured on CONDUCTORS the
# corpus was ALREADY 231 of 237 compliant and the other 6 sat ABOVE three, which is why the rule is
# a FLOOR. Under it the POINT axis moves ZERO rows and only the circuit axis coerces (46).
# ⚠️ WHERE THE MISSING CONDUCTOR GOES (owner, 2026-09-03): a SINGLE-CORE short wire takes MORE RUNS
# and NO second wire is created; with two single-core wires the BIGGER one is raised; a MULTI-CORE
# short wire keeps its cores and gains a second wire of ONE core at the SAME size. The two shapes
# price differently (a second wire buys a second install unit) -- the owner chose runs-for-single.
# ⚠️ "unless the line explicitly states otherwise" STAYS. The earlier instruction to DELETE it was
# WITHDRAWN when the rule became a floor: a stated count at or above three now always wins, so the
# clause is exactly right rather than an escape hatch. Do not remove it as leftover.
# ⚠️ THE INSTALL STEPPING IS CLOSED BY RULING, NOT OPEN. `mult_step_divisor: 3` exists on BOTH axes
# and is byte-identical, but it is applied PER COMPONENT and never summed across the pair, so two
# wires carrying three runs between them buy TWO install units. The owner ruled that CORRECT ("we
# are pricing the 2 wires separately") and ruled the 98 rows that would fall under summed stepping
# (76 point, 22 circuit) "ignore". Do NOT build multi-attribute stepping.
# ⚠️ F4a -- the display-only pipelines pw_circuit_supply / pw_circuit_install are REMOVED (with
# their labels), because the circuit money was ALWAYS inside the point rate and a second block read
# as an extra charge. Proven rate-neutral at this tip: 190 priced / 61 refused, 0 rows moved.
# THE GOLDENS HAD TO LOSE THOSE TWO `expect` KEYS -- `_validate_config` refuses a golden naming a
# pipeline the config no longer declares. That deletion is the ONLY golden movement; the three
# surviving expectations are asserted byte-identical in the mint.
# ⚠️ F4b -- `group_label` on an attribute definition is a NEW GENERAL capability (any category, any
# fields); it sits on the DEFINITION because top-level config keys are allowlisted and definition
# keys are documented as not, so it ships with NO backend change.
# ✅ SLICE B v4 (2026-09-03, v54). THE ARITHMETIC LEFT THE PROMPT AND BECAME CODE.
# sha256 24ff55c057d5819f4a8280eb75e99b062fcc5870d1b7a234c46845328904317c (WORKING-TREE form).
# ⚠️ THE PROCESS LESSON, WHICH MATTERS MORE THAN THE DIFF. The standing rule on this project is that
# the MODEL READS FACTS and every substitution, ladder or conversion lives in deterministic code or
# config. The conductor floor is a SUBSTITUTION and was written as PROSE inside R9. It cost two
# cross-talk failures in two days -- every `rules` entry is injected into ONE ESTIMATOR_RULES block,
# so rewriting R12's conduit example flipped R13's circuit verdict, and extending R9's floor to NAME
# the circuit wires (the only way prose could reach them) moved R13's `circuit_wire_included` on
# BOQ-26-00200 r11. BEFORE WRITING ANY EXTRACTION WORDING, ASK: is this a FACT TO READ or a
# CALCULATION TO APPLY? A calculation does not go in the prompt at all.
# ⚠️ R9 IS NOW READING-ONLY AND POINT-SCOPED. It states no total, names no circuit wire, and the
# clause "unless the line explicitly states otherwise" is REMOVED -- it excepted a total R9 no
# longer states, and prose that reads like a rule while governing nothing is worse than silence.
# The behaviour it protected is structural now: `apply_conductor_floor` only ever RAISES.
# ⚠️ PROVEN BEFORE THE PROSE WAS TOUCHED: the corrector was run over all 237 in-axis POINT rows of
# the live corpus and changed ZERO, byte-identical to the prose output. The point axis was already
# 231-of-237 correct and the other 6 sit ABOVE the floor; moving a working rule for tidiness is
# exactly the risk that proof exists to retire.
CURRENT_EALL_ASSET = "rate_master_electrical_all_v54.json"

# The SUPERSEDED wiring asset. It is RETAINED on disk (a mint-gate self-test operand) and is still
# read here on purpose: loader.load_rate_master's SINGLE-config path -- the one whose
# _deactivate_prior is DISCIPLINE-WIDE -- is reachable only by a payload carrying the SINGULAR
# `category_config` key, and the merged asset carries the LIST form. Repointing these tests at the
# merged asset would delete the only coverage the dangerous path has.
LEGACY_WIRING_ASSET = "rate_master_wiring_cabling_v3.json"


# The point_wiring pipelines that PRICE. v51 added two DISPLAY-ONLY siblings (`pw_circuit_supply` /
# `pw_circuit_install`) which carry neither `circuit_fit` nor the conduit chain, so every assertion
# about the pricing shape iterates THIS tuple rather than `cfg["pipelines"]`.
_PW_ASSEMBLY_PIPELINES = ("pw_boq_supply", "pw_boq_install", "pw_bcs")


def _asset_path(filename):
    return os.path.join(os.path.dirname(loader.__file__), "data", filename)


def _obj(value):
    """JSON fields come back from frappe.get_all already parsed to dict; tolerate either a
    dict or a raw JSON string."""
    return value if isinstance(value, (dict, list)) else json.loads(value)


class TestRateMaster(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # The SINGULAR-shape fixture, read by explicit path. Until the 2026-08-13 merge this was
        # loader.DEFAULT_DATA_FILE; that constant is GONE as of F-20 (2026-08-14) -- there is no
        # default asset at all now, and a source-less load refuses by name. `_real_payload` below
        # stamps `p["category_config"]["discipline"]`, so the ~30 tests built on it cover the
        # single-config loader path specifically. See LEGACY_WIRING_ASSET.
        with open(_asset_path(LEGACY_WIRING_ASSET), "r", encoding="utf-8") as fh:
            cls.raw = json.load(fh)
        # EA-1/EA-1b: a HISTORICAL E-ALL asset, pinned to v12 on purpose -- test_23 asserts that
        # asset's own counts, so this must NOT follow CURRENT_EALL_ASSET.
        cls.eall_path = _asset_path("rate_master_electrical_all_v12.json")
        with open(cls.eall_path, "r", encoding="utf-8") as fh:
            cls.eall = json.load(fh)
        cls._disciplines = set()

    @classmethod
    def tearDownClass(cls):
        # RM-4a: audited edits create Version docs (track_changes) in the live DB -- delete them for
        # the synthetic docs BEFORE the docs, so no orphan Versions and the live count returns to 0.
        # SLICE 3: BoQ Rate Master Retirement joins the purge. The loader now records a retirement
        # row per declared entry, and both E-ALL fixtures (v12 and the current asset) declare some --
        # so without this every run of this suite would leave synthetic rows behind in the LIVE DB.
        # SLICE 4: BoQ Rate Master Snapshot joins the purge for the same reason -- the export test
        # writes one per scratch discipline, and this suite runs against the LIVE site DB.
        for disc in cls._disciplines:
            frappe.db.delete("BoQ Rate Master Snapshot", {"discipline": disc})
            for dt in ("BoQ Rate Category Config", "BoQ Rate Master Item",
                       "BoQ Rate Master Retirement"):
                for r in frappe.get_all(dt, filters={"discipline": disc}, fields=["name"]):
                    frappe.db.delete("Version", {"ref_doctype": dt, "docname": r.name})
            frappe.db.delete("BoQ Rate Master Item", {"discipline": disc})
            frappe.db.delete("BoQ Rate Category Config", {"discipline": disc})
            frappe.db.delete("BoQ Rate Master Retirement", {"discipline": disc})
        frappe.db.commit()
        super().tearDownClass()

    # ---- helpers ----
    def _new_disc(self):
        disc = "TEST_RM_" + frappe.generate_hash(length=8)
        type(self)._disciplines.add(disc)
        return disc

    def _real_payload(self, discipline):
        p = copy.deepcopy(type(self).raw)
        p["category_config"]["discipline"] = discipline
        return p

    def _active_items(self, discipline, **extra):
        f = {"discipline": discipline, "active": 1}
        f.update(extra)
        return frappe.db.count("BoQ Rate Master Item", f)

    # ---- tests ----
    def test_01_counts_batch_provenance_and_lugs(self):
        disc = self._new_disc()
        summary = loader.load_rate_master(payload=self._real_payload(disc))

        self.assertEqual(summary["items_by_kind"].get("cable"), 292)
        self.assertEqual(summary["items_by_kind"].get("termination"), 296)
        self.assertEqual(summary["items_total"], 588)
        self.assertEqual(summary["config_loaded"], 1)

        batch = summary["batch"]
        self.assertTrue(batch.startswith("rmbulk-"))
        # ONE batch id on every item + the config
        item_batches = {
            r.import_batch
            for r in frappe.get_all(
                "BoQ Rate Master Item", filters={"discipline": disc}, fields=["import_batch"]
            )
        }
        self.assertEqual(item_batches, {batch})
        cfg_batch = frappe.db.get_value(
            "BoQ Rate Category Config", {"discipline": disc}, "import_batch"
        )
        self.assertEqual(cfg_batch, batch)

        # every item active
        self.assertEqual(self._active_items(disc), 588)

        # provenance populated + the three cleaned lug rows read 106.04
        lugs = frappe.get_all(
            "BoQ Rate Master Item",
            filters={
                "discipline": disc,
                "kind": "termination",
                "source_sheet": "Termination",
                "source_row": ["in", [117, 217, 228]],
            },
            fields=["source_row", "rates"],
        )
        self.assertEqual(len(lugs), 3)
        for row in lugs:
            self.assertEqual(_obj(row.rates)["lug_list"], 106.04)

    def test_02_normalization_mixed_case_to_upper(self):
        disc = self._new_disc()
        payload = self._real_payload(disc)
        payload["items"] = [
            {
                "kind": "cable",
                "brand": "Polycab",
                "unit": "Mtr",
                "attributes": {
                    "material": "Aluminium",
                    "insulation": "unarmoured",
                    "core": 1.0,
                    "thickness_sqmm": 6.0,
                },
                "rates": {"list_price_per_mtr": 100.0, "install_base_per_mtr": 10.0},
                "source": {"sheet": "Synthetic", "row": 1},
            },
            {
                "kind": "cable",
                "brand": "Polycab",
                "unit": "Mtr",
                "attributes": {
                    "material": "coPPer",
                    "insulation": "Armoured",
                    "core": 2.0,
                    "thickness_sqmm": 1.5,
                },
                "rates": {"list_price_per_mtr": 200.0, "install_base_per_mtr": 12.0},
                "source": {"sheet": "Synthetic", "row": 2},
            },
        ]
        loader.load_rate_master(payload=payload)

        rows = frappe.get_all(
            "BoQ Rate Master Item", filters={"discipline": disc}, fields=["attributes"]
        )
        materials = sorted(_obj(r.attributes)["material"] for r in rows)
        insulations = sorted(_obj(r.attributes)["insulation"] for r in rows)
        self.assertEqual(materials, ["ALUMINIUM", "COPPER"])
        self.assertEqual(insulations, ["ARMOURED", "UNARMOURED"])
        # no mixed-case survivors
        for r in rows:
            a = _obj(r.attributes)
            self.assertEqual(a["material"], a["material"].upper())
            self.assertEqual(a["insulation"], a["insulation"].upper())

    def test_03_real_load_holds_zero_mixed_case(self):
        disc = self._new_disc()
        loader.load_rate_master(payload=self._real_payload(disc))
        rows = frappe.get_all(
            "BoQ Rate Master Item", filters={"discipline": disc}, fields=["attributes"]
        )
        self.assertEqual(len(rows), 588)
        for r in rows:
            a = _obj(r.attributes)
            for key in ("material", "insulation"):
                val = a.get(key)
                if isinstance(val, str):
                    self.assertEqual(val, val.upper(), "mixed-case %s: %r" % (key, val))

    def test_04_idempotency_non_replace_refuses(self):
        disc = self._new_disc()
        loader.load_rate_master(payload=self._real_payload(disc))
        self.assertEqual(self._active_items(disc), 588)

        with self.assertRaises(frappe.ValidationError):
            loader.load_rate_master(payload=self._real_payload(disc), replace=False)

        # counts unchanged, still exactly one active batch
        self.assertEqual(self._active_items(disc), 588)
        active_batches = {
            r.import_batch
            for r in frappe.get_all(
                "BoQ Rate Master Item",
                filters={"discipline": disc, "active": 1},
                fields=["import_batch"],
            )
        }
        self.assertEqual(len(active_batches), 1)

    def test_05_replace_supersedes_old_batch(self):
        disc = self._new_disc()
        first = loader.load_rate_master(payload=self._real_payload(disc))
        second = loader.load_rate_master(payload=self._real_payload(disc), replace=True)

        self.assertEqual(second["items_deactivated"], 588)
        self.assertEqual(second["configs_deactivated"], 1)
        self.assertNotEqual(first["batch"], second["batch"])

        # active = only the new batch; total rows retained (freeze-and-supersede)
        self.assertEqual(self._active_items(disc), 588)
        self.assertEqual(frappe.db.count("BoQ Rate Master Item", {"discipline": disc}), 1176)
        self.assertEqual(self._active_items(disc, import_batch=first["batch"]), 0)
        self.assertEqual(self._active_items(disc, import_batch=second["batch"]), 588)
        # config likewise superseded, exactly one active
        self.assertEqual(
            frappe.db.count(
                "BoQ Rate Category Config", {"discipline": disc, "active": 1}
            ),
            1,
        )

    def test_06_endpoints_shape_kind_and_active_only(self):
        disc = self._new_disc()
        b1 = loader.load_rate_master(payload=self._real_payload(disc))["batch"]

        res = rate_master.get_rate_master_items(disc)
        self.assertEqual(res["count"], 588)
        self.assertEqual(len(res["items"]), 588)
        self.assertIsInstance(res["items"][0]["attributes"], dict)
        self.assertIsInstance(res["items"][0]["rates"], dict)

        cable = rate_master.get_rate_master_items(disc, kind="cable")
        self.assertEqual(cable["count"], 292)
        self.assertTrue(all(i["kind"] == "cable" for i in cable["items"]))

        # active-only: after a replace, only the new batch is returned
        b2 = loader.load_rate_master(payload=self._real_payload(disc), replace=True)["batch"]
        self.assertNotEqual(b1, b2)
        res2 = rate_master.get_rate_master_items(disc)
        self.assertEqual(res2["count"], 588)
        self.assertTrue(all(i["import_batch"] == b2 for i in res2["items"]))

        cfg = rate_master.get_rate_category_config(disc, "wiring_cabling")
        self.assertIsNotNone(cfg["config"])
        self.assertEqual(set(cfg["config"]["pipelines"].keys()), PIPELINE_KEYS)

        missing = rate_master.get_rate_category_config(disc, "does_not_exist")
        self.assertIsNone(missing["config"])

    def test_07_login_required_guest_denied(self):
        disc = self._new_disc()
        loader.load_rate_master(payload=self._real_payload(disc))
        original = frappe.session.user
        try:
            frappe.set_user("Guest")
            with self.assertRaises(frappe.PermissionError):
                rate_master.get_rate_master_items(disc)
            with self.assertRaises(frappe.PermissionError):
                rate_master.get_rate_category_config(disc, "wiring_cabling")
        finally:
            frappe.set_user(original)

    def test_08_config_integrity_roundtrip(self):
        disc = self._new_disc()
        loader.load_rate_master(payload=self._real_payload(disc))
        cfg = rate_master.get_rate_category_config(disc, "wiring_cabling")["config"]

        # all four pipelines present + structurally valid
        self.assertEqual(set(cfg["pipelines"].keys()), PIPELINE_KEYS)
        for name, pl in cfg["pipelines"].items():
            self.assertIsInstance(pl.get("steps"), list)
            self.assertTrue(pl["steps"], "pipeline %s has empty steps" % name)
            self.assertIn("output", pl)
            self.assertTrue(pl["output"])

        # attribute definitions present with the expected dimension ids
        attr_ids = {d["id"] for d in cfg["attribute_definitions"]}
        self.assertTrue(
            {"material", "insulation", "core", "thickness_sqmm", "brand"}.issubset(attr_ids)
        )
        self.assertIn("normalization_rule", cfg)

    # ---- RM-4a: editing endpoints (admin-only) ----
    def _config_name(self, disc):
        return frappe.db.get_value(
            "BoQ Rate Category Config", {"discipline": disc, "active": 1}, "name"
        )

    def _versions(self, dt, docname):
        return frappe.get_all("Version", filters={"ref_doctype": dt, "docname": docname}, fields=["name", "data"])

    def test_09_config_param_edit_audited_first_version(self):
        disc = self._new_disc()
        loader.load_rate_master(payload=self._real_payload(disc))
        cfg_name = self._config_name(disc)
        # no Version for this synthetic config yet
        self.assertEqual(len(self._versions("BoQ Rate Category Config", cfg_name)), 0)

        # cable_boq step 1 (apply_effective_multiplier), condition 0 (ARMOURED), discount 0.75 -> 0.70
        res = rate_master.update_rate_config_param(
            name=cfg_name, pipeline_id="cable_boq", step_index=1, condition_index=0,
            param_key="discount", new_value="0.70",
        )
        self.assertTrue(res["ok"])
        self.assertEqual(
            res["config"]["pipelines"]["cable_boq"]["steps"][1]["conditions"][0]["params"]["discount"],
            0.70,
        )
        # persisted
        stored = _obj(frappe.db.get_value("BoQ Rate Category Config", cfg_name, "config"))
        self.assertEqual(
            stored["pipelines"]["cable_boq"]["steps"][1]["conditions"][0]["params"]["discount"], 0.70
        )
        # AUDIT: the FIRST Version doc now exists and its diff captures the config field
        versions = self._versions("BoQ Rate Category Config", cfg_name)
        self.assertEqual(len(versions), 1)
        changed = {c[0] for c in json.loads(versions[0]["data"]).get("changed", [])}
        self.assertIn("config", changed)

    def test_10_config_param_negatives(self):
        disc = self._new_disc()
        loader.load_rate_master(payload=self._real_payload(disc))
        cfg_name = self._config_name(disc)
        before = frappe.db.get_value("BoQ Rate Category Config", cfg_name, "config")

        # non-admin -> PermissionError, no write
        original = frappe.session.user
        try:
            frappe.set_user("Guest")
            with self.assertRaises(frappe.PermissionError):
                rate_master.update_rate_config_param(
                    name=cfg_name, pipeline_id="cable_boq", step_index=1, condition_index=0,
                    param_key="discount", new_value="0.70",
                )
        finally:
            frappe.set_user(original)

        # non-numeric value -> validation error, no write
        with self.assertRaises(frappe.ValidationError):
            rate_master.update_rate_config_param(
                name=cfg_name, pipeline_id="cable_boq", step_index=1, condition_index=0,
                param_key="discount", new_value="cheap",
            )
        # nonexistent param path -> validation error, no write (adding params is RM-4b)
        with self.assertRaises(frappe.ValidationError):
            rate_master.update_rate_config_param(
                name=cfg_name, pipeline_id="cable_boq", step_index=1, condition_index=0,
                param_key="not_a_param", new_value="0.5",
            )
        # config byte-identical after all three rejects
        self.assertEqual(frappe.db.get_value("BoQ Rate Category Config", cfg_name, "config"), before)

    def test_11_item_rate_edit_audited(self):
        disc = self._new_disc()
        loader.load_rate_master(payload=self._real_payload(disc))
        it = frappe.get_all(
            "BoQ Rate Master Item", filters={"discipline": disc, "kind": "cable"}, fields=["name"], limit=1
        )[0]["name"]
        res = rate_master.update_rate_master_item(
            name=it, rates_patch=json.dumps({"list_price_per_mtr": 999.5}),
            attributes_patch=json.dumps({"material": "copper"}),  # canonicalised -> COPPER
        )
        self.assertTrue(res["ok"])
        self.assertEqual(res["item"]["rates"]["list_price_per_mtr"], 999.5)
        self.assertEqual(res["item"]["attributes"]["material"], "COPPER")
        # AUDIT
        self.assertEqual(len(self._versions("BoQ Rate Master Item", it)), 1)

    def test_12_item_edit_negatives(self):
        disc = self._new_disc()
        loader.load_rate_master(payload=self._real_payload(disc))
        it = frappe.get_all(
            "BoQ Rate Master Item", filters={"discipline": disc, "kind": "cable"}, fields=["name"], limit=1
        )[0]["name"]
        original = frappe.session.user
        try:
            frappe.set_user("Guest")
            with self.assertRaises(frappe.PermissionError):
                rate_master.update_rate_master_item(name=it, rates_patch=json.dumps({"x": 1}))
        finally:
            frappe.set_user(original)
        # bad attribute key -> validation error
        with self.assertRaises(frappe.ValidationError):
            rate_master.update_rate_master_item(
                name=it, attributes_patch=json.dumps({"not_an_attr": "X"})
            )

    def test_13_create_item_manual_provenance(self):
        disc = self._new_disc()
        loader.load_rate_master(payload=self._real_payload(disc))
        before = self._active_items(disc)
        res = rate_master.create_rate_master_item(
            discipline=disc, kind="cable", brand="Polycab", unit="Mtr",
            attributes=json.dumps({"material": "aluminium", "insulation": "armoured", "core": 7.0, "thickness_sqmm": 25.0}),
            rates=json.dumps({"list_price_per_mtr": 500.0, "install_base_per_mtr": 30.0}),
        )
        self.assertTrue(res["ok"])
        self.assertEqual(res["item"]["source_sheet"], "Manual entry")
        self.assertEqual(res["item"]["source_row"], 0)
        self.assertTrue(res["item"]["import_batch"].startswith("manual-"))
        self.assertEqual(res["item"]["active"], 1)
        # material/insulation canonicalised
        self.assertEqual(res["item"]["attributes"]["material"], "ALUMINIUM")
        self.assertEqual(res["item"]["attributes"]["insulation"], "ARMOURED")
        self.assertEqual(self._active_items(disc), before + 1)

        # negatives: non-admin + bad attribute key
        original = frappe.session.user
        try:
            frappe.set_user("Guest")
            with self.assertRaises(frappe.PermissionError):
                rate_master.create_rate_master_item(discipline=disc, kind="cable")
        finally:
            frappe.set_user(original)
        with self.assertRaises(frappe.ValidationError):
            rate_master.create_rate_master_item(
                discipline=disc, kind="cable", attributes=json.dumps({"bogus": 1})
            )

    def test_14_deactivate_retains_row(self):
        disc = self._new_disc()
        loader.load_rate_master(payload=self._real_payload(disc))
        made = rate_master.create_rate_master_item(
            discipline=disc, kind="cable", brand="Polycab", unit="Mtr",
            attributes=json.dumps({"material": "COPPER", "insulation": "ARMOURED", "core": 9.0, "thickness_sqmm": 99.0}),
            rates=json.dumps({"list_price_per_mtr": 1.0}),
        )["item"]["name"]
        total_before = frappe.db.count("BoQ Rate Master Item", {"discipline": disc})

        # non-admin cannot deactivate
        original = frappe.session.user
        try:
            frappe.set_user("Guest")
            with self.assertRaises(frappe.PermissionError):
                rate_master.deactivate_rate_master_item(name=made)
        finally:
            frappe.set_user(original)

        res = rate_master.deactivate_rate_master_item(name=made)
        self.assertEqual(res["active"], 0)
        # RETAINED (never deleted), just inactive
        self.assertEqual(frappe.db.count("BoQ Rate Master Item", {"discipline": disc}), total_before)
        self.assertEqual(frappe.db.get_value("BoQ Rate Master Item", made, "active"), 0)
        # audited
        self.assertGreaterEqual(len(self._versions("BoQ Rate Master Item", made)), 1)

    # ---- RM-4b: whole-config structure editing (update_rate_config) ----
    def _full_config(self, cfg_name):
        return _obj(frappe.db.get_value("BoQ Rate Category Config", cfg_name, "config"))

    _GOLDENS = [
        {"attrs": {"material": "COPPER", "insulation": "UNARMOURED", "core": 1, "thickness_sqmm": 6},
         "expect": {"cable_boq": {"supply_per_mtr": 120, "install_per_mtr": 20},
                    "termination_boq": {"supply_per_set": 80, "install_per_set": 20},
                    "cable_bcs": {"bcs_supply_per_mtr": 87}}},
        {"attrs": {"material": "COPPER", "insulation": "ARMOURED", "core": 3, "thickness_sqmm": 2.5},
         "expect": {"cable_boq": {"supply_per_mtr": 200, "install_per_mtr": 28},
                    "cable_bcs": {"bcs_supply_per_mtr": 150}}},
    ]

    def test_15_whole_config_replace_audited_and_seeds_goldens(self):
        disc = self._new_disc()
        loader.load_rate_master(payload=self._real_payload(disc))
        cfg_name = self._config_name(disc)
        self.assertEqual(len(self._versions("BoQ Rate Category Config", cfg_name)), 0)

        cfg = self._full_config(cfg_name)
        cfg["goldens"] = self._GOLDENS  # seed goldens as config data (RM-4b)
        res = rate_master.update_rate_config(name=cfg_name, config=json.dumps(cfg))
        self.assertTrue(res["ok"])
        self.assertEqual(len(res["config"]["goldens"]), 2)
        # persisted + audited (first Version doc, diff captures the config field)
        stored = self._full_config(cfg_name)
        self.assertIn("goldens", stored)
        versions = self._versions("BoQ Rate Category Config", cfg_name)
        self.assertEqual(len(versions), 1)
        changed = {c[0] for c in json.loads(versions[0]["data"]).get("changed", [])}
        self.assertIn("config", changed)

    def test_16_unknown_step_type_rejected_no_write(self):
        disc = self._new_disc()
        loader.load_rate_master(payload=self._real_payload(disc))
        cfg_name = self._config_name(disc)
        before = frappe.db.get_value("BoQ Rate Category Config", cfg_name, "config")
        cfg = self._full_config(cfg_name)
        cfg["pipelines"]["cable_boq"]["steps"].append({"step": "quantum_flux", "target": "x"})
        with self.assertRaises(frappe.ValidationError) as cm:
            rate_master.update_rate_config(name=cfg_name, config=json.dumps(cfg))
        self.assertIn("quantum_flux", str(cm.exception))
        self.assertEqual(frappe.db.get_value("BoQ Rate Category Config", cfg_name, "config"), before)

    def test_17_malformed_condition_predicate_rejected(self):
        disc = self._new_disc()
        loader.load_rate_master(payload=self._real_payload(disc))
        cfg_name = self._config_name(disc)
        before = frappe.db.get_value("BoQ Rate Category Config", cfg_name, "config")
        cfg = self._full_config(cfg_name)
        # a range/in predicate OBJECT is not executable by the interpreter -> rejected
        cfg["pipelines"]["cable_boq"]["steps"][1]["conditions"][0]["when"] = {"insulation": {"in": ["ARMOURED"]}}
        with self.assertRaises(frappe.ValidationError):
            rate_master.update_rate_config(name=cfg_name, config=json.dumps(cfg))
        self.assertEqual(frappe.db.get_value("BoQ Rate Category Config", cfg_name, "config"), before)
        # a params-value non-number is likewise rejected
        cfg2 = self._full_config(cfg_name)
        cfg2["pipelines"]["cable_boq"]["steps"][1]["conditions"][0]["params"]["discount"] = "cheap"
        with self.assertRaises(frappe.ValidationError):
            rate_master.update_rate_config(name=cfg_name, config=json.dumps(cfg2))

    def test_18_non_admin_rejected_no_write(self):
        disc = self._new_disc()
        loader.load_rate_master(payload=self._real_payload(disc))
        cfg_name = self._config_name(disc)
        before = frappe.db.get_value("BoQ Rate Category Config", cfg_name, "config")
        cfg = self._full_config(cfg_name)
        original = frappe.session.user
        try:
            frappe.set_user("Guest")
            with self.assertRaises(frappe.PermissionError):
                rate_master.update_rate_config(name=cfg_name, config=json.dumps(cfg))
        finally:
            frappe.set_user(original)
        self.assertEqual(frappe.db.get_value("BoQ Rate Category Config", cfg_name, "config"), before)

    def test_19_reference_guard_rejects_removing_referenced_definition(self):
        disc = self._new_disc()
        loader.load_rate_master(payload=self._real_payload(disc))
        cfg_name = self._config_name(disc)
        before = frappe.db.get_value("BoQ Rate Category Config", cfg_name, "config")
        cfg = self._full_config(cfg_name)
        # insulation is referenced by cable_boq / cable_bcs apply_effective_multiplier conditions
        cfg["attribute_definitions"] = [d for d in cfg["attribute_definitions"] if d["id"] != "insulation"]
        with self.assertRaises(frappe.ValidationError) as cm:
            rate_master.update_rate_config(name=cfg_name, config=json.dumps(cfg))
        msg = str(cm.exception)
        self.assertIn("insulation", msg)
        self.assertIn("referenced by", msg)
        self.assertEqual(frappe.db.get_value("BoQ Rate Category Config", cfg_name, "config"), before)

    def test_20_unknown_top_level_key_rejected(self):
        disc = self._new_disc()
        loader.load_rate_master(payload=self._real_payload(disc))
        cfg_name = self._config_name(disc)
        before = frappe.db.get_value("BoQ Rate Category Config", cfg_name, "config")
        cfg = self._full_config(cfg_name)
        cfg["surprise_key"] = 1
        with self.assertRaises(frappe.ValidationError) as cm:
            rate_master.update_rate_config(name=cfg_name, config=json.dumps(cfg))
        self.assertIn("surprise_key", str(cm.exception))
        self.assertEqual(frappe.db.get_value("BoQ Rate Category Config", cfg_name, "config"), before)

    def test_21_identity_repoint_rejected(self):
        disc = self._new_disc()
        loader.load_rate_master(payload=self._real_payload(disc))
        cfg_name = self._config_name(disc)
        cfg = self._full_config(cfg_name)
        cfg["discipline"] = "SOMETHING_ELSE"
        with self.assertRaises(frappe.ValidationError):
            rate_master.update_rate_config(name=cfg_name, config=json.dumps(cfg))

    def test_22_valid_structure_add_step_and_param_persists(self):
        disc = self._new_disc()
        loader.load_rate_master(payload=self._real_payload(disc))
        cfg_name = self._config_name(disc)
        cfg = self._full_config(cfg_name)
        # add a NEW param to an existing condition (was RM-4b-forbidden as RM-4a param-add) + a step
        cfg["pipelines"]["cable_boq"]["steps"][1]["conditions"][0]["params"]["surcharge"] = 0.02
        cfg["pipelines"]["cable_boq"]["steps"].append({"step": "roundup", "target": "supply_per_mtr", "params": {"digits": 0}})
        res = rate_master.update_rate_config(name=cfg_name, config=json.dumps(cfg))
        self.assertTrue(res["ok"])
        stored = self._full_config(cfg_name)
        self.assertEqual(stored["pipelines"]["cable_boq"]["steps"][1]["conditions"][0]["params"]["surcharge"], 0.02)
        self.assertEqual(stored["pipelines"]["cable_boq"]["steps"][-1]["step"], "roundup")

    # ---- EA-1: the all-categories (E-ALL) multi-config load ----
    def _eall_payload(self, discipline):
        p = copy.deepcopy(type(self).eall)
        p["discipline"] = discipline  # loader stamps every item + config from this
        return p

    def test_23_eall_multi_config_load_counts_and_goldens_merge(self):
        disc = self._new_disc()
        r = loader.load_rate_master(payload=self._eall_payload(disc))
        # per-kind counts land EXACTLY (EA-DIFF v11: -4 GI conduit rows, +8 db_install_rate -> 768)
        self.assertEqual(r["items_total"], 768)
        self.assertEqual(r["items_by_kind"]["cable_tray"], 450)
        self.assertEqual(r["items_by_kind"]["tray_install_rate"], 10)  # EA-2b: the width->install-rate table
        self.assertEqual(r["items_by_kind"]["db_switchgear_item"], 137)
        self.assertEqual(r["items_by_kind"]["db_install_rate"], 8)  # EA-DIFF: the per-DB install table
        self.assertEqual(r["items_by_kind"]["conduit"], 8)  # EA-DIFF: GI conduit rows excluded (was 12)
        self.assertEqual(r["items_by_kind"]["earthing_item"], 25)
        self.assertEqual(r["items_by_kind"]["popup_box_module"], 1)
        self.assertNotIn("ups_per_kva", r["items_by_kind"])  # UPS removed by the Floor BOX correction
        # GI conduit rows are EXCLUDED (retired via replace) -> zero active conduit carries conduit_type GI
        conduit_gi = [
            c for c in frappe.get_all("BoQ Rate Master Item", filters={"discipline": disc, "kind": "conduit"}, fields=["attributes"])
            if _obj(c.attributes).get("conduit_type") == "GI"
        ]
        self.assertEqual(len(conduit_gi), 0)
        self.assertEqual(r["configs_loaded"], 11)  # EA-DIFF: + point_wiring (data-only)
        # ONE shared batch across the whole scope (items + configs)
        item_batches = {
            x.import_batch
            for x in frappe.get_all("BoQ Rate Master Item", filters={"discipline": disc}, fields=["import_batch"])
        }
        self.assertEqual(item_batches, {r["batch"]})
        # 11 active configs, discipline stamped INTO the config JSON, per-category goldens merged
        cfgs = frappe.get_all(
            "BoQ Rate Category Config", filters={"discipline": disc, "active": 1}, fields=["category_id", "config"]
        )
        self.assertEqual(len(cfgs), 11)
        by_cat = {c["category_id"]: _obj(c["config"]) for c in cfgs}
        self.assertEqual(by_cat["earthing"]["discipline"], disc)
        self.assertIn("goldens", by_cat["earthing"])
        self.assertEqual(len(by_cat["earthing"]["goldens"]), 2)  # e1 + e2
        g = by_cat["earthing"]["goldens"][0]
        # RM-4b machine contract: {id, attrs, expect: {pipeline_id: {output_key: number}}}
        self.assertIn("attrs", g)
        self.assertIn("expect", g)
        self.assertIn("earthing_boq", g["expect"])
        # EA-1b: the LMS config loads DATA-ONLY -- empty pipelines, active, items present
        self.assertIn("lighting_mgmt_system", by_cat)
        self.assertEqual(by_cat["lighting_mgmt_system"]["pipelines"], {})
        self.assertEqual(r["items_by_kind"]["lms_item"], 24)
        # EA-DIFF: point_wiring is DATA-ONLY too -- empty pipelines, active, banked EA-4 oracle in notes
        self.assertIn("point_wiring", by_cat)
        self.assertEqual(by_cat["point_wiring"]["pipelines"], {})
        self.assertIn("1869", json.dumps(by_cat["point_wiring"].get("notes", "")))
        self.assertNotIn("ups", by_cat)  # no UPS config

    def test_24_eall_scoped_replace_preserves_wiring(self):
        disc = self._new_disc()
        # wiring loaded first under this discipline (kinds cable/termination, category wiring_cabling)
        loader.load_rate_master(payload=self._real_payload(disc))
        wiring_active = self._active_items(disc, kind="cable") + self._active_items(disc, kind="termination")
        self.assertEqual(wiring_active, 588)
        wiring_cfg_active = frappe.db.count(
            "BoQ Rate Category Config", {"discipline": disc, "category_id": "wiring_cabling", "active": 1}
        )
        self.assertEqual(wiring_cfg_active, 1)

        # E-ALL loads WITHOUT replace -- its kinds/categories are disjoint from wiring, no scope overlap
        r1 = loader.load_rate_master(payload=self._eall_payload(disc))
        self.assertEqual(r1["configs_loaded"], 11)
        self.assertEqual(r1["items_deactivated"], 0)
        # wiring UNTOUCHED
        self.assertEqual(
            self._active_items(disc, kind="cable") + self._active_items(disc, kind="termination"), 588
        )

        # a SECOND E-ALL load now refuses (its scope is active)
        with self.assertRaises(frappe.ValidationError):
            loader.load_rate_master(payload=self._eall_payload(disc))

        # replace supersedes ONLY the E-ALL scope (768 items / 11 configs, EA-DIFF v11), never wiring
        r2 = loader.load_rate_master(payload=self._eall_payload(disc), replace=True)
        self.assertEqual(r2["items_deactivated"], 768)
        self.assertEqual(r2["configs_deactivated"], 11)
        # THE NAMED INVARIANT: wiring cable/termination still active + wiring_cabling config still active
        self.assertEqual(
            self._active_items(disc, kind="cable") + self._active_items(disc, kind="termination"), 588
        )
        self.assertEqual(
            frappe.db.count("BoQ Rate Category Config", {"discipline": disc, "category_id": "wiring_cabling", "active": 1}),
            1,
        )
        # a fresh active E-ALL batch: 768 items, 11 configs
        self.assertEqual(self._active_items(disc, kind="cable_tray"), 450)
        self.assertEqual(
            frappe.db.count("BoQ Rate Category Config", {"discipline": disc, "category_id": "earthing", "active": 1}),
            1,
        )

    def _merged_payload(self, discipline):
        with open(_asset_path(CURRENT_EALL_ASSET), "r", encoding="utf-8") as fh:
            p = json.load(fh)
        p["discipline"] = discipline
        return p

    def test_24b_the_merged_asset_loads_as_one_batch_on_the_scoped_path(self):
        """THE MERGE (2026-08-13). One asset, one batch, one loader path -- and the DANGEROUS path
        is unreachable from it.

        Until the merge the catalog needed TWO imports whose ORDER was load-bearing and undocumented:
        the wiring asset carried the SINGULAR `category_config` key, which routes to
        load_rate_master's single-config path, whose _deactivate_prior is DISCIPLINE-WIDE
        (`... SET active = 0 WHERE discipline = %s`). Loading wiring second therefore deactivated
        every E-ALL item -- which is exactly what happened on 2026-08-09 and had to be repaired by
        re-importing E-ALL 37 seconds later.

        This asserts the merged asset takes the LIST branch, so `_load_multi`'s SCOPED supersede is
        what runs and the discipline-wide UPDATE is never reached. NEGATIVE HALF: the merged payload
        must NOT carry `category_config`, because that key alone is what selects the wide path."""
        disc = self._new_disc()
        payload = self._merged_payload(disc)

        # NEGATIVE: the singular key is absent -- this is what makes the wide path unreachable.
        self.assertNotIn("category_config", payload)
        self.assertIsInstance(payload["category_configs"], list)

        r = loader.load_rate_master(payload=payload)
        # ONE batch covers items AND configs -- previously two batches from two files.
        self.assertEqual(r["items_total"], 1367)  # F-16 then F-17: 1382 -> 1372 -> 1364 (10 tray + 8 db_install_rate retired)  # SLICE 5: 1364 -> 1367 (three combined '1M & 2M' containers SPLIT into six single-size SKUs, the three combined ones retired by freeze-and-supersede)
        self.assertEqual(r["configs_loaded"], 12)
        self.assertEqual(len({r["batch"]}), 1)
        self.assertTrue(r["batch"].startswith("rmbulk-"))

        # wiring's kinds now arrive in the SAME batch as everything else
        self.assertEqual(r["items_by_kind"]["cable"], 292)
        self.assertEqual(r["items_by_kind"]["termination"], 296)
        # and the ruled duplicate is gone: 137 -> 136 (owner ruling 2026-08-13, the 12133.0 @ row 14
        # copy of TPN FLEXI DB 4 ROW 14M dropped, the 12881.0 @ row 17 copy kept)
        self.assertEqual(r["items_by_kind"]["db_switchgear_item"], 136)
        self.assertEqual(self._active_items(disc, kind="db_switchgear_item"), 136)

        # wiring_cabling is a first-class member of the list now, and its FIVE goldens survived the
        # effective merge (_load_multi lets the top-level dict win; the config's own copy agrees).
        stored = _obj(frappe.db.get_value(
            "BoQ Rate Category Config",
            {"discipline": disc, "category_id": "wiring_cabling", "active": 1}, "config",
        ))
        self.assertEqual([g["id"] for g in stored["goldens"]], ["g1", "g2", "g3", "g4", "g5"])
        # `item_kinds` is deliberately ABSENT on wiring_cabling -- its kinds derive from the
        # pipelines' match_master_row, and adding one would change the stored config for no gain.
        self.assertNotIn("item_kinds", stored)
        self.assertEqual(extraction._config_kinds(stored), ["cable", "termination"])

        # the retired scope carries through unchanged
        # F-16 ADDED tray_install_rate: the parallel install table is retired BY DECLARATION, since
        # omission alone leaves its rows orphan-active (_load_multi scopes the supersede to the
        # payload's own kinds). NOTE: this pin HARDCODES the list rather than deriving it, so it sits
        # outside the CURRENT_EALL_ASSET single-pin discipline and will need editing on every future
        # retirement. Recorded, not restructured, in this slice.
        self.assertEqual(payload["retired_kinds"],
                         ["db_install_rate", "tray_install_rate", "ups_per_kva",
                          "ups_reference"])  # F-17 added db_install_rate
        # F-16: SORTED, because the asset is now EXPORTED rather than hand-built and
        # retirement.get_retirement_lists returns `sorted(...)` -- "sorted for a stable export",
        # per its own docstring. v30 carried the hand-built insertion order ["ups",
        # "switches_point"]. This mismatch was INVISIBLE until the retired_kinds pin above was
        # corrected, because that line failed first.
        self.assertEqual(payload["retired_category_ids"], ["switches_point", "ups"])

    def test_24c_the_loader_carries_item_uid_through_from_the_asset(self):
        """SLICE 2 -- the stable item uid survives an import.

        Every import INSERTS fresh documents, so `name` is regenerated and cannot be a durable
        identity: freeze-and-supersede RETAINS the superseded row, so its name stays OCCUPIED and a
        new row reusing it would be a primary-key collision. `item_uid` is carried through from the
        payload exactly like brand/unit, which is what lets a CSV round trip say "this row is that
        row" across a mint.

        Loaded into a SCRATCH discipline -- never against live Electrical data."""
        disc = self._new_disc()
        payload = self._merged_payload(disc)

        # the asset itself must carry a uid on every item (the backfill stamps asset AND DB alike)
        uids = [it.get("item_uid") for it in payload["items"]]
        self.assertTrue(all(uids), "every asset item must carry an item_uid")
        self.assertEqual(len(set(uids)), len(uids), "asset uids must be distinct")
        self.assertTrue(all(u.startswith("rmi-") for u in uids))

        loader.load_rate_master(payload=payload)

        stored = frappe.get_all(
            "BoQ Rate Master Item",
            filters={"discipline": disc, "active": 1},
            fields=["kind", "brand", "attributes", "item_uid"],
        )
        self.assertEqual(len(stored), 1367)  # F-16 then F-17: 1382 -> 1372 -> 1364 (10 tray + 8 db_install_rate retired)  # SLICE 5: 1364 -> 1367 (three combined '1M & 2M' containers SPLIT into six single-size SKUs, the three combined ones retired by freeze-and-supersede)
        self.assertTrue(all((r["item_uid"] or "").startswith("rmi-") for r in stored),
                        "every stored row must carry the uid the asset supplied")
        self.assertEqual(len({r["item_uid"] for r in stored}), 1367)  # SLICE 5: 1364 -> 1367 (three combined '1M & 2M' containers SPLIT into six single-size SKUs, the three combined ones retired by freeze-and-supersede)
        # and it is the SAME uid on the SAME item -- keyed by (kind, brand, attributes), the tuple
        # the backfill paired on. `brand` is load-bearing here: six lms_item pairs are identical on
        # (kind, attributes) and differ ONLY by brand, at materially different prices.
        def key(kind, brand, attrs):
            return json.dumps([kind, brand, attrs], sort_keys=True, separators=(",", ":"))
        want = {key(it["kind"].strip(), it.get("brand"),
                    loader._canonicalize_attributes(it["attributes"])): it["item_uid"]
                for it in payload["items"]}
        got = {key(r["kind"], r["brand"], _obj(r["attributes"])): r["item_uid"] for r in stored}
        self.assertEqual(len(want), 1367)  # SLICE 5: 1364 -> 1367 (three combined '1M & 2M' containers SPLIT into six single-size SKUs, the three combined ones retired by freeze-and-supersede)
        self.assertEqual(want, got, "uid must land on the item the asset assigned it to")

    # ---- F-16 (2026-08-13): cable tray install moved ON-ROW ----------------------------
    # Plain-English coverage summary (test -> changed behaviour):
    #   f16a  a tray row CARRIES its own install rate, at the narrow end of the width table, and
    #         the install pipeline now matches `cable_tray` -- i.e. the second lookup is gone and
    #         install is read off the row the supply match already found.
    #   f16b  the same at the WIDE end. All three stored goldens sit at width 100, so without this
    #         a single hard-coded 120 would satisfy every other check in the suite.
    #   f16c  NEGATIVE: the parallel kind is genuinely RETIRED -- absent from the asset, absent
    #         from item_kinds, and declared in retired_kinds so a replace deactivates it. Omission
    #         alone would leave the 10 rows ORPHAN-ACTIVE.
    #   f16d  NEGATIVE: no multiplier survives anywhere in the install pipeline. A re-introduced
    #         per_run_factor would QUADRUPLE every tray install and nothing else here would notice.
    #   f16e  the three goldens reproduce UNCHANGED -- the prices-must-not-move instrument.
    #
    # SCOPE NOTE, deliberate: the pipeline INTERPRETER is TypeScript
    # (frontend/src/pages/pricing/rate-master/ratePipelineInterpreter.ts) and there is no Python
    # implementation -- by design; a second implementation of this arithmetic is forbidden. These
    # tests therefore pin the DATA and CONFIG that determine the price. The EXECUTED finals
    # (install = 120 at width 100, 380 at width 600) are proven in the browser cert against the
    # pre-change ledger, which is the only surface that actually runs the interpreter.
    F16_WIDTH_TABLE = {50.0: 100.0, 100.0: 120.0, 150.0: 140.0, 200.0: 160.0, 250.0: 180.0,
                       300.0: 220.0, 350.0: 260.0, 400.0: 300.0, 450.0: 340.0, 600.0: 380.0}

    def _f16_tray_config(self, payload):
        return next(c for c in payload["category_configs"] if c["category_id"] == "cabletray_raceway")

    def _f16_tray_rows(self, payload, width):
        return [i for i in payload["items"]
                if i["kind"] == "cable_tray" and i["attributes"]["width_mm"] == width]

    def test_f16a_install_is_read_off_the_tray_row_itself_at_the_narrow_end(self):
        """POSITIVE. At width 100 every tray row carries install_rate = 120 -- the FINAL effective
        figure, with the old x4 already baked in -- and the install pipeline's match_master_row now
        names `cable_tray`, the SAME kind the supply pipeline matches.

        That pairing is the whole of F-16: one matched row, two rate keys read off it, exactly as
        the supply pipeline already reads without_cover_list and cover_only_list off one row."""
        payload = self._merged_payload("Electrical")
        rows = self._f16_tray_rows(payload, 100.0)
        self.assertEqual(len(rows), 45)
        for it in rows:
            self.assertEqual(it["rates"]["install_rate"], 120.0)
            # the supply rates are UNTOUCHED -- install_rate was added, nothing was replaced
            self.assertIn("without_cover_list", it["rates"])
            self.assertIn("cover_only_list", it["rates"])

        steps = self._f16_tray_config(payload)["pipelines"]["tray_boq_install"]["steps"]
        # F-9 (slice 3a) RE-ANCHOR. These four assertions read steps[0] and steps[1] until now.
        # The INDEX was INCIDENTAL: what F-16 protects is that install is read VERBATIM off the
        # MATCHED cable_tray row -- one matched row, two rate keys -- not where those two steps
        # happen to sit in the list. F-9 inserts a `catalog_fit` ahead of the match (the width has
        # to be fitted BEFORE the row can be matched), which shifted both indices while touching
        # nothing F-16 cares about. Anchoring by step TYPE and component NAME asserts the same
        # guarantee and cannot be moved by a later insertion. A missing step yields None and fails
        # as an assertion rather than an IndexError.
        match = next((s for s in steps if s.get("step") == "match_master_row"), {})
        install = next((s for s in steps if s.get("name") == "width_install"), {})
        self.assertEqual(match.get("step"), "match_master_row")
        self.assertEqual(match.get("params", {}).get("kind"), "cable_tray")
        self.assertEqual(install.get("target"), "install_rate")
        self.assertEqual(install.get("formula"), "base")   # verbatim, no arithmetic on top

    def test_f16b_install_is_read_off_the_tray_row_itself_at_the_wide_end(self):
        """POSITIVE, and the ONLY coverage away from width 100.

        Goldens t1/t2/t3 all sit at width 100, so a config that hard-coded 120 -- or a table read
        that silently returned the same row for every width -- would pass f16a and every golden.
        Width 600 is the far end of the ladder, and the whole table is checked row by row."""
        payload = self._merged_payload("Electrical")
        rows = self._f16_tray_rows(payload, 600.0)
        self.assertEqual(len(rows), 45)
        for it in rows:
            self.assertEqual(it["rates"]["install_rate"], 380.0)

        # every width, every row: 450 rows, 45 at each of the ten widths, no eleventh value
        seen = {}
        for it in payload["items"]:
            if it["kind"] != "cable_tray":
                continue
            w = it["attributes"]["width_mm"]
            self.assertIn(w, self.F16_WIDTH_TABLE, f"width {w} is outside the F-16 table")
            self.assertEqual(it["rates"]["install_rate"], self.F16_WIDTH_TABLE[w])
            seen[w] = seen.get(w, 0) + 1
        self.assertEqual(seen, {w: 45 for w in self.F16_WIDTH_TABLE})

    def test_f16c_the_parallel_kind_is_retired_by_declaration_not_by_omission(self):
        """NEGATIVE, and the one that would have been silently wrong.

        `_load_multi` computes its supersede scope from the PAYLOAD's own kinds, so a kind merely
        DROPPED from an asset is never named by _deactivate_scope and its rows stay ACTIVE -- still
        served by every active-only reader, while the asset meant to define them no longer mentions
        them. Declaring it in `retired_kinds` is the ONLY thing that deactivates it, and the
        declaration must ADD to the existing entries rather than replace them."""
        payload = self._merged_payload("Electrical")
        self.assertFalse([i for i in payload["items"] if i["kind"] == "tray_install_rate"])
        self.assertEqual(self._f16_tray_config(payload)["item_kinds"], ["cable_tray"])
        self.assertIn("tray_install_rate", payload["retired_kinds"])
        # the pre-existing retirements survive -- losing one would silently UN-retire that kind
        self.assertIn("ups_per_kva", payload["retired_kinds"])
        self.assertIn("ups_reference", payload["retired_kinds"])

        # and the declaration really does deactivate, in a scratch discipline
        disc = self._new_disc()
        r = loader.load_rate_master(payload=self._merged_payload(disc), replace=True)
        self.assertIn("kind::tray_install_rate", r["retirements_recorded"]["created"])
        self.assertEqual(self._active_items(disc, kind="tray_install_rate"), 0)
        self.assertEqual(self._active_items(disc, kind="cable_tray"), 450)

    def test_f16d_no_multiplier_survives_in_the_install_pipeline(self):
        """NEGATIVE. The x4 is now baked into the stored figures, so the pipeline must apply NO
        factor at all. A re-introduced `per_run_factor` -- or any other numeric param on the
        width_install step -- would quadruple every tray install on every sheet, and the goldens
        could not catch it alone: they would simply move together and look self-consistent."""
        payload = self._merged_payload("Electrical")
        pl = self._f16_tray_config(payload)["pipelines"]["tray_boq_install"]
        self.assertNotIn("per_run_factor", json.dumps(pl))
        width_install = next(s for s in pl["steps"] if s.get("name") == "width_install")
        self.assertEqual(width_install["params"], {})
        # the floor_cutting adder and the sum are UNTOUCHED by F-16
        cutting = next(s for s in pl["steps"] if s.get("name") == "floor_cutting")
        self.assertEqual(cutting["conditions"][0]["params"], {"cutting_rate": 200.0, "markup": 0.45})
        self.assertEqual(pl["steps"][-1], {"step": "sum_components", "result": "install_per_rmt"})

    def test_f16e_the_tray_goldens_are_unchanged_by_the_restructure(self):
        """THE PRICES-MUST-NOT-MOVE INSTRUMENT.

        F-16 is a pure restructure, so the stored goldens must survive it untouched. All three sit
        at width 100, where the retired table said 30 x 4 and the row now says 120 -- the same
        number by construction, which is exactly why no golden needed editing. t3 additionally
        carries the cutting adder (200 x 1.45 = 290), proving F-16 left that branch alone."""
        payload = self._merged_payload("Electrical")
        goldens = {g["id"]: g for g in payload["goldens"]["cabletray_raceway"]}
        self.assertEqual(set(goldens), {"t1", "t2", "t3"})
        for gid in ("t1", "t2", "t3"):
            self.assertEqual(goldens[gid]["attrs"]["width_mm"], 100.0)
        self.assertEqual(goldens["t1"]["expect"]["tray_boq_install"]["install_per_rmt"], 120.0)
        self.assertEqual(goldens["t2"]["expect"]["tray_boq_install"]["install_per_rmt"], 120.0)
        self.assertEqual(goldens["t3"]["expect"]["tray_boq_install"]["install_per_rmt"], 410.0)
        self.assertEqual(goldens["t1"]["expect"]["tray_boq_supply"]["supply_per_rmt"], 431.0)
        # 410 = the row's own 120 + the untouched cutting adder 290
        self.assertEqual(
            goldens["t3"]["expect"]["tray_boq_install"]["install_per_rmt"],
            self.F16_WIDTH_TABLE[100.0] + 200.0 * 1.45,
        )

    # ---- F-17 (2026-08-13/14): db_switchgear install becomes a plain RATIO -------------
    # Plain-English coverage summary (test -> changed behaviour):
    #   f17a  install is 20% of the CALCULATED SUPPLY, on a BARE shell and on the SAME shell
    #         LOADED with MCBs. Two assemblies is the whole point: the retired table was a flat
    #         per-shell figure that could not see the MCBs, so a single-assembly test would not
    #         distinguish "tracks the assembly" from "happens to match on this one row".
    #   f17b  R1 -- the Finding-B shell prices from 12,881, and its old 12,133 row is retained
    #         inactive (freeze-and-supersede), not deleted.
    #   f17c  NEGATIVE: the install table is genuinely retired -- absent from items, absent from
    #         item_kinds, present in retired_kinds. Omission alone would leave it orphan-active.
    #   f17d  NEGATIVE: NO `lookup_or_ratio` step and NO `db_install_rate` reference survive in
    #         the install pipeline -- the reference is GONE, not dormant.
    #   f17e  the four goldens carry the re-minted ratio figures.
    #
    # SCOPE NOTE (as for F-16): the interpreter is TypeScript, so these pin the DATA and CONFIG
    # that determine the price; the EXECUTED figures are proven by the browser cert against the
    # expected-after table.
    F17_RATIO = 0.20

    def _f17_db_config(self, payload):
        return next(c for c in payload["category_configs"] if c["category_id"] == "db_switchgear")

    def test_f17a_install_is_a_ratio_of_the_calculated_supply(self):
        """POSITIVE -- the ruling itself, expressed in config rather than in a lookup table.

        Install was `lookup_or_ratio`: a flat per-shell figure from an 8-row table (x1.5) for 8
        shells, and a 0.15 ratio fallback for the other 19. It is now ONE rule for all 27 --
        `ROUNDUP(supply x 0.20, -1)` -- so it tracks the WHOLE assembly (shell + MCBs + enclosure)
        rather than the shell alone.

        The step pair is asserted rather than the arithmetic, because the arithmetic lives in the
        TypeScript interpreter; the browser cert proves the numbers against the expected-after
        table, on a BARE and a LOADED assembly for each certified shell."""
        payload = self._merged_payload("Electrical")
        steps = self._f17_db_config(payload)["pipelines"]["db_buildup_install"]["steps"]
        scale = steps[-2]
        self.assertEqual(scale["step"], "scale")
        self.assertEqual(scale["target"], "supply")        # the CALCULATED supply, not the shell
        self.assertEqual(scale["result"], "install")
        self.assertEqual(scale["params"], {"m": self.F17_RATIO})
        self.assertEqual(scale["formula"], "base*m")
        # the rounding BEHAVIOUR of the retired step's `round_ratio: -1` is preserved exactly
        self.assertEqual(steps[-1], {"step": "roundup", "target": "install",
                                     "params": {"digits": -1}})
        # steps 0-9 (the build-up itself) are untouched by F-17
        supply_steps = self._f17_db_config(payload)["pipelines"]["db_buildup_supply"]["steps"]
        self.assertEqual(steps[:10], supply_steps[:10])

    def test_f17b_the_finding_b_shell_prices_from_the_higher_figure(self):
        """POSITIVE -- R1, the slice's SECOND deliberate price move.

        The ledger's framing (a merge dedup 'missed a twin') was a MISREAD: the merge deduplicated
        `db_switchgear_item` and completed correctly. The 12,133 that survived was the `db_shell`
        catalog's OWN row for the same product -- a different kind with a different rate key, never
        part of that dedup. The owner adopted the higher figure for safety, so this is a new pricing
        decision, not a repair."""
        payload = self._merged_payload("Electrical")
        shells = [i for i in payload["items"] if i["kind"] == "db_shell"]
        self.assertEqual(len(shells), 27)
        target = [i for i in shells if i["item_uid"] == "rmi-867d1c6a5d6b"]
        self.assertEqual(len(target), 1)
        self.assertEqual(target[0]["rates"]["shell_rate"], 12881.0)
        self.assertEqual(target[0]["attributes"]["item"],
                         "TPN FLEXI DB 4 ROW 14M (DOUBLE DOOR IP 43)")
        # exactly ONE active shell row for that product -- no duplicate was introduced
        same = [i for i in shells
                if i["attributes"]["item"] == "TPN FLEXI DB 4 ROW 14M (DOUBLE DOOR IP 43)"]
        self.assertEqual(len(same), 1)
        # and no active row anywhere still carries the superseded figure
        self.assertEqual([i["item_uid"] for i in payload["items"]
                          if 12133.0 in (i.get("rates") or {}).values()], [])

    def test_f17c_the_install_table_is_retired_by_declaration(self):
        """NEGATIVE -- the same failure mode F-16 proved: omission alone is not retirement.

        `_load_multi` scopes its supersede to the payload's own kinds, so a kind merely dropped from
        an asset is never named by `_deactivate_scope` and its rows stay ORPHAN-ACTIVE. Declaring it
        in `retired_kinds` is the only thing that deactivates it, and the list is ADDED to."""
        payload = self._merged_payload("Electrical")
        self.assertFalse([i for i in payload["items"] if i["kind"] == "db_install_rate"])
        self.assertEqual(self._f17_db_config(payload)["item_kinds"],
                         ["db_switchgear_item", "db_shell"])
        self.assertIn("db_install_rate", payload["retired_kinds"])
        for kept in ("tray_install_rate", "ups_per_kva", "ups_reference"):
            self.assertIn(kept, payload["retired_kinds"])   # never replaced, only added to

        disc = self._new_disc()
        r = loader.load_rate_master(payload=self._merged_payload(disc), replace=True)
        self.assertIn("kind::db_install_rate", r["retirements_recorded"]["created"])
        self.assertEqual(self._active_items(disc, kind="db_install_rate"), 0)
        self.assertEqual(self._active_items(disc, kind="db_shell"), 27)

    def test_f17d_no_lookup_survives_in_the_install_pipeline(self):
        """NEGATIVE -- GONE, not dormant (owner ruling C).

        Retiring the 8 rows alone would have left the `lookup_or_ratio` step in place, still naming
        a kind that no longer exists and still tracing 'table miss' against a table that had been
        retired. Deleting only its `lookup` key was MEASURED and is fatal: the interpreter reads
        `s.lookup.item` unconditionally, so the pipeline degrades to `unsupported` and every DB
        install blanks. Replacing the step with `scale` + `roundup` -- existing vocabulary, no
        interpreter change -- is the shape that removes the reference safely."""
        payload = self._merged_payload("Electrical")
        install = json.dumps(self._f17_db_config(payload)["pipelines"]["db_buildup_install"])
        self.assertNotIn("lookup_or_ratio", install)
        self.assertNotIn("db_install_rate", install)
        self.assertNotIn("round_ratio", install)
        self.assertNotIn("round_lookup", install)
        # and NO category anywhere still EXECUTES the step -- checked STRUCTURALLY, over step
        # types, not by searching the serialized config. A substring search also matches the
        # `notes` prose, which retains the v16c build record that introduced `lookup_or_ratio`;
        # that is archaeology and is meant to stay. The claim being pinned is behavioural --
        # nothing runs the step -- so the assertion has to look at steps.
        executed = [
            (c["category_id"], pid)
            for c in payload["category_configs"]
            for pid, pl in (c.get("pipelines") or {}).items()
            for st in pl.get("steps", [])
            if st.get("step") == "lookup_or_ratio"
        ]
        self.assertEqual(executed, [],
                         "F-17: lookup_or_ratio has no shipped consumer left")

    def test_f17e_the_db_goldens_carry_the_reminted_ratio_figures(self):
        """POSITIVE -- the goldens are config DATA and a standing pin, so a ruling that moves
        prices must move them too (a test is updated to match a ruling, never the reverse).

        Each was re-derived through the interpreter before editing: dbu1 and dbu3 were already on
        the 0.15 ratio (3,660 / 3,580 -> 4,880 / 4,770); dbu2 and dbu4 were TABLE hits (1,500 /
        1,275 -> 2,640 / 1,670). Supplies are unchanged -- none of the four uses the R1 shell, and
        dbu3's shell is "None"."""
        payload = self._merged_payload("Electrical")
        top = {g["id"]: g for g in payload["goldens"]["db_switchgear"]}
        self.assertEqual(set(top), {"dbu1", "dbu2", "dbu3", "dbu4"})
        for gid, install in (("dbu1", 4880.0), ("dbu2", 2640.0),
                             ("dbu3", 4770.0), ("dbu4", 1670.0)):
            self.assertEqual(top[gid]["expect"]["db_buildup_install"]["install"], install)
        # the supplies did NOT move
        self.assertEqual(top["dbu1"]["expect"]["db_buildup_supply"]["supply"], 24360.0)
        self.assertEqual(top["dbu3"]["expect"]["db_buildup_supply"]["supply"], 23840.0)
        self.assertEqual(top["dbu3"]["attrs"]["db_shell_item"], "None")   # checked, not assumed

    def test_f20_a_source_less_load_refuses_by_name_and_writes_nothing(self):
        """NEGATIVE -- F-20. A load with NEITHER payload NOR path must refuse by name.

        THE TRAP THIS REPLACES: `_load_payload` used to fall back to a `DEFAULT_DATA_FILE`
        constant naming a FIXED filename, so it went stale the moment a new asset was minted. It
        still pointed at v30 after F-16 shipped v31, and a path-less `load_rate_master(replace=
        True)` would have silently reverted the WHOLE v30 scope -- 12 categories and 15 kinds --
        re-activating the 10 retired `tray_install_rate` rows and stripping `install_rate` from all
        450 trays. It reported success while doing it.

        Nothing in the repo ever opened that default (every caller passes `payload=`), so the
        danger was never traffic -- it was the INVITATION: an optional argument documented as
        "defaults to the committed data asset" reads like a safe convenience.

        WHY NOTHING IS WRITTEN IS TRUE BY CONSTRUCTION, not by luck: `_load_payload` is called on
        `load_rate_master`'s FIRST line, before the shape branch, before any count and before any
        insert -- so the refusal precedes every DB statement. The row counts below are a
        BELT-AND-BRACES confirmation of that ordering, not the proof of it.

        This test calls the loader deliberately, and it is safe precisely because the call is
        refused before it can read or write anything: no asset is opened and no discipline is
        touched.
        """
        before_items = frappe.db.count(loader.ITEM_DOCTYPE)
        before_cfgs = frappe.db.count(loader.CONFIG_DOCTYPE)

        # the DANGEROUS shape specifically: path-less AND replace=True
        with self.assertRaises(frappe.ValidationError) as cm:
            loader.load_rate_master(replace=True)
        msg = str(cm.exception)
        # the message must TEACH, naming both valid call shapes and where a current file comes from
        self.assertIn("needs an explicit source", msg)
        self.assertIn("payload=", msg)
        self.assertIn("path=", msg)
        self.assertIn("export_rate_master_asset", msg)

        # an EMPTY-STRING path is falsy and must refuse identically -- `not path`, never
        # `path is None`, or `path=""` would sail through to open("") and raise a bare OSError.
        with self.assertRaises(frappe.ValidationError):
            loader.load_rate_master(path="", replace=True)

        self.assertEqual(frappe.db.count(loader.ITEM_DOCTYPE), before_items)
        self.assertEqual(frappe.db.count(loader.CONFIG_DOCTYPE), before_cfgs)

        # and the constant is GONE. Without this, a re-introduced default would silently restore
        # the trap and every other test would still pass -- none of them takes that branch.
        self.assertFalse(
            hasattr(loader, "DEFAULT_DATA_FILE"),
            "F-20: loader must carry NO default asset constant -- a fixed filename goes stale on "
            "every mint, and a path-less load would silently supersede the live catalog with it",
        )

    def test_24d_a_legacy_asset_without_uids_still_loads(self):
        """SLICE 2 -- NEGATIVE half. v29 and earlier carry no `item_uid`, and `_validate_items` must
        keep tolerating its absence rather than requiring it, or every historical-fixture test in
        this suite would break. The loader reads it with .get(), so absence yields None.

        Uses the v12 asset (the oldest one this suite pins) into a SCRATCH discipline."""
        disc = self._new_disc()
        legacy = self._eall_payload(disc)
        self.assertTrue(all("item_uid" not in it for it in legacy["items"]),
                        "the v12 fixture must genuinely carry no uid, or this proves nothing")

        r = loader.load_rate_master(payload=legacy)      # must NOT raise
        self.assertEqual(r["status"], "loaded")

        stored = frappe.get_all("BoQ Rate Master Item",
                                filters={"discipline": disc, "active": 1}, fields=["item_uid"])
        self.assertTrue(stored)
        self.assertTrue(all(not r["item_uid"] for r in stored),
                        "a legacy asset must load with a BLANK uid, never a fabricated one")

    def test_24e_the_loader_records_retirement_state_it_never_used_to_persist(self):
        """SLICE 3 -- the retirement lists become a durable RECORD.

        `retired_kinds` / `retired_category_ids` were the ONLY two loader inputs consumed to drive
        behaviour and never persisted: the whole effect was `active = 0`, which is indistinguishable
        from an ordinary supersede. Built from rows alone, an export would drop them.

        ⚠️ PAYLOAD IS THE INSTRUCTION, TABLE IS THE RECORD -- the NEGATIVE half below pins that the
        deactivation still reads the payload, never this table.

        Loaded into a SCRATCH discipline; never against live Electrical data."""
        from nirmaan_stack.services.boq_rate_master import retirement

        disc = self._new_disc()
        payload = self._merged_payload(disc)
        # F-16 ADDED tray_install_rate -- see the note on the twin pin in test_24b: this one is
        # likewise hardcoded and outside the single-pin discipline.
        self.assertEqual(payload["retired_kinds"],
                         ["db_install_rate", "tray_install_rate", "ups_per_kva",
                          "ups_reference"])  # F-17 added db_install_rate
        # F-16: SORTED, because the asset is now EXPORTED rather than hand-built and
        # retirement.get_retirement_lists returns `sorted(...)` -- "sorted for a stable export",
        # per its own docstring. v30 carried the hand-built insertion order ["ups",
        # "switches_point"]. This mismatch was INVISIBLE until the retired_kinds pin above was
        # corrected, because that line failed first.
        self.assertEqual(payload["retired_category_ids"], ["switches_point", "ups"])

        # nothing recorded for a discipline that has never been loaded
        self.assertEqual(
            retirement.get_retirement_lists(disc),
            # F-19: the read gained `retirement_reasons` in the SAME shape the asset uses. A
            # discipline with no rows exports two EMPTY sub-maps -- the same inherit-nothing
            # discipline the two lists already keep.
            {"retired_kinds": [], "retired_category_ids": [],
             "retirement_reasons": {"kinds": {}, "categories": {}}},
        )

        r = loader.load_rate_master(payload=payload)

        # the summary reports what it recorded, and the read function returns the asset's own shape
        # F-16: 4 -> 5 recorded. F-17: 5 -> 6, db_install_rate is the SIXTH retirement.
        self.assertEqual(len(r["retirements_recorded"]["created"]), 6)
        self.assertEqual(r["retirements_recorded"]["existing"], [])
        self.assertEqual(
            retirement.get_retirement_lists(disc),
            {"retired_kinds": ["db_install_rate", "tray_install_rate", "ups_per_kva",
                               "ups_reference"],   # F-17 added db_install_rate
             "retired_category_ids": ["switches_point", "ups"],
             # F-3 (2026-08-15) RE-MINTED THIS PIN, and the ruling it now encodes is F-19's own.
             # It used to assert two EMPTY maps, on the stated grounds that "the merged asset
             # declares retirements but carries NO reasons". That was never a property of the
             # SYSTEM -- only of v32, which was minted at F-17, BEFORE F-19 added the channel and
             # backfilled the two real reasons. v33 is the first asset exported after F-19, so it
             # is the first to carry them, and the old assertion was guaranteed to fail on the next
             # mint by anyone for any reason. Asserting against the PAYLOAD states the actual rule
             # -- the loader records what the asset declares, and the read returns it in the
             # asset's own shape -- and is immune to every future mint.
             "retirement_reasons": payload["retirement_reasons"]},
        )

        # ⚠️ retired_at / retired_by stay EMPTY -- the loader knows when it RAN, not when the
        # decision was made, and it has never known by whom. A field asserting a precision it does
        # not have is worse than an empty one, and F-19 does NOT change that.
        #
        # F-19 NARROWED THE REASON CLAUSE ONLY: a reason is AUTHORED FACT travelling with the
        # payload, not something inferred after the event, so it may now be set. The reason CHANNEL
        # is covered by test_f19a-e.
        #
        # F-3 (2026-08-15) RE-MINTED THE REASON HALF, on F-19's ruling -- the SECOND assertion in
        # this test to move, and it was masked until the first one was fixed. It read a blanket
        # `assertFalse(reason)` "because this payload declares none", true only while the current
        # asset was v32 (minted at F-17, before F-19's channel and backfill). The two timestamp
        # clauses are UNTOUCHED and are the load-bearing half: `retired_at` / `retired_by` are
        # never written, because the loader knows when it RAN and has never known by whom.
        declared = payload["retirement_reasons"]
        for row in frappe.get_all(retirement.RETIREMENT_DOCTYPE, filters={"discipline": disc},
                                  fields=["scope_type", "scope_value",
                                          "retired_at", "retired_by", "reason"]):
            self.assertIsNone(row["retired_at"])
            self.assertFalse(row["retired_by"])
            # each row carries EXACTLY what the payload declared for its scope, and blank where it
            # declared nothing -- the R2 path still proven on the four reasonless retirements.
            bucket = "kinds" if row["scope_type"] == "kind" else "categories"
            self.assertEqual(row["reason"] or "",
                             declared.get(bucket, {}).get(row["scope_value"], ""))

        # IDEMPOTENT: a second load records nothing new
        r2 = loader.load_rate_master(payload=self._merged_payload(disc), replace=True)
        self.assertEqual(r2["retirements_recorded"]["created"], [])
        # F-16: 4 -> 5. F-17: 5 -> 6 on both counts -- db_install_rate is the sixth.
        self.assertEqual(len(r2["retirements_recorded"]["existing"]), 6)
        self.assertEqual(
            frappe.db.count(retirement.RETIREMENT_DOCTYPE, {"discipline": disc}), 6
        )

        # UNIQUENESS IS STRUCTURAL: the tuple IS the primary key, so a duplicate cannot be inserted
        # even bypassing record_retirements. Not a validate hook that could race or be skipped.
        #
        # ⚠️ SAVEPOINT IS LOAD-BEARING, not tidiness. A primary-key violation ABORTS the postgres
        # transaction ("current transaction is aborted, commands ignored until end of transaction
        # block"), so without rolling back to a savepoint every subsequent test in this class fails
        # at its first write -- measured: 18 cascading errors plus tearDownClass.
        frappe.db.savepoint("retirement_dup_probe")
        with self.assertRaises(frappe.DuplicateEntryError):
            frappe.get_doc({
                "doctype": retirement.RETIREMENT_DOCTYPE, "discipline": disc,
                "scope_type": "kind", "scope_value": "ups_per_kva",
            }).insert(ignore_permissions=True)
        frappe.db.rollback(save_point="retirement_dup_probe")

    # ---- F-19 (2026-08-14): a retirement can carry a REASON ----------------------------
    # Plain-English coverage summary (test -> changed behaviour):
    #   f19a  a payload declaring a reason records it VERBATIM on the minted row, and only on the
    #         row it names -- the map ANNOTATES a declaration, it does not make one.
    #   f19b  the reason survives export -> re-load, so the asset self-documents its retirements.
    #         retired_at/retired_by are NOT exported (a timestamp would break byte-identity).
    #   f19c  a retirement with NO reason still records, blank, and the summary COUNTS it. This is
    #         what keeps every pre-F-19 asset (v32 and earlier) loading.
    #   f19d  NEGATIVE: a reason naming something the payload does not retire REFUSES BY NAME. The
    #         map must never become a second, quieter way to declare a retirement.
    #   f19e  NEGATIVE: a replay carrying reasons does NOT fill an existing blank row. The skip is
    #         what makes a re-load safe; the two historical rows are filled by the one-off script.
    F19_KIND_REASON = "Superseded by a test: the kind moved on-row."
    F19_CAT_REASON = "Superseded by a test: the category was folded away."

    def _f19_payload(self, disc, reasons=None):
        """The merged payload for a scratch discipline, optionally carrying `retirement_reasons`."""
        p = self._merged_payload(disc)
        if reasons is not None:
            p["retirement_reasons"] = reasons
        return p

    def test_f19a_a_declared_reason_is_recorded_verbatim_on_the_minted_row(self):
        """POSITIVE -- the channel itself.

        Before F-19 the loader recorded WHAT was retired and nothing about WHY; the reason lived
        only in a commit message, which the database could not show anyone. The asset now carries an
        optional `retirement_reasons` map and the minted row stores it verbatim."""
        from nirmaan_stack.services.boq_rate_master import retirement
        disc = self._new_disc()
        payload = self._f19_payload(disc, {
            "kinds": {"tray_install_rate": self.F19_KIND_REASON},
            "categories": {"ups": self.F19_CAT_REASON},
        })
        r = loader.load_rate_master(payload=payload)
        self.assertEqual(len(r["retirements_recorded"]["created"]), 6)

        rows = {x["name"]: x for x in frappe.get_all(
            retirement.RETIREMENT_DOCTYPE, filters={"discipline": disc},
            fields=["name", "scope_type", "scope_value", "reason", "retired_at", "retired_by"])}
        kind_row = rows[f"{disc}::kind::tray_install_rate"]
        cat_row = rows[f"{disc}::category::ups"]
        self.assertEqual(kind_row["reason"], self.F19_KIND_REASON)
        self.assertEqual(cat_row["reason"], self.F19_CAT_REASON)
        # ONLY the named rows -- the other four are declared but unexplained, and that is legal
        self.assertFalse(rows[f"{disc}::kind::ups_per_kva"]["reason"])
        self.assertEqual(r["retirements_without_reason"], 4)
        # provenance the loader cannot know is STILL untouched
        for row in rows.values():
            self.assertIsNone(row["retired_at"])
            self.assertFalse(row["retired_by"])

    def test_f19b_a_reason_survives_the_export_round_trip(self):
        """POSITIVE -- the asset self-documents (extends test_24g's axes).

        A reason that lived only in the database would be lost the next time the catalog was
        bootstrapped from the repo asset -- the F-20 finding that a fresh site can only load the
        committed file. So the export must carry it, and a re-load must reproduce it."""
        from nirmaan_stack.services.boq_rate_master import exporter, retirement
        src = self._new_disc()
        loader.load_rate_master(payload=self._f19_payload(src, {
            "kinds": {"tray_install_rate": self.F19_KIND_REASON}, "categories": {}}))

        payload, _text = exporter.export_asset_text(src)
        self.assertEqual(payload["retirement_reasons"]["kinds"]["tray_install_rate"],
                         self.F19_KIND_REASON)
        # ⚠️ REASON ONLY -- a timestamp in the payload would break test_24h's byte-identity
        self.assertNotIn("retired_at", json.dumps(payload["retirement_reasons"]))
        self.assertNotIn("retired_by", json.dumps(payload["retirement_reasons"]))

        dst = self._new_disc()
        payload2 = json.loads(json.dumps(payload))
        payload2["discipline"] = dst
        loader.load_rate_master(payload=payload2)
        self.assertEqual(retirement.get_retirement_lists(dst)["retirement_reasons"],
                         retirement.get_retirement_lists(src)["retirement_reasons"])

    def test_f19c_a_retirement_without_a_reason_records_blank_and_is_counted(self):
        """NEGATIVE-ish (R2) -- the backwards-compatibility path, and the reason it was chosen.

        REFUSING a reasonless retirement would have been the tidier rule and was rejected: every
        asset up to and including v32 declares retirements and carries no reasons at all, so the
        shipped catalog would have stopped loading -- exactly the trap class F-20 removed. The
        honest lever against forgetting is VISIBILITY, so the summary reports the count.

        F-3 (2026-08-15) RE-MINTED THE FIXTURE, not the ruling. The reasonless payload used to be
        `_merged_payload` as-is, which was reasonless only because v32 predated F-19. v33 carries
        two real reasons, so the fixture now STRIPS the key: the R2 path is about a payload that
        declares retirements and no reasons, and that must be an explicit property of the fixture
        rather than an accident of which asset happens to be current."""
        from nirmaan_stack.services.boq_rate_master import retirement
        disc = self._new_disc()
        payload = self._merged_payload(disc)
        payload.pop("retirement_reasons", None)                           # no reasons at all
        r = loader.load_rate_master(payload=payload)
        self.assertEqual(len(r["retirements_recorded"]["created"]), 6)
        self.assertEqual(r["retirements_without_reason"], 6)
        for row in frappe.get_all(retirement.RETIREMENT_DOCTYPE, filters={"discipline": disc},
                                  fields=["reason"]):
            self.assertFalse(row["reason"])

    def test_f19d_a_reason_for_an_undeclared_retirement_refuses_by_name(self):
        """NEGATIVE -- the map ANNOTATES a declaration; it must never MAKE one.

        `retired_kinds` stays the single instruction (the module's standing "payload is the
        instruction, table is the record" rule). Without this, a typo'd key would sit in the asset
        looking effective while doing nothing -- the silent-no-op class this module keeps paying to
        remove -- and a reader could reasonably think naming a kind here retired it."""
        disc = self._new_disc()
        with self.assertRaises(frappe.ValidationError) as cm:
            loader.load_rate_master(payload=self._f19_payload(disc, {
                "kinds": {"cable_tray": "this kind is NOT retired by this payload"},
                "categories": {}}))
        self.assertIn("cable_tray", str(cm.exception))
        self.assertIn("retired_kinds", str(cm.exception))
        # a malformed map is refused too, by shape
        for bad in ({"kinds": ["not", "a", "map"]}, {"unexpected": {}}, "not a dict"):
            with self.assertRaises(frappe.ValidationError):
                loader.load_rate_master(payload=self._f19_payload(self._new_disc(), bad))

    def test_f19e_a_replay_never_fills_an_existing_blank_reason(self):
        """NEGATIVE -- THE RECON'S KEY FINDING, pinned so it cannot regress.

        `record_retirements` SKIPS an entry that already exists, and that skip is what makes a
        re-load safe. It is therefore structurally unable to fill a row minted blank: re-loading
        with reasons attached reports the rows as `existing` and changes nothing. Turning the skip
        into an upsert would trade a load-safety guarantee for two historical fields, which is why
        the two real rows were filled by `scripts/backfill_retirement_reasons.py` instead.

        F-3 (2026-08-15) RE-MINTED THE FIXTURE, not the ruling. The first load must mint the row
        BLANK for the replay to prove anything, and `_merged_payload` stopped doing that the moment
        an asset carried reasons -- v33 is the first, because v32 predated F-19. Stripping the key
        makes "minted blank" the fixture's own doing rather than a property borrowed from whichever
        asset is current."""
        from nirmaan_stack.services.boq_rate_master import retirement
        disc = self._new_disc()
        blank = self._merged_payload(disc)
        blank.pop("retirement_reasons", None)
        loader.load_rate_master(payload=blank)                            # minted blank
        name = f"{disc}::kind::tray_install_rate"
        self.assertFalse(frappe.db.get_value(retirement.RETIREMENT_DOCTYPE, name, "reason"))

        r2 = loader.load_rate_master(payload=self._f19_payload(disc, {
            "kinds": {"tray_install_rate": self.F19_KIND_REASON}, "categories": {}}), replace=True)
        self.assertEqual(r2["retirements_recorded"]["created"], [])
        self.assertIn("kind::tray_install_rate", r2["retirements_recorded"]["existing"])
        self.assertFalse(frappe.db.get_value(retirement.RETIREMENT_DOCTYPE, name, "reason"),
                         "a replay must NOT fill an existing blank reason (F-19 R5)")

    def test_24f_the_table_is_the_record_and_never_drives_deactivation(self):
        """SLICE 3 NEGATIVE half -- the payload remains the instruction.

        A retirement RECORDED for a discipline must NOT cause a later payload that no longer
        declares it to deactivate anything. If the loader ever read this table to drive
        `_deactivate_scope`, import behaviour would change -- explicitly out of scope."""
        from nirmaan_stack.services.boq_rate_master import retirement

        disc = self._new_disc()
        # record a retirement for a kind that the E-ALL payload DOES carry, so if the table were
        # ever consulted the load below would deactivate those rows.
        retirement.record_retirements(disc, ["cable_tray"], [])
        frappe.db.commit()
        self.assertEqual(retirement.get_retirement_lists(disc)["retired_kinds"], ["cable_tray"])

        payload = self._merged_payload(disc)
        self.assertNotIn("cable_tray", payload["retired_kinds"])   # the payload does NOT retire it
        loader.load_rate_master(payload=payload, replace=True)

        # cable_tray loaded ACTIVE and stayed active -- the recorded row changed nothing
        self.assertEqual(self._active_items(disc, kind="cable_tray"), 450)

    # ── SLICE 4: the asset export + snapshots ────────────────────────────────────────────
    # Plain-English coverage summary (test -> changed behaviour):
    #   24g  the export ROUND-TRIPS -- exporting a discipline and loading the result into a fresh
    #        one reproduces every axis (items per kind, identity, rates, provenance, item_uid,
    #        config blobs, goldens, the retirement entries). This is the slice's real gate; the
    #        mint gate cannot see below `kind:<k>` and proves nothing about item fidelity.
    #   24h  two consecutive exports are BYTE-IDENTICAL, so the file is a stable artefact and a
    #        re-export produces no spurious diff.
    #   24i  BLOB-VERBATIM (the negative half): a config carrying a key nothing knows about
    #        survives the export untouched. This is what stops a fixed-schema export silently
    #        dropping the 21st key the day someone adds one.
    #   24j  retirement lists come from the TABLE (slice 3), not a file header -- and a discipline
    #        with no retirement rows exports two EMPTY lists rather than inheriting anything.
    #   24k  a snapshot is written per export, and the prune keeps the newest 10 per discipline.
    #   24l  the endpoint refuses a non-admin, and writes NOTHING when it refuses.

    def _export_scratch(self, source_disc=None):
        """Export a discipline and return (payload, text). Defaults to a freshly loaded scratch."""
        from nirmaan_stack.services.boq_rate_master import exporter
        return exporter.export_asset_text(source_disc)

    def test_24g_the_export_round_trips_every_axis(self):
        """SLICE 4 -- the export is proven by ROUND TRIP, not by assertion.

        Export a loaded discipline, load the result into a SECOND scratch discipline, and compare
        the two axis by axis. Row identity (name / import_batch / timestamps) regenerates by
        design and is deliberately not compared; `item_uid` IS compared, because that is the
        durable identity slice 2 added precisely so it survives a mint."""
        from nirmaan_stack.services.boq_rate_master import exporter, retirement

        src = self._new_disc()
        loader.load_rate_master(payload=self._merged_payload(src))

        payload, _text = exporter.export_asset_text(src)
        dst = self._new_disc()
        payload2 = json.loads(json.dumps(payload))
        payload2["discipline"] = dst
        r = loader.load_rate_master(payload=payload2)
        self.assertEqual(r["items_total"], 1367)  # F-16 then F-17: 1382 -> 1372 -> 1364 (10 tray + 8 db_install_rate retired)  # SLICE 5: 1364 -> 1367 (three combined '1M & 2M' containers SPLIT into six single-size SKUs, the three combined ones retired by freeze-and-supersede)
        self.assertEqual(r["configs_loaded"], 12)

        def rows(d):
            return frappe.get_all(
                "BoQ Rate Master Item", filters={"discipline": d, "active": 1},
                fields=["kind", "brand", "unit", "attributes", "rates",
                        "source_sheet", "source_row", "item_uid"])

        def full(x):
            return json.dumps([x["kind"], x["brand"], x["unit"], _obj(x["attributes"]),
                               _obj(x["rates"]), x["source_sheet"], x["source_row"],
                               x["item_uid"]], sort_keys=True, separators=(",", ":"))

        a, b = rows(src), rows(dst)
        # items per kind
        self.assertEqual(collections.Counter(x["kind"] for x in a),
                         collections.Counter(x["kind"] for x in b))
        # the full tuple covers identity, rates, provenance AND item_uid in one comparison
        self.assertEqual(collections.Counter(full(x) for x in a),
                         collections.Counter(full(x) for x in b))
        self.assertEqual({x["item_uid"] for x in a}, {x["item_uid"] for x in b})
        self.assertTrue(all(x["item_uid"] for x in b), "every round-tripped row keeps a uid")

        # config blobs, deep -- discipline aside, which the loader stamps per import
        def cfgs(d):
            out = {}
            for c in frappe.get_all("BoQ Rate Category Config",
                                    filters={"discipline": d, "active": 1},
                                    fields=["category_id", "config"]):
                blob = dict(_obj(c["config"]))
                blob.pop("discipline", None)
                out[c["category_id"]] = json.dumps(blob, sort_keys=True, separators=(",", ":"))
            return out
        self.assertEqual(cfgs(src), cfgs(dst))

        # the four retirement entries survive the round trip
        self.assertEqual(retirement.get_retirement_lists(dst),
                         retirement.get_retirement_lists(src))

    def test_24h_two_consecutive_exports_are_byte_identical(self):
        """SLICE 4 -- the export is a STABLE artefact.

        Nothing in the payload is a timestamp, a batch id or a hash, and ordering is deterministic
        (kind then item_uid; category_id), so re-exporting an unchanged database must produce the
        same bytes. If it did not, every export would show a spurious diff and the file could never
        be trusted as evidence that the asset matches the DB."""
        from nirmaan_stack.services.boq_rate_master import exporter

        disc = self._new_disc()
        loader.load_rate_master(payload=self._merged_payload(disc))
        _, first = exporter.export_asset_text(disc)
        _, second = exporter.export_asset_text(disc)
        self.assertEqual(first, second)
        self.assertTrue(first.endswith("\n"))

    def test_24i_an_unknown_config_key_round_trips_untouched(self):
        """SLICE 4 NEGATIVE half -- THE BLOB-VERBATIM PROOF.

        No two configs share a key set, 15 keys have no screen control and 8 reach the AI prompt,
        so an export that enumerated known keys would silently drop the 21st the day someone added
        one -- and `_validate_config`'s allowlist has already had to widen six times. A key nothing
        in the codebase knows about must survive an export untouched."""
        from nirmaan_stack.services.boq_rate_master import exporter

        disc = self._new_disc()
        loader.load_rate_master(payload=self._merged_payload(disc))
        cfg_name = frappe.db.get_value(
            "BoQ Rate Category Config",
            {"discipline": disc, "category_id": "earthing", "active": 1}, "name")
        blob = _obj(frappe.db.get_value("BoQ Rate Category Config", cfg_name, "config"))
        blob["a_key_nothing_knows_about"] = {"nested": [1, 2, {"deep": True}], "why": "verbatim"}
        frappe.db.set_value("BoQ Rate Category Config", cfg_name, "config",
                            json.dumps(blob), update_modified=False)
        frappe.db.commit()

        payload, _ = exporter.export_asset_text(disc)
        exported = next(c for c in payload["category_configs"] if c["category_id"] == "earthing")
        self.assertIn("a_key_nothing_knows_about", exported)
        self.assertEqual(exported["a_key_nothing_knows_about"],
                         {"nested": [1, 2, {"deep": True}], "why": "verbatim"})
        # and it survives a re-import, which is the half that actually matters
        dst = self._new_disc()
        payload["discipline"] = dst
        loader.load_rate_master(payload=payload)
        stored = _obj(frappe.db.get_value(
            "BoQ Rate Category Config",
            {"discipline": dst, "category_id": "earthing", "active": 1}, "config"))
        self.assertEqual(stored["a_key_nothing_knows_about"],
                         {"nested": [1, 2, {"deep": True}], "why": "verbatim"})

    def test_24j_retirement_lists_come_from_the_table_not_a_file_header(self):
        """SLICE 4 -- retirement is read through slice 3's table, never carried forward from the
        previous asset. A discipline with no retirement rows must export two EMPTY lists: if the
        export inherited a header, a fresh discipline would claim retirements it never made."""
        from nirmaan_stack.services.boq_rate_master import exporter, retirement

        disc = self._new_disc()
        # load WITHOUT retirement declarations, so nothing is recorded
        payload_in = self._merged_payload(disc)
        payload_in["retired_kinds"] = []
        payload_in["retired_category_ids"] = []
        # F-3 (2026-08-15): blank the reasons TOO. F-19 made `retirement_reasons` a THIRD
        # retirement input, and its R3 refuses a reason naming something the payload does not
        # retire -- so emptying only the two lists left this payload self-contradictory and the
        # loader threw, correctly. Latent since F-19 and invisible only because v32, the current
        # asset until v33, carried no reasons at all.
        payload_in["retirement_reasons"] = {"kinds": {}, "categories": {}}
        loader.load_rate_master(payload=payload_in)
        out, _ = exporter.export_asset_text(disc)
        self.assertEqual(out["retired_kinds"], [])
        self.assertEqual(out["retired_category_ids"], [])

        # record one directly in the table -- the export must now surface it
        retirement.record_retirements(disc, ["ups_per_kva"], ["ups"])
        frappe.db.commit()
        out2, _ = exporter.export_asset_text(disc)
        self.assertEqual(out2["retired_kinds"], ["ups_per_kva"])
        self.assertEqual(out2["retired_category_ids"], ["ups"])

    def test_24k_a_snapshot_is_written_and_the_prune_keeps_ten(self):
        """SLICE 4 -- every export is retained, newest 10 per discipline (owner-ruled).

        Also pins that `version` is NOT reused after a prune: it is (max existing) + 1, so a
        version number identifies one snapshot for the life of the site even once its row is gone."""
        from nirmaan_stack.services.boq_rate_master import exporter

        disc = self._new_disc()
        loader.load_rate_master(payload=self._merged_payload(disc))

        versions = []
        for _ in range(12):
            payload, text = exporter.export_asset_text(disc)
            name = exporter.write_snapshot(disc, text, payload)
            versions.append(frappe.db.get_value(exporter.SNAPSHOT_DOCTYPE, name, "version"))
        frappe.db.commit()

        self.assertEqual(versions, list(range(1, 13)))          # monotonic, never reused
        kept = frappe.get_all(exporter.SNAPSHOT_DOCTYPE, filters={"discipline": disc},
                              fields=["version"], order_by="version asc")
        self.assertEqual(len(kept), exporter.KEEP_SNAPSHOTS)
        self.assertEqual([k["version"] for k in kept], list(range(3, 13)))  # 1 and 2 pruned

        newest = frappe.get_all(exporter.SNAPSHOT_DOCTYPE, filters={"discipline": disc},
                                fields=["payload", "item_count", "config_count", "taken_by",
                                        "import_batch"],
                                order_by="version desc", limit=1)[0]
        self.assertEqual(newest["item_count"], 1367)  # F-16 then F-17: 1382 -> 1372 -> 1364 (10 tray + 8 db_install_rate retired)  # SLICE 5: 1364 -> 1367 (three combined '1M & 2M' containers SPLIT into six single-size SKUs, the three combined ones retired by freeze-and-supersede)
        self.assertEqual(newest["config_count"], 12)
        self.assertTrue(newest["taken_by"])
        self.assertTrue(newest["import_batch"].startswith("rmbulk-"))
        # the payload is stored VERBATIM -- byte-for-byte what the export produced
        _, text_now = exporter.export_asset_text(disc)
        self.assertEqual(newest["payload"], text_now)

    def test_24l_the_export_endpoint_refuses_a_non_admin_and_writes_nothing(self):
        """SLICE 4 NEGATIVE half -- the endpoint is admin-gated.

        The shape is cloned from export_priced_workbook, whose gate is bare login-only; that gate
        is deliberately NOT cloned, because an export hands over the whole priced catalog. A refusal
        must also write no snapshot."""
        from nirmaan_stack.services.boq_rate_master import exporter

        disc = self._new_disc()
        loader.load_rate_master(payload=self._merged_payload(disc))
        before = frappe.db.count(exporter.SNAPSHOT_DOCTYPE, {"discipline": disc})

        original = frappe.session.user
        try:
            frappe.set_user("Guest")
            with self.assertRaises(frappe.PermissionError):
                rate_master.export_rate_master_asset(discipline=disc)
        finally:
            frappe.set_user(original)
        self.assertEqual(frappe.db.count(exporter.SNAPSHOT_DOCTYPE, {"discipline": disc}), before)

        # POSITIVE twin: as admin it returns a downloadable file AND writes exactly one snapshot
        res = rate_master.export_rate_master_asset(discipline=disc)
        self.assertEqual(res["content_type"], "application/json")
        self.assertTrue(res["filename"].endswith(".json"))
        self.assertEqual(res["item_count"], 1367)  # F-16 then F-17: 1382 -> 1372 -> 1364 (10 tray + 8 db_install_rate retired)  # SLICE 5: 1364 -> 1367 (three combined '1M & 2M' containers SPLIT into six single-size SKUs, the three combined ones retired by freeze-and-supersede)
        decoded = base64.b64decode(res["content_base64"]).decode("utf-8")
        self.assertEqual(json.loads(decoded)["discipline"], disc)
        self.assertEqual(frappe.db.count(exporter.SNAPSHOT_DOCTYPE, {"discipline": disc}), before + 1)

    # -- SLICE 5: the editable CSV download ----------------------------------------------
    # Plain-English coverage summary (test -> changed behaviour):
    #   24m  MODE A gives exactly ONE category's attribute + rate columns, and every row carries
    #        item_uid -- without which the round trip is one-way and the upload cannot tell an edit
    #        from a new item.
    #   24n  MODE B gives the UNION of every category's keys plus a `category` column, so one file
    #        covers the whole catalog. Sparse by construction.
    #   24o  a value containing a comma or a quote survives CSV quoting intact, and values are
    #        emitted AS STORED -- never reformatted to look tidier.
    #   24p  NEGATIVE: a non-admin is refused before anything is read.
    #   24q  NEGATIVE: a category with no items yields a HEADERS-ONLY template, not an error.

    def test_24m_mode_a_gives_one_categorys_columns_with_item_uid(self):
        """SLICE 5 MODE A -- narrow and directly editable.

        Columns are exactly that category's attribute and rate keys as real named columns. EVERY row
        carries item_uid: without it the upload cannot tell an edit from a new item."""
        import csv as _csv
        from nirmaan_stack.services.boq_rate_master import csv_exporter

        disc = self._new_disc()
        loader.load_rate_master(payload=self._merged_payload(disc))

        text, headers, n = csv_exporter.build_category_csv(disc, "cabletray_raceway")
        # F-16: 460 -> 450. The category used to own TWO kinds (450 cable_tray + the 10-row
        # tray_install_rate table); the table is retired, so its CSV scope shrank by exactly the
        # retired kind -- a positive signal, not merely a count edit.
        self.assertEqual(n, 450)
        self.assertEqual(headers,
                         ["item_uid", "kind", "brand", "unit",
                          "material", "thickness_mm", "tray_type", "width_mm",
                          "cover_only_list", "install_rate", "with_cover_list", "without_cover_list",
                          "source_sheet", "source_row"])
        self.assertNotIn("core", headers)          # a wiring attribute must NOT appear
        self.assertNotIn("category", headers)      # MODE A has no category column

        rows = list(_csv.reader(io.StringIO(text.lstrip(BOM))))
        self.assertEqual(rows[0], headers)
        self.assertEqual(len(rows) - 1, 450)   # F-16: 460 -> 450, same reason as the count above
        self.assertTrue(all(r[0].startswith("rmi-") for r in rows[1:]),
                        "every row must carry item_uid")

    def test_24n_mode_b_gives_the_union_plus_a_category_column(self):
        """SLICE 5 MODE B -- one file, every category, the UNION of all keys.

        Sparseness is inherent: a cable row has nothing to say about tray_type. What matters is that
        the category is EXPLICIT per row, so a reader never has to infer it from a value."""
        import csv as _csv
        from nirmaan_stack.services.boq_rate_master import csv_exporter

        disc = self._new_disc()
        loader.load_rate_master(payload=self._merged_payload(disc))

        text, headers, n = csv_exporter.build_all_categories_csv(disc)
        self.assertEqual(n, 1367)  # F-16 then F-17: 1382 -> 1372 -> 1364 (10 tray + 8 db_install_rate retired)  # SLICE 5: 1364 -> 1367 (three combined '1M & 2M' containers SPLIT into six single-size SKUs, the three combined ones retired by freeze-and-supersede)
        self.assertEqual(headers[:5], ["item_uid", "category", "kind", "brand", "unit"])
        self.assertEqual(headers[-2:], ["source_sheet", "source_row"])
        for k in ("tray_type", "core", "conduit_type", "colour", "description"):
            self.assertIn(k, headers)
        # SLICE 2b: 45 -> 48. The MCB-ladder mint gave the 106 `family: Switchgear` rows the four
        # discriminators a catalog ladder can filter on, and THREE of those names are new to the
        # union -- `device`, `amp_a`, `curve`. `pole` is NOT new: industrial_sockets already declared
        # it, which is why this is +3 rather than +4. (One consequence, logged not fixed: the single
        # `pole` column now carries two vocabularies -- "3 Pin / 2P+E" on socket rows, "FP" on
        # switchgear rows. The union has always been per-row, so this is legible, not wrong.)
        # SLICE 5: 48 -> 49, the single `modules` column (the per-SKU module width). It is a
        # DECLARED attribute -- which is the whole reason it round-trips as a NUMBER rather than a
        # string -- so it necessarily joins the Mode B union.
        self.assertEqual(len(headers), 49)

        rows = list(_csv.reader(io.StringIO(text.lstrip(BOM))))
        self.assertEqual(len(rows) - 1, 1367)  # SLICE 5: 1364 -> 1367 (three combined '1M & 2M' containers SPLIT into six single-size SKUs, the three combined ones retired by freeze-and-supersede)
        self.assertTrue(all(r[0].startswith("rmi-") for r in rows[1:]))
        cats = {r[1] for r in rows[1:]}
        self.assertIn("cabletray_raceway", cats)
        self.assertIn("wiring_cabling", cats)
        # a cable row is BLANK in the tray column -- sparse, not wrong
        ti = headers.index("tray_type")
        cable = next(r for r in rows[1:] if r[2] == "cable")
        self.assertEqual(cable[ti], "")

    def test_24o_a_comma_or_quote_survives_and_values_are_emitted_as_stored(self):
        """SLICE 5 -- CSV quoting holds, and nothing is silently 'fixed'.

        The file must round-trip what is in the DB. A value is emitted exactly as stored: a float
        stays 2.0, a string keeps its spacing, and a comma or quote is quoted rather than stripped."""
        import csv as _csv
        from nirmaan_stack.services.boq_rate_master import csv_exporter

        disc = self._new_disc()
        loader.load_rate_master(payload=self._merged_payload(disc))
        name = frappe.db.get_value("BoQ Rate Master Item",
                                   {"discipline": disc, "kind": "junction_box", "active": 1}, "name")
        nasty = 'A "quoted", comma value'
        frappe.db.set_value("BoQ Rate Master Item", name, "attributes",
                            json.dumps({"size": nasty}), update_modified=False)
        frappe.db.commit()

        text, headers, _ = csv_exporter.build_category_csv(disc, "junction_box_raceway")
        rows = list(_csv.reader(io.StringIO(text.lstrip(BOM))))
        si = headers.index("size")
        self.assertIn(nasty, [r[si] for r in rows[1:]])

        # values as stored: a float keeps its .0 rather than being prettified to an int
        text2, h2, _ = csv_exporter.build_category_csv(disc, "wiring_cabling")
        rows2 = list(_csv.reader(io.StringIO(text2.lstrip(BOM))))
        ci = h2.index("core")
        self.assertTrue(any(v.endswith(".0") for v in [r[ci] for r in rows2[1:]]),
                        "a stored float must be emitted as stored, not reformatted")

    def test_24p_the_csv_endpoint_refuses_a_non_admin(self):
        """SLICE 5 NEGATIVE -- an editable dump of the priced catalog is no less sensitive than the
        asset, so it carries the SAME admin gate, checked before anything is read."""
        disc = self._new_disc()
        loader.load_rate_master(payload=self._merged_payload(disc))
        original = frappe.session.user
        try:
            frappe.set_user("Guest")
            with self.assertRaises(frappe.PermissionError):
                rate_master.export_rate_master_csv(discipline=disc)
            with self.assertRaises(frappe.PermissionError):
                rate_master.export_rate_master_csv(discipline=disc, category_id="earthing")
        finally:
            frappe.set_user(original)

        # POSITIVE twin: as admin both modes return a decodable file
        res = rate_master.export_rate_master_csv(discipline=disc, category_id="earthing")
        self.assertEqual(res["content_type"], "text/csv")
        self.assertEqual(res["mode"], "category")
        self.assertTrue(res["filename"].endswith(".csv"))
        self.assertIn("item_uid", base64.b64decode(res["content_base64"]).decode("utf-8"))
        res_all = rate_master.export_rate_master_csv(discipline=disc)
        self.assertEqual(res_all["mode"], "all")
        # SLICE 2b: 45 -> 48, the same +3 as test_24n (device / amp_a / curve; `pole` already existed).
        # SLICE 5: 48 -> 49, the `modules` width column -- the same +1 as test_24n.
        self.assertEqual(res_all["column_count"], 49)
        self.assertEqual(res_all["row_count"], 1367)  # F-16 then F-17: 1382 -> 1372 -> 1364 (10 tray + 8 db_install_rate retired)  # SLICE 5: 1364 -> 1367 (three combined '1M & 2M' containers SPLIT into six single-size SKUs, the three combined ones retired by freeze-and-supersede)

    def test_24q_a_category_with_no_items_gives_headers_only_not_an_error(self):
        """SLICE 5 NEGATIVE -- point_wiring is kind-less and owns no rows of its own. It must yield a
        usable headers-only TEMPLATE (from the config's attribute definitions) rather than throwing,
        so a user can still add rows for it."""
        import csv as _csv
        from nirmaan_stack.services.boq_rate_master import csv_exporter

        disc = self._new_disc()
        loader.load_rate_master(payload=self._merged_payload(disc))

        text, headers, n = csv_exporter.build_category_csv(disc, "point_wiring")
        self.assertEqual(n, 0)
        rows = list(_csv.reader(io.StringIO(text.lstrip(BOM))))
        self.assertEqual(len(rows), 1, "headers only")
        self.assertEqual(rows[0], headers)
        self.assertIn("item_uid", headers)
        # the template still names the category's own attributes, from its definitions
        self.assertIn("circuit_length_m", headers)

        # and an UNKNOWN category is a named error, not an empty file
        with self.assertRaises(frappe.ValidationError):
            csv_exporter.build_category_csv(disc, "no_such_category")

    def test_25_eall_retired_scope_deactivated_on_replace(self):
        disc = self._new_disc()
        # simulate a PRIOR batch that carried UPS (now retired by the Floor BOX correction): a
        # ups_per_kva item + a ups config, both active.
        frappe.get_doc({
            "doctype": "BoQ Rate Master Item", "discipline": disc, "kind": "ups_per_kva",
            "attributes": "{}", "rates": "{}", "import_batch": "prior-eall", "active": 1,
        }).insert(ignore_permissions=True)
        frappe.get_doc({
            "doctype": "BoQ Rate Category Config", "discipline": disc, "category_id": "ups",
            "config": "{}", "import_batch": "prior-eall", "active": 1,
        }).insert(ignore_permissions=True)
        frappe.db.commit()

        # first v4 load (no replace) leaves the retired UPS rows untouched (not in the payload scope)
        loader.load_rate_master(payload=self._eall_payload(disc))
        self.assertEqual(self._active_items(disc, kind="ups_per_kva"), 1)

        # replace ALSO supersedes the retired scope
        r = loader.load_rate_master(payload=self._eall_payload(disc), replace=True)
        self.assertEqual(r["retired_kinds"], ["ups_per_kva", "ups_reference"])
        self.assertEqual(r["retired_category_ids"], ["ups"])
        self.assertGreaterEqual(r["retired_items_deactivated"], 1)
        self.assertGreaterEqual(r["retired_configs_deactivated"], 1)
        # UPS item + config now inactive (RETAINED, never deleted)
        self.assertEqual(self._active_items(disc, kind="ups_per_kva"), 0)
        self.assertEqual(
            frappe.db.count("BoQ Rate Category Config", {"discipline": disc, "category_id": "ups", "active": 1}), 0
        )
        self.assertEqual(frappe.db.count("BoQ Rate Master Item", {"discipline": disc, "kind": "ups_per_kva"}), 1)
        # and the E-ALL scope itself is freshly active
        self.assertEqual(self._active_items(disc, kind="cable_tray"), 450)

    def test_26_update_rate_config_accepts_item_kinds(self):
        # EA-1c: the config carries a top-level item_kinds (Data-tab scoping); the RM-4b whole-config
        # validator must ACCEPT it (else editing any E-ALL config's pipelines would break).
        disc = self._new_disc()
        loader.load_rate_master(payload=self._real_payload(disc))
        cfg_name = self._config_name(disc)
        cfg = self._full_config(cfg_name)
        cfg["item_kinds"] = ["cable", "termination"]
        res = rate_master.update_rate_config(name=cfg_name, config=json.dumps(cfg))
        self.assertTrue(res["ok"])
        self.assertEqual(self._full_config(cfg_name)["item_kinds"], ["cable", "termination"])

    # ---- EA-2c: the component_ref step is a first-class RM-4b vocabulary member ----
    def test_29_component_ref_config_roundtrips(self):
        disc = self._new_disc()
        loader.load_rate_master(payload=self._eall_payload(disc))
        cfg_name = frappe.db.get_value(
            "BoQ Rate Category Config", {"discipline": disc, "category_id": "earthing", "active": 1}, "name"
        )
        cfg = _obj(frappe.db.get_value("BoQ Rate Category Config", cfg_name, "config"))
        # sanity: the earthing config really carries a QUALIFIED component_ref (ref.kind + ref.attributes)
        refs = [s for p in cfg["pipelines"].values() for s in p["steps"] if s["step"] == "component_ref"]
        self.assertTrue(refs)
        self.assertEqual(refs[0]["ref"]["attributes"], {"type": "Bus bar"})
        # the RM-4b validator ACCEPTS component_ref -> the whole earthing config round-trips
        res = rate_master.update_rate_config(name=cfg_name, config=json.dumps(cfg))
        self.assertTrue(res["ok"])
        # NEGATIVE: a component_ref missing ref.kind is rejected, no write
        before = frappe.db.get_value("BoQ Rate Category Config", cfg_name, "config")
        bad = copy.deepcopy(_obj(before))  # deep copy -- _obj returns `before` itself when it is a dict
        for p in bad["pipelines"].values():
            for s in p["steps"]:
                if s["step"] == "component_ref":
                    s.pop("ref", None)
        with self.assertRaises(frappe.ValidationError):
            rate_master.update_rate_config(name=cfg_name, config=json.dumps(bad))
        self.assertEqual(frappe.db.get_value("BoQ Rate Category Config", cfg_name, "config"), before)

    # ---- EA-DIFF: the synonyms key is a first-class RM-4b pass-through ----
    def test_30_update_rate_config_accepts_synonyms(self):
        # EA-DIFF: a config may carry a top-level `synonyms` map ({attr_id: {variant: canonical}}) --
        # the extraction prompt injects it and _coerce_value maps it (defence in depth). The RM-4b
        # whole-config validator must ACCEPT it verbatim (pass-through, not structurally validated),
        # exactly like item_kinds / pipeline_labels, else editing the conduit config would break.
        disc = self._new_disc()
        loader.load_rate_master(payload=self._real_payload(disc))
        cfg_name = self._config_name(disc)
        cfg = self._full_config(cfg_name)
        cfg["synonyms"] = {"conduit_type": {"GI": "MS"}}
        res = rate_master.update_rate_config(name=cfg_name, config=json.dumps(cfg))
        self.assertTrue(res["ok"])
        self.assertEqual(self._full_config(cfg_name)["synonyms"], {"conduit_type": {"GI": "MS"}})

    # ---- EA-2: relaxed empty-pipelines validator + pass-through keys ----
    def test_27_relaxed_empty_pipelines_accepted_bad_nonempty_rejected(self):
        disc = self._new_disc()
        loader.load_rate_master(payload=self._real_payload(disc))
        cfg_name = self._config_name(disc)
        cfg = self._full_config(cfg_name)
        # (a) EA-2: an EMPTY pipelines dict is now ACCEPTED (the LMS in-system authoring path). Its
        # goldens must also empty (goldens reference pipelines).
        cfg["pipelines"] = {}
        cfg["goldens"] = []
        res = rate_master.update_rate_config(name=cfg_name, config=json.dumps(cfg))
        self.assertTrue(res["ok"])
        self.assertEqual(self._full_config(cfg_name)["pipelines"], {})
        # (b) a NON-empty but structurally BAD pipeline is STILL rejected, no write
        before = frappe.db.get_value("BoQ Rate Category Config", cfg_name, "config")
        bad = self._full_config(cfg_name)
        bad["pipelines"] = {"x": {"output": ["y"], "steps": [{"step": "quantum_flux"}]}}
        with self.assertRaises(frappe.ValidationError):
            rate_master.update_rate_config(name=cfg_name, config=json.dumps(bad))
        self.assertEqual(frappe.db.get_value("BoQ Rate Category Config", cfg_name, "config"), before)

    def test_28_pass_through_keys_and_pipeline_labels_audited(self):
        disc = self._new_disc()
        loader.load_rate_master(payload=self._real_payload(disc))
        cfg_name = self._config_name(disc)
        self.assertEqual(len(self._versions("BoQ Rate Category Config", cfg_name)), 0)
        cfg = self._full_config(cfg_name)
        # EA-2 pass-through keys: accepted by the allowlist, stored verbatim (NOT structurally
        # validated) -- exactly like item_kinds. pipeline_labels is the wiring-helper label source.
        cfg["pipeline_labels"] = {"cable_boq": "Cable — per Mtr", "termination_boq": "Termination — per Set"}
        cfg["matching_mode"] = "item_identity"
        cfg["identity_attribute_id"] = "material"
        cfg["notes"] = "authored by test"
        res = rate_master.update_rate_config(name=cfg_name, config=json.dumps(cfg))
        self.assertTrue(res["ok"])
        stored = self._full_config(cfg_name)
        self.assertEqual(stored["pipeline_labels"]["cable_boq"], "Cable — per Mtr")
        self.assertEqual(stored["matching_mode"], "item_identity")
        self.assertEqual(stored["notes"], "authored by test")
        # AUDIT: a Version doc records the config diff
        versions = self._versions("BoQ Rate Category Config", cfg_name)
        self.assertEqual(len(versions), 1)
        changed = {c[0] for c in json.loads(versions[0]["data"]).get("changed", [])}
        self.assertIn("config", changed)

    # ---- EA-4d: DB composite-decomposition + the single-item removal + the round-split fix ----
    def test_31_eall_v17_db_composite_decomposition_and_round_split(self):
        # EA-4d loads the CURRENT E-ALL asset (v17) by path. Pins: the four SINGLE-ITEM DB pipelines +
        # the family/item attrs are GONE; only the 3 build-up pipelines remain; matching_mode is now
        # composite_decomposition with a composite_slots descriptor; the lookup_or_ratio step carries the
        # SPLIT rounding (round_lookup null / round_ratio -1); the goldens are dbu1/dbu2/dbu4 (d1/d2 gone,
        # dbu4 pins the UNROUNDED table-hit 1275). Items are UNCHANGED (795; db_switchgear_item 137).
        disc = self._new_disc()
        path = os.path.join(os.path.dirname(loader.__file__), "data", "rate_master_electrical_all_v17.json")
        with open(path, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
        payload["discipline"] = disc
        r = loader.load_rate_master(payload=payload)
        self.assertEqual(r["items_total"], 795)
        self.assertEqual(r["items_by_kind"]["db_shell"], 27)
        self.assertEqual(r["items_by_kind"]["db_install_rate"], 8)
        self.assertEqual(r["items_by_kind"]["db_switchgear_item"], 137)  # items UNCHANGED -- only the config moved
        self.assertEqual(r["configs_loaded"], 12)
        cfg_name = frappe.db.get_value(
            "BoQ Rate Category Config", {"discipline": disc, "category_id": "db_switchgear", "active": 1}, "name"
        )
        cfg = _obj(frappe.db.get_value("BoQ Rate Category Config", cfg_name, "config"))
        pids = set(cfg["pipelines"].keys())
        # the 3 build-up pipelines remain; the 4 single-item pipelines are REMOVED
        self.assertEqual(pids, {"db_buildup_supply", "db_buildup_install", "db_buildup_bcs"})
        self.assertNotIn("db_boq", pids)
        self.assertNotIn("db_install_db", pids)
        self.assertNotIn("db_install_nondb", pids)
        self.assertNotIn("db_bcs", pids)
        # the single-item identity attrs are GONE; the build-up slot attrs remain
        attr_ids = {d["id"] for d in cfg["attribute_definitions"]}
        self.assertNotIn("family", attr_ids)
        self.assertNotIn("item", attr_ids)
        self.assertLessEqual({"db_shell_item", "mcb1_item", "mcb5_item", "enclosure_item"}, attr_ids)
        # the composite-decomposition mode + descriptor
        self.assertEqual(cfg.get("matching_mode"), "composite_decomposition")
        cs = cfg.get("composite_slots")
        self.assertEqual(cs["shell"]["attr"], "db_shell_item")
        self.assertEqual(cs["repeatable"]["prefix"], "mcb")
        self.assertEqual(cs["repeatable"]["count"], 5)
        self.assertEqual(cs["fixed"][0]["attr"], "enclosure_item")
        self.assertIn("curve", cfg.get("decomposition_rules", {}))
        # the lookup_or_ratio step: the SPLIT rounding (table-hit unrounded, ratio branches tens)
        lor = [s for s in cfg["pipelines"]["db_buildup_install"]["steps"] if s.get("step") == "lookup_or_ratio"]
        self.assertEqual(len(lor), 1)
        self.assertIsNone(lor[0]["round_lookup"])  # table-hit UNROUNDED (the sheet fidelity)
        self.assertEqual(lor[0]["round_ratio"], -1)  # ratio branches roundup tens
        # goldens: dbu1 fallback / dbu2 table-hit / dbu4 UNROUNDED 1275; the old d1/d2 single-item goldens are gone
        gs = {g["id"]: g for g in cfg.get("goldens", [])}
        self.assertLessEqual({"dbu1", "dbu2", "dbu4"}, set(gs))
        self.assertNotIn("d1", gs)
        self.assertNotIn("d2", gs)
        self.assertEqual(gs["dbu1"]["expect"]["db_buildup_install"]["install"], 3660)  # fallback -> tens
        self.assertEqual(gs["dbu2"]["expect"]["db_buildup_install"]["install"], 1500)  # table-hit lands on a ten
        self.assertEqual(gs["dbu4"]["expect"]["db_buildup_install"]["install"], 1275)  # TPN-6WAY table-hit UNROUNDED
        # PASS-THROUGH: the RM-4b whole-config validator ACCEPTS composite_slots + decomposition_rules
        # (new pass-through keys) AND a lookup_or_ratio step -- proven on a ROUND-TRIPPABLE config (wiring).
        wdisc = self._new_disc()
        loader.load_rate_master(payload=self._real_payload(wdisc))
        wcfg_name = self._config_name(wdisc)
        wcfg = self._full_config(wcfg_name)
        wcfg["matching_mode"] = "composite_decomposition"
        wcfg["composite_slots"] = {"shell": {"attr": "material", "values_from": {"kind": "cable", "attr": "material"}}}
        wcfg["decomposition_rules"] = {"curve": {"order": ["default_C"]}}
        some_pid = next(iter(wcfg["pipelines"]))
        wcfg["pipelines"][some_pid]["steps"].append({
            "step": "lookup_or_ratio", "result": "install",
            "lookup": {"kind": "db_install_rate", "item": "@db_shell_item", "target": "install_rate", "mult": 1.5},
            "ratio": {"of": "supply", "mult": 0.15},
            "when_shell_absent": {"attr": "db_shell_item", "equals": "None", "use": "ratio"},
            "round_lookup": None, "round_ratio": -1,
        })
        res = rate_master.update_rate_config(name=wcfg_name, config=json.dumps(wcfg))
        self.assertTrue(res["ok"])  # composite_slots / decomposition_rules / lookup_or_ratio all accepted
        stored = self._full_config(wcfg_name)
        self.assertEqual(stored.get("matching_mode"), "composite_decomposition")
        self.assertIn("composite_slots", stored)

    # ---- EA-4d: the GENERAL composite-decomposition extraction seam (config-driven, no DB-specifics) ----
    def test_32_composite_decomposition_extraction_seam(self):
        # The seam is entirely config-driven: build_slot_spec expands composite_slots (shell + the
        # repeatable group -> its enumerated slot attrs + each slot's catalog resolved via values_from),
        # and select_prompt_text routes composite_decomposition -> the decomposition prompt. NOTHING
        # db-specific is hardcoded -- a future composite inherits this by declaring the config keys.
        disc = self._new_disc()
        path = os.path.join(os.path.dirname(loader.__file__), "data", "rate_master_electrical_all_v17.json")
        with open(path, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
        payload["discipline"] = disc
        loader.load_rate_master(payload=payload)
        db_cfg = _obj(frappe.db.get_value(
            "BoQ Rate Category Config",
            {"discipline": disc, "category_id": "db_switchgear", "active": 1}, "config",
        ))
        # POSITIVE: the slot spec expands from composite_slots + resolves each slot's live catalog
        spec = extraction.build_slot_spec(db_cfg, disc)
        self.assertEqual(spec["shell"]["item_attr"], "db_shell_item")
        self.assertEqual(spec["repeatable"]["item_attrs"], [f"mcb{i}_item" for i in range(1, 6)])
        self.assertEqual(spec["repeatable"]["qty_attrs"], [f"mcb{i}_qty" for i in range(1, 6)])
        self.assertIn("63A FP MCB C CURVE", spec["repeatable"]["catalog"])  # Switchgear catalog, live
        self.assertEqual(len(spec["shell"]["catalog"]), 27)  # db_shell catalog, live
        self.assertEqual(spec["fixed"][0]["item_attr"], "enclosure_item")
        # POSITIVE: the mode routes to the decomposition prompt (its own distinctive text)
        prompt = extraction.select_prompt_text(db_cfg)
        self.assertIn("SLOT_SPEC", prompt)
        self.assertIn("decompose", prompt.lower())
        # NEGATIVE: a NON-composite config yields no slot spec and NOT the decomposition prompt
        non_composite = {"category_id": "x", "attribute_definitions": [], "pipelines": {}, "matching_mode": "attribute"}
        self.assertIsNone(extraction.build_slot_spec(non_composite, disc))
        self.assertNotIn("SLOT_SPEC", extraction.select_prompt_text(non_composite))

    # ---- point_wiring RUNS: the circuit_fit wire_specs arity pins ----
    # `_validate_config` is called DIRECTLY here (not through the wiring fixture): circuit_fit lives
    # in point_wiring, which is in the E-ALL asset, not the wiring payload these tests load.
    def _circuit_fit_config(self, wire_specs, extra_defs=()):
        """A minimal config whose only step is a circuit_fit carrying `wire_specs`."""
        defs = [
            {"id": "wire1_core", "label": "Wire 1 - cores", "type": "number"},
            {"id": "wire1_thickness_sqmm", "label": "Wire 1 - thickness", "type": "number"},
            {"id": "circuit_length_m", "label": "Length", "type": "number"},
            {"id": "conduit_type", "label": "Conduit", "type": "choice", "values": ["PVC"]},
        ] + [dict(d) for d in extra_defs]
        return {
            "discipline": "Electrical",
            "category_id": "pw_arity_probe",
            "attribute_definitions": defs,
            "pipelines": {
                "p": {
                    "output": ["supply"],
                    "steps": [
                        {
                            "step": "circuit_fit",
                            "params": {
                                "sizes": [25.0],
                                "usable": {"PVC": [0.55]},
                                "wire_specs": wire_specs,
                                "length_attr": "circuit_length_m",
                                "conduit_type_attr": "conduit_type",
                            },
                            "binds": ["fitted_size", "circuits", "conduit_qty"],
                        }
                    ],
                }
            },
        }

    def test_33_circuit_fit_wire_specs_pair_is_accepted(self):
        """The 2-tuple shape every shipped config uses must keep validating. BACKWARDS-COMPAT."""
        cfg = self._circuit_fit_config([["wire1_core", "wire1_thickness_sqmm"]])
        rate_master._validate_config(cfg)  # must not raise

    def test_34_circuit_fit_wire_specs_triple_is_accepted(self):
        """AFTER. A third wire_specs element naming a DEFINED runs attribute now validates.
        (BEFORE this slice the validator enforced an exact pair and this raised.)"""
        cfg = self._circuit_fit_config(
            [["wire1_core", "wire1_thickness_sqmm", "wire1_runs"]],
            extra_defs=[{"id": "wire1_runs", "label": "Wire 1 - runs", "type": "number"}],
        )
        rate_master._validate_config(cfg)  # must not raise

    def test_34b_circuit_fit_wire_specs_triple_with_an_UNDEFINED_runs_attr_is_rejected(self):
        """G7 / NEGATIVE. The third element is REFERENCE-GUARDED: naming an attribute that is not
        defined must be REJECTED, never silently ignored. This matters more than the usual reference
        guard because absent-means-1 at runtime -- an unguarded typo would read as 'no runs' and
        silently under-price, rather than failing."""
        cfg = self._circuit_fit_config(
            [["wire1_core", "wire1_thickness_sqmm", "wire1_ruuns"]],  # typo, and NOT defined
        )
        with self.assertRaises(frappe.ValidationError) as cm:
            rate_master._validate_config(cfg)
        self.assertIn("wire1_ruuns", str(cm.exception))

    def test_34c_rate_stage_mult_from_attr_is_validated_and_reference_guarded(self):
        """The second interpreter change, at the validator. A rate stage may bind an attribute as a
        multiplier; the id must be a non-empty string AND defined."""
        def cfg_with(stage):
            return {
                "discipline": "Electrical", "category_id": "pw_stage_probe",
                "attribute_definitions": [
                    {"id": "wire1_runs", "label": "Wire 1 - runs", "type": "number"},
                    {"id": "qty_attr", "label": "Qty", "type": "number"},
                ],
                "pipelines": {"p": {"output": ["supply"], "steps": [{
                    "step": "component_ref", "name": "w", "ref": {"kind": "cable"},
                    "target": "list_price_per_mtr", "rate_stages": [stage],
                    "qty": {"from_attr": "qty_attr"},
                }]}},
            }
        # POSITIVE: a defined attr id validates
        rate_master._validate_config(cfg_with({"mult": 0.602, "mult_from_attr": "wire1_runs", "round": "up0"}))
        # NEGATIVE: an UNDEFINED attr id is rejected by the reference guard
        with self.assertRaises(frappe.ValidationError) as cm:
            rate_master._validate_config(cfg_with({"mult": 0.602, "mult_from_attr": "nope_runs"}))
        self.assertIn("nope_runs", str(cm.exception))
        # NEGATIVE: a non-string / empty id is rejected outright
        for bad in ("", 3, []):
            with self.assertRaises(frappe.ValidationError):
                rate_master._validate_config(cfg_with({"mult": 0.602, "mult_from_attr": bad}))

    def test_35_circuit_fit_wire_specs_rejects_a_bad_arity(self):
        """NEGATIVE, both directions: a 1-element entry and a non-list entry are always invalid."""
        for bad in ([["wire1_core"]], ["wire1_core"], [[]]):
            with self.assertRaises(frappe.ValidationError):
                rate_master._validate_config(self._circuit_fit_config(bad))

    def test_36_circuit_fit_wire_specs_reference_guard_catches_a_typo(self):
        """G7. An attr id named in wire_specs that is NOT defined must be REJECTED, never silently
        ignored -- otherwise a typo'd id would read as absent at runtime."""
        cfg = self._circuit_fit_config([["wire1_core", "wire1_thicknes_sqmm"]])  # typo
        with self.assertRaises(frappe.ValidationError) as cm:
            rate_master._validate_config(cfg)
        self.assertIn("wire1_thicknes_sqmm", str(cm.exception))

    # ---- SLICE 1a: switches_sockets rebuilt as a per-component composite ----
    #
    # ROOT CAUSE these pins guard: `matching_mode: "item_identity"` routes a category to
    # prompts/boq_rate_item_identity_prompt.md, whose lines 18-21 tell the model to return null for any
    # row describing "MULTIPLE items or an assembled unit". EVERY switches_sockets production row IS an
    # assembly, so the model refused DELIBERATELY -- 48/48 attribute cells blank at confidence 0.9 --
    # while point_wiring (same run, same sheet, same model, NO matching_mode) filled 310/368. The fix is
    # the QUESTION SHAPE, not the attributes.
    #
    # These are the C1 BEFORE-pins: they assert the CURRENT behaviour and are proven green against the
    # unchanged state, then UPDATED IN THIS SAME SLICE, so the diff shows exactly what changed.

    # SLICE 1b (owner-ruled 2026-08-13): this pin now follows the ONE constant, closing the last of
    # the four "current-asset" pins that had each drifted to a different version.
    #
    # It had sat on v22 for two mints, and repointing it exposed THREE tests asserting a v22-era
    # shape that TWO OWNER RULINGS have since superseded. The assertions were UPDATED to the
    # post-ruling shape -- the tests were already wrong, and the merge changed nothing here (v29 and
    # v30 are byte-identical on both points). Each updated assertion carries an inline comment naming
    # the ruling it now encodes. FOUR tests read this pin; test_37 (routing / ownership) was
    # unaffected and passes on the current asset unchanged.
    _ASSET = CURRENT_EALL_ASSET

    def _asset_payload(self, discipline):
        path = _asset_path(self._ASSET)
        with open(path, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
        payload["discipline"] = discipline
        return payload

    def test_37_switches_sockets_routing_and_ownership(self):
        """The ROUTING pin, both directions.

        AFTER: matching_mode and identity_attribute_id are REMOVED TOGETHER (the latter is only read
        when the mode is item_identity, so leaving it would be a dangling key), which routes the
        category to the ordinary attribute prompt -- the one with NO refusal clause.
        `item_kinds` is asserted either way: it is a SEPARATE key, and switches_sockets stays the sole
        owner of switch_socket_item (point_wiring / switches_point are kind-less borrowers).
        """
        disc = self._new_disc()
        loader.load_rate_master(payload=self._asset_payload(disc))
        cfg = _obj(frappe.db.get_value(
            "BoQ Rate Category Config",
            {"discipline": disc, "category_id": "switches_sockets", "active": 1}, "config",
        ))

        self.assertIsNone(cfg.get("matching_mode"))
        self.assertIsNone(cfg.get("identity_attribute_id"))
        self.assertEqual(cfg.get("item_kinds"), ["switch_socket_item"])

        prompt = extraction.select_prompt_text(cfg)
        # NEGATIVE: the refusal clause must be GONE -- this is the whole point of the slice.
        # NB: the asset hard-wraps, so "assemblies are priced\nelsewhere" -- match within one line.
        self.assertNotIn("assemblies are priced", prompt)
        self.assertNotIn("MULTIPLE items or an assembled unit", prompt)
        # NEGATIVE: nor is it the composite-decomposition prompt.
        self.assertNotIn("SLOT_SPEC", prompt)

    def test_38_switches_sockets_attribute_shape(self):
        """The SHAPE pin.

        AFTER: six per-component slots, each a LIVE catalog choice (values_from + a `where` family
        filter, never a static list that goes stale) and each None-able with its qty disabled when None.
        The three flat attributes (family / item) are gone; only `colour` survives, joined by `back_box`.
        """
        disc = self._new_disc()
        loader.load_rate_master(payload=self._asset_payload(disc))
        cfg = _obj(frappe.db.get_value(
            "BoQ Rate Category Config",
            {"discipline": disc, "category_id": "switches_sockets", "active": 1}, "config",
        ))
        defs = {d["id"]: d for d in cfg["attribute_definitions"]}
        # SLICE 5: 12 -> 17. FOUR from the two new socket slots (R8: socket3/socket4, item + qty
        # each), and ONE from the per-SKU `modules` width fact.
        self.assertEqual(len(defs), 17)
        # NEGATIVE: the flat identity attributes are gone
        self.assertNotIn("family", defs)
        self.assertNotIn("item", defs)

        # SLICE 5 -- the WIDTH FACT is DECLARED but INVISIBLE, and both halves matter.
        # Declared: only a declared numeric type makes `csv_importer.coerce_attribute` return a
        # float, so without this the CSV round trip retypes every seeded width as a string.
        # Invisible: nobody PICKS a width -- it is a fact of the SKU, not a choice about the row --
        # so it is off the pricing panel AND off the Derivation configurator AND out of the prompt.
        self.assertEqual(defs["modules"]["type"], "number")
        self.assertIs(defs["modules"]["selector"], False)
        self.assertIs(defs["modules"]["panel"], False)

        # the ONLY blanker (1M Blanker) is filed under the Switch family -- verified against the catalog
        # SLICE 5 (R8): socket3/socket4 join the map, so the four socket slots are held to the
        # IDENTICAL shape as the original two -- a new slot that quietly differed would price wrong.
        families = {"switch_item": "Switch", "socket1_item": "Socket", "socket2_item": "Socket",
                    "socket3_item": "Socket", "socket4_item": "Socket",
                    "blank_item": "Switch", "plate_item": "Grid and Face Plates"}
        for slot, family in families.items():
            d = defs[slot]
            self.assertEqual(d["type"], "choice")
            self.assertTrue(d.get("allow_none"), f"{slot} must be None-able")
            self.assertIsNone(d.get("values"), f"{slot} must use values_from, never a static list")
            self.assertEqual(d["values_from"]["kind"], "switch_socket_item")
            self.assertEqual(d["values_from"]["where"]["family"], family)
            qty = slot.replace("_item", "_qty")
            # SLICE 1b: `blank_item` is the ONE slot that no longer disables its quantity, and the
            # asymmetry IS the BLANKER-BIND ruling (2026-08-10). The blanker is inferred from the
            # EFFECTIVE module count, never selected by extraction -- so `blank_item` stopped driving
            # the price while `blank_qty` became EDITABLE again (seeded with the computed count, and
            # arbitrated against the plate's spare capacity). A dead dropdown was therefore greying
            # out the one field that had just started to matter, on every row where extraction
            # answered "None". This asserted the PRE-ruling shape; the live shape is the absence.
            if slot == "blank_item":
                self.assertIsNone(d.get("disables_when_none"),
                                  "blank_item must NOT disable blank_qty -- BLANKER-BIND")
            else:
                self.assertIn(qty, d["disables_when_none"])
            self.assertEqual(defs[qty]["type"], "number")
            # POSITIVE: each slot resolves a NON-EMPTY catalog from the live master rows
            self.assertTrue(extraction.values_from_catalog(disc, d["values_from"]))
        # SLICE 1b corrected this: a None plate disables ONLY plate_qty. It must NOT grey out the back
        # box -- a box can exist with no face plate, and greying it made such a row unpriceable.
        # The one-way relationship is pinned in full by test_41.
        self.assertEqual(defs["plate_item"]["disables_when_none"], ["plate_qty"])

        self.assertEqual(defs["back_box"]["values"], ["Yes", "No"])
        self.assertEqual(defs["colour"]["type"], "choice")
        # SLICE 5 (B2 / R-B): a quantity default is now SLOT-PAIRED -- an object carrying the
        # default AND the item attribute it belongs to. A bare 1.0 fired on slots the row positively
        # does not carry, which produced 84 phantom quantities across the live corpus, every one of
        # them the value 1.
        self.assertEqual(
            cfg["extraction_defaults"]["switch_qty"],
            {"default": 1.0, "requires_named": "switch_item"},
        )
        # NEGATIVE: a default that is NOT a slot quantity stays a bare value -- the pairing is
        # scoped to quantities, not applied to every default.
        self.assertEqual(cfg["extraction_defaults"]["colour"], "White")
        self.assertTrue(cfg.get("extraction_none_guidance"))
        # SLICE 1b: the two assertions below said "C2: NO colour default and NO rules THIS SLICE" --
        # a SCOPE statement about C2, which later slices then superseded, not a standing rule.
        # `colour: "White"` was added to extraction_defaults on BOTH categories at v23 (recorded as
        # "S4 is NOT a rule" -- it is a default, not estimator guidance), and the S1/S2/S3 switch
        # rules landed in the same era. Asserting their absence pinned a scope boundary that had
        # already moved, so both now assert the live shape.
        self.assertEqual(cfg["extraction_defaults"]["colour"], "White")
        self.assertTrue(cfg.get("rules"))
        # RULING 4 (same era): blank_qty was REMOVED from extraction_defaults on both categories --
        # a fabricated default and a computed count must not both be live. If module_fit does not
        # run, blanks are ABSENT, not 1.
        self.assertNotIn("blank_qty", cfg["extraction_defaults"])

    def test_39_switches_sockets_goldens_live(self):
        """The GOLDEN pin, read from the LIVE production config (not a synthetic load) -- these are the
        values a live re-import must not move, and the asset-goldens trap (C7) is exactly that a
        replace=True import from an asset WITHOUT `goldens` silently drops them.

        s1 arithmetic, derived from catalog list prices x the stored rate stages, NOT from the config:
          6A 3-Pin Socket White list_price 282
          supply : 282 x 0.3625 = 102.225 -> roundup tens = 110
          install: 110 x 0.2     =  22    -> roundup tens =  30
          bcs    : 282 x 0.25    =  70.5  -> roundup tens =  80
        """
        cfg = _obj(frappe.db.get_value(
            "BoQ Rate Category Config",
            {"discipline": "Electrical", "category_id": "switches_sockets", "active": 1}, "config",
        ))
        by_id = {g["id"]: g for g in (cfg.get("goldens") or [])}
        self.assertIn("s1", by_id)
        s1 = by_id["s1"]
        # The VALUES had to read identically before and after THE REBUILD -- that was a claim about
        # the rebuild, never a claim that these prices are permanent.
        # SLICE 4 / B4 (owner ruling R7, 2026-08-19): RE-BANKED for the switch/socket rates adopted
        # with v43. Goldens are REGRESSION CANARIES (2026-08-19), re-banked mechanically.
        # supply 110 -> 120 (raw 309 x 0.3625 = 112.0125 -> tens 120); install + BCS did NOT move.
        self.assertEqual(s1["expect"]["swsock_boq"]["supply"], 120.0)
        self.assertEqual(s1["expect"]["swsock_boq"]["install"], 30.0)
        self.assertEqual(s1["expect"]["swsock_bcs"]["bcs_supply"], 80.0)
        # AFTER: re-stated as ONE socket, every other component POSITIVELY ABSENT ("None", not blank)
        self.assertEqual(s1["attrs"]["socket1_item"], "6A 3-Pin Socket")
        self.assertEqual(s1["attrs"]["socket1_qty"], 1.0)
        for absent in ("switch_item", "socket2_item", "blank_item", "plate_item"):
            self.assertEqual(s1["attrs"][absent], "None")
        self.assertNotIn("family", s1["attrs"])
        self.assertNotIn("item", s1["attrs"])

        # POSITIVE: the composite golden exists -- s1 is single-item and cannot prove a composite.
        #
        # SLICE 2 part 2 RE-MINTED ss1. The 1a golden was INCOHERENT: 7 modules of content on a 6M
        # plate that holds 6, with a blank_qty of 2 that fits at no plate size. It priced only
        # because nothing checked module coherence. It is now an 8M plate, 7 modules occupied, and
        # ONE blank -- and the blank count is COMPUTED by module_fit, not stated.
        # Values derived from CATALOG list prices x the rate stages, NOT from the config:
        #   switch 258x1 + socket1 425x1 + socket2 282x2 + blank 61x1 + plate(8M) 396x1
        #     + back box(8M) 320x1 = raw 2024
        #   2024 x0.3625 = 733.70 -> tens 740 ; 740 x0.2 = 148 -> tens 150 ;
        #   2024 x0.25   = 506.00 -> tens 510
        self.assertIn("ss1", by_id)
        ss1 = by_id["ss1"]
        # SLICE 4 / B4 (owner ruling R8, 2026-08-19): RE-BANKED for the switch/socket rates adopted
        # with v43. Goldens are REGRESSION CANARIES (2026-08-19), re-banked mechanically; the block
        # above recites the SUPERSEDED 2024-raw arithmetic and is kept as the re-mint's own record.
        # The v43 rates give: 290 + 464 + 309x2 + 70 + 446(8M plate) + 362(8M box) = raw 2250;
        #   2250 x0.3625 = 815.625 -> tens 820 ; 820 x0.2 = 164 -> tens 170 ;
        #   2250 x0.25   = 562.5   -> tens 570.
        # ⚠️ These three were MASKED last round: unittest reports only the FIRST failing assertion
        # per test, so the s1 failure above hid them. Found by an execution-independent sweep.
        self.assertEqual(ss1["expect"]["swsock_boq"]["supply"], 820.0)
        self.assertEqual(ss1["expect"]["swsock_boq"]["install"], 170.0)
        self.assertEqual(ss1["expect"]["swsock_bcs"]["bcs_supply"], 570.0)
        # the re-mint is COHERENT: an 8M plate holding the 7 modules its contents occupy, leaving 1
        self.assertEqual(ss1["attrs"]["plate_item"], "8M")
        self.assertEqual(ss1["attrs"]["blank_item"], "1M Blanker")
        # it exercises BOTH socket slots -- the shape a single-socket category cannot express
        self.assertEqual(ss1["attrs"]["socket1_item"], "6A/16A 3-Pin Socket")
        self.assertEqual(ss1["attrs"]["socket2_item"], "6A 3-Pin Socket")
        self.assertEqual(ss1["attrs"]["socket2_qty"], 2.0)

    # ---- SLICE 1b: point_wiring's blanker + the back_box dependency fix ----
    #
    # C1 BEFORE-pins: proven green against the UNCHANGED state, then updated in this same slice.

    def test_40_point_wiring_has_a_blanker(self):
        """point_wiring gains blank_item / blank_qty.

        AFTER: blank_item / blank_qty exist, None-able, bound to the LIVE catalog.
        The ONLY blanker item is `1M Blanker` and it is filed under family "Switch" -- there is no
        blanker family -- so the values_from filter is {"family": "Switch"}.
        Each of the THREE pipelines carries exactly one `none_skips` blank line, using point_wiring's
        OWN per-component UNIT rounding (never switches_sockets' tens -- the two are deliberately
        different and both sheet-faithful).
        """
        disc = self._new_disc()
        loader.load_rate_master(payload=self._asset_payload(disc))
        cfg = _obj(frappe.db.get_value(
            "BoQ Rate Category Config",
            {"discipline": disc, "category_id": "point_wiring", "active": 1}, "config",
        ))
        defs = {d["id"]: d for d in cfg["attribute_definitions"]}
        b = defs["blank_item"]
        self.assertEqual(b["type"], "choice")
        self.assertTrue(b["allow_none"])
        # SLICE 1b -- BLANKER-BIND ruling (2026-08-10). Was `["blank_qty"]`. The blanker is now
        # INFERRED from the EFFECTIVE module count and never selected by extraction, so `blank_item`
        # no longer drives the price while `blank_qty` became EDITABLE again. Leaving the disable in
        # place meant a dead dropdown greyed out the newly-live quantity on every "None" row.
        self.assertIsNone(b.get("disables_when_none"))
        self.assertIsNone(b.get("values"))                      # NEGATIVE: never a static list
        self.assertEqual(b["values_from"]["kind"], "switch_socket_item")
        self.assertEqual(b["values_from"]["where"]["family"], "Switch")
        self.assertEqual(defs["blank_qty"]["type"], "number")
        # SLICE 1b -- same ruling, second half. `blank_qty` carried an extraction default of 1.0 back
        # when the model chose the blanker; the pipeline now COMPUTES the count, so an injected
        # default would be a STATED value competing with the computation. It is correctly absent.
        self.assertNotIn("blank_qty", cfg.get("extraction_defaults") or {})
        # POSITIVE: the live catalog behind the slot resolves, and contains the one blanker
        cat = extraction.values_from_catalog(disc, b["values_from"])
        self.assertIn("1M Blanker", cat)

        # every pipeline carries exactly ONE none_skips blank line
        # v51: the roster grew by two DISPLAY-ONLY circuit pipelines. They price wire and nothing
        # else -- no plate, so no blanker -- which is why the blank-line loop below is scoped to the
        # three that assemble a point (test_pw_cs_10 pins their whole step vocabulary).
        # SLICE B (v53): the two DISPLAY-ONLY circuit pipelines are REMOVED -- the circuit money was
        # always inside the point rate and a second labelled block read as an extra charge (owner).
        # The roster is back to the three that assemble a point.
        self.assertEqual(sorted(cfg["pipelines"]),
                         ["pw_bcs", "pw_boq_install", "pw_boq_supply"])
        for pid in _PW_ASSEMBLY_PIPELINES:
            pipe = cfg["pipelines"][pid]
            blanks = [s for s in pipe["steps"]
                      if s.get("step") == "component_ref" and s.get("name") == "blank"]
            self.assertEqual(len(blanks), 1, f"{pid} must carry exactly one blank line")
            self.assertTrue(blanks[0]["none_skips"])
            self.assertEqual(blanks[0]["ref"]["family"], "Switch")
            # SLICE 1b -- BLANKER-BIND ruling, the binding half. Was `@blank_item` + a
            # `{from_attr: blank_qty}` quantity, i.e. the model picked the item AND stated the count.
            # A POSITIVE effective count now prices `1M Blanker` whatever extraction returned, and a
            # ZERO count binds the None sentinel so the line reads as deliberately absent. The item
            # therefore comes from the FIT (`@blank_fit_item`, bound like a ladder rung) and the
            # quantity from `{from_fit: blank_count}` -- the pipeline computes both.
            self.assertEqual(blanks[0]["ref"]["item"], "@blank_fit_item")
            self.assertEqual(blanks[0]["qty"], {"from_fit": "blank_count"})
            # NEGATIVE: point_wiring rounds to UNITS -- a tens roundup here would be the wrong category's
            for stage in blanks[0]["rate_stages"]:
                self.assertNotEqual(stage.get("round"), -1)
                self.assertIn(stage.get("round"), ("up0", "up-1", None))

    def test_41_back_box_is_not_disabled_by_a_none_plate(self):
        """THE 1a DEFECT, pinned both ways.

        A back box can exist with NO face plate, so the plate -> back_box relationship is ONE-WAY: a
        plate present DEFAULTS the box to yes, but a None plate must leave the box SELECTABLE. As
        shipped at 898dffe5, `plate_item.disables_when_none` listed back_box, which greys the control
        out and makes such a row UNPRICEABLE -- a wrong answer, not merely a wrong UI.

        AFTER: back_box is NOT in the list, on BOTH categories. `plate_qty` stays in it.

        BOTH carried it. switches_sockets inherited it from the 1a spec; point_wiring has had it since
        EA-4a-r, so it PREDATES 1a. The owner's ruling is physical, not category-specific -- a box can
        exist without a plate -- so both are fixed.
        """
        disc = self._new_disc()
        loader.load_rate_master(payload=self._asset_payload(disc))
        for cid, pipeline_id in (("switches_sockets", "swsock_boq"), ("point_wiring", "pw_boq_supply")):
            cfg = _obj(frappe.db.get_value(
                "BoQ Rate Category Config",
                {"discipline": disc, "category_id": cid, "active": 1}, "config",
            ))
            defs = {d["id"]: d for d in cfg["attribute_definitions"]}
            disables = defs["plate_item"]["disables_when_none"]
            self.assertNotIn("back_box", disables, f"{cid}: a None plate must NOT grey out the box")
            self.assertIn("plate_qty", disables, f"{cid}: invariant either way")
            # SLICE 1b -- the back-box RE-FIT ruling. This comment used to say the binding was "NOT
            # part of this fix ... and is slice 2"; slice 2 SHIPPED and changed it, so both the
            # comment and the assertion were stale.
            #
            # The box takes the SELECTED plate's module COUNT, re-fitted on its OWN ladder -- never
            # the plate's LABEL. The box ladder is SHORTER than the plate ladder (no 9M, no 16M), so
            # a 9M plate pairs with a 12M box and a 16M plate with an 18M box. Copying the label
            # (`@plate_item`) asked the catalog for a box that does not exist and made the WHOLE ROW
            # unpriceable -- a live defect before slice 2 part 2, and what this now guards against.
            step = next(s for s in cfg["pipelines"][pipeline_id]["steps"]
                        if s.get("step") == "component_ref" and s.get("name") == "back_box")
            self.assertEqual(step["ref"]["item"], "@box_item")

    def test_42_point_wiring_goldens_hold(self):
        """pw1 and pw2 must be UNMOVED: both state a 3M plate with 3 modules occupied, so their blank
        count is 0 AND they carry blank_item "None", which none_skips zeroes before the quantity is
        ever read -- nothing may shift them.
        pw2's install is FRACTIONAL (722.2) by design -- it pins the per-stage rounding and must not
        be rounded.
        pw3 is DIFFERENT and deliberately so: slice 2 part 2 COMPLETED it. A 3M plate with 1 module
        occupied leaves 2 empty, so it now carries a REAL Grey 1M Blanker at the COMPUTED count of 2
        and its totals MOVED -- two real blankers cost money. Its install line is what pins the
        0.0725 blanker factor at a non-zero quantity."""
        cfg = _obj(frappe.db.get_value(
            "BoQ Rate Category Config",
            {"discipline": "Electrical", "category_id": "point_wiring", "active": 1}, "config",
        ))
        by_id = {g["id"]: g for g in (cfg.get("goldens") or [])}
        # pw4 (RULING 1, 2026-08-09) joins them: the ZERO-MODULE light point that pins the back-box
        # fallback. It is asserted in full by test_72b; here it only has to be PRESENT, because this
        # list is exhaustive on purpose -- a golden appearing or vanishing unnoticed is the failure
        # this line exists to catch, and it caught pw4 exactly as intended.
        # pw5 (PW-CIRCUIT-STRETCH, 2026-09-02) joins them: the CHARGED row, and the only golden that
        # exercises the circuit components at a non-zero quantity. It is asserted in full by
        # test_pw_cs_13, which re-derives it from the catalog rather than from our own interpreter;
        # here it only has to be PRESENT. ⚠️ pw1-pw4's THREE VALUES BELOW ARE UNCHANGED BY THAT
        # SLICE, and that is its regression proof -- they carry no circuit wiring, so `none_skips`
        # zeroes both circuit lines and the flat add is 0.
        self.assertEqual(sorted(by_id), ["pw1", "pw2", "pw3", "pw4", "pw5"])
        self.assertEqual(by_id["pw1"]["expect"]["pw_boq_supply"]["supply"], 1869.0)
        self.assertEqual(by_id["pw1"]["expect"]["pw_boq_install"]["install"], 735.0)
        self.assertEqual(by_id["pw1"]["expect"]["pw_bcs"]["bcs_supply"], 1370.0)
        self.assertEqual(by_id["pw2"]["expect"]["pw_boq_supply"]["supply"], 1823.0)
        self.assertEqual(by_id["pw2"]["expect"]["pw_boq_install"]["install"], 722.2)
        self.assertEqual(by_id["pw2"]["expect"]["pw_bcs"]["bcs_supply"], 1342.0)
        # pw3 (slice 2 part 2): 1682 + the blanker line. Grey 1M Blanker list 79, computed count 2:
        #   supply : ceil(79 x 0.3625) = 29 x2 = 58 -> 1682 + 58 = 1740
        #   install: 735 - ceil(514 x 0.0725)=38 + ceil(79 x 0.0725)=6 x2 = 12 -> 709
        #   bcs    : 1370 - ceil(514 x 0.25)=129 + ceil(79 x 0.25)=20 x2 = 40 -> 1281
        self.assertEqual(by_id["pw3"]["expect"]["pw_boq_supply"]["supply"], 1740.0)
        self.assertEqual(by_id["pw3"]["expect"]["pw_boq_install"]["install"], 709.0)
        self.assertEqual(by_id["pw3"]["expect"]["pw_bcs"]["bcs_supply"], 1281.0)
        # pw1/pw2 carry the blanker as a POSITIVE ABSENCE, so their line contributes zero and their
        # totals above are unmoved. A golden's attrs are an ATOMIC SET.
        for gid in ("pw1", "pw2"):
            self.assertEqual(by_id[gid]["attrs"]["blank_item"], "None")
            self.assertEqual(by_id[gid]["attrs"]["blank_qty"], 0.0)
        # pw3 carries a REAL blanker -- the one golden that proves a non-zero blank line prices
        self.assertEqual(by_id["pw3"]["attrs"]["blank_item"], "1M Blanker")
        self.assertEqual(by_id["pw3"]["attrs"]["blank_qty"], 2.0)

        # switches_sockets must be UNMOVED by the back_box dependency fix (it touches no pricing input)
        ss = _obj(frappe.db.get_value(
            "BoQ Rate Category Config",
            {"discipline": "Electrical", "category_id": "switches_sockets", "active": 1}, "config",
        ))
        ssg = {g["id"]: g for g in ss["goldens"]}
        # SLICE 4 / B4 (owner ruling R7, 2026-08-19): these four were "UNMOVED by the back_box fix"
        # cross-checks -- a claim about THAT slice's blast radius, not about the prices themselves.
        # RE-BANKED for the v43 switch/socket rates; goldens are REGRESSION CANARIES (2026-08-19).
        # s1 supply 110 -> 120 (BCS unmoved); ss1 740/150/510 -> 820/170/570 (raw sum 2024 -> 2250).
        self.assertEqual(ssg["s1"]["expect"]["swsock_boq"], {"supply": 120.0, "install": 30.0})
        self.assertEqual(ssg["s1"]["expect"]["swsock_bcs"], {"bcs_supply": 80.0})
        # ss1 was RE-MINTED coherent by slice 2 part 2 (8M plate, 7 occupied, 1 computed blank)
        self.assertEqual(ssg["ss1"]["expect"]["swsock_boq"], {"supply": 820.0, "install": 170.0})
        self.assertEqual(ssg["ss1"]["expect"]["swsock_bcs"], {"bcs_supply": 570.0})

    # ---- SLICE 2 part 1: the STEP-VOCABULARY PIN (C5) ----
    #
    # The pure interpreter (frontend ratePipelineInterpreter.ts) and THIS validator must agree on
    # exactly one step vocabulary. A step the interpreter executes but the validator rejects is
    # UNSAVABLE through RM-4b; a step the validator accepts but the interpreter cannot execute is a
    # silent `unsupported` at runtime. That pairing has already bitten twice (the circuit_fit triple,
    # the wire_specs length check), so BOTH sides are pinned and are only ever changed together.
    # The mirror pin lives in ratePipelineInterpreter.test.ts ("step vocabulary pin").

    def test_43_known_step_types_are_exactly_the_declared_vocabulary(self):
        """The server half of the vocabulary pin."""
        self.assertEqual(
            rate_master._KNOWN_STEP_TYPES,
            {
                "match_master_row",
                "apply_effective_multiplier",
                "scale",
                "roundup",
                "component",
                "component_ref",
                "component_band",
                "sum_components",
                "install_as_ratio",
                "circuit_fit",
                "lookup_or_ratio",
                # SLICE 2. This pin was proven green at 11 types against the unchanged
                # validator, THEN both sides were extended together in one commit.
                "module_fit",
                # SLICE 2b. Same discipline again: green at 13 types against the unchanged validator,
                # then interpreter + validator extended together in one commit. `map_attribute` is the
                # CONVERSION primitive (pin count -> pole here, F-10's SWG -> mm next); `catalog_fit`
                # is `module_fit`'s ladder half generalised, so slice 3's tray width rides the same
                # step. Both are PASS-THROUGH here -- the pure interpreter's Option-C degrades a
                # malformed shape to the honest `unsupported`.
                "map_attribute",
                "catalog_fit",
                # CIRCUIT LENGTH part 1. Same discipline: green at 12 types against the
                # unchanged validator, then interpreter + validator extended together in one commit.
                "derive_attribute",
            },
        )

    def test_44_a_type_outside_the_vocabulary_is_rejected(self):
        """NEGATIVE. An undeclared step type must be refused by name, with NO write."""
        cfg = {
            "discipline": "Electrical", "category_id": "vocab_probe",
            "attribute_definitions": [{"id": "q", "label": "Q", "type": "number"}],
            "pipelines": {"p": {"output": ["supply"], "steps": [{"step": "quantum_flux"}]}},
        }
        with self.assertRaises(frappe.ValidationError) as cm:
            rate_master._validate_config(cfg)
        self.assertIn("quantum_flux", str(cm.exception))

    # ---- SLICE 2 part 1: module_fit VALIDATION ----
    #
    # C3: a step the interpreter understands but the validator rejects is UNSAVABLE, so module_fit is
    # fully validated here and every attribute id it names is REFERENCE-GUARDED. That guard matters
    # more than usual: a typo'd id no-computes SILENTLY at runtime (the step refuses the whole row
    # rather than erroring), so without the guard a one-character mistake would blank a category's
    # prices with nothing to point at.

    def _module_fit_config(self, step_params, extra_defs=None):
        defs = [
            {"id": "socket1_qty", "label": "Socket 1 qty", "type": "number"},
            {"id": "socket2_qty", "label": "Socket 2 qty", "type": "number"},
            {"id": "switch_qty", "label": "Switch qty", "type": "number"},
            {"id": "socket1_item", "label": "Socket 1", "type": "choice", "values": ["6A 3-Pin Socket"]},
            {"id": "plate_item", "label": "Plate", "type": "choice", "values": ["6M", "8M"]},
        ]
        return {
            "discipline": "Electrical", "category_id": "module_fit_probe",
            "attribute_definitions": defs + (extra_defs or []),
            "pipelines": {"p": {"output": ["supply"], "steps": [
                {"step": "module_fit", "params": step_params},
            ]}},
        }

    _MF_LADDERS = [
        {"kind": "switch_socket_item", "where": {"family": "Grid and Face Plates"},
         "bind": "plate_size", "bind_modules": "plate_modules"},
        {"kind": "switch_socket_item", "where": {"family": "Back Box"}, "bind": "box_size"},
    ]
    _MF_TERMS = [
        {"attr": "socket1_qty", "weight": 2, "none_when": "socket1_item"},
        {"attr": "socket2_qty", "weight": 2},
        {"attr": "switch_qty", "weight": 1},
    ]

    def test_45_module_fit_valid_shape_is_accepted(self):
        """POSITIVE. The real shape -- a parameterised weighted sum + TWO catalog ladders + blanks."""
        cfg = self._module_fit_config({
            "terms": self._MF_TERMS,
            "ladders": self._MF_LADDERS,
            "blanks": {"bind": "blank_count", "from_ladder": "plate_size", "stated_attr": "plate_item"},
        })
        rate_master._validate_config(cfg)  # must not raise

    def test_46_module_fit_term_attrs_are_reference_guarded(self):
        """NEGATIVE, both attribute channels. A term's `attr` and its `none_when` must be DEFINED --
        an undefined id would silently no-compute every row instead of failing at save."""
        for bad_terms, needle in (
            ([{"attr": "socket1_qtyy", "weight": 2}], "socket1_qtyy"),                      # typo'd attr
            ([{"attr": "switch_qty", "weight": 1, "none_when": "switch_itemm"}], "switch_itemm"),  # typo'd none_when
        ):
            cfg = self._module_fit_config({"terms": bad_terms, "ladders": self._MF_LADDERS})
            with self.assertRaises(frappe.ValidationError) as cm:
                rate_master._validate_config(cfg)
            self.assertIn(needle, str(cm.exception))

    def test_47_module_fit_blanks_stated_attr_is_reference_guarded(self):
        """NEGATIVE. blanks.stated_attr names an attribute too, so it is guarded identically."""
        cfg = self._module_fit_config({
            "terms": self._MF_TERMS, "ladders": self._MF_LADDERS,
            "blanks": {"bind": "blank_count", "from_ladder": "plate_size", "stated_attr": "plate_itemm"},
        })
        with self.assertRaises(frappe.ValidationError) as cm:
            rate_master._validate_config(cfg)
        self.assertIn("plate_itemm", str(cm.exception))


    # ---- BLANKER ITEM BIND: the blanks block's three new keys ----
    # The blanker is no longer selected by extraction. `module_fit` publishes its ITEM through the
    # same fitLabels scope a ladder publishes its fitted rung into, so the blank component's ref stays
    # an ordinary "@"-reference and nothing shared changes. The validator has to guard the two
    # channels that can silently misfire: an attribute id (`qty_attr`) and the bind/label PAIR.

    _MF_BLANKS_BOUND = {
        "bind": "blank_count", "from_ladder": "plate_size",
        "qty_attr": "blank_qty", "bind_item": "blank_fit_item", "item_when_positive": "1M Blanker",
    }
    _MF_BLANK_QTY_DEF = [{"id": "blank_qty", "label": "Blank qty", "type": "number"}]

    def test_87_module_fit_blanks_item_bind_shape_is_accepted(self):
        """POSITIVE. The shipped shape: an arbitrated quantity attribute plus the item bind pair."""
        cfg = self._module_fit_config(
            {"terms": self._MF_TERMS, "ladders": self._MF_LADDERS, "blanks": self._MF_BLANKS_BOUND},
            extra_defs=self._MF_BLANK_QTY_DEF,
        )
        rate_master._validate_config(cfg)  # must not raise

    def test_88_module_fit_blanks_qty_attr_is_reference_guarded(self):
        """NEGATIVE, and the load-bearing guard. `qty_attr` names an ATTRIBUTE, so a typo would stop
        the step ever finding a stated count to arbitrate on -- the row would price the computed spare
        forever and nothing would say so. That is quieter than a no-compute and worse, exactly the
        reasoning derive_attribute's `result_attr` carries."""
        blanks = dict(self._MF_BLANKS_BOUND, qty_attr="blank_qtyy")
        cfg = self._module_fit_config(
            {"terms": self._MF_TERMS, "ladders": self._MF_LADDERS, "blanks": blanks},
            extra_defs=self._MF_BLANK_QTY_DEF,
        )
        with self.assertRaises(frappe.ValidationError) as cm:
            rate_master._validate_config(cfg)
        self.assertIn("blank_qtyy", str(cm.exception))

    def test_89_bind_item_and_item_when_positive_are_required_together(self):
        """NEGATIVE, both directions. `bind_item` alone has nothing to bind on a positive count (the
        interpreter refuses the row rather than silently pricing zero); `item_when_positive` alone is
        dead config that reads as though it does something. Neither may be saved."""
        for drop in ("item_when_positive", "bind_item"):
            blanks = {k: v for k, v in self._MF_BLANKS_BOUND.items() if k != drop}
            cfg = self._module_fit_config(
                {"terms": self._MF_TERMS, "ladders": self._MF_LADDERS, "blanks": blanks},
                extra_defs=self._MF_BLANK_QTY_DEF,
            )
            with self.assertRaises(frappe.ValidationError) as cm:
                rate_master._validate_config(cfg)
            self.assertIn("together", str(cm.exception))

    def test_90_bind_item_and_item_when_positive_must_be_non_empty_strings(self):
        """NEGATIVE. `bind_item` is a fitLabels KEY (not an attribute id, so NOT reference-guarded --
        exactly like a ladder's `bind`) and `item_when_positive` is a catalog item NAME; both must
        still be real strings rather than blanks or numbers."""
        for key, bad in (("bind_item", ""), ("item_when_positive", ""), ("bind_item", 7)):
            blanks = dict(self._MF_BLANKS_BOUND, **{key: bad})
            cfg = self._module_fit_config(
                {"terms": self._MF_TERMS, "ladders": self._MF_LADDERS, "blanks": blanks},
                extra_defs=self._MF_BLANK_QTY_DEF,
            )
            with self.assertRaises(frappe.ValidationError) as cm:
                rate_master._validate_config(cfg)
            self.assertIn(key, str(cm.exception))

    def test_91_a_blanks_block_without_the_new_keys_is_still_accepted(self):
        """BACKWARDS-COMPAT. Every pre-existing config carries a bare {bind, from_ladder} blanks block
        and must keep saving unchanged -- the three keys are OPTIONAL, and a config without them binds
        no item and arbitrates nothing (the interpreter is byte-identical on that path)."""
        cfg = self._module_fit_config({
            "terms": self._MF_TERMS, "ladders": self._MF_LADDERS,
            "blanks": {"bind": "blank_count", "from_ladder": "plate_size"},
        })
        rate_master._validate_config(cfg)  # must not raise

    def test_92_the_shipped_asset_validates_end_to_end(self):
        """POSITIVE, over the REAL asset rather than a probe. Every category in the shipped E-ALL
        payload must pass the validator -- the loader does NOT validate, so this suite is the only
        place an un-savable config is caught before it reaches the editor.

        Reads CURRENT_EALL_ASSET (was an inline v29 path -- one of the three "current" pins that
        had each drifted to a different version). The name is version-free for the same reason."""
        import json as _json
        with open(_asset_path(CURRENT_EALL_ASSET), encoding="utf-8") as fh:
            payload = _json.load(fh)
        goldens = payload.get("goldens") or {}
        for cfg in payload["category_configs"]:
            c = dict(cfg)
            c["discipline"] = "Electrical"
            if c["category_id"] in goldens:
                c["goldens"] = goldens[c["category_id"]]
            rate_master._validate_config(c)  # must not raise, for any category
        # and the two changed categories really do carry the bind (a guard against a silent re-mint)
        by_id = {c["category_id"]: c for c in payload["category_configs"]}
        for cid in ("switches_sockets", "point_wiring"):
            for pid, pl in by_id[cid]["pipelines"].items():
                # v51: point_wiring's two DISPLAY-ONLY circuit pipelines price wire and nothing
                # else -- they carry no module_fit BY DESIGN (test_pw_cs_10 pins their whole step
                # vocabulary). Skipping them here keeps this guard about the pipelines that fit
                # modules, which is what it was written to protect.
                if cid == "point_wiring" and pid not in _PW_ASSEMBLY_PIPELINES:
                    continue
                mf = [s for s in pl["steps"] if s.get("step") == "module_fit"]
                self.assertTrue(mf, f"{cid}.{pid} lost its module_fit")
                blanks = mf[0]["params"]["blanks"]
                self.assertEqual(blanks["item_when_positive"], "1M Blanker")
                self.assertEqual(blanks["bind_item"], "blank_fit_item")
                self.assertEqual(blanks["qty_attr"], "blank_qty")
                blank = [s for s in pl["steps"] if s.get("name") == "blank"][0]
                # the ref reads the BOUND item, never the row's own blank_item, and never a literal
                self.assertEqual(blank["ref"]["item"], "@blank_fit_item")
                self.assertEqual(blank["ref"]["colour"], "@colour")

    def test_48_module_fit_blanks_from_ladder_must_name_a_declared_ladder(self):
        """NEGATIVE. A blank count keyed to a ladder that does not exist computes nothing; catch it at
        save rather than as a silent runtime no-compute."""
        cfg = self._module_fit_config({
            "terms": self._MF_TERMS, "ladders": self._MF_LADDERS,
            "blanks": {"bind": "blank_count", "from_ladder": "nope_size"},
        })
        with self.assertRaises(frappe.ValidationError) as cm:
            rate_master._validate_config(cfg)
        self.assertIn("nope_size", str(cm.exception))

    def test_49_module_fit_structural_negatives(self):
        """NEGATIVE, the shape itself: empty/absent terms or ladders, a non-finite weight, a ladder
        missing kind/bind, a duplicate bind, and a range-predicate `where`."""
        L = self._MF_LADDERS
        T = self._MF_TERMS
        for params in (
            {"ladders": L},                                                   # no terms at all
            {"terms": [], "ladders": L},                                      # empty terms
            {"terms": T},                                                     # no ladders at all
            {"terms": T, "ladders": []},                                      # empty ladders
            {"terms": [{"attr": "switch_qty"}], "ladders": L},                # weight missing
            {"terms": [{"attr": "switch_qty", "weight": "two"}], "ladders": L},   # weight not a number
            {"terms": [{"attr": "switch_qty", "weight": float("inf")}], "ladders": L},  # non-finite
            {"terms": [{"weight": 1}], "ladders": L},                         # attr missing
            {"terms": T, "ladders": [{"kind": "switch_socket_item"}]},        # bind missing
            {"terms": T, "ladders": [{"bind": "plate_size"}]},                # kind missing
            {"terms": T, "ladders": [                                          # duplicate bind
                {"kind": "switch_socket_item", "bind": "plate_size"},
                {"kind": "switch_socket_item", "bind": "plate_size"},
            ]},
            {"terms": T, "ladders": [                                          # range predicate in where
                {"kind": "switch_socket_item", "bind": "plate_size", "where": {"family": {"in": ["a"]}}},
            ]},
            {"terms": T, "ladders": L, "blanks": {"bind": "b"}},              # blanks without from_ladder
        ):
            with self.assertRaises(frappe.ValidationError):
                rate_master._validate_config(self._module_fit_config(params))

    def test_50_module_fit_ladder_carries_no_size_list_to_drift(self):
        """THE LADDER COMES FROM THE CATALOG, NOT PARAMS. A ladder spec declares a kind + a `where`
        family and NOTHING resembling a size array -- there is deliberately no such key to validate,
        which is what makes a retired or added plate size flow through with no config edit."""
        cfg = self._module_fit_config({"terms": self._MF_TERMS, "ladders": self._MF_LADDERS})
        rate_master._validate_config(cfg)
        for lad in cfg["pipelines"]["p"]["steps"][0]["params"]["ladders"]:
            self.assertNotIn("sizes", lad)
            self.assertEqual(set(lad) - {"kind", "where", "bind", "bind_modules", "label_attr"}, set())

    # ---- SLICE 2 part 2 / CP0: floor_from + on_none validation ----
    #
    # `floor_from` names an ATTRIBUTE, so it is reference-guarded like every other attribute id. That
    # guard is load-bearing here beyond the usual reason: a typo'd floor_from reads as "nothing
    # stated", which lets the COMPUTED size override a STATED plate -- the one thing the owner's
    # rule forbids. A silent typo would invert the rule rather than merely blank a row.

    def test_51_module_fit_floor_from_and_on_none_are_accepted(self):
        """POSITIVE. The real slice-2-part-2 shape: a plate ladder that defers to the stated plate
        and stays absent on None, plus a box ladder that defers to the same attribute but falls back
        to the computed count (a back box can exist with no face plate)."""
        cfg = self._module_fit_config({
            "terms": self._MF_TERMS,
            "ladders": [
                {"kind": "switch_socket_item", "where": {"family": "Grid and Face Plates"},
                 "bind": "plate_item", "floor_from": "plate_item", "on_none": "none"},
                {"kind": "switch_socket_item", "where": {"family": "Back Box"},
                 "bind": "box_item", "floor_from": "plate_item", "on_none": "computed"},
            ],
            "blanks": {"bind": "blank_count", "from_ladder": "plate_item"},
        })
        rate_master._validate_config(cfg)  # must not raise

    def test_52_module_fit_floor_from_is_reference_guarded(self):
        """NEGATIVE. An UNDEFINED floor_from attribute must be rejected -- unguarded, a typo would
        silently read as 'nothing stated' and let a computed size override a stated plate."""
        cfg = self._module_fit_config({
            "terms": self._MF_TERMS,
            "ladders": [{"kind": "switch_socket_item", "bind": "plate_item", "floor_from": "plate_itemm"}],
        })
        with self.assertRaises(frappe.ValidationError) as cm:
            rate_master._validate_config(cfg)
        self.assertIn("plate_itemm", str(cm.exception))

    def test_53_module_fit_floor_from_and_on_none_negatives(self):
        """NEGATIVE, both keys: a blank/non-string floor_from, and an on_none outside its two values."""
        for lad in (
            {"kind": "switch_socket_item", "bind": "b", "floor_from": ""},
            {"kind": "switch_socket_item", "bind": "b", "floor_from": 7},
            {"kind": "switch_socket_item", "bind": "b", "floor_from": "plate_item", "on_none": "maybe"},
            {"kind": "switch_socket_item", "bind": "b", "floor_from": "plate_item", "on_none": True},
        ):
            with self.assertRaises(frappe.ValidationError):
                rate_master._validate_config(
                    self._module_fit_config({"terms": self._MF_TERMS, "ladders": [lad]})
                )

    def test_54_module_fit_floor_from_and_on_none_are_optional(self):
        """BACKWARDS-COMPAT. The slice-2-part-1 shape, carrying NEITHER key, must keep validating --
        absent means the computed count always, byte-identical to part 1."""
        cfg = self._module_fit_config({"terms": self._MF_TERMS, "ladders": self._MF_LADDERS})
        rate_master._validate_config(cfg)  # must not raise
        for lad in cfg["pipelines"]["p"]["steps"][0]["params"]["ladders"]:
            self.assertNotIn("floor_from", lad)
            self.assertNotIn("on_none", lad)

    # ---- BLANKER SLICE / item 2: the blanker COLOUR + UNIQUENESS pins (P3, P4) ----
    #
    # The blank component already binds `colour: "@colour"`, so the blanker follows the assembly and
    # a Grey assembly is priced at the Grey blanker (79) rather than the White one (61). That worked
    # before this slice but NOTHING pinned it. P1/P2 pin the PRICE PATH in the interpreter suite;
    # these two pin the SHIPPED CONFIG and the CATALOG, read from the LIVE production rows -- the
    # same live-config pattern test_39 / test_42 use.

    _BLANKER_CATEGORIES = ("switches_sockets", "point_wiring")

    def _live_config(self, category_id):
        return _obj(frappe.db.get_value(
            "BoQ Rate Category Config",
            {"discipline": "Electrical", "category_id": category_id, "active": 1}, "config",
        ))

    def test_57_blank_ref_binds_colour_and_never_hardcodes_it(self):
        """P3, THE GUARD THAT MATTERS. On BOTH categories and EVERY pipeline, the blank ref must bind
        the colour to the ATTRIBUTE (@colour), never to a literal. A hardcoded colour does NOT fail at
        runtime -- it silently prices a Grey assembly at the White blanker (proven by the matching
        negative test in ratePipelineInterpreter.test.ts), so only a pin catches it."""
        seen = 0
        for cid in self._BLANKER_CATEGORIES:
            cfg = self._live_config(cid)
            for pid, pl in (cfg.get("pipelines") or {}).items():
                for step in pl.get("steps") or []:
                    if step.get("name") != "blank":
                        continue
                    seen += 1
                    where = "%s/%s" % (cid, pid)
                    ref = step.get("ref") or {}
                    self.assertEqual(ref.get("colour"), "@colour", where)
                    # SUPERSEDED BY THE ITEM BIND (owner ruling R1). This asserted "@blank_item" --
                    # the row's own extracted value -- until the blanker stopped being SELECTED by
                    # extraction. It is now bound by module_fit from the EFFECTIVE count, so the ref
                    # reads the BIND. The assertion is kept (not deleted) and re-pointed, because what
                    # it guards is unchanged: this line must reference something, and which something
                    # decides whether a Grey assembly prices the Grey blanker.
                    self.assertEqual(ref.get("item"), "@blank_fit_item", where)
                    # ...and it must NEVER become a literal. `none_skips` tests the "@" prefix FIRST,
                    # so a literal is taken as a CATALOG MATCH KEY: a literal "None" matches no row and
                    # returns a WHOLE-PIPELINE no_match -- the entire row unpriceable, wire and conduit
                    # included. That is the obvious implementation, and it is wrong.
                    self.assertTrue(str(ref.get("item")).startswith("@"), where)
                    self.assertEqual(ref.get("family"), "Switch", where)
                    self.assertEqual(ref.get("kind"), "switch_socket_item", where)
                    # the COMPUTED count always wins -- the line never reads a stated quantity
                    self.assertEqual(step.get("qty"), {"from_fit": "blank_count"}, where)
        # 2 switches_sockets pipelines + 3 point_wiring pipelines; a DROPPED blank line fails here too
        self.assertEqual(seen, 5)

    def test_58_the_blanker_is_the_only_blanker_in_the_catalog(self):
        """P4. `1M Blanker` is the ONLY blanker in the active master, so blank_item never needs
        choosing -- which is what makes the COLOUR the only free variable on that line. Pinned
        structurally over the LIVE catalog, never asserted as a hardcoded constant."""
        rows = frappe.db.sql(
            """SELECT attributes, rates FROM "tabBoQ Rate Master Item"
               WHERE active = 1 AND discipline = %s AND kind = %s""",
            ("Electrical", "switch_socket_item"),
        )
        blankers = {}
        families = set()
        for attrs, rates in rows:
            a = _obj(attrs) or {}
            if "blank" in str(a.get("item", "")).lower():
                blankers[(a.get("item"), a.get("colour"))] = (_obj(rates) or {}).get("list_price")
                families.add(a.get("family"))
        # exactly ONE distinct blanker item...
        self.assertEqual({item for item, _ in blankers}, {"1M Blanker"})
        # ...in exactly the two assembly colours, at DIFFERENT prices (so the colour is load-bearing)
        self.assertEqual({colour for _, colour in blankers}, {"White", "Grey"})
        white = blankers[("1M Blanker", "White")]
        grey = blankers[("1M Blanker", "Grey")]
        self.assertNotEqual(white, grey)
        self.assertGreater(grey, white)
        # it lives under family "Switch" -- there is NO blanker family
        # (invariant: .claude/context/domain/boq-rate-master.md)
        self.assertEqual(families, {"Switch"})

    # ---- CP2: the NUMERIC DROPDOWN attribute type (`number_choice`) ----
    # A dropdown affordance with a NUMERIC match key. It exists because item matching is strict
    # identity, so a dropdown over a numeric catalog column must not emit the string "3" against a
    # stored 3. `_validate_config` is called DIRECTLY (the type lives in the E-ALL asset's
    # point_wiring, not the wiring payload the fixture loads).
    def _number_choice_config(self, core_def, extra_defs=(), wire_specs=None):
        """A minimal config whose circuit_fit references the (possibly number_choice) core attr."""
        defs = [
            dict(core_def),
            {"id": "wire1_thickness_sqmm", "label": "Wire 1 - thickness", "type": "number"},
            {"id": "circuit_length_m", "label": "Length", "type": "number"},
            {"id": "conduit_type", "label": "Conduit", "type": "choice", "values": ["PVC"]},
        ] + [dict(d) for d in extra_defs]
        return {
            "discipline": "Electrical",
            "category_id": "cp2_number_choice_probe",
            "attribute_definitions": defs,
            "pipelines": {
                "p": {
                    "output": ["supply"],
                    "steps": [
                        {
                            "step": "circuit_fit",
                            "params": {
                                "sizes": [25.0],
                                "usable": {"PVC": [0.55]},
                                "wire_specs": wire_specs or [["wire1_core", "wire1_thickness_sqmm"]],
                                "length_attr": "circuit_length_m",
                                "conduit_type_attr": "conduit_type",
                            },
                            "binds": ["fitted_size", "circuits", "conduit_qty"],
                        }
                    ],
                }
            },
        }

    def test_59_number_choice_with_values_from_is_accepted(self):
        """POSITIVE. The new type validates, resolving its options from the live catalog exactly as a
        choice does (point_wiring's cores/thicknesses are keyed COPPER/UNARMOURED)."""
        cfg = self._number_choice_config({
            "id": "wire1_core",
            "label": "Wire 1 - runs (Core)",
            "type": "number_choice",
            "values_from": {
                "kind": "cable",
                "attr": "core",
                "where": {"material": "COPPER", "insulation": "UNARMOURED"},
            },
        })
        rate_master._validate_config(cfg)  # must not raise

    def test_59b_number_choice_with_a_static_values_list_is_accepted(self):
        """POSITIVE. A static values list is equally valid -- values_from is an alternative, not a
        requirement."""
        cfg = self._number_choice_config({
            "id": "wire1_core", "label": "Wire 1 - cores", "type": "number_choice",
            "values": [1, 2, 3, 4, 5, 6],
        })
        rate_master._validate_config(cfg)  # must not raise

    def test_60_number_choice_with_no_values_source_is_rejected(self):
        """NEGATIVE. A dropdown with neither `values` nor `values_from` would render EMPTY and price
        nothing -- the same requirement `choice` already carries, and the message names the type."""
        cfg = self._number_choice_config({
            "id": "wire1_core", "label": "Wire 1 - cores", "type": "number_choice",
        })
        with self.assertRaises(frappe.ValidationError) as cm:
            rate_master._validate_config(cfg)
        self.assertIn("number_choice", str(cm.exception))
        self.assertIn("wire1_core", str(cm.exception))

    def test_61_an_unknown_attribute_type_is_still_rejected(self):
        """NEGATIVE / BACKWARDS-COMPAT. Widening to three types must not open the door to a fourth;
        a typo'd type still fails, and the message names all three legal values."""
        cfg = self._number_choice_config({
            "id": "wire1_core", "label": "Wire 1 - cores", "type": "numeric_choice",
            "values": [1, 2, 3],
        })
        with self.assertRaises(frappe.ValidationError) as cm:
            rate_master._validate_config(cfg)
        msg = str(cm.exception)
        for legal in ("'choice'", "'number'", "'number_choice'"):
            self.assertIn(legal, msg)

    def test_62_a_number_choice_attr_is_reference_guarded_like_any_other(self):
        """NEGATIVE. Converting an attribute to the new type does not exempt it from the reference
        guard: a pipeline naming it while the DEFINITION is gone is still rejected, naming the
        location. This is the guard that protects the four point_wiring conversions."""
        cfg = self._number_choice_config({
            "id": "wire1_core", "label": "Wire 1 - cores", "type": "number_choice",
            "values": [1, 2, 3],
        })
        cfg["attribute_definitions"] = [
            d for d in cfg["attribute_definitions"] if d["id"] != "wire1_core"
        ]
        with self.assertRaises(frappe.ValidationError) as cm:
            rate_master._validate_config(cfg)
        self.assertIn("wire1_core", str(cm.exception))

    def test_63_choice_and_number_are_byte_unchanged_by_the_widening(self):
        """BACKWARDS-COMPAT. The two pre-existing types keep their exact acceptance rules: a choice
        still needs values (or values_from), a number still needs neither."""
        ok = self._number_choice_config({"id": "wire1_core", "label": "C", "type": "number"})
        rate_master._validate_config(ok)  # a number needs no values list

        bad = self._number_choice_config({"id": "wire1_core", "label": "C", "type": "choice"})
        with self.assertRaises(frappe.ValidationError) as cm:
            rate_master._validate_config(bad)
        self.assertIn("choice attribute 'wire1_core'", str(cm.exception))

    # ---- CIRCUIT LENGTH part 1: derive_attribute VALIDATION ----
    #
    # C3 again: a step the interpreter understands but the validator rejects is UNSAVABLE, and that
    # pairing has bitten twice. This step names attribute ids in TWO places and BOTH are
    # reference-guarded -- its SOURCE attrs and, unusually, its TARGET. The target guard is the one
    # worth spelling out: a typo there means the step never finds the stated value it is supposed to
    # defer to, so a stated length would be silently ignored and the computed one would price. That is
    # quieter than a no-compute and worse, which is why the typo has to fail at save.

    def _derive_attr_config(self, step_params, extra_defs=None):
        defs = [
            {"id": "point_count", "label": "Points", "type": "number"},
            {"id": "circuit_length_m", "label": "Circuit length (m)", "type": "number"},
        ]
        return {
            "discipline": "Electrical", "category_id": "derive_attr_probe",
            "attribute_definitions": defs + (extra_defs or []),
            "pipelines": {"p": {"output": ["supply"], "steps": [
                {"step": "derive_attribute", "params": step_params},
            ]}},
        }

    _DA_PARAMS = {
        "result_attr": "circuit_length_m",
        "terms": [{"ident": "n", "attr": "point_count"}],
        "constants": {"base": 15, "per_extra": 5},
        "formula": "base + (n - 1) * per_extra",
        "unit": "m",
    }

    def test_64_derive_attribute_valid_shape_is_accepted(self):
        """POSITIVE. The owner's circuit-length rule as config: the formula, its input attribute and
        its target attribute are ALL data -- nothing about `15 + (N-1)*5` is hardcoded anywhere."""
        rate_master._validate_config(self._derive_attr_config(self._DA_PARAMS))  # must not raise

    def test_65_derive_attribute_source_attr_is_reference_guarded(self):
        """NEGATIVE. A term's `attr` must be DEFINED -- a typo would silently no-compute every row."""
        params = dict(self._DA_PARAMS, terms=[{"ident": "n", "attr": "point_cont"}])
        with self.assertRaises(frappe.ValidationError) as cm:
            rate_master._validate_config(self._derive_attr_config(params))
        self.assertIn("point_cont", str(cm.exception))

    def test_66_derive_attribute_result_attr_is_reference_guarded(self):
        """NEGATIVE, and the load-bearing one. A typo in the TARGET fails at save rather than quietly
        overriding a stated value the step can no longer see."""
        params = dict(self._DA_PARAMS, result_attr="circuit_lenght_m")
        with self.assertRaises(frappe.ValidationError) as cm:
            rate_master._validate_config(self._derive_attr_config(params))
        self.assertIn("circuit_lenght_m", str(cm.exception))

    def test_67_derive_attribute_structural_negatives(self):
        """NEGATIVE sweep -- every malformed shape is refused with a NAMED error, never written."""
        cases = [
            ({"terms": self._DA_PARAMS["terms"], "formula": "n"}, "result_attr"),          # no target
            (dict(self._DA_PARAMS, result_attr=""), "result_attr"),                        # blank target
            (dict(self._DA_PARAMS, formula=""), "formula"),                                # blank formula
            ({k: v for k, v in self._DA_PARAMS.items() if k != "formula"}, "formula"),     # no formula
            (dict(self._DA_PARAMS, terms=[]), "terms"),                                    # no terms
            (dict(self._DA_PARAMS, terms=[{"attr": "point_count"}]), "ident"),             # term without ident
            (dict(self._DA_PARAMS, terms=[{"ident": "n"}]), "attr"),                       # term without attr
            (dict(self._DA_PARAMS, constants={"base": "fifteen"}), "finite number"),       # non-numeric constant
            (dict(self._DA_PARAMS, unit=""), "unit"),                                      # blank unit
        ]
        for params, needle in cases:
            with self.subTest(needle=needle):
                with self.assertRaises(frappe.ValidationError) as cm:
                    rate_master._validate_config(self._derive_attr_config(params))
                self.assertIn(needle, str(cm.exception))

    def test_68_derive_attribute_rejects_an_ambiguous_formula_env(self):
        """NEGATIVE. Two terms binding one identifier, or a constant shadowing a term, would make the
        formula read an input the author did not choose -- silently, and with the wrong price."""
        dup = dict(self._DA_PARAMS, terms=[
            {"ident": "n", "attr": "point_count"},
            {"ident": "n", "attr": "circuit_length_m"},
        ])
        with self.assertRaises(frappe.ValidationError) as cm:
            rate_master._validate_config(self._derive_attr_config(dup))
        self.assertIn("repeats the ident", str(cm.exception))

        clash = dict(self._DA_PARAMS, constants={"n": 3, "base": 15, "per_extra": 5})
        with self.assertRaises(frappe.ValidationError) as cm:
            rate_master._validate_config(self._derive_attr_config(clash))
        self.assertIn("collides with a term ident", str(cm.exception))

    def test_69_derive_attribute_constants_and_unit_are_optional(self):
        """POSITIVE. A rule whose formula needs no fixed numbers is valid config -- the validator must
        not be stricter than the interpreter, which treats both keys as optional."""
        params = {
            "result_attr": "circuit_length_m",
            "terms": [{"ident": "n", "attr": "point_count"}],
            "formula": "n",
        }
        rate_master._validate_config(self._derive_attr_config(params))  # must not raise

    # ---- RULINGS 1 + 2 (owner 2026-08-09): the ZERO-MODULE BOX FALLBACK and the INSTALL STEP FUNCTION
    #
    # C3 for the third time. Both rulings add an OPTIONAL key, and an optional key is exactly the shape
    # that slips through: `rate_stages` and `ladders` positively validate the keys they know and ignore
    # the rest, so a mistyped or inert value would save cleanly and do nothing at runtime. Each new key
    # is therefore validated POSITIVELY, and each one's inert-but-plausible form (a non-positive
    # divisor, a divisor with no partner) is REJECTED rather than tolerated -- a config that looks
    # stepped and prices linearly is worse than one that will not save.
    #
    # Neither key names an attribute, so there is nothing new to _ref-guard; the partner keys that DO
    # name attributes (`mult_from_attr`, `floor_from`) were already guarded and stay so.

    def _stage_config(self, stage):
        return {
            "discipline": "Electrical", "category_id": "step_divisor_probe",
            "attribute_definitions": [
                {"id": "wire1_runs", "label": "Runs", "type": "number"},
                {"id": "circuit_length_m", "label": "Len", "type": "number"},
            ],
            "pipelines": {"p": {"output": ["supply"], "steps": [
                {"step": "component_ref", "name": "wire1", "target": "install_base_per_mtr",
                 "ref": {"kind": "cable"}, "rate_stages": [stage],
                 "qty": {"from_attr": "circuit_length_m"}},
            ]}},
        }

    def _ladder_config(self, ladder_extra):
        return {
            "discipline": "Electrical", "category_id": "zero_modules_probe",
            "attribute_definitions": [
                {"id": "switch_qty", "label": "Switch qty", "type": "number"},
                {"id": "plate_item", "label": "Plate", "type": "choice", "values": ["3M"]},
            ],
            "pipelines": {"p": {"output": ["supply"], "steps": [
                {"step": "module_fit", "params": {
                    "terms": [{"attr": "switch_qty", "weight": 1}],
                    "ladders": [dict({
                        "kind": "switch_socket_item", "where": {"family": "Back Box"},
                        "bind": "box_item", "floor_from": "plate_item", "on_none": "computed",
                    }, **ladder_extra)],
                }},
            ]}},
        }

    def test_70a_on_zero_modules_is_accepted_and_absence_stays_valid(self):
        """POSITIVE, both halves. The fallback saves, and a ladder WITHOUT it is still valid config --
        absence is the shipped shape for the plate ladder and for every pre-ruling category."""
        rate_master._validate_config(self._ladder_config({"on_zero_modules": 3}))  # must not raise
        rate_master._validate_config(self._ladder_config({}))  # must not raise

    def test_70b_on_zero_modules_rejects_an_inert_or_malformed_count(self):
        """NEGATIVE. The interpreter reads a non-positive value as 'no fallback declared', so accepting
        one here would ship a ladder that looks configured and suppresses the box exactly as before."""
        for bad in (0, -3, "3M", float("inf")):
            with self.subTest(bad=bad):
                with self.assertRaises(frappe.ValidationError) as cm:
                    rate_master._validate_config(self._ladder_config({"on_zero_modules": bad}))
                self.assertIn("on_zero_modules", str(cm.exception))

    def test_70c_mult_step_divisor_is_accepted_beside_its_partner(self):
        """POSITIVE, both halves. A stepped stage saves; a stage with neither key (every shipped supply
        and BCS stage) is untouched and still valid."""
        rate_master._validate_config(self._stage_config(
            {"mult": 2.0, "round": "up0", "mult_from_attr": "wire1_runs", "mult_step_divisor": 3}))
        rate_master._validate_config(self._stage_config({"mult": 2.0, "round": "up0"}))

    def test_70d_mult_step_divisor_rejects_an_inert_divisor_or_an_orphan(self):
        """NEGATIVE sweep. Both failure shapes are SILENT at runtime: a non-positive divisor multiplies
        linearly, and a divisor with no `mult_from_attr` divides a factor that is always 1."""
        cases = [
            ({"mult": 2.0, "mult_from_attr": "wire1_runs", "mult_step_divisor": 0}, "positive finite"),
            ({"mult": 2.0, "mult_from_attr": "wire1_runs", "mult_step_divisor": -3}, "positive finite"),
            ({"mult": 2.0, "mult_from_attr": "wire1_runs", "mult_step_divisor": "3"}, "positive finite"),
            ({"mult": 2.0, "mult_step_divisor": 3}, "mult_from_attr"),
        ]
        for stage, needle in cases:
            with self.subTest(needle=needle):
                with self.assertRaises(frappe.ValidationError) as cm:
                    rate_master._validate_config(self._stage_config(stage))
                self.assertIn(needle, str(cm.exception))

    def test_70e_scale_step_divisor_param_is_accepted_and_its_orphan_refused(self):
        """The `scale` half of the SAME capability. `_validate_params` already accepted any finite
        number, so the positive case never needed a change -- the NEGATIVES are the point."""
        def cfg(params):
            return {
                "discipline": "Electrical", "category_id": "scale_divisor_probe",
                "attribute_definitions": [{"id": "runs", "label": "Runs", "type": "number"}],
                "pipelines": {"p": {"output": ["install_per_mtr"], "steps": [
                    {"step": "scale", "target": "install_per_mtr", "result": "install_per_mtr",
                     "params": params, "formula": "base*runs"},
                ]}},
            }
        # POSITIVE: the shipped wiring shape, stepped
        rate_master._validate_config(cfg({"runs_from_attr": "runs", "runs_step_divisor": 3}))
        # POSITIVE: the LINEAR shape is byte-untouched
        rate_master._validate_config(cfg({"runs_from_attr": "runs"}))
        for params, needle in (
            ({"runs_from_attr": "runs", "runs_step_divisor": 0}, "positive finite"),
            ({"runs_from_attr": "runs", "runs_step_divisor": -1}, "positive finite"),
            ({"runs_step_divisor": 3}, "runs_from_attr"),
        ):
            with self.subTest(needle=needle):
                with self.assertRaises(frappe.ValidationError) as cm:
                    rate_master._validate_config(cfg(params))
                self.assertIn(needle, str(cm.exception))

    def test_70f_the_two_step_divisor_suffixes_are_the_same_string(self):
        """The interpreter names this suffix too (STEP_DIVISOR_SUFFIX). If the two ever drift, a config
        saves on one side and does nothing on the other -- the quietest failure this pair can have."""
        self.assertEqual(rate_master._STEP_DIVISOR_SUFFIX, "_step_divisor")

    def test_70_derive_attribute_is_in_the_known_step_vocabulary(self):
        """The vocabulary pin's server half. The frontend STEP_VOCABULARY carries the same 15 members
        (pinned in ratePipelineInterpreter.test.ts); a step known to only one side is unusable.

        SLICE 2b took this 13 -> 15 (`map_attribute` + `catalog_fit`), extended on both sides in one
        commit exactly as the 11 -> 12 -> 13 moves before it."""
        self.assertIn("derive_attribute", rate_master._KNOWN_STEP_TYPES)
        self.assertEqual(len(rate_master._KNOWN_STEP_TYPES), 15)

    # ---- MINT GATE: the two carry-forward repairs ----
    #
    # A replace=True is WHOLESALE -- the prior config row is deactivated and a new one is inserted
    # from the payload ALONE. Anything the asset does not carry is gone. These two pins guard the
    # values that were living ONLY in the DB (as audited RM-4b edits) until they were written back.

    def test_71_wiring_asset_carries_the_in_system_edits_and_a_reimport_keeps_them(self):
        """POSITIVE, both halves. `pipeline_labels` and `attribute_definitions[runs].default` were
        made in-system via RM-4b and were absent from the asset, so a re-import DISCARDED them.

        `default` is NOT cosmetic: extraction.build_attribute_defs copies it into the per-attribute
        definitions sent to the model, so losing it is a behavioural regression in extraction that no
        other test can see. The round-trip through the loader is the real proof -- asserting the file
        alone would not show that a replace=True now preserves them."""
        asset_cfg = type(self).raw["category_config"]
        self.assertEqual(
            asset_cfg.get("pipeline_labels"),
            {"cable_boq": "Cable — per Mtr", "termination_boq": "Termination — per Set"},
        )
        runs = {d["id"]: d for d in asset_cfg["attribute_definitions"]}["runs"]
        self.assertEqual(runs.get("default"), 1)

        # the round-trip: a fresh load must STORE both, or the repair has not actually landed
        disc = self._new_disc()
        loader.load_rate_master(payload=self._real_payload(disc))
        stored = rate_master.get_rate_category_config(disc, "wiring_cabling")["config"]
        self.assertEqual(stored.get("pipeline_labels"), asset_cfg["pipeline_labels"])
        stored_runs = {d["id"]: d for d in stored["attribute_definitions"]}["runs"]
        self.assertEqual(stored_runs.get("default"), 1)

    # The CURRENT E-ALL asset. Named ONCE, version-free at the call sites, because the pin below
    # guards whichever asset is live -- and it was silently left behind on v26 when v27 was minted,
    # which is precisely the C4 trap it exists to catch.
    #
    # IT THEN FELL INTO THAT TRAP A SECOND TIME: it sat on v27 while v28 and v29 shipped, so three
    # tests spent two mints validating a stale file. "Named once" was true only WITHIN this class,
    # and two OTHER current pins existed elsewhere on two other versions. It now reads the ONE
    # module-level CURRENT_EALL_ASSET, so a mint bumps a single line for the whole suite.
    _EALL_CURRENT = CURRENT_EALL_ASSET

    def _current_eall_asset(self):
        path = _asset_path(self._EALL_CURRENT)
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)

    def test_72_the_current_eall_asset_carries_no_stale_config_level_goldens(self):
        """The top-level `goldens` dict is the AUTHORITY (#178); loader._load_multi OVERWRITES a
        config's own `goldens` from it. switches_sockets carried a SECOND, disagreeing copy -- the
        known-incoherent slice-1a ss1 (a 6M plate holding 7 modules) that slice 2 re-minted.

        It was harmless ONLY while the top-level entry existed to overwrite it. Drop that entry --
        exactly what a retirement does -- and the stale copy would load SILENTLY. NEGATIVE half: no
        config may carry a `goldens` copy that disagrees with the top-level dict.

        F-16 (owner ruling R2) REPLACED an `assertNotIn("goldens", ss)` absence pin. That pin
        encoded a property of a HAND-BUILT asset, not of the invariant: v30 was hand-merged, whereas
        an EXPORTED asset legitimately GAINS a config-level `goldens` copy, because the loader stamps
        it at ingest and the export reproduces what is stored. So the absence pin fails on every
        exported asset -- v31 was the first -- while never having guarded the actual hazard.

        THE ACTUAL HAZARD is a config-level copy with NO top-level twin: the overwrite fires only
        when a top-level entry exists for that category, so an orphan copy survives the load
        untouched and goes silently stale. Absence-checking could not see that; agreement-checking
        does, and it holds for hand-built and exported assets alike."""
        payload = self._current_eall_asset()
        top = payload["goldens"]

        for cfg in payload["category_configs"]:
            if "goldens" not in cfg:
                continue                      # nothing to disagree with
            cid = cfg["category_id"]
            # (a) a top-level entry MUST exist -- an orphan copy is the silent-staleness hazard
            self.assertIn(cid, top,
                          f"{cid} carries a config-level goldens copy with no top-level twin: "
                          "the load would not overwrite it, so it can go stale unnoticed")
            # (b) and the two must AGREE EXACTLY -- a disagreeing copy is the #178 defect
            self.assertEqual(cfg["goldens"], top[cid],
                             f"{cid}'s config-level goldens disagree with the top-level authority")

        # the surviving authority is the slice-2 re-mint, not the incoherent 1a golden
        ss1 = {g["id"]: g for g in payload["goldens"]["switches_sockets"]}["ss1"]
        self.assertEqual(ss1["attrs"]["plate_item"], "8M")
        self.assertEqual(ss1["attrs"]["blank_qty"], 1.0)
        # SLICE 4 / B4 (owner ruling R7, 2026-08-19): incidental value pins beside the SHAPE pins
        # above -- this test's subject is config-level-vs-top-level AGREEMENT (#178), which is
        # unaffected. RE-BANKED for the v43 rates; goldens are REGRESSION CANARIES (2026-08-19).
        self.assertEqual(ss1["expect"]["swsock_boq"], {"supply": 820.0, "install": 170.0})
        self.assertEqual(ss1["expect"]["swsock_bcs"], {"bcs_supply": 570.0})

        # NEGATIVE: no OTHER category may carry a divergent second copy either
        for cfg in payload["category_configs"]:
            inner = cfg.get("goldens")
            top = payload["goldens"].get(cfg["category_id"])
            if inner is None or top is None:
                continue
            self.assertEqual(
                json.dumps(inner, sort_keys=True), json.dumps(top, sort_keys=True),
                "%s carries a config-level goldens copy that disagrees with the top-level dict"
                % cfg["category_id"],
            )

    def test_72a_both_assets_carry_the_two_rulings_exactly_where_they_belong(self):
        """RULINGS 1 + 2, as SHIPPED. This is the test_71-shaped pin: a `replace=True` is WHOLESALE, so
        a key silently absent from a future mint is gone from the active config with no signal at all.

        Every assertion has a NEGATIVE twin, because on both rulings the damage is in the over-reach:
          - the BOX ladder takes the fallback, the PLATE ladder must NOT (nothing on it => no plate);
          - INSTALL steps in threes, SUPPLY and BCS must NOT (three runs is three times the wire);
          - and `termination_boq` install must carry NO runs multiplier of its own -- it inherits one
            through `install_as_ratio`, so a second would be runs-SQUARED."""
        payload = self._current_eall_asset()
        pw = [c for c in payload["category_configs"] if c["category_id"] == "point_wiring"][0]

        # ---- RULING 1: the box ladder only, in every pipeline ----
        seen = 0
        # v51: scoped to the three that assemble a point -- the two DISPLAY-ONLY circuit pipelines
        # fit no modules by design (test_pw_cs_10).
        for pid in _PW_ASSEMBLY_PIPELINES:
            pl = pw["pipelines"][pid]
            mf = [s for s in pl["steps"] if s.get("step") == "module_fit"]
            self.assertEqual(len(mf), 1, "%s should carry exactly one module_fit" % pid)
            for lad in mf[0]["params"]["ladders"]:
                if lad["bind"] == "box_item":
                    self.assertEqual(lad.get("on_zero_modules"), 3, pid)
                    seen += 1
                else:
                    # NEGATIVE: the plate ladder must never fall back -- with nothing on it there is
                    # no plate, and a fallback there would manufacture one.
                    self.assertEqual(lad["bind"], "plate_item")
                    self.assertNotIn("on_zero_modules", lad, pid)
        self.assertEqual(seen, 3, "all three point_wiring pipelines must carry the fallback")

        # ---- RULING 2: pw_boq_install's wire stages only ----
        for pid, pl in pw["pipelines"].items():
            stepped = pid == "pw_boq_install"
            for st in pl["steps"]:
                if st.get("step") != "component_ref" or st.get("name") not in ("wire1", "wire2"):
                    continue
                for stg in st.get("rate_stages") or []:
                    if "mult_from_attr" not in stg:
                        continue
                    if stepped:
                        self.assertEqual(stg.get("mult_step_divisor"), 3, "%s/%s" % (pid, st["name"]))
                    else:
                        # NEGATIVE: supply (0.602) and BCS (0.4515) stay LINEAR
                        self.assertNotIn("mult_step_divisor", stg, "%s/%s" % (pid, st["name"]))

        # ---- RULING 2, the wiring config: cable install only ----
        # Read from the MERGED asset (2026-08-13). It used to read rate_master_wiring_cabling_v3.json
        # directly; that file is retained on disk as a mint-gate operand but is no longer the live
        # asset, so a pin left on it would guard a frozen artefact instead of what ships.
        with open(_asset_path(CURRENT_EALL_ASSET), "r", encoding="utf-8") as fh:
            wcfg = next(
                c for c in json.load(fh)["category_configs"] if c["category_id"] == "wiring_cabling"
            )
        for pid, pl in wcfg["pipelines"].items():
            for st in pl["steps"]:
                if st.get("step") != "scale":
                    continue
                prm = st.get("params") or {}
                if "runs_from_attr" not in prm:
                    continue
                if pid == "cable_boq" and st["result"] == "install_per_mtr":
                    self.assertEqual(prm.get("runs_step_divisor"), 3)
                else:
                    # NEGATIVE: cable supply, termination supply, and BOTH BCS outputs stay LINEAR
                    self.assertNotIn("runs_step_divisor", prm, "%s/%s" % (pid, st["result"]))

        # ---- C2: termination install is BYTE-UNTOUCHED, ordering and rounding included ----
        tb = wcfg["pipelines"]["termination_boq"]["steps"]
        iar = [i for i, s in enumerate(tb) if s.get("step") == "install_as_ratio"]
        self.assertEqual(len(iar), 1)
        self.assertEqual(tb[iar[0]]["params"], {"ratio": 0.25})
        # the supply runs `scale` still sits BEFORE it -- that ordering IS the inheritance
        scale_i = [i for i, s in enumerate(tb) if s.get("step") == "scale"]
        self.assertTrue(scale_i and max(scale_i) < iar[0])
        # ...and the roundup still lands AFTER it, where it always did
        self.assertEqual(tb[iar[0] + 1]["step"], "roundup")
        self.assertEqual(tb[iar[0] + 1]["params"], {"digits": -1})

    def test_72b_the_new_golden_pw4_is_a_zero_module_row_with_a_back_box(self):
        """CP3. pw4 pins RULING 1, which would otherwise ship UNPINNED -- every other point_wiring
        golden drives a plate, so none of them ever reaches the zero-module path.

        The VALUES are asserted by the RM-4b preview gate against the live catalog; what this pins is
        that the golden still DRIVES the case it was minted for. A pw4 that quietly gained a plate, or
        lost its back box, would go green while testing nothing."""
        goldens = {g["id"]: g for g in self._current_eall_asset()["goldens"]["point_wiring"]}
        self.assertIn("pw4", goldens)
        a = goldens["pw4"]["attrs"]
        # zero modules: BOTH module terms positively absent
        self.assertEqual(a["switch_item"], "None")
        self.assertEqual(a["socket_item"], "None")
        self.assertEqual(a["switch_qty"], 0.0)
        self.assertEqual(a["socket_qty"], 0.0)
        # no plate, and the box explicitly asked for
        self.assertEqual(a["plate_item"], "None")
        self.assertEqual(a["back_box"], "Yes")
        # circuit_length_m must be DERIVED, never stated -- a stated length wins and would make the
        # derive_attribute step inert while the golden stayed green
        self.assertNotIn("circuit_length_m", a)
        self.assertEqual(a["points"], 1)
        # SLICE B: the two display-only pipelines were removed, so their expectations went with
        # them (`_validate_config` refuses a golden naming a pipeline the config no longer declares).
        # The three assembly values are UNCHANGED -- that is the real no-golden-moved guarantee.
        self.assertEqual(goldens["pw4"]["expect"], {
            "pw_boq_supply": {"supply": 607.0},
            "pw_boq_install": {"install": 330.0},
            "pw_bcs": {"bcs_supply": 445.0},
        })

    # ══════════════════════════════════════════════════════════════════════════════════
    # SELECTED-ROW RUNS -- only_rows + the carry-forward write.
    # ZERO AI CALLS: every extraction test below drives the fail-closed (AI disabled) path,
    # which returns blank rows WITHOUT constructing a client or issuing a request. The filter
    # under test runs before that branch, so the scoping is proven without spending anything.
    # ══════════════════════════════════════════════════════════════════════════════════

    # A realistic results blob: out of excel_row order on purpose, with a `defaulted` flag, a
    # float confidence, an int value, a null value and a non-ASCII description -- the shapes a
    # naive re-serialisation is most likely to alter.
    CARRY_ROWS = [
        {"excel_row": 41, "description": "1.5 sqmm FRLS wire — 3 runs", "category_id": "point_wiring",
         "attributes": {"wire1_core": {"value": 1, "confidence": 0.9, "corroborated": True},
                        "wire1_runs": {"value": 3, "confidence": 0.85, "corroborated": False,
                                       "defaulted": True}}},
        {"excel_row": 16, "description": "6way TPN DB", "category_id": "db_switchgear",
         "attributes": {"db_shell_item": {"value": "TPN DB 6WAY (DOUBLE DOOR IP 43)",
                                          "confidence": 0.9, "corroborated": False},
                        "db_shell_qty": {"value": 1, "confidence": 0.95, "corroborated": False}}},
        {"excel_row": 28, "description": "6A modular switch", "category_id": "switches_sockets",
         "attributes": {"plate_item": {"value": None, "confidence": 0.0, "corroborated": False},
                        "colour": {"value": "WHITE", "confidence": 0.72, "corroborated": False,
                                   "defaulted": True}}},
    ]

    def test_73_normalize_only_rows_parses_dedupes_sorts_and_rejects_a_non_integer(self):
        """POSITIVE: every shape the wire can carry parses to a sorted, deduped int list.
        NEGATIVE 1 (the G6 PIN): ABSENT or EMPTY -> None, which every downstream branch reads as
        'whole sheet', so the unscoped path is untouched by this slice.
        NEGATIVE 2: a non-integer member THROWS. Silently dropping it would run fewer rows than
        the confirmation the user just accepted named -- the exact class of silent narrowing this
        slice exists to remove."""
        n = rate_master.normalize_only_rows

        # POSITIVE -- list, JSON string (what frappe-react-sdk posts), and a bare scalar
        self.assertEqual(n([28, 16, 41]), [16, 28, 41])
        self.assertEqual(n("[28, 16, 41]"), [16, 28, 41])
        self.assertEqual(n(41), [41])
        self.assertEqual(n(["16", "28"]), [16, 28])          # numeric strings are row numbers
        self.assertEqual(n([16, 16, 28, 16]), [16, 28])      # duplicates collapse

        # NEGATIVE 1 -- the G6 pin: absent / empty in every spelling means "whole sheet"
        for absent in (None, "", [], "[]", set()):
            self.assertIsNone(n(absent), "%r must normalise to None (whole sheet)" % (absent,))

        # NEGATIVE 2 -- a member that is not a row number is REJECTED, and named
        with self.assertRaises(frappe.ValidationError) as ctx:
            n([16, "not-a-row"])
        self.assertIn("not-a-row", str(ctx.exception))

    def test_74_serialize_run_results_is_the_byte_identity_guarantee(self):
        """POSITIVE: parsing a stored blob and re-serialising it reproduces the ORIGINAL TEXT
        character-for-character -- `defaulted` flags, float confidences, nulls and non-ASCII
        included. This is the property the whole carry-forward rests on.

        NEGATIVE: the guarantee is NOT vacuous -- a formatting-only variant of the same values
        produces DIFFERENT text, which is exactly how a 'tidy-up' of the dump would pass a
        still-present check while breaking byte-identity."""
        canonical = rate_master.serialize_run_results(self.CARRY_ROWS)

        # POSITIVE: text -> parse -> text is a fixpoint (the round trip the carry performs)
        self.assertEqual(rate_master.serialize_run_results(json.loads(canonical)), canonical)
        # ... and idempotent under repetition (a run may be carried forward many times)
        again = canonical
        for _ in range(3):
            again = rate_master.serialize_run_results(json.loads(again))
        self.assertEqual(again, canonical)

        # sorted by excel_row regardless of input order
        self.assertEqual([r["excel_row"] for r in json.loads(canonical)], [16, 28, 41])
        # the flags that must survive are actually present in the TEXT
        self.assertEqual(canonical.count('"defaulted": true'), 2)
        self.assertIn('"confidence": 0.72', canonical)
        self.assertIn('"value": null', canonical)

        # NEGATIVE: formatting variants are NOT byte-identical -> the property has teeth
        rows_sorted = sorted(self.CARRY_ROWS, key=lambda r: r["excel_row"])
        self.assertNotEqual(json.dumps(rows_sorted, indent=2), canonical)
        self.assertNotEqual(json.dumps(rows_sorted, sort_keys=True), canonical)
        self.assertNotEqual(json.dumps(rows_sorted, separators=(",", ":")), canonical)

    def test_75_carry_forward_leaves_every_untouched_row_byte_identical(self):
        """G5, the feature's premise. Simulate what a selected-row pass does to the results array:
        seed from the prior run, REPLACE exactly one row, re-serialise. Every OTHER row's
        serialised text must come out byte-identical -- asserted on the TEXT, not on parsed
        values, because a re-serialisation that preserved the values and lost the `defaulted`
        flag would pass a parsed comparison and still be the silent regression."""
        before = rate_master.serialize_run_results(self.CARRY_ROWS)

        # the merge the worker performs: an excel_row-keyed dict, one row overwritten
        acc = {int(r["excel_row"]): r for r in json.loads(before)}
        acc[28] = {"excel_row": 28, "description": "6A modular switch", "category_id": "switches_sockets",
                   "attributes": {"plate_item": {"value": "2M", "confidence": 0.88, "corroborated": False}}}
        after = rate_master.serialize_run_results(acc.values())

        # every UNTOUCHED row's own serialised fragment survives verbatim in the new text
        untouched = [r for r in self.CARRY_ROWS if r["excel_row"] != 28]
        self.assertEqual(len(untouched), 2)
        for row in untouched:
            fragment = json.dumps(row)
            self.assertIn(fragment, before)
            self.assertIn(fragment, after, "row %s was not carried byte-identically" % row["excel_row"])

        # the ONLY textual difference is the replaced row's fragment
        old_fragment = json.dumps([r for r in self.CARRY_ROWS if r["excel_row"] == 28][0])
        new_fragment = json.dumps(acc[28])
        self.assertEqual(before.replace(old_fragment, new_fragment), after)

        # The CARRIED rows keep their defaulted flag. Row 41 carries one and row 16 does not, so
        # exactly one survives -- the replaced row 28 legitimately lost its own (it was re-extracted
        # and the new reading is not a default). Pinning the number, not just ">0", is what would
        # catch a carry that quietly dropped row 41's flag.
        self.assertEqual(after.count('"defaulted": true'), 1)
        self.assertIn('"defaulted": true', json.dumps(json.loads(after)[2]))  # row 41, still flagged

    def _scoped_extraction(self, population, **kwargs):
        """Drive run_extraction over a synthetic population with AI DISABLED (fail-closed), so the
        row-selection filter is exercised with ZERO AI calls and no network client is ever built."""
        rows = [
            {"excel_row": er, "description": "row %d" % er, "discipline": "TEST_DISC",
             "category_id": "test_cat", "anc_headers": [], "notes": ""}
            for er in population
        ]
        cfg = {"attribute_definitions": [{"id": "attr_a", "type": "number"}], "pipelines": {"p": {}}}
        with mock.patch.object(extraction, "assemble_population", return_value=(4, rows)), \
             mock.patch.object(extraction, "_load_active_configs",
                               return_value={("TEST_DISC", "test_cat"): cfg}), \
             mock.patch.object(extraction, "build_attribute_defs",
                               return_value=[{"id": "attr_a", "type": "number"}]), \
             mock.patch.object(extraction, "select_prompt_text", return_value=""), \
             mock.patch("nirmaan_stack.api.boq.wizard.ai_settings.get_boq_ai_settings",
                        return_value={"enabled": False, "model": "test-model"}):
            return extraction.run_extraction("TEST_BOQ", "TEST SHEET", **kwargs)

    def test_76_only_rows_scopes_the_processing_and_never_the_population(self):
        """C2, the load-bearing distinction. POSITIVE: with only_rows the envelope's `results`
        carry ONLY the scoped rows, while `population_rows` remains the WHOLE sheet -- which is
        what keeps the caller's completeness test (population - attempted) honest and stops a
        scoped run from flipping active=1 on its own.

        NEGATIVE half (the G6 pin): only_rows=None processes every row, exactly as before."""
        population = [10, 16, 28, 33, 41]

        env = self._scoped_extraction(population, only_rows=[16, 41])
        self.assertEqual(sorted(r["excel_row"] for r in env["results"]), [16, 41])
        self.assertEqual(sorted(env["population_rows"]), population,
                         "only_rows must NOT narrow the population -- that is the destructive shape")
        self.assertEqual(sorted(env["attempted_rows"]), [16, 41])

        # NEGATIVE: absent scope == whole sheet, population unchanged
        env_all = self._scoped_extraction(population)
        self.assertEqual(sorted(r["excel_row"] for r in env_all["results"]), population)
        self.assertEqual(sorted(env_all["population_rows"]), population)

        # an EMPTY selection is treated as ABSENT, never as "process nothing"
        env_empty = self._scoped_extraction(population, only_rows=[])
        self.assertEqual(sorted(r["excel_row"] for r in env_empty["results"]), population)

    def test_77_skip_rows_and_only_rows_compose(self):
        """A resume of a HALTED scoped run relies on this: the rows that pass are the scope MINUS
        whatever the earlier pass already finished. A row named by both filters is skipped."""
        population = [10, 16, 28, 33, 41]
        env = self._scoped_extraction(population, only_rows=[16, 28, 41], skip_rows=[28])
        self.assertEqual(sorted(r["excel_row"] for r in env["results"]), [16, 41])
        self.assertEqual(sorted(env["population_rows"]), population)

    def test_78_guard_rejects_a_row_outside_the_population_and_names_it(self):
        """REJECT, not ignore (owner choice). NEGATIVE: a row the client sends that the run does
        not accept aborts the whole request and is NAMED, because the confirmation the user just
        accepted quoted a count that is no longer true. POSITIVE: a fully eligible selection
        passes the same guard untouched."""
        with mock.patch.object(rate_master, "_carry_source_run", return_value={"name": "X"}), \
             mock.patch.object(rate_master, "_population_rows", return_value={16, 28, 41}), \
             mock.patch("nirmaan_stack.api.boq.wizard.ai_settings.get_boq_ai_settings",
                        return_value={"enabled": True}), \
             mock.patch("nirmaan_stack.api.boq.wizard.ai_settings.get_boq_ai_api_key",
                        return_value="k"):
            # NEGATIVE -- 99 is not in the population
            with self.assertRaises(frappe.ValidationError) as ctx:
                rate_master._guard_only_rows("B", "S", 4, [16, 99], None)
            self.assertIn("99", str(ctx.exception))

            # POSITIVE -- an eligible selection raises nothing
            rate_master._guard_only_rows("B", "S", 4, [16, 41], None)

    def test_79_guard_refuses_resume_plus_scope_ai_off_and_no_carry_source(self):
        """Three NEGATIVE pre-flight refusals, each before a single token is spent:
        (a) a resume already has its own scope, so it cannot also take a selection;
        (b) AI off would blank the picked rows AND stamp ai_status='disabled' onto a document
            whose carried rows were extracted with AI on -- mislabelling the whole document;
        (c) with no completed run to carry forward from there is nothing to preserve, so the
            'run the whole sheet once first' boundary is stated rather than silently producing a
            partial that the editor would never adopt."""
        ai_on = mock.patch("nirmaan_stack.api.boq.wizard.ai_settings.get_boq_ai_settings",
                           return_value={"enabled": True})
        key_on = mock.patch("nirmaan_stack.api.boq.wizard.ai_settings.get_boq_ai_api_key",
                            return_value="k")

        # (a) resume + only_rows are mutually exclusive -- refused before anything else is read
        with self.assertRaises(frappe.ValidationError) as ctx:
            rate_master._guard_only_rows("B", "S", 4, [16], "some-run-id")
        self.assertIn("selection", str(ctx.exception).lower())

        # (b) AI off
        with mock.patch("nirmaan_stack.api.boq.wizard.ai_settings.get_boq_ai_settings",
                        return_value={"enabled": False}), key_on:
            with self.assertRaises(frappe.ValidationError) as ctx:
                rate_master._guard_only_rows("B", "S", 4, [16], None)
            self.assertIn("AI", str(ctx.exception))

        # (c) nothing to carry forward from
        with ai_on, key_on, mock.patch.object(rate_master, "_carry_source_run", return_value=None):
            with self.assertRaises(frappe.ValidationError) as ctx:
                rate_master._guard_only_rows("B", "S", 4, [16], None)
            self.assertIn("carry", str(ctx.exception).lower())


    def test_80_pass_attempted_count_reads_this_pass_not_the_document(self):
        """POSITIVE: the count comes off the ENVELOPE, which run_extraction builds from the batches
        THIS pass completed.

        NEGATIVE, and the whole reason the helper exists: it is NOT the document-level number. On a
        carried scoped run `attempted_count` (len(acc_attempted)) counts every row the DOCUMENT has
        results for -- carried rows included -- so it cannot answer "how much did this pass do".
        A missing or empty envelope yields 0 rather than raising."""
        # POSITIVE -- this pass attempted three rows
        self.assertEqual(rate_master.pass_attempted_count({"attempted_rows": [16, 22, 30]}), 3)

        # NEGATIVE -- absent / empty / None never raise, and never guess
        self.assertEqual(rate_master.pass_attempted_count({}), 0)
        self.assertEqual(rate_master.pass_attempted_count({"attempted_rows": []}), 0)
        self.assertEqual(rate_master.pass_attempted_count({"attempted_rows": None}), 0)

        # NEGATIVE -- it must NOT be confused with the document total. A scoped pass that finished
        # 2 of its 4 rows against a 94-row carried document: the document knows 94, the pass did 2.
        env = {"attempted_rows": [16, 22]}
        acc_attempted = set(range(1, 95))          # what the run doc holds after the carry
        self.assertEqual(rate_master.pass_attempted_count(env), 2)
        self.assertNotEqual(rate_master.pass_attempted_count(env), len(acc_attempted))

    def _run_worker_capture(self, env, only_rows=None, prior_results=None, prior_attempted=None):
        """Drive the REAL _suggest_worker payload construction with the DB + AI mocked out, and
        return the terminal payload it publishes. No AI call, no DB write, no enqueue."""
        published = {}

        def _capture(event, payload, **kw):
            published.update(payload)

        prior_results = prior_results or []
        prior_attempted = prior_attempted or []
        with mock.patch.object(rate_master, "_s_get_marker", return_value={"job_id": "J"}),              mock.patch.object(rate_master, "_resolve_committed_version", return_value=4),              mock.patch.object(rate_master, "_open_run_doc",
                               return_value=("RUN-NAME", "RUN-ID", prior_results, prior_attempted,
                                             {int(x) for x in only_rows} if only_rows else None)),              mock.patch.object(rate_master.extraction, "run_extraction", return_value=env),              mock.patch.object(rate_master, "_finalise_run"),              mock.patch.object(rate_master, "_write_run_progress"),              mock.patch.object(rate_master, "_s_clear_marker"),              mock.patch.object(frappe, "publish_realtime", side_effect=_capture), mock.patch.object(frappe, "log_error"),              mock.patch.object(frappe.db, "commit"),              mock.patch.object(frappe, "cache", return_value=mock.MagicMock()):
            rate_master._suggest_worker(
                boq="B", sheet_name="S", user="u@x", only_rows=only_rows,
            )
        return published

    def test_81_worker_publishes_the_pass_count_and_changes_nothing_else(self):
        """The wiring, on the REAL worker. A carried SCOPED pass that halted part-way must publish a
        pass count that DIFFERS from the document-level attempted_count -- that difference is what
        makes the halted-scoped three-way split derivable at all.

        ADDITIVE-ONLY half (the regression the owner asked to pin rather than assume): adding the
        key must leave every PRE-EXISTING payload key byte-identical, on a complete pass and on a
        halted one. The three message shapes that already read correctly are driven entirely by
        those keys, so if none of them moves, none of those messages can move."""
        rows = lambda ns: [{"excel_row": n} for n in ns]
        carried = rows(range(1, 95))
        carried_attempted = list(range(1, 95))

        # ---- a HALTED SCOPED pass: scoped to 4 rows, only 2 batches landed ----
        halted_env = {
            "committed_version": 4, "ai_status": "ran", "results": rows([16, 22]),
            "complete": False, "halted": True, "halt_reason": "An AI request kept failing.",
            "attempted_rows": [16, 22], "population_rows": list(range(1, 95)),
        }
        p = self._run_worker_capture(
            halted_env, only_rows=[16, 22, 30, 36],
            prior_results=carried, prior_attempted=carried_attempted,
        )
        self.assertEqual(p["run_status"], "partial")
        self.assertEqual(p["scoped_row_count"], 4)
        self.assertEqual(p["pass_attempted_count"], 2)          # what THIS pass did
        self.assertEqual(p["attempted_count"], 94)              # what the DOCUMENT holds
        self.assertNotEqual(p["pass_attempted_count"], p["attempted_count"])
        # the three counts the message needs are now all derivable
        self.assertEqual(len(p["results"]) - p["pass_attempted_count"], 92)   # carried forward
        self.assertEqual(p["scoped_row_count"] - p["pass_attempted_count"], 2)  # not reached

        # ---- ADDITIVE-ONLY: the pre-existing keys are untouched, complete AND halted ----
        complete_env = {
            "committed_version": 4, "ai_status": "ran", "results": rows(range(1, 95)),
            "complete": True, "halted": False, "halt_reason": None,
            "attempted_rows": list(range(1, 95)), "population_rows": list(range(1, 95)),
        }
        for label, env, only in (
            ("whole-sheet complete", complete_env, None),
            ("whole-sheet halted", {**halted_env, "results": rows([1, 2])}, None),
        ):
            got = self._run_worker_capture(env, only_rows=only)
            # every key the pre-slice payload carried, unchanged in name and value
            for key in ("status", "boq", "sheet_name", "committed_version", "run_id", "ai_status",
                        "run_status", "results", "attempted_count", "population_count",
                        "halt_reason", "scoped_row_count"):
                self.assertIn(key, got, "%s: %s disappeared from the payload" % (label, key))
            self.assertIsNone(got["scoped_row_count"], label)   # whole-sheet stays None
            self.assertIn("pass_attempted_count", got)
        # and the ONLY new key is the one this slice added
        expected = {"status", "boq", "sheet_name", "committed_version", "run_id", "ai_status",
                    "run_status", "results", "attempted_count", "population_count", "halt_reason",
                    "scoped_row_count", "pass_attempted_count"}
        self.assertEqual(set(self._run_worker_capture(complete_env).keys()), expected)

    # ── SCOPE PERSISTENCE: a halted scoped run must resume SCOPED ────────────────────
    # ZERO AI CALLS: the worker tests below drive the REAL run_extraction with AI DISABLED, which
    # returns a blank row per processed row WITHOUT building a client or issuing a request. Those
    # blank rows ARE the processing set, so the row arithmetic is observable for free.

    def _extraction_env_mocks(self, population):
        """Mock only what run_extraction needs to reach its row filter, with AI OFF."""
        rows = [{"excel_row": er, "description": "row %d" % er, "discipline": "TEST_DISC",
                 "category_id": "test_cat", "anc_headers": [], "notes": ""} for er in population]
        cfg = {"attribute_definitions": [{"id": "a", "type": "number"}], "pipelines": {"p": {}}}
        return [
            mock.patch.object(extraction, "assemble_population", return_value=(4, rows)),
            mock.patch.object(extraction, "_load_active_configs",
                              return_value={("TEST_DISC", "test_cat"): cfg}),
            mock.patch.object(extraction, "build_attribute_defs",
                              return_value=[{"id": "a", "type": "number"}]),
            mock.patch.object(extraction, "select_prompt_text", return_value=""),
            mock.patch("nirmaan_stack.api.boq.wizard.ai_settings.get_boq_ai_settings",
                       return_value={"enabled": False, "model": "m"}),
        ]

    def _resume_processed_rows(self, population, doc_attempted, doc_scope):
        """Drive the REAL _suggest_worker + REAL run_extraction for a RESUME of a run whose stored
        state is (attempted_rows=doc_attempted, scope_rows=doc_scope). Returns the excel_rows the
        pass actually processed, read off the terminal payload. No DB write, no AI call."""
        published = {}

        def _capture(event, payload, **kw):
            published.update(payload)

        stack = self._extraction_env_mocks(population) + [
            mock.patch.object(rate_master, "_s_get_marker", return_value={"job_id": "J"}),
            mock.patch.object(rate_master, "_resolve_committed_version", return_value=4),
            mock.patch.object(rate_master, "_open_run_doc",
                              return_value=("N", "RID", [], list(doc_attempted), doc_scope)),
            mock.patch.object(rate_master, "_finalise_run"),
            mock.patch.object(rate_master, "_write_run_progress"),
            mock.patch.object(rate_master, "_s_clear_marker"),
            mock.patch.object(frappe, "publish_realtime", side_effect=_capture),
            mock.patch.object(frappe, "log_error"),
            mock.patch.object(frappe.db, "commit"),
            mock.patch.object(frappe, "cache", return_value=mock.MagicMock()),
        ]
        for m in stack:
            m.start()
        try:
            rate_master._suggest_worker(boq="B", sheet_name="S", user="u", resume_run_id="RID")
        finally:
            for m in reversed(stack):
                m.stop()
        return sorted(r["excel_row"] for r in published.get("results", [])), published

    def test_83_open_run_doc_returns_the_persisted_scope_on_a_resume(self):
        """POSITIVE: a resume reads the scope off the document it is resuming -- that is the whole
        fix, because `only_rows` is a request parameter that died with the original request.

        NEGATIVE 1: a whole-sheet run stores NULL and must resume with scope None (unchanged path).
        NEGATIVE 2: a stored EMPTY list means 'scoped, nothing left' and must NOT collapse to None
        -- collapsing would be the exact population fallback this slice removes."""
        def _doc(scope_json):
            return [{"name": "N", "results": "[]", "attempted_rows": "[1,2,3]",
                     "scope_rows": scope_json}]

        for stored, expected in (
            ("[16, 22]", {16, 22}),      # POSITIVE -- scoped
            (None, None),                # NEGATIVE 1 -- whole-sheet, unchanged
            ("[]", set()),               # NEGATIVE 2 -- scoped-but-empty, NOT None
        ):
            with mock.patch.object(frappe, "get_all", return_value=_doc(stored)), \
                 mock.patch.object(frappe.db, "set_value"), \
                 mock.patch.object(frappe.db, "commit"):
                out = rate_master._open_run_doc("B", "S", 4, "J", "u", "RID")
            self.assertEqual(len(out), 5, "the scope must be the 5th return value")
            self.assertEqual(out[4], expected, "stored %r -> %r" % (stored, expected))

    def test_84_a_halted_scoped_run_resumes_SCOPED_and_never_touches_carried_rows(self):
        """THE FIX, on the real worker. A 4-row scoped run halted after 2: the document carries the
        whole 94-row population as attempted (the carry seeds it) and its scope_rows holds the two
        rows still to do.

        POSITIVE: the resume processes EXACTLY those two.
        NEGATIVE (the damage pin): it touches NO carried row -- the resume's processing set and the
        rows the run carried forward are disjoint."""
        population = list(range(1, 95))
        carried_attempted = set(population)          # what the carry seeded
        remaining_scope = {30, 36}                   # scope_rows after the halt

        processed, payload = self._resume_processed_rows(
            population, carried_attempted, remaining_scope)

        # POSITIVE -- exactly the remaining scoped rows
        self.assertEqual(processed, [30, 36])
        self.assertEqual(payload.get("scoped_row_count"), 2)

        # NEGATIVE -- not one carried row was re-extracted
        carried = set(population) - remaining_scope
        self.assertEqual(sorted(set(processed) & carried), [],
                         "a scoped resume must never re-extract a carried row")
        self.assertLess(len(processed), len(population))

    def test_85_a_whole_sheet_halted_run_resumes_EXACTLY_as_before(self):
        """G6 / the backwards-compat pin. A whole-sheet run stores NULL scope_rows, so the resume
        takes the untouched `population - attempted` path: same rows, same count as before this
        slice. Every document already in the database is this shape."""
        population = list(range(1, 95))
        already_done = set(range(1, 13))             # 12 rows finished before the halt

        processed, payload = self._resume_processed_rows(
            population, already_done, None)          # NULL scope -> whole-sheet

        self.assertEqual(processed, sorted(set(population) - already_done))
        self.assertEqual(len(processed), 82)
        self.assertIsNone(payload.get("scoped_row_count"),
                          "a whole-sheet resume must not claim a scope")

    def test_86_the_persisted_scope_shrinks_and_is_the_ONE_source(self):
        """The scope is rewritten as the run progresses, so a later resume gets the remainder --
        and `get_active_suggestion_run` quotes THAT SAME value rather than computing its own.

        POSITIVE: _finalise_run persists (scope - attempted-this-pass).
        NEGATIVE: a whole-sheet pass (scope_pending None) never writes the column at all, so an
        existing document's shape is untouched."""
        wrote = {}
        with mock.patch.object(frappe.db, "set_value",
                               side_effect=lambda dt, n, values, **kw: wrote.update(values)):
            rate_master._finalise_run("N", 4, "ran", [], {1, 2}, complete=False,
                                      halt_reason="stopped", boq="B", sheet_name="S",
                                      scope_pending={30, 36})
        self.assertEqual(json.loads(wrote["scope_rows"]), [30, 36])

        wrote2 = {}
        with mock.patch.object(frappe.db, "set_value",
                               side_effect=lambda dt, n, values, **kw: wrote2.update(values)):
            rate_master._finalise_run("N", 4, "ran", [], {1, 2}, complete=False,
                                      halt_reason="stopped", boq="B", sheet_name="S",
                                      scope_pending=None)
        self.assertNotIn("scope_rows", wrote2)

        # ONE SOURCE -- the read surfaces the STORED value, not a second computation
        partial = {"run_id": "R", "committed_version": 4, "status": "partial",
                   "attempted_rows": "[1,2,3]", "halt_reason": "x", "results": "[]",
                   "scope_rows": "[30, 36]"}
        with mock.patch.object(frappe, "get_all", side_effect=[[], [dict(partial)]]), \
             mock.patch.object(rate_master, "_population_rows", return_value={1, 2, 3}):
            out = rate_master.get_active_suggestion_run(boq="B", sheet_name="S")
        self.assertEqual(out["partial_run"]["scope_pending"], [30, 36])
        self.assertEqual(out["partial_run"]["scope_pending_count"], 2)

        with mock.patch.object(frappe, "get_all", side_effect=[[], [dict(partial, scope_rows=None)]]), \
             mock.patch.object(rate_master, "_population_rows", return_value={1, 2, 3}):
            out2 = rate_master.get_active_suggestion_run(boq="B", sheet_name="S")
        self.assertIsNone(out2["partial_run"]["scope_pending_count"])

    # ══════════════════════════════════════════════════════════════════════════════════════
    # SLICE 6 -- THE CSV UPLOAD (preview -> confirm -> apply). The FIRST write path into the
    # live catalog from a file a human edited.
    #
    # Plain-English coverage summary (test -> changed behaviour):
    #   87   THE ROUND TRIP IS A NO-OP. Downloading a category and uploading it back UNEDITED
    #        reports zero changes and zero errors. This is the single strongest property in the
    #        slice: it proves the blank-cell rules, the type-strict comparison and the value
    #        coercion all agree with what csv_exporter emitted -- one live attribute holds ""
    #        and two live rates hold null, and none of them may show up as a spurious edit.
    #   88   A rate edit updates exactly ONE item and leaves the rest untouched, keeping the
    #        uid; freeze-and-supersede holds (the prior row is RETAINED at active=0).
    #   89   A blank item_uid ADDS an item with a freshly minted `rmi-` uid and honest
    #        provenance, rather than failing or silently matching something by content.
    #   90   A PARTIAL file (two rows out of a whole category) leaves every absent item ACTIVE
    #        and byte-unchanged -- the safety property of the entire feature.
    #   91   MODE A and MODE B both parse, and the mode is DETECTED by the `category` column.
    #        Both are no-ops when unedited; the upsert itself is uid-keyed and mode-independent.
    #   92   A rate move of >=10% IN EITHER DIRECTION is flagged `major` (expanded by default),
    #        a 5% move is not, and a move a percentage cannot describe (a rate appearing) is
    #        major too. Every ADD is major.
    #   93   The SNAPSHOT is written BEFORE the write and holds the PRE-upload rate -- which is
    #        what makes it a rollback path rather than a receipt.
    #   94   NEGATIVE: a non-admin is refused on BOTH endpoints, before anything is read.
    #   95   NEGATIVE: an item_uid the catalog does not carry is REJECTED BY NAME, never
    #        inserted -- a stale file must not mint a duplicate of a real item.
    #   96   NEGATIVE: one malformed row rejects the WHOLE file; nothing is applied and no
    #        snapshot is written.
    #   96b  NEGATIVE (the transactional guarantee itself): a failure MID-WRITE leaves the
    #        transaction uncommitted, so a rollback restores the catalog AND removes the
    #        snapshot -- the snapshot can never exist for an upload that did not land.
    #   97   NEGATIVE: THE PREVIEW WRITES NOTHING -- item rows, snapshots and every document
    #        name are identical before and after previewing a heavily edited file.
    #   98   NEGATIVE: Excel mangling appears as a CHANGE and never slips through as unchanged
    #        (re-spacing, trailing whitespace, a date for `16/20A`), while a numerically
    #        identical `2.0` -> `2` correctly stays unchanged.
    #   99   NEGATIVE: a stale digest refuses the apply -- the honest answer when the catalog
    #        moved between preview and confirm.
    #   100  NEGATIVE: an unknown column, a missing item_uid column, a duplicated column and a
    #        duplicated uid are each named, and a header problem stops the row pass rather than
    #        deriving nonsense from mis-positioned cells.
    #   101  classify_columns is PURE and refuses a name that is both an attribute and a rate
    #        key -- the file would be ambiguous and the import cannot repair the export.

    # ---- slice 6 helpers ----
    def _csv_parts(self, text):
        import csv as _csv
        rows = list(_csv.reader(io.StringIO(text.lstrip(BOM))))
        return rows[0], rows[1:]

    def _csv_text(self, headers, rows):
        import csv as _csv
        buf = io.StringIO()
        w = _csv.writer(buf, lineterminator="\r\n")
        w.writerow(headers)
        for r in rows:
            w.writerow(r)
        return BOM + buf.getvalue()

    def _loaded_disc(self):
        disc = self._new_disc()
        loader.load_rate_master(payload=self._merged_payload(disc))
        return disc

    def _picks_with(self, rows, idx, n=1):
        """Indices of the first n rows carrying a VALUE in column idx.

        The catalog is SPARSE by construction -- a tray row has nothing to say about most of the
        union's rate keys -- so a positional pick lands on a blank as often as not, and editing a
        blank cell tests the blank rule rather than the edit rule."""
        picks = [i for i, r in enumerate(rows) if (r[idx] or "").strip() != ""]
        self.assertGreaterEqual(len(picks), n, "fixture: not enough populated rows")
        return picks[:n]

    def _first_with(self, rows, idx):
        return self._picks_with(rows, idx, 1)[0]

    def _picks_measurable_at_ten_percent(self, rows, idx, n=3):
        """Indices of the first n rows whose stored value makes a +-10% edit measurable as major.

        ✅ F-21 IS FIXED (2026-08-14), so this picker is no longer routing around a defect. The
        classifier now ROUNDS before comparing (`round(abs(pct), 6) >= MAJOR_RATE_CHANGE_PCT`), so
        an exactly -10% edit is major whatever the float does -- which is what the docstring's
        "AT OR ABOVE" promise always claimed. Its own boundary coverage is `test_f21a`/`test_f21b`.

        WHAT THIS PICKER IS NOW: belt-and-braces VALUE HYGIENE for a fixture that needs rows it can
        do arithmetic on. Its live-behaviour half is inert post-fix -- every non-zero row qualifies
        -- and it is kept because the ZERO EXCLUSION is still load-bearing: `x1.05` leaves a zero
        UNCHANGED, so such a row never appears in plan["changes"] and the lookup would KeyError,
        and its percentage would be a divide-by-zero.

        ⚠️ FACT UPDATED AT THE v41 DEPLOYMENT RE-MINT (2026-08-18). This line used to read "31 rows
        in this column are zeros". Those same 31 cable rows are now NULL, not 0.0 -- the production
        re-entry cleared them, and an absent rate REFUSES where 0.0 silently priced supply at zero.
        The picker is UNAFFECTED and needed no code change: the blank guard immediately below runs
        BEFORE the zero check, so an empty cell was always skipped first. The zero exclusion stays
        because it guards a real shape, not because this column still contains one.

        ⚠️ Do NOT read the surviving `>= 10.0` comparisons below as the product's rule. They are a
        fixture filter; the product's rule lives in `csv_importer._diff_fields` and is rounded."""
        def pct(old, new):
            return (new - old) / abs(old) * 100.0

        picks = []
        for i, r in enumerate(rows):
            raw = (r[idx] or "").strip()
            if not raw:
                continue
            v = float(raw)
            if v == 0.0:
                continue
            # round-trip through str() exactly as the fixture writes the cell back
            up, dn = float(str(v * 1.10)), float(str(v * 0.90))
            if abs(pct(v, up)) >= 10.0 and abs(pct(v, dn)) >= 10.0:
                picks.append(i)
            if len(picks) == n:
                break
        self.assertGreaterEqual(len(picks), n,
                                "fixture: not enough rows whose +-10% edit is measurable")
        return picks

    def _active_rows(self, disc):
        return {
            r["item_uid"]: r
            for r in frappe.get_all(
                "BoQ Rate Master Item", filters={"discipline": disc, "active": 1},
                fields=["name", "item_uid", "kind", "brand", "unit", "attributes", "rates",
                        "source_sheet", "source_row", "import_batch"])
        }

    # ---- slice 6 tests ----
    def test_87_an_untouched_round_trip_changes_nothing(self):
        """THE ROUND TRIP IS A NO-OP -- the property the whole upsert rests on.

        If downloading and re-uploading an unedited file reported changes, every real preview would
        be buried in noise and the >=10% rule would be useless. It holds only because a blank cell
        means 'empty or absent' and is compared against the STORED value rather than re-derived:
        one live attribute holds "" and two live rates hold null, and all three must survive."""
        from nirmaan_stack.services.boq_rate_master import csv_exporter, csv_importer

        disc = self._loaded_disc()
        text, _headers, n = csv_exporter.build_category_csv(disc, "cabletray_raceway")
        plan = csv_importer.build_plan(disc, text)

        self.assertEqual(plan["errors"], [])
        self.assertEqual(plan["changes"], [])
        self.assertEqual(plan["counts"]["unchanged"], n)
        self.assertEqual(plan["counts"]["rates_changed"], 0)
        self.assertEqual(plan["counts"]["items_added"], 0)
        self.assertEqual(plan["counts"]["other_changed"], 0)
        self.assertEqual(plan["mode"], "category")
        self.assertEqual(plan["encoding"], "utf-8")

        # ...and applying a no-op writes nothing at all -- not even a snapshot, since there is
        # nothing to roll back to and one would evict a real snapshot from the keep-10.
        before = frappe.db.count("BoQ Rate Master Item", {"discipline": disc})
        res = csv_importer.apply_plan(disc, text)
        self.assertEqual(res["applied"], 0)
        self.assertIsNone(res["snapshot"])
        self.assertEqual(frappe.db.count("BoQ Rate Master Item", {"discipline": disc}), before)

    def test_88_a_rate_edit_updates_one_item_and_leaves_the_rest_untouched(self):
        """POSITIVE: the ordinary case, and the freeze-and-supersede shape underneath it."""
        from nirmaan_stack.services.boq_rate_master import csv_exporter, csv_importer

        disc = self._loaded_disc()
        text, _h, n = csv_exporter.build_category_csv(disc, "cabletray_raceway")
        headers, rows = self._csv_parts(text)
        ri = headers.index("install_rate")
        pick = self._first_with(rows, ri)
        target_uid = rows[pick][0]
        old_rate = float(rows[pick][ri])
        rows[pick][ri] = str(old_rate * 2)
        edited = self._csv_text(headers, rows)

        before = self._active_rows(disc)
        plan = csv_importer.build_plan(disc, edited)
        self.assertEqual(plan["errors"], [])
        self.assertEqual(len(plan["changes"]), 1)
        self.assertEqual(plan["counts"]["rates_changed"], 1)
        self.assertEqual(plan["counts"]["unchanged"], n - 1)
        ch = plan["changes"][0]
        self.assertEqual(ch["kind"], "update")
        self.assertEqual(ch["item_uid"], target_uid)
        self.assertTrue(ch["major"])                       # doubling is >= 10%
        field = next(f for f in ch["fields"] if f["column"] == "install_rate")
        self.assertEqual(field["space"], "rate")
        self.assertEqual(field["pct"], 100.0)

        res = csv_importer.apply_plan(disc, edited)
        frappe.db.commit()
        self.assertEqual((res["applied"], res["items_replaced"], res["items_added"]), (1, 1, 0))

        after = self._active_rows(disc)
        self.assertEqual(set(after), set(before))          # the uid set is unchanged
        self.assertEqual(_obj(after[target_uid]["rates"])["install_rate"], old_rate * 2)
        # FREEZE-AND-SUPERSEDE: a NEW document carries the uid; the prior one is RETAINED inactive.
        self.assertNotEqual(after[target_uid]["name"], before[target_uid]["name"])
        self.assertEqual(
            frappe.db.get_value("BoQ Rate Master Item", before[target_uid]["name"], "active"), 0)
        self.assertEqual(after[target_uid]["import_batch"], res["batch"])
        self.assertTrue(res["batch"].startswith(csv_importer.BATCH_PREFIX))
        # EVERY other item is the SAME DOCUMENT -- not rewritten, not re-inserted, not touched.
        for uid, row in before.items():
            if uid == target_uid:
                continue
            self.assertEqual(after[uid]["name"], row["name"])

    def test_89_a_blank_uid_adds_an_item_with_a_fresh_uid(self):
        """POSITIVE: 'blank id means add' -- the other half of why item_uid exists."""
        from nirmaan_stack.services.boq_rate_master import csv_exporter, csv_importer

        disc = self._loaded_disc()
        text, _h, _n = csv_exporter.build_category_csv(disc, "cabletray_raceway")
        headers, rows = self._csv_parts(text)
        new_row = list(rows[0])
        new_row[0] = ""                                       # blank uid -> ADD
        new_row[headers.index("width_mm")] = "999.0"
        new_row[headers.index("source_sheet")] = ""
        new_row[headers.index("source_row")] = ""
        rows.append(new_row)
        edited = self._csv_text(headers, rows)

        plan = csv_importer.build_plan(disc, edited)
        self.assertEqual(plan["errors"], [])
        self.assertEqual(plan["counts"]["items_added"], 1)
        self.assertEqual(len(plan["changes"]), 1)
        self.assertTrue(plan["changes"][0]["major"], "every new item is expanded by default")

        before_uids = set(self._active_rows(disc))
        res = csv_importer.apply_plan(disc, edited)
        frappe.db.commit()
        self.assertEqual((res["items_added"], res["items_replaced"]), (1, 0))

        after = self._active_rows(disc)
        minted = set(after) - before_uids
        self.assertEqual(len(minted), 1)
        uid = minted.pop()
        self.assertTrue(uid.startswith("rmi-"))
        self.assertEqual(len(uid), len("rmi-") + 12)
        row = after[uid]
        self.assertEqual(_obj(row["attributes"])["width_mm"], 999.0)
        # honest provenance rather than a copied source line
        self.assertEqual(row["source_sheet"], csv_importer.DEFAULT_SOURCE_SHEET)
        self.assertEqual(row["source_row"], len(rows))

    def test_90_a_partial_file_leaves_absent_items_active(self):
        """THE SAFETY PROPERTY: a partial upload can never delete anything.

        This is the ONE behaviour that separates this write path from loader.replace=True, which
        supersedes an entire scope and would deactivate all 458 rows the file omits."""
        from nirmaan_stack.services.boq_rate_master import csv_exporter, csv_importer

        disc = self._loaded_disc()
        text, _h, n = csv_exporter.build_category_csv(disc, "cabletray_raceway")
        headers, rows = self._csv_parts(text)
        ri = headers.index("install_rate")
        keep = [list(rows[i]) for i in self._picks_with(rows, ri, 2)]
        keep[0][ri] = str(float(keep[0][ri]) + 7)
        partial = self._csv_text(headers, keep)

        before = self._active_rows(disc)
        self.assertGreater(len(before), 400)
        plan = csv_importer.build_plan(disc, partial)
        self.assertEqual(plan["errors"], [])
        self.assertEqual(plan["row_count"], 2)
        self.assertEqual(len(plan["changes"]), 1)

        csv_importer.apply_plan(disc, partial)
        frappe.db.commit()

        after = self._active_rows(disc)
        self.assertEqual(len(after), len(before), "not one absent item was deactivated")
        touched = keep[0][0]
        for uid, row in before.items():
            if uid == touched:
                continue
            self.assertEqual(after[uid]["name"], row["name"])
            self.assertEqual(_obj(after[uid]["rates"]), _obj(row["rates"]))
            self.assertEqual(after[uid]["import_batch"], row["import_batch"])

    def test_91_mode_a_and_mode_b_both_parse(self):
        """POSITIVE: the mode is DETECTED by the `category` column and is informational only --
        items carry no category, so the uid-keyed upsert is mode-independent."""
        from nirmaan_stack.services.boq_rate_master import csv_exporter, csv_importer

        disc = self._loaded_disc()
        a_text, _ha, na = csv_exporter.build_category_csv(disc, "junction_box_raceway")
        b_text, _hb, nb = csv_exporter.build_all_categories_csv(disc)

        plan_a = csv_importer.build_plan(disc, a_text)
        self.assertEqual(plan_a["mode"], "category")
        self.assertNotIn("category", plan_a["columns"]["fixed"])
        self.assertEqual((plan_a["errors"], plan_a["changes"]), ([], []))
        self.assertEqual(plan_a["counts"]["unchanged"], na)

        plan_b = csv_importer.build_plan(disc, b_text)
        self.assertEqual(plan_b["mode"], "all")
        self.assertIn("category", plan_b["columns"]["fixed"])
        self.assertEqual((plan_b["errors"], plan_b["changes"]), ([], []))
        self.assertEqual(plan_b["counts"]["unchanged"], nb)

        # MODE B's category column is DERIVED from the kind and is never stored, so a value
        # disagreeing with the kind is refused rather than silently discarded.
        headers, rows = self._csv_parts(b_text)
        cat_i = headers.index("category")
        # ⚠️ pick a row that is NOT already wiring_cabling -- the file is ordered by kind, and
        # `cable` sorts first, so rows[0] IS wiring_cabling and re-stating it is a no-op.
        victim = next(r for r in rows if r[cat_i] not in ("", "wiring_cabling"))
        victim[cat_i] = "wiring_cabling"
        bad = csv_importer.build_plan(disc, self._csv_text(headers, rows))
        self.assertTrue(any("does not match kind" in e["message"] for e in bad["errors"]))

    # ---- F-21 (2026-08-14): the >=10% boundary keeps its own promise -------------------
    # Plain-English coverage summary (test -> changed behaviour):
    #   f21a  an EXACTLY -10% edit is MAJOR even when the 0.90 multiple is not representable.
    #         This is the whole defect: `(new-old)/abs(old)*100` returned -9.999999999999993 and
    #         `abs(pct) >= 10.0` said no, so the row folded away behind a count -- in the one
    #         direction that quotes LOW. 60% of integer rupee rates 1..20000 were affected.
    #   f21b  NEGATIVE twin: -9.99% STAYS minor. The threshold MOVED, it did not dissolve.
    #   f21c  the per-field flag: one change carrying a major AND a minor rate field flags them
    #         separately, and the change-level flag is "any field major".
    #   f21d  the DIGEST is unchanged by the new field key -- proven, not assumed.
    #
    # ⚠️ THE ROW IS FOUND BY ITS FLOAT BEHAVIOUR, NEVER HARDCODED. Whether `old * 0.90` lands a
    # hair short of -10% depends on the value: 399.0 -> 359.1 gives -9.999999999999993 and is the
    # case under test, while 605.0 -> 544.5 gives exactly -10.0 and proves nothing. 234 of the 450
    # tray rows are in the short class today, but WHICH ones is a property of the live catalog, so
    # a hardcoded pair would rot silently into a test that passes without testing anything.
    F21_RATE_COL = "without_cover_list"

    def _f21_short_row(self, disc):
        """(headers, rows, idx, old) for the first cabletray row whose `old * 0.90` lands SHORT of
        -10% under the raw arithmetic -- i.e. a row the pre-F-21 classifier got wrong."""
        from nirmaan_stack.services.boq_rate_master import csv_exporter
        text, _h, _n = csv_exporter.build_category_csv(disc, "cabletray_raceway")
        headers, rows = self._csv_parts(text)
        ci = headers.index(self.F21_RATE_COL)
        for idx, r in enumerate(rows):
            old = float(r[ci])
            if old and abs((old * 0.90 - old) / abs(old) * 100.0) < 10.0:
                return headers, rows, idx, old
        self.fail("fixture: no tray row lands short of -10% -- the boundary case is unreachable")

    def _f21_plan_for(self, disc, headers, rows, idx, edits):
        """Preview ONE edited row. Preview only -- nothing is applied, nothing is written."""
        from nirmaan_stack.services.boq_rate_master import csv_importer
        row = list(rows[idx])
        for col, val in edits.items():
            row[headers.index(col)] = val
        plan = csv_importer.build_plan(disc, self._csv_text(headers, [row]))
        self.assertEqual(plan["errors"], [])
        return plan, plan["changes"][0]

    def test_f21a_an_exactly_ten_percent_drop_is_major_even_when_the_float_lands_short(self):
        """POSITIVE -- F-21, and this test FAILS on the pre-fix code.

        The promise is stated three times ('a rate change AT OR ABOVE this', 'a rate move of 10%
        or more', '>= 10% IN EITHER DIRECTION') and the code did not keep it: an exactly -10%
        edit on a value whose 0.90 multiple is not representable computed -9.999999999999993, so
        `abs(pct) >= 10.0` was False and the row collapsed behind a count.

        The fix is ROUND-THEN-COMPARE at 6 decimal places -- the module's own idiom, since it
        already rounds this same value to 2dp one line later for display."""
        disc = self._loaded_disc()
        headers, rows, idx, old = self._f21_short_row(disc)
        new = old * 0.90
        # the raw arithmetic really does land short -- this IS the condition under test
        self.assertLess(abs((new - old) / abs(old) * 100.0), 10.0)
        _plan, change = self._f21_plan_for(disc, headers, rows, idx,
                                           {self.F21_RATE_COL: repr(new)})
        fld = next(f for f in change["fields"] if f["column"] == self.F21_RATE_COL)
        self.assertEqual(fld["pct"], -10.0)          # what the user is SHOWN, rounded to 2dp
        self.assertTrue(fld["major"], "an exactly -10% move must be MAJOR (F-21)")
        self.assertTrue(change["major"])

    def test_f21b_a_move_just_inside_the_threshold_stays_minor(self):
        """NEGATIVE twin -- the threshold MOVED, it did not DISSOLVE.

        Without this, 'fix the boundary' and 'lower the boundary' are indistinguishable. -9.99%
        is a real, deliberate near-miss and must still collapse behind a count."""
        disc = self._loaded_disc()
        headers, rows, idx, old = self._f21_short_row(disc)
        near = round(old * 0.9001, 6)                  # -9.99%
        _plan, change = self._f21_plan_for(disc, headers, rows, idx,
                                           {self.F21_RATE_COL: repr(near)})
        fld = next(f for f in change["fields"] if f["column"] == self.F21_RATE_COL)
        self.assertAlmostEqual(fld["pct"], -9.99, places=2)
        self.assertFalse(fld["major"], "-9.99% is not a 10% move")
        self.assertFalse(change["major"])

    def test_f21c_the_major_flag_is_per_field_and_the_change_is_any(self):
        """POSITIVE -- ONE DEFINITION (F-21 R2).

        The dialog used to decide its own colour from `Math.abs(f.pct) >= 10`, a SECOND definition
        of the threshold reading the ROUNDED percentage. At the boundary the two disagreed and the
        row rendered RED while sitting COLLAPSED -- the UI saying 'big move' and 'not worth
        showing' about the same row. The server now emits the verdict PER FIELD so the colour can
        read it instead of recomputing it."""
        disc = self._loaded_disc()
        headers, rows, idx, old = self._f21_short_row(disc)
        other_old = float(rows[idx][headers.index("cover_only_list")])
        _plan, change = self._f21_plan_for(disc, headers, rows, idx, {
            self.F21_RATE_COL: repr(old * 0.90),                    # exactly -10% -> major
            "cover_only_list": repr(round(other_old * 0.98, 6)),    # -2% -> minor
        })
        by_col = {f["column"]: f for f in change["fields"]}
        self.assertTrue(by_col["without_cover_list"]["major"])
        self.assertFalse(by_col["cover_only_list"]["major"])
        self.assertTrue(change["major"], "change-level major is ANY field major")
        # a NON-rate field carries no verdict at all -- a percentage is meaningless there
        for f in change["fields"]:
            if f["space"] != "rate":
                self.assertNotIn("major", f)

    def test_f21d_the_new_field_key_does_not_move_the_digest(self):
        """NEGATIVE -- the stale-preview guard must be untouched by a DISPLAY addition.

        `_digest` fingerprints (row, kind, uid, name, (column, old, new)). If the per-field flag
        leaked into it, every previously-issued digest would stop matching and every in-flight
        preview would be refused with 'the catalog moved' -- a false alarm about the wrong thing.
        Recomputed here from the same inputs rather than asserted from a constant."""
        from nirmaan_stack.services.boq_rate_master import csv_importer
        disc = self._loaded_disc()
        headers, rows, idx, old = self._f21_short_row(disc)
        plan, _change = self._f21_plan_for(disc, headers, rows, idx,
                                           {self.F21_RATE_COL: repr(old * 0.90)})
        stripped = json.loads(json.dumps(plan, default=str))
        for c in stripped["changes"]:
            for f in c["fields"]:
                f.pop("major", None)          # the pre-F-21 field shape
        self.assertEqual(csv_importer._digest(disc, stripped), plan["digest"],
                         "the per-field flag must not enter the digest")

    def test_92_a_ten_percent_move_in_either_direction_is_major(self):
        """POSITIVE: the expansion rule, exactly as ruled.

        26,100 typed for 2,610 is invisible in a count and 261 for 2,610 quotes catastrophically
        low -- BOTH directions matter, so the threshold is on the absolute move.

        F-16 (owner ruling R3) MOVED this fixture from cabletray_raceway to wiring_cabling. The
        appearing-rate case needs a GENUINELY blank rate cell, and the tray category's blanks were
        never its own: they were borrowed from the 10 tray_install_rate rows, which shared the
        category and carry no cover rates. F-16 retired that kind, so cabletray_raceway is now
        FULLY DENSE -- all 450 rows carry all four rates -- and no appearing-rate case exists in it
        at all. wiring_cabling is genuinely sparse for a structural reason that will not go away:
        it spans two kinds with disjoint rate keys, so its 292 cable rows carry no lug/gland rates
        and its 296 termination rows carry no per-metre rates. The assertion is UNWEAKENED; only
        the category supplying the blank changed."""
        from nirmaan_stack.services.boq_rate_master import csv_exporter, csv_importer

        disc = self._loaded_disc()
        text, _h, _n = csv_exporter.build_category_csv(disc, "wiring_cabling")
        headers, rows = self._csv_parts(text)
        ri = headers.index("list_price_per_mtr")   # carried by the cable rows
        ci = headers.index("lug_list")             # blank on every cable row

        # F-21: pick rows whose +-10% edit is MEASURABLE, and never a 0.0 row -- see the picker's
        # docstring. The boundary's downward float-fragility is a real product edge, recorded and
        # owner-parked; it is accommodated here, not hidden and not fixed.
        picks = self._picks_measurable_at_ten_percent(rows, ri, 3)
        up, down, small = (list(rows[i]) for i in picks)
        up[ri] = str(float(up[ri]) * 1.10)          # exactly +10%
        down[ri] = str(float(down[ri]) * 0.90)      # exactly -10%
        small[ri] = str(float(small[ri]) * 1.05)    # +5%
        ai = next(i for i, r in enumerate(rows) if r[ci] == "" and i not in picks)
        appear = list(rows[ai])
        appear[ci] = "12.5"                         # a rate APPEARING -- no percentage exists

        plan = csv_importer.build_plan(disc, self._csv_text(headers, [up, down, small, appear]))
        self.assertEqual(plan["errors"], [])
        by_uid = {c["item_uid"]: c for c in plan["changes"]}
        self.assertTrue(by_uid[up[0]]["major"])
        self.assertTrue(by_uid[down[0]]["major"])
        self.assertFalse(by_uid[small[0]]["major"], "a 5% move collapses behind a count")
        self.assertTrue(by_uid[appear[0]]["major"], "a move a percentage cannot describe is major")

        # F-16: the columns follow the fixture's move to wiring_cabling (were install_rate /
        # cover_only_list, the tray pair).
        pct_up = next(f["pct"] for f in by_uid[up[0]]["fields"]
                      if f["column"] == "list_price_per_mtr")
        pct_dn = next(f["pct"] for f in by_uid[down[0]]["fields"]
                      if f["column"] == "list_price_per_mtr")
        self.assertAlmostEqual(pct_up, 10.0, places=2)
        self.assertAlmostEqual(pct_dn, -10.0, places=2)
        self.assertIsNone(next(f["pct"] for f in by_uid[appear[0]]["fields"]
                               if f["column"] == "lug_list"))
        # nothing about computing a preview writes
        self.assertEqual(frappe.db.count("BoQ Rate Master Snapshot", {"discipline": disc}), 0)

    def test_93_the_snapshot_is_written_before_the_write(self):
        """POSITIVE: an upload with no snapshot behind it is unrecoverable, so the snapshot is
        taken FIRST and must therefore hold the PRE-upload value."""
        from nirmaan_stack.services.boq_rate_master import csv_exporter, csv_importer

        disc = self._loaded_disc()
        text, _h, _n = csv_exporter.build_category_csv(disc, "cabletray_raceway")
        headers, rows = self._csv_parts(text)
        ri = headers.index("install_rate")
        pick = self._first_with(rows, ri)
        uid, old_rate = rows[pick][0], float(rows[pick][ri])
        rows[pick][ri] = str(old_rate + 111)

        self.assertEqual(frappe.db.count("BoQ Rate Master Snapshot", {"discipline": disc}), 0)
        res = csv_importer.apply_plan(disc, self._csv_text(headers, rows))
        frappe.db.commit()

        self.assertIsNotNone(res["snapshot"])
        snap = frappe.get_doc("BoQ Rate Master Snapshot", res["snapshot"])
        self.assertEqual(snap.discipline, disc)
        stored = json.loads(snap.payload)
        item = next(i for i in stored["items"] if i["item_uid"] == uid)
        self.assertEqual(item["rates"]["install_rate"], old_rate,
                         "the snapshot must hold the PRE-upload rate -- it is the rollback path")
        # ...while the live catalog holds the new one
        self.assertEqual(_obj(self._active_rows(disc)[uid]["rates"])["install_rate"],
                         old_rate + 111)

    def test_94_both_upload_endpoints_refuse_a_non_admin(self):
        """NEGATIVE: gate first, on BOTH. The preview is read-only but it renders the whole
        catalog's deltas, so it is exactly as sensitive as the download it is paired with."""
        from nirmaan_stack.services.boq_rate_master import csv_exporter

        disc = self._loaded_disc()
        text, _h, _n = csv_exporter.build_category_csv(disc, "junction_box_raceway")
        b64 = base64.b64encode(text.encode("utf-8")).decode("ascii")

        original = frappe.session.user
        try:
            frappe.set_user("Guest")
            with self.assertRaises(frappe.PermissionError):
                rate_master.preview_rate_master_csv(discipline=disc, content_base64=b64)
            with self.assertRaises(frappe.PermissionError):
                rate_master.apply_rate_master_csv(discipline=disc, content_base64=b64)
        finally:
            frappe.set_user(original)

        # POSITIVE twin: as admin both are reachable, and the plan carries no internal payloads.
        plan = rate_master.preview_rate_master_csv(discipline=disc, content_base64=b64)
        self.assertEqual(plan["errors"], [])
        self.assertEqual(plan["changes"], [])
        self.assertIn("digest", plan)
        res = rate_master.apply_rate_master_csv(discipline=disc, content_base64=b64,
                                                expected_digest=plan["digest"])
        self.assertEqual(res["applied"], 0)

    def test_95_an_unknown_item_uid_is_rejected_by_name(self):
        """NEGATIVE: a uid the catalog does not carry means a STALE FILE or a hand-typed id.
        Inserting it would mint a silent duplicate of a real item -- the exact failure item_uid
        exists to prevent -- so it is an error, named."""
        from nirmaan_stack.services.boq_rate_master import csv_exporter, csv_importer

        disc = self._loaded_disc()
        text, _h, _n = csv_exporter.build_category_csv(disc, "junction_box_raceway")
        headers, rows = self._csv_parts(text)
        rows[0][0] = "rmi-deadbeefcafe"
        bad = self._csv_text(headers, rows)

        plan = csv_importer.build_plan(disc, bad)
        self.assertTrue(any("rmi-deadbeefcafe" in e["message"] for e in plan["errors"]))
        self.assertTrue(any("Unknown item_uid" in e["message"] for e in plan["errors"]))
        self.assertEqual(plan["changes"], [], "an unknown uid is never treated as an insert")

        before = frappe.db.count("BoQ Rate Master Item", {"discipline": disc})
        with self.assertRaises(frappe.ValidationError):
            csv_importer.apply_plan(disc, bad)
        self.assertEqual(frappe.db.count("BoQ Rate Master Item", {"discipline": disc}), before)
        self.assertEqual(frappe.db.count("BoQ Rate Master Snapshot", {"discipline": disc}), 0)

    def test_96_a_malformed_row_rejects_the_whole_file(self):
        """NEGATIVE: ALL-OR-NOTHING. Three good edits and one bad cell -- nothing is applied, and
        no snapshot is written for an upload that never happened."""
        from nirmaan_stack.services.boq_rate_master import csv_exporter, csv_importer

        disc = self._loaded_disc()
        text, _h, _n = csv_exporter.build_category_csv(disc, "cabletray_raceway")
        headers, rows = self._csv_parts(text)
        ri = headers.index("install_rate")
        picks = self._picks_with(rows, ri, 4)
        for i in picks[:3]:
            rows[i][ri] = str(float(rows[i][ri]) + 5)
        rows[picks[3]][ri] = "1,234.50"   # Excel's thousands separator -- refused, never "repaired"
        bad = self._csv_text(headers, rows)

        plan = csv_importer.build_plan(disc, bad)
        self.assertEqual(len(plan["errors"]), 1)
        self.assertIn("1,234.50", plan["errors"][0]["message"])
        self.assertEqual(len(plan["changes"]), 3, "the good rows are still described")

        before = self._active_rows(disc)
        with self.assertRaises(frappe.ValidationError):
            csv_importer.apply_plan(disc, bad)
        after = self._active_rows(disc)
        for uid, row in before.items():
            self.assertEqual(after[uid]["name"], row["name"])
            self.assertEqual(_obj(after[uid]["rates"]), _obj(row["rates"]))
        self.assertEqual(frappe.db.count("BoQ Rate Master Snapshot", {"discipline": disc}), 0)

    def test_96b_a_failure_mid_write_leaves_nothing_behind(self):
        """NEGATIVE -- THE TRANSACTIONAL GUARANTEE ITSELF, not merely the validation in front of it.

        Every write rides the ONE transaction Frappe opens for the request, and apply_plan never
        commits; the endpoint's single commit is the only one. A failure after the first insert
        therefore leaves the whole thing uncommitted -- INCLUDING the snapshot, which can never
        exist for an upload that did not land."""
        from nirmaan_stack.services.boq_rate_master import csv_exporter

        disc = self._loaded_disc()
        text, _h, _n = csv_exporter.build_category_csv(disc, "cabletray_raceway")
        headers, rows = self._csv_parts(text)
        ri = headers.index("install_rate")
        for i in self._picks_with(rows, ri, 3):
            rows[i][ri] = str(float(rows[i][ri]) + 5)
        edited = self._csv_text(headers, rows)

        before = self._active_rows(disc)
        real_get_doc = frappe.get_doc
        seen = {"n": 0}

        def boom(*args, **kwargs):
            d = args[0] if args else kwargs
            if isinstance(d, dict) and d.get("doctype") == "BoQ Rate Master Item":
                seen["n"] += 1
                if seen["n"] == 2:
                    raise RuntimeError("simulated failure mid-write")
            return real_get_doc(*args, **kwargs)

        with mock.patch.object(frappe, "get_doc", side_effect=boom):
            with self.assertRaises(RuntimeError):
                rate_master.apply_rate_master_csv(discipline=disc, csv_text=edited)
        frappe.db.rollback()   # what Frappe does at request teardown when nothing committed

        after = self._active_rows(disc)
        self.assertEqual(set(after), set(before))
        for uid, row in before.items():
            self.assertEqual(after[uid]["name"], row["name"])
            self.assertEqual(_obj(after[uid]["rates"]), _obj(row["rates"]))
        self.assertEqual(frappe.db.count("BoQ Rate Master Snapshot", {"discipline": disc}), 0,
                         "the snapshot rolled back with the writes it was taken for")

    def test_97_the_preview_writes_nothing(self):
        """NEGATIVE: the preview is READ-ONLY, and that is what makes it safe to run against live
        data. Items, snapshots and every document name are identical afterwards."""
        from nirmaan_stack.services.boq_rate_master import csv_exporter, csv_importer

        disc = self._loaded_disc()
        text, _h, _n = csv_exporter.build_category_csv(disc, "cabletray_raceway")
        headers, rows = self._csv_parts(text)
        ri = headers.index("install_rate")
        picks = [i for i, r in enumerate(rows) if (r[ri] or "").strip() != ""]
        self.assertGreaterEqual(len(picks), 10, "fixture: too few populated rows to be 'heavy'")
        for i in picks:
            rows[i][ri] = str(float(rows[i][ri]) * 3)
        added = list(rows[0])
        added[0] = ""
        rows.append(added)
        heavily_edited = self._csv_text(headers, rows)

        before_rows = self._active_rows(disc)
        before_total = frappe.db.count("BoQ Rate Master Item", {"discipline": disc})
        before_snaps = frappe.db.count("BoQ Rate Master Snapshot", {"discipline": disc})

        plan = csv_importer.build_plan(disc, heavily_edited)
        self.assertEqual(plan["counts"]["rates_changed"], len(picks))
        self.assertEqual(plan["counts"]["items_added"], 1)

        self.assertEqual(frappe.db.count("BoQ Rate Master Item", {"discipline": disc}),
                         before_total)
        self.assertEqual(frappe.db.count("BoQ Rate Master Snapshot", {"discipline": disc}),
                         before_snaps)
        after_rows = self._active_rows(disc)
        self.assertEqual(set(after_rows), set(before_rows))
        for uid, row in before_rows.items():
            self.assertEqual(after_rows[uid]["name"], row["name"])
            self.assertEqual(_obj(after_rows[uid]["rates"]), _obj(row["rates"]))

    def test_98_excel_mangling_shows_as_a_change_never_as_unchanged(self):
        """NEGATIVE -- THE CENTRAL DATA RISK. Nothing is silently repaired; the PREVIEW is the
        defence, so every mangle must surface as a CHANGE.

        The live catalog really does carry `16/20A`, `70 x 6 MM Earth Strip` and `3 Pin / 2P+E`,
        all one Excel round trip from being rewritten. The deliberate exception is a NUMERICALLY
        IDENTICAL float flattened from 2.0 to 2 -- same stored value, no change.

        F-3 (2026-08-15) dropped `100x50mm` from that list: junction_box now carries a numeric
        `face_mm`, so the composite string is no longer in the catalog. Prose only -- this test
        exercises earthing / industrial_sockets / wiring_cabling and never touched it."""
        from nirmaan_stack.services.boq_rate_master import csv_exporter, csv_importer

        disc = self._loaded_disc()
        text, _h, _n = csv_exporter.build_category_csv(disc, "earthing")
        headers, rows = self._csv_parts(text)
        ti = headers.index("type")
        strip = next(r for r in rows if "70 x 6 MM" in r[ti])

        mangled = list(strip)
        mangled[ti] = strip[ti].replace("70 x 6 MM", "70x6MM")      # re-spacing
        other = next(r for r in rows if r[0] != strip[0])
        trailing = list(other)
        trailing[ti] = other[ti] + " "                              # trailing whitespace
        plan = csv_importer.build_plan(disc, self._csv_text(headers, [mangled, trailing]))
        self.assertEqual(plan["errors"], [])
        self.assertEqual(plan["counts"]["other_changed"], 2)
        self.assertEqual(plan["counts"]["unchanged"], 0,
                         "a mangled value must NEVER slip through as unchanged")
        f = next(x for x in plan["changes"] if x["item_uid"] == mangled[0])["fields"][0]
        self.assertEqual((f["space"], f["column"]), ("attribute", "type"))
        self.assertIn("70 x 6 MM", f["old"])
        self.assertIn("70x6MM", f["new"])

        # a `16/20A` rating read back as a date is likewise a visible change
        it_text, ih, _n2 = csv_exporter.build_category_csv(disc, "industrial_sockets")
        _ih, irows = self._csv_parts(it_text)
        gi = ih.index("rating")
        hit = next(r for r in irows if r[gi] == "16/20A")
        dated = list(hit)
        dated[gi] = "2020-01-16"
        p2 = csv_importer.build_plan(disc, self._csv_text(ih, [dated]))
        self.assertEqual(p2["counts"]["unchanged"], 0)
        self.assertEqual(len(p2["changes"]), 1)

        # THE DELIBERATE EXCEPTION: a float flattened to an integer is the SAME stored number.
        wt, wh, _n3 = csv_exporter.build_category_csv(disc, "wiring_cabling")
        _wh, wrows = self._csv_parts(wt)
        ci = wh.index("core")
        flat = next(r for r in wrows if r[ci].endswith(".0"))
        flattened = list(flat)
        flattened[ci] = flat[ci][:-2]
        p3 = csv_importer.build_plan(disc, self._csv_text(wh, [flattened]))
        self.assertEqual((p3["counts"]["unchanged"], p3["changes"]), (1, []))

    def test_99_a_stale_digest_refuses_the_apply(self):
        """NEGATIVE: the answer to 'what if the DB moved between preview and apply'.

        The apply re-derives the plan from the LIVE catalog and compares fingerprints. A row the
        plan TOUCHES having moved underneath means the preview no longer describes what would
        happen, so it refuses. An unrelated edit elsewhere is deliberately NOT in the fingerprint."""
        from nirmaan_stack.services.boq_rate_master import csv_exporter, csv_importer

        disc = self._loaded_disc()
        text, _h, _n = csv_exporter.build_category_csv(disc, "cabletray_raceway")
        headers, rows = self._csv_parts(text)
        ri = headers.index("install_rate")
        pick = self._first_with(rows, ri)
        rows[pick][ri] = str(float(rows[pick][ri]) + 9)
        edited = self._csv_text(headers, rows)

        plan = csv_importer.build_plan(disc, edited)
        digest = plan["digest"]

        # someone else edits the very row this upload touches
        target = self._active_rows(disc)[rows[pick][0]]
        rates = _obj(target["rates"])
        rates["install_rate"] = 4242.0
        frappe.db.set_value("BoQ Rate Master Item", target["name"], "rates",
                            json.dumps(rates), update_modified=False)
        frappe.db.commit()

        before = self._active_rows(disc)
        with self.assertRaises(frappe.ValidationError):
            csv_importer.apply_plan(disc, edited, expected_digest=digest)
        after = self._active_rows(disc)
        self.assertEqual(after[rows[pick][0]]["name"], before[rows[pick][0]]["name"])
        self.assertEqual(frappe.db.count("BoQ Rate Master Snapshot", {"discipline": disc}), 0)

        # and the FRESH digest applies cleanly -- the refusal is about staleness, not the file
        fresh = csv_importer.build_plan(disc, edited)
        res = csv_importer.apply_plan(disc, edited, expected_digest=fresh["digest"])
        frappe.db.commit()
        self.assertEqual(res["applied"], 1)

    def test_100_header_and_duplicate_problems_are_each_named(self):
        """NEGATIVE: a column nobody can place is a file we cannot read. Guessing is how a typo
        becomes a new attribute, so the row pass does not even start."""
        from nirmaan_stack.services.boq_rate_master import csv_exporter, csv_importer

        disc = self._loaded_disc()
        text, _h, _n = csv_exporter.build_category_csv(disc, "junction_box_raceway")
        headers, rows = self._csv_parts(text)

        with_unknown = list(headers) + ["totally_made_up"]
        plan = csv_importer.build_plan(disc, self._csv_text(with_unknown,
                                                            [r + ["x"] for r in rows]))
        self.assertTrue(any("totally_made_up" in e["message"] for e in plan["errors"]))
        self.assertEqual(plan["changes"], [])
        self.assertEqual(plan["counts"]["unchanged"], 0,
                         "a header problem stops the pass rather than deriving nonsense")

        no_uid = [h for h in headers if h != "item_uid"]
        p2 = csv_importer.build_plan(disc, self._csv_text(no_uid, [r[1:] for r in rows]))
        self.assertTrue(any("no 'item_uid' column" in e["message"] for e in p2["errors"]))

        dup = [list(rows[0]), list(rows[0])]
        p3 = csv_importer.build_plan(disc, self._csv_text(headers, dup))
        self.assertTrue(any("appears twice" in e["message"] for e in p3["errors"]))

        p4 = csv_importer.build_plan(disc, self._csv_text(headers + ["kind"],
                                                          [r + ["x"] for r in rows]))
        self.assertTrue(any("appears more than once" in e["message"] for e in p4["errors"]))

    def test_101_classify_columns_is_pure_and_refuses_an_ambiguous_column(self):
        """NEGATIVE + PURE: no database, no discipline -- just the header rules.

        The attribute/rate collision is measured IMPOSSIBLE on the live catalog and must stay so:
        the export emits ONE column per name, so a name meaning both makes the FILE ambiguous. The
        import cannot repair an export that cannot represent the data, so it refuses."""
        from nirmaan_stack.services.boq_rate_master import csv_importer

        attrs, rates = {"material", "core"}, {"list_price"}
        spec, errs = csv_importer.classify_columns(
            ["item_uid", "kind", "brand", "unit", "material", "core", "list_price",
             "source_sheet", "source_row"], attrs, rates)
        self.assertEqual(errs, [])
        self.assertEqual(spec["mode"], "category")
        self.assertEqual(sorted(spec["attributes"]), ["core", "material"])
        self.assertEqual(sorted(spec["rates"]), ["list_price"])

        spec_b, errs_b = csv_importer.classify_columns(
            ["item_uid", "category", "kind"], attrs, rates)
        self.assertEqual(errs_b, [])
        self.assertEqual(spec_b["mode"], "all")

        _s, collide = csv_importer.classify_columns(
            ["item_uid", "kind", "material"], {"material"}, {"material"})
        self.assertTrue(any("both an attribute and a rate key" in e["message"] for e in collide))

    # ── SLICE 4 (F-1 / F-8): three free NUMBER fields become CATALOGUE-FED pick-lists ──────────
    #
    # Configuration only -- the `number_choice` + `values_from` mechanism already shipped four
    # times. What these pin is the three OWNER RULINGS, each with its negative half, because each
    # one is a choice that a later reader could plausibly "tidy" the wrong way:
    #
    #   R1 STRICT   -- a value the catalogue does not carry is refused, not offered (frontend half)
    #   R2 CABLE    -- wiring draws from the `cable` kind, NOT `termination`
    #   R3 GLOBAL   -- the lists are unfiltered; there is deliberately NO `where` key
    #
    # These read the SHIPPED asset, not a synthetic fixture, so they fail if a future mint drops
    # the change. The vitest suite covers the panel/gate behaviour on the other side of the wire.

    def test_102_the_three_slice4_attributes_are_catalogue_fed_dropdowns(self):
        """POSITIVE + NEGATIVE. The three attributes are `number_choice` bound to the live catalogue.

        The NEGATIVE half is the load-bearing one: R3 (GLOBAL) means these carry NO `where` key.
        point_wiring's equivalents DO carry one ({material: COPPER, insulation: UNARMOURED}), so a
        reader copying that shape across would silently narrow these lists and start hiding
        catalogue values the owner ruled must be offered. `assertNotIn("where", ...)` is what stops
        that, and it must not be deleted as redundant.

        `number_choice`, not `choice`, is equally deliberate: matchMasterRow compares with `===`, so
        a plain `choice` emits the STRING "25" against a stored 25.0 and matches nothing, silently.
        """
        payload = self._current_eall_asset()
        cfgs = {c["category_id"]: c for c in payload["category_configs"]}
        expected = {
            ("conduit_piping", "size_mm"): {"kind": "conduit", "attr": "size_mm"},
            ("wiring_cabling", "core"): {"kind": "cable", "attr": "core"},
            ("wiring_cabling", "thickness_sqmm"): {"kind": "cable", "attr": "thickness_sqmm"},
        }
        for (cid, aid), vf in expected.items():
            d = {x["id"]: x for x in cfgs[cid]["attribute_definitions"]}[aid]
            self.assertEqual(d["type"], "number_choice", f"{cid}.{aid} must be a NUMERIC dropdown")
            self.assertEqual(d["values_from"], vf, f"{cid}.{aid} values_from")
            # NEGATIVE -- R3: global, never row-filtered. No `where`, and no static list either.
            self.assertNotIn("where", d["values_from"], f"{cid}.{aid} must stay GLOBAL (R3)")
            self.assertIsNone(d.get("values"), f"{cid}.{aid} must never carry a static list")

    def test_103_wiring_lists_resolve_from_cable_never_termination(self):
        """R2, pinned by the values that DISTINGUISH the two kinds -- the only way to pin it.

        Asserting "the list resolves" proves nothing: cable and termination overlap heavily, so a
        list built from the wrong kind still looks plausible. These two values are the discriminator:
        `core 8` and `thickness 0.75` exist in cable and NOT in termination. Repoint either
        values_from at `termination` and exactly these assertions go red.

        The accepted consequence (owner, R2) is that a termination-only row can now be offered a
        value termination cannot price -- e.g. the two live 8-core rows. That is deliberate.
        """
        disc = self._new_disc()
        loader.load_rate_master(payload=self._asset_payload(disc))
        cable_core = extraction.values_from_catalog(disc, {"kind": "cable", "attr": "core"})
        cable_th = extraction.values_from_catalog(disc, {"kind": "cable", "attr": "thickness_sqmm"})
        term_core = extraction.values_from_catalog(disc, {"kind": "termination", "attr": "core"})
        term_th = extraction.values_from_catalog(
            disc, {"kind": "termination", "attr": "thickness_sqmm"})

        # POSITIVE: the cable-only values ARE offered
        self.assertIn(8.0, cable_core, "core 8 is a cable value and must be offered")
        self.assertIn(0.75, cable_th, "thickness 0.75 is a cable value and must be offered")
        # NEGATIVE: they are absent from termination -- which is what makes them discriminators
        self.assertNotIn(8.0, term_core)
        self.assertNotIn(0.75, term_th)
        # and the cable domain is a strict SUPERSET here, so "wrong kind" is always detectable
        self.assertTrue(set(term_core) < set(cable_core))
        self.assertTrue(set(term_th) < set(cable_th))

    def test_104_the_lists_are_global_and_ignore_the_rows_other_attributes(self):
        """R3. A GLOBAL list is the union across every material/insulation combination.

        Pinned by a value that exists under ONE combination only: `core 24` is COPPER/ARMOURED-only,
        and `thickness 0.5` is COPPER/UNARMOURED-only. A row-filtered list would drop whichever one
        did not match the row -- so their simultaneous presence proves no filtering is happening.

        This is what makes the 3.5-core/150 COMBINATION gap invisible to this slice, which the owner
        ruled is a separate finding and explicitly NOT this slice's job.
        """
        disc = self._new_disc()
        loader.load_rate_master(payload=self._asset_payload(disc))
        cores = extraction.values_from_catalog(disc, {"kind": "cable", "attr": "core"})
        ths = extraction.values_from_catalog(disc, {"kind": "cable", "attr": "thickness_sqmm"})
        # values from DIFFERENT, mutually exclusive combinations coexist in one list
        self.assertIn(24.0, cores)    # COPPER/ARMOURED only
        self.assertIn(3.5, cores)     # ARMOURED only (either material)
        self.assertIn(0.5, ths)       # COPPER/UNARMOURED only
        self.assertIn(400.0, ths)     # ARMOURED-heavy end
        # the union is strictly larger than any single combination's own domain
        one_combo = {
            it["attributes"]["core"]
            for it in frappe.get_all(
                "BoQ Rate Master Item",
                filters={"discipline": disc, "kind": "cable", "active": 1},
                fields=["attributes"])
            if _obj(it["attributes"]).get("material") == "ALUMINIUM"
            and _obj(it["attributes"]).get("insulation") == "UNARMOURED"
        }
        self.assertTrue(set(cores) > {float(c) for c in one_combo})

    def test_105_the_four_already_shipped_number_choice_attributes_are_unchanged(self):
        """NEGATIVE / regression. Slice 4 must not disturb the four precedents it copied.

        point_wiring's two keep their `where` filter -- that asymmetry with the slice-4 three IS the
        R3 ruling, and a later "consistency" pass that stripped it would silently widen point_wiring's
        wire lists to every cable in the catalogue, including armoured ones a point wire never uses.
        """
        cfgs = {c["category_id"]: c for c in self._current_eall_asset()["category_configs"]}
        pw = {d["id"]: d for d in cfgs["point_wiring"]["attribute_definitions"]}
        where = {"material": "COPPER", "insulation": "UNARMOURED"}
        for aid, attr in (("wire1_core", "core"), ("wire1_thickness_sqmm", "thickness_sqmm"),
                          ("wire2_core", "core"), ("wire2_thickness_sqmm", "thickness_sqmm")):
            self.assertEqual(pw[aid]["type"], "number_choice", aid)
            self.assertEqual(pw[aid]["values_from"]["kind"], "cable", aid)
            self.assertEqual(pw[aid]["values_from"]["attr"], attr, aid)
            # POSITIVE: point_wiring KEEPS its filter -- the deliberate asymmetry with slice 4
            self.assertEqual(pw[aid]["values_from"]["where"], where, aid)
        jb = {d["id"]: d for d in cfgs["junction_box_raceway"]["attribute_definitions"]}
        self.assertEqual(jb["face_mm"]["type"], "number_choice")
        self.assertEqual(jb["face_mm"]["values_from"], {"kind": "junction_box", "attr": "face_mm"})
        ct = {d["id"]: d for d in cfgs["cabletray_raceway"]["attribute_definitions"]}
        self.assertEqual(ct["thickness_mm"]["type"], "number_choice")
        self.assertEqual(ct["thickness_mm"]["values_from"],
                         {"kind": "cable_tray", "attr": "thickness_mm"})

    def test_106_the_switch_socket_goldens_are_rebanked_to_the_current_rates(self):
        """B4. The two stale switches_sockets goldens, re-banked against the rates adopted with v43.

        Goldens are REGRESSION CANARIES (2026-08-19), so recomputing them from our own interpreter is
        correct. Both values were derived TWICE and agreed -- by hand from the catalog list prices x
        the rate stages, and by the product's own RM-4b preview gate.

        The arithmetic, so a future reader can re-check it without re-deriving the pipeline:
          s1  = 309 (6A 3-Pin Socket White) -> roundup(309 x 0.3625, -1) = 120 supply
          ss1 = 290 + 464 + 309x2 + 70 + 446 + 362 = 2250 raw
                -> roundup(2250 x 0.3625, -1) = 820 ; roundup(820 x 0.2, -1) = 170
                -> roundup(2250 x 0.25, -1)   = 570

        NEGATIVE half: s1's install and BCS did NOT move (30 / 80). Exactly four numbers changed, and
        asserting the two that held is what proves this was a re-bank and not a blanket overwrite.
        """
        goldens = {g["id"]: g for g in self._current_eall_asset()["goldens"]["switches_sockets"]}
        self.assertEqual(goldens["s1"]["expect"], {
            "swsock_boq": {"supply": 120.0, "install": 30.0},
            "swsock_bcs": {"bcs_supply": 80.0},
        })
        self.assertEqual(goldens["ss1"]["expect"], {
            "swsock_boq": {"supply": 820.0, "install": 170.0},
            "swsock_bcs": {"bcs_supply": 570.0},
        })

    def test_107_an_out_of_catalogue_value_is_refused_silently_at_coercion(self):
        """R1 + R4, the SERVER half of "the catalogue is the boundary".

        This is what makes the three attributes a real boundary rather than a cosmetic dropdown: on a
        FRESH extraction, a value outside the resolved domain is discarded before it is ever stored,
        with reason COERCE_OUTSIDE_DOMAIN, and the row arrives BLANK. No message, no new text, no
        near-miss substitution -- the owner ruled a non-match refuses SILENTLY and the pricer decides.

        Pinned against the REAL resolved domains, not a hand-written list, so it tracks the catalogue.
        The values are the live ones this slice was built for: conduit 80 mm (5 live rows ask for a
        size we do not stock) and cable 180 sqmm (1 live row).

        NEGATIVE half: an IN-catalogue value survives coercion untouched and keeps its numeric type --
        which is the whole reason these are `number_choice` and not `choice` (matchMasterRow compares
        with `===`, so a string "25" would match a stored 25.0 nowhere, silently).
        """
        disc = self._new_disc()
        loader.load_rate_master(payload=self._asset_payload(disc))
        size_def = {"id": "size_mm", "label": "Size (mm)", "type": "number_choice",
                    "values": extraction.values_from_catalog(
                        disc, {"kind": "conduit", "attr": "size_mm"})}
        th_def = {"id": "thickness_sqmm", "label": "Thickness (sqmm)", "type": "number_choice",
                  "values": extraction.values_from_catalog(
                      disc, {"kind": "cable", "attr": "thickness_sqmm"})}

        # NEGATIVE: outside the domain -> dropped, and the REASON says which check dropped it
        for defn, bad in ((size_def, 80), (th_def, 180)):
            value, reason = extraction._coerce_value_ex(defn, bad)
            self.assertIsNone(value, f"{defn['id']}={bad} must be refused")
            self.assertEqual(reason, extraction.COERCE_OUTSIDE_DOMAIN, f"{defn['id']}={bad}")

        # POSITIVE: inside the domain -> kept, numeric, and equal to what the catalog stores
        value, reason = extraction._coerce_value_ex(size_def, 25)
        self.assertEqual(value, 25)
        self.assertEqual(reason, extraction.COERCE_OK)
        self.assertIsInstance(value, (int, float))
        # ...and the string form the model may return is accepted too (like compared with like)
        self.assertEqual(extraction._coerce_value_ex(th_def, "2.5")[0], 2.5)


# ═══════════════════════════════════════════════════════════════════════════════════════════════
# SLICE RMF-1 -- THE RATE-MASTER DEPLOYMENT FREEZE
#
# WHY: on 2026-08-18, 235 hand-entered production cable prices were overwritten by a dev-minted
# asset. The freeze is step one of Deployment Mode (freeze, export, merge, deploy) and was until
# now an unenforced manual discipline.
#
# ⚠️ THIS CLASS MUTATES A **SINGLE** DOCTYPE ON THE **LIVE** SITE, so every test captures the
# site's CURRENT freeze state and restores THAT -- never a hardcoded "unfrozen". The standing rule
# in CLAUDE.md exists because the failure is SILENT: a hardcoded restore would quietly lift a
# freeze the owner had genuinely set, and the two provenance fields would be destroyed with it.
# `_freeze_sandbox` also purges only the Version rows THIS test created, never pre-existing ones.
#
# THE TWO HALVES BOTH MATTER AND ARE TESTED TOGETHER:
#   the six WRITE endpoints refuse (R1)   AND   the three READ endpoints still succeed (R3)
# The second half is not a nicety -- the export is the action the freeze exists to protect, so a
# guard folded into the shared `_require_rate_admin` would defeat the whole feature. test_rmf_04
# is the test that would catch that refactor.
# ═══════════════════════════════════════════════════════════════════════════════════════════════
def _rmf_source(mod):
    import inspect
    return inspect.getsource(mod)


def _rmf_source_of(fn):
    import inspect
    return inspect.getsource(fn)


# A param path that genuinely EXISTS in the legacy wiring fixture's cable_boq pipeline. Using a
# real one matters: `update_rate_config_param` validates the path AFTER the freeze guard, so a
# bogus path would let the frozen-refusal test pass for the wrong reason and would break the
# post-unfreeze call (it did, on the first run of this suite).
_RMF_PARAM_STEP = 4
_RMF_PARAM_KEY = "install_markup"


def _rmf_csv_text(discipline):
    """The discipline's editable CSV, unedited -- so an apply is a genuine no-op and any refusal
    can only be the freeze, never a validation error wearing the same clothes."""
    from nirmaan_stack.services.boq_rate_master import csv_exporter
    text, _headers, _n = csv_exporter.build_category_csv(discipline, "wiring_cabling")
    return text


class TestRateMasterFreeze(FrappeTestCase):
    FREEZE_DT = "BoQ Rate Master Freeze"

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        with open(_asset_path(LEGACY_WIRING_ASSET), "r", encoding="utf-8") as fh:
            cls.raw = json.load(fh)
        cls._disciplines = set()

    @classmethod
    def tearDownClass(cls):
        for disc in cls._disciplines:
            frappe.db.delete("BoQ Rate Master Snapshot", {"discipline": disc})
            for dt in ("BoQ Rate Category Config", "BoQ Rate Master Item",
                       "BoQ Rate Master Retirement"):
                for r in frappe.get_all(dt, filters={"discipline": disc}, fields=["name"]):
                    frappe.db.delete("Version", {"ref_doctype": dt, "docname": r.name})
            frappe.db.delete("BoQ Rate Master Item", {"discipline": disc})
            frappe.db.delete("BoQ Rate Category Config", {"discipline": disc})
            frappe.db.delete("BoQ Rate Master Retirement", {"discipline": disc})
        frappe.db.commit()
        super().tearDownClass()

    # ---- helpers ----
    def _new_disc(self):
        disc = "TEST_RMF_" + frappe.generate_hash(length=8)
        type(self)._disciplines.add(disc)
        return disc

    def _loaded(self):
        """A scratch discipline with the real wiring payload loaded, plus its config + an item."""
        disc = self._new_disc()
        p = copy.deepcopy(type(self).raw)
        p["category_config"]["discipline"] = disc
        loader.load_rate_master(payload=p)
        cfg = frappe.db.get_value("BoQ Rate Category Config",
                                  {"discipline": disc, "active": 1}, "name")
        item = frappe.db.get_value("BoQ Rate Master Item",
                                   {"discipline": disc, "active": 1, "kind": "cable"}, "name")
        return disc, cfg, item

    def _freeze_sandbox(self):
        """Capture the LIVE site's freeze state + its existing Version rows, and restore EXACTLY
        those on cleanup. THE STANDING SINGLE-DOCTYPE RULE -- restoring a hardcoded 'unfrozen'
        would silently lift a real freeze, and `set_single_value` writes no Version row, so a
        `track_changes` audit could not even show that it had happened."""
        dt = type(self).FREEZE_DT
        original = {
            f: frappe.db.get_value(dt, dt, f) for f in ("frozen", "frozen_by", "frozen_at")
        }
        pre_versions = {
            r.name for r in frappe.get_all("Version", filters={"ref_doctype": dt}, fields=["name"])
        }

        def _restore():
            for field, value in original.items():
                frappe.db.set_single_value(dt, field, value)
            for r in frappe.get_all("Version", filters={"ref_doctype": dt}, fields=["name"]):
                if r.name not in pre_versions:  # only OUR rows, never the owner's history
                    frappe.db.delete("Version", {"name": r.name})
            frappe.db.commit()

        self.addCleanup(_restore)
        return original, pre_versions

    def _new_versions(self, pre_versions):
        return [
            r for r in frappe.get_all(
                "Version", filters={"ref_doctype": type(self).FREEZE_DT},
                fields=["name", "owner", "creation"], order_by="creation asc")
            if r.name not in pre_versions
        ]

    def _set_frozen(self, user="rmf-test-admin@example.com"):
        """Freeze via the service, stamping an EXPLICIT actor -- used where the test needs a freeze
        that somebody ELSE set (test_rmf_08, owner ruling R6). `frozen_by` is Data, not Link, so a
        synthetic address is legal and touches no User row."""
        freeze.set_freeze_state(True, user)
        frappe.db.commit()

    def _write_calls(self, cfg, item, disc):
        """(label, callable) for EVERY rate-master WRITE reachable from the app: the SIX endpoints
        plus the service-level csv apply. Every call is given VALID arguments, so a refusal can
        only be the freeze."""
        b64 = base64.b64encode(_rmf_csv_text(disc).encode("utf-8")).decode("ascii")
        cfg_json = frappe.db.get_value("BoQ Rate Category Config", cfg, "config")
        return [
            ("update_rate_config_param", lambda: rate_master.update_rate_config_param(
                name=cfg, pipeline_id="cable_boq", step_index=_RMF_PARAM_STEP,
                param_key=_RMF_PARAM_KEY, new_value=0.5)),
            ("update_rate_master_item", lambda: rate_master.update_rate_master_item(
                name=item, rates_patch=json.dumps({"list_rate": 123.0}))),
            ("create_rate_master_item", lambda: rate_master.create_rate_master_item(
                discipline=disc, kind="cable", attributes=json.dumps({"material": "COPPER"}),
                rates=json.dumps({"list_rate": 1.0}))),
            ("deactivate_rate_master_item", lambda: rate_master.deactivate_rate_master_item(
                name=item)),
            ("update_rate_config", lambda: rate_master.update_rate_config(
                name=cfg, config=cfg_json)),
            ("apply_rate_master_csv", lambda: rate_master.apply_rate_master_csv(
                discipline=disc, content_base64=b64)),
            # THE SERVICE PATH, called directly and NOT through the endpoint. This is the one a
            # guard on the audited doc.save endpoints alone would miss entirely.
            ("csv_importer.apply_plan", lambda: csv_importer.apply_plan(
                disc, base64.b64decode(b64))),
        ]

    # ---- tests ----
    def test_rmf_01_default_state_is_unfrozen_and_an_absent_single_reads_as_unfrozen(self):
        """POSITIVE: the feature is INERT by default. A never-written Single reads as not frozen, so
        a database nobody has touched behaves byte-identically to pre-freeze."""
        self._freeze_sandbox()
        for field in ("frozen", "frozen_by", "frozen_at"):
            frappe.db.set_single_value(type(self).FREEZE_DT, field, None)
        frappe.db.commit()
        self.assertFalse(freeze.is_frozen())
        self.assertEqual(
            freeze.get_freeze_state(), {"frozen": False, "frozen_by": None, "frozen_at": None})

    def test_rmf_02_the_blocked_message_is_the_owners_text_verbatim(self):
        """POSITIVE PIN: the owner supplied this string on 2026-08-18. It must not be reworded,
        expanded, or given a second sentence -- including the space after the slash, which is
        theirs."""
        self.assertEqual(
            freeze.BLOCKED_MESSAGE,
            "Rate master is locked for deployment. Contact Nitesh/ Abhishek.")

    def test_rmf_02b_the_frontend_constant_is_byte_identical(self):
        """POSITIVE: the client renders this same message (as the disabled-control tooltip), so the
        two copies sit either side of a language boundary. Pinned by READING the .ts source, so a
        reword on one side cannot pass unnoticed. Cross-language duplication is deliberate here
        (the `isRowQtyBearing` precedent); silent DIVERGENCE is not."""
        here = os.path.dirname(os.path.abspath(__file__))            # .../nirmaan_stack/api/boq
        app = os.path.abspath(os.path.join(here, "..", "..", ".."))  # .../apps/nirmaan_stack
        ts = os.path.join(app, "frontend", "src", "pages", "pricing", "rate-master",
                          "rateMasterFreeze.ts")
        self.assertTrue(os.path.exists(ts), ts)
        with open(ts, "r", encoding="utf-8") as fh:
            src = fh.read()
        self.assertIn(freeze.BLOCKED_MESSAGE, src)

    def test_rmf_03_every_write_refuses_while_frozen_with_the_exact_message(self):
        """NEGATIVE, the core of the feature (R1). All SIX write endpoints AND the service-level csv
        apply refuse, each with the owner's exact message and nothing appended."""
        disc, cfg, item = self._loaded()
        self._freeze_sandbox()
        self._set_frozen()
        for label, call in self._write_calls(cfg, item, disc):
            with self.subTest(endpoint=label):
                with self.assertRaises(frappe.ValidationError) as ctx:
                    call()
                self.assertEqual(str(ctx.exception), freeze.BLOCKED_MESSAGE, label)

    def test_rmf_04_the_three_read_endpoints_still_succeed_while_frozen(self):
        """POSITIVE, and THE test that catches the tempting refactor (owner ruling R3). The export is
        THE ACTION THE FREEZE EXISTS TO PROTECT -- Deployment Mode is freeze-then-export. If a future
        reader folds `guard_not_frozen` into the shared `_require_rate_admin`, which gates all nine
        endpoints, this goes red and says why."""
        disc, _cfg, _item = self._loaded()
        self._freeze_sandbox()
        self._set_frozen()

        asset = rate_master.export_rate_master_asset(discipline=disc)
        self.assertTrue(asset["content_base64"])
        self.assertEqual(asset["discipline"], disc)

        csv_out = rate_master.export_rate_master_csv(discipline=disc)
        self.assertTrue(csv_out["content_base64"])

        b64 = base64.b64encode(_rmf_csv_text(disc).encode("utf-8")).decode("ascii")
        plan = rate_master.preview_rate_master_csv(discipline=disc, content_base64=b64)
        self.assertEqual(plan["errors"], [])
        self.assertIn("digest", plan)

    def test_rmf_05_a_frozen_write_mutates_nothing(self):
        """NEGATIVE: reject-mutates-nothing. A refusal must not half-apply -- and the CSV apply is
        the one with real blast radius, since it supersedes by raw SQL and writes a snapshot."""
        disc, cfg, item = self._loaded()
        before_rates = frappe.db.get_value("BoQ Rate Master Item", item, "rates")
        before_cfg = frappe.db.get_value("BoQ Rate Category Config", cfg, "config")
        before_items = frappe.db.count("BoQ Rate Master Item", {"discipline": disc, "active": 1})
        before_snaps = frappe.db.count("BoQ Rate Master Snapshot", {"discipline": disc})
        self._freeze_sandbox()
        self._set_frozen()
        for label, call in self._write_calls(cfg, item, disc):
            with self.subTest(endpoint=label):
                with self.assertRaises(frappe.ValidationError):
                    call()
        self.assertEqual(frappe.db.get_value("BoQ Rate Master Item", item, "rates"), before_rates)
        self.assertEqual(frappe.db.get_value("BoQ Rate Category Config", cfg, "config"), before_cfg)
        self.assertEqual(
            frappe.db.count("BoQ Rate Master Item", {"discipline": disc, "active": 1}), before_items)
        # No snapshot either: the csv guard fires BEFORE the snapshot is taken.
        self.assertEqual(
            frappe.db.count("BoQ Rate Master Snapshot", {"discipline": disc}), before_snaps)

    def test_rmf_06_unfreezing_restores_every_blocked_path(self):
        """POSITIVE: the lift is complete. Every write refused while frozen works again after --
        proving the guard is a gate, not a latch that leaves something broken behind it."""
        disc, cfg, item = self._loaded()
        self._freeze_sandbox()
        self._set_frozen()
        with self.assertRaises(frappe.ValidationError):
            rate_master.update_rate_master_item(
                name=item, rates_patch=json.dumps({"list_rate": 7.0}))

        res = rate_master.unfreeze_rate_master()
        self.assertTrue(res["ok"])
        self.assertFalse(res["frozen"])

        rate_master.update_rate_master_item(name=item, rates_patch=json.dumps({"list_rate": 7.0}))
        rate_master.update_rate_config_param(
            name=cfg, pipeline_id="cable_boq", step_index=_RMF_PARAM_STEP,
            param_key=_RMF_PARAM_KEY, new_value=0.5)
        b64 = base64.b64encode(_rmf_csv_text(disc).encode("utf-8")).decode("ascii")
        applied = rate_master.apply_rate_master_csv(discipline=disc, content_base64=b64)
        self.assertIn("applied", applied)

    def test_rmf_07_freezing_records_who_and_when(self):
        """POSITIVE: attribution. The live fields say who SET the freeze and when, and the flip lands
        a Version row -- which happens only because the doctype is track_changes:1 AND the writer
        goes through doc.save(ignore_version=False) rather than set_single_value."""
        _o, pre = self._freeze_sandbox()
        before = frappe.utils.now_datetime().replace(microsecond=0)
        res = rate_master.freeze_rate_master()
        self.assertTrue(res["ok"])
        self.assertTrue(res["changed"])
        self.assertTrue(res["frozen"])
        self.assertEqual(res["frozen_by"], frappe.session.user)
        self.assertIsNotNone(res["frozen_at"])
        self.assertGreaterEqual(frappe.utils.get_datetime(res["frozen_at"]), before)

        state = freeze.get_freeze_state()   # persisted, via the ONE reader
        self.assertTrue(state["frozen"])
        self.assertEqual(state["frozen_by"], frappe.session.user)

        new = self._new_versions(pre)       # audited
        self.assertEqual(len(new), 1)
        self.assertEqual(new[0].owner, frappe.session.user)

    def test_rmf_08_any_admin_may_lift_another_admins_freeze_and_the_lift_is_attributed(self):
        """POSITIVE, owner ruling R6. There is DELIBERATELY no check that the lifter is the user who
        set the freeze -- what makes that safe is that the lift is attributable. The freeze here is
        stamped to a DIFFERENT actor, and the session admin lifts it."""
        _o, pre = self._freeze_sandbox()
        self._set_frozen(user="some-other-admin@example.com")
        self.assertEqual(freeze.get_freeze_state()["frozen_by"], "some-other-admin@example.com")

        res = rate_master.unfreeze_rate_master()
        self.assertTrue(res["ok"])
        self.assertTrue(res["changed"])
        self.assertFalse(res["frozen"])
        self.assertIsNone(res["frozen_by"])     # provenance cleared with the flag
        self.assertIsNone(res["frozen_at"])

        new = self._new_versions(pre)           # the LIFT is in the audit, naming the lifter
        self.assertTrue(new)
        self.assertEqual(new[-1].owner, frappe.session.user)

    def test_rmf_09_a_non_admin_can_neither_freeze_nor_lift(self):
        """NEGATIVE: the freeze population IS the rate-master edit population (R5). A non-admin is
        refused with PermissionError -- NOT with the freeze message, which would be a confusing
        answer to a question they were never allowed to ask."""
        self._freeze_sandbox()
        original = frappe.session.user
        try:
            frappe.set_user("Guest")
            with self.assertRaises(frappe.PermissionError):
                rate_master.freeze_rate_master()
            with self.assertRaises(frappe.PermissionError):
                rate_master.unfreeze_rate_master()
        finally:
            frappe.set_user(original)
        self.assertFalse(freeze.is_frozen())    # nothing was written

    def test_rmf_09b_a_non_admin_hitting_a_frozen_write_still_gets_permission_denied(self):
        """NEGATIVE: gate ORDER. The admin check runs FIRST, so a non-admin never learns about the
        freeze -- they are simply not permitted, frozen or not."""
        _disc, _cfg, item = self._loaded()
        self._freeze_sandbox()
        self._set_frozen()
        original = frappe.session.user
        try:
            frappe.set_user("Guest")
            with self.assertRaises(frappe.PermissionError):
                rate_master.update_rate_master_item(
                    name=item, rates_patch=json.dumps({"list_rate": 1.0}))
        finally:
            frappe.set_user(original)

    def test_rmf_10_freeze_is_idempotent_and_never_restarts_the_clock(self):
        """POSITIVE + the reason it matters: the banner renders `frozen_at` as ELAPSED time, so a
        second Freeze click must NOT re-stamp it. Re-freezing reports changed=False, preserves the
        original provenance, and writes no Version row."""
        _o, pre = self._freeze_sandbox()
        first = rate_master.freeze_rate_master()
        self.assertTrue(first["changed"])
        after_first = {r.name for r in self._new_versions(pre)}

        again = rate_master.freeze_rate_master()
        self.assertFalse(again["changed"])
        self.assertEqual(again["frozen_at"], first["frozen_at"])   # the clock did NOT restart
        self.assertEqual(again["frozen_by"], first["frozen_by"])
        self.assertEqual({r.name for r in self._new_versions(pre)}, after_first)  # no write, no row

    def test_rmf_10b_unfreeze_is_idempotent(self):
        """POSITIVE: lifting an unfrozen catalog is a clean no-op, not an error."""
        self._freeze_sandbox()
        rate_master.unfreeze_rate_master()
        res = rate_master.unfreeze_rate_master()
        self.assertTrue(res["ok"])
        self.assertFalse(res["changed"])
        self.assertFalse(res["frozen"])

    def test_rmf_11_the_read_endpoint_reports_state_and_hides_stale_provenance(self):
        """POSITIVE: `get_rate_master_freeze` is what the banner reads. Provenance is reported ONLY
        while frozen, so a half-cleared row can never render a banner claiming a live freeze."""
        self._freeze_sandbox()
        self._set_frozen(user="banner-test@example.com")
        got = rate_master.get_rate_master_freeze()
        self.assertTrue(got["frozen"])
        self.assertEqual(got["frozen_by"], "banner-test@example.com")
        self.assertIsNotNone(got["frozen_at"])

        frappe.db.set_single_value(type(self).FREEZE_DT, "frozen", 0)   # flag off, provenance left
        frappe.db.commit()
        got = rate_master.get_rate_master_freeze()
        self.assertFalse(got["frozen"])
        self.assertIsNone(got["frozen_by"])
        self.assertIsNone(got["frozen_at"])

    def test_rmf_12_pricing_is_unaffected_by_the_freeze(self):
        """POSITIVE, owner ruling R2 -- and it holds BY CONSTRUCTION, not by exemption: no pricing
        path writes the rate master. Exercised under a LIVE freeze: the two rate-master READS the
        pricing screen needs to compute a rate at all, and a real pricing-path WRITE ("Use this
        value" telemetry). If any of these refused, a freeze would stop pricers working."""
        disc, _cfg, _item = self._loaded()
        self._freeze_sandbox()
        self._set_frozen()

        items = rate_master.get_rate_master_items(discipline=disc)
        self.assertTrue(items["items"])
        cfg = rate_master.get_rate_category_config(discipline=disc, category_id="wiring_cabling")
        self.assertTrue(cfg["config"])

        # A third real pricing-screen endpoint, invoked under the live freeze. It tolerates an
        # unknown BoQ (pure read, no existence check), so it needs no fixture.
        evs = rate_master.get_suggestion_events(boq="RMF-FREEZE-NONE", sheet_name="Sheet1")
        self.assertEqual(evs["events"], [])

        # The "Use this value" telemetry is a genuine WRITE on a pricing path. Its `boq` field is
        # a LINK to BOQs, so exercising it would need a real BoQ (and behind it the Projects
        # fixture chain) to assert a fact these two lines state exactly: it is login-gated, not
        # admin-gated, and carries NO freeze guard. Asserted structurally, and said so plainly.
        write_src = _rmf_source_of(rate_master.record_rate_suggestion_event)
        self.assertNotIn("guard_not_frozen", write_src)
        self.assertNotIn("_require_rate_admin", write_src)
        self.assertIn("_require_login()", write_src)

        # ...and the pricing module does not even NAME the rate-master doctypes, which is why R2
        # needs no exemption anywhere in this feature.
        from nirmaan_stack.api.boq.wizard import pricing as pricing_api
        src = _rmf_source(pricing_api)
        self.assertNotIn("BoQ Rate Master Item", src)
        self.assertNotIn("BoQ Rate Category Config", src)
        self.assertNotIn("guard_not_frozen", src)

    def test_rmf_13_the_guard_is_one_definition_called_at_both_write_mechanisms(self):
        """POSITIVE: ONE predicate, two call sites. The five audited doc.save endpoints plus the csv
        endpoint are guarded inline in the api module; `csv_importer.apply_plan` guards itself,
        because it supersedes by RAW SQL and never touches doc.save. A guard on only one mechanism
        would leave the other wide open -- and the csv path has the larger blast radius."""
        self.assertEqual(_rmf_source(rate_master).count("freeze.guard_not_frozen()"), 6)
        self.assertEqual(_rmf_source(csv_importer).count("freeze.guard_not_frozen()"), 1)
        self.assertIs(rate_master.freeze.guard_not_frozen, freeze.guard_not_frozen)
        self.assertIs(csv_importer.freeze.guard_not_frozen, freeze.guard_not_frozen)

    def test_rmf_14_the_guard_is_not_in_require_rate_admin_and_not_on_the_reads(self):
        """NEGATIVE, structural (owner ruling R3). `_require_rate_admin` gates nine endpoints, three
        of them reads. This asserts the guard is NOT inside it -- the single refactor that would
        silently make Deployment Mode impossible, because you could no longer export the catalog you
        had just frozen."""
        gate = _rmf_source_of(rate_master._require_rate_admin)
        self.assertNotIn("guard_not_frozen", gate)
        self.assertNotIn("frozen", gate)
        for fn in (rate_master.export_rate_master_asset, rate_master.export_rate_master_csv,
                   rate_master.preview_rate_master_csv):
            with self.subTest(endpoint=fn.__name__):
                self.assertNotIn("guard_not_frozen", _rmf_source_of(fn))
        # build_plan is SHARED with the preview, so it must stay unguarded too
        self.assertNotIn("guard_not_frozen", _rmf_source_of(csv_importer.build_plan))

    def test_rmf_15_set_single_value_is_never_used_to_write_the_freeze(self):
        """NEGATIVE, and it protects the ONE thing that makes R6 safe. `set_single_value` is a raw
        UPDATE: it bypasses the doc lifecycle and writes NO Version row, so a lift would become
        unattributable while every other test stayed green. The writer must use doc.save with an
        EXPLICIT ignore_version=False -- Frappe defaults that to frappe.flags.in_test, which would
        suppress the audit under exactly this runner."""
        writer = _rmf_source_of(freeze.set_freeze_state)
        code = writer.split('"""')[-1]          # body only, past the docstring that NAMES the trap
        self.assertNotIn("set_single_value", code)
        self.assertIn("ignore_version=False", code)
        self.assertIn("doc.save(", code)


# ── SLICE 5 post-cert: TWO CONFIG-SHAPE GUARDS over the estimator rules ──────────────────────
#
# ⚠️ WHY THESE EXIST, AND WHY THEY ARE CHEAP.
# The popup P1 rule was authored telling the model to "return None for every module attribute: the
# switch, all four sockets, the blank plate, the face plate AND THE COLOUR". Two things were wrong
# with that last clause and BOTH are decidable from the config alone, with no AI call and no run:
#
#   1. `colour` carries a plain `extraction_defaults` entry ("White"). Instructing the model to
#      return "None" for it CONTRADICTS the default the same config declares.
#   2. `colour` is a `choice` WITHOUT `allow_none`, so "None" is not one of its allowed values;
#      `_coerce_value` rejects it, the stored value becomes null, and a declared non-derived
#      attribute that is null counts as MISSING INPUT -- so the row GATES.
#
# It cost one live row (BOQ-26-00196/263) and would have kept costing an occasional row, because a
# guidance sentence bends the model only where its confidence is already low -- the same intermittent
# shape as the story-1 drift. Neither guard needs a model, a database row, or a pipeline run: both
# read the shipped config and would have failed the moment that sentence was written.


def _attr_label(cfg, attr_id):
    """The human LABEL of an attribute id in one config -- what a guidance sentence would call it."""
    for d in (cfg.get("attribute_definitions") or []):
        if d.get("id") == attr_id:
            return str(d.get("label") or attr_id)
    return None


def _rules_of(cfg):
    return [r for r in (cfg.get("rules") or []) if isinstance(r, dict)]


def _guidance(rule):
    return str(rule.get("guidance") or "")


def _none_targets(text):
    """Attribute LABELS a guidance sentence tells the model to return "None" for.

    Deliberately crude and deliberately WIDE: it looks for the words "return None" and then reads the
    rest of that sentence. A guard that tried to parse English precisely would miss the next
    variation; one that over-reports is cheap to satisfy (reword the sentence) and cannot let the
    real case through."""
    out = []
    low = text.lower()
    start = 0
    while True:
        i = low.find("return none", start)
        if i < 0:
            break
        end = low.find(".", i)
        out.append(text[i:end if end > 0 else len(text)])
        start = i + 11
    return out


class TestRuleGuidanceDoesNotFightTheConfig(FrappeTestCase):
    """The two shape guards. Both are pure config reads over the SHIPPED asset."""

    def _configs(self):
        with open(_asset_path(CURRENT_EALL_ASSET), "r", encoding="utf-8") as fh:
            return json.load(fh)["category_configs"]

    def test_no_rule_names_an_extraction_default_key_as_a_none_target(self):
        """GUARD 1. A rule must not tell the model to return "None" for an attribute the SAME config
        gives a default. The two instructions contradict each other, and which one wins is decided by
        the model's confidence on the row -- i.e. not decided at all."""
        offenders = []
        for cfg in self._configs():
            defaults = cfg.get("extraction_defaults") or {}
            if not defaults:
                continue
            for rule in _rules_of(cfg):
                for sentence in _none_targets(_guidance(rule)):
                    low = sentence.lower()
                    for attr_id, spec in defaults.items():
                        # a slot-paired default is ABOUT the None case -- it is the mechanism, not a
                        # contradiction -- so only PLAIN defaults are guarded here.
                        if isinstance(spec, dict) and spec.get("requires_named"):
                            continue
                        label = _attr_label(cfg, attr_id)
                        if label and label.lower() in low:
                            offenders.append(
                                "%s rule %s: 'return None' sentence names '%s', which carries the "
                                "plain default %r" % (cfg["category_id"], rule.get("id"), label, spec)
                            )
        self.assertEqual(offenders, [], "\n".join(offenders))

    def test_no_rule_instructs_none_for_an_attribute_that_cannot_hold_it(self):
        """GUARD 2, and the one that bites hardest. "None" is only a legal value for an `allow_none`
        attribute; for any other, `_coerce_value` rejects it and the row silently loses the value AND
        gates. This is decidable without running anything."""
        offenders = []
        for cfg in self._configs():
            defs = {d["id"]: d for d in (cfg.get("attribute_definitions") or []) if d.get("id")}
            for rule in _rules_of(cfg):
                for sentence in _none_targets(_guidance(rule)):
                    low = sentence.lower()
                    for aid, d in defs.items():
                        if d.get("allow_none"):
                            continue
                        label = str(d.get("label") or aid)
                        if label.lower() in low:
                            offenders.append(
                                "%s rule %s: 'return None' sentence names '%s', which is NOT "
                                "allow_none -- coercion will drop it and the row will gate"
                                % (cfg["category_id"], rule.get("id"), label)
                            )
        self.assertEqual(offenders, [], "\n".join(offenders))

    def test_the_guards_are_not_vacuous_they_see_the_rules_they_are_meant_to_read(self):
        """NEGATIVE control on the guards' own reach: the popup P1 rule must actually be visible to
        them, and its 'return None' sentence must actually be found. A guard that reads nothing
        passes for the wrong reason."""
        popup = [c for c in self._configs() if c["category_id"] == "popup_boxes"][0]
        p1 = [r for r in _rules_of(popup) if r.get("id") == "P1"]
        self.assertEqual(len(p1), 1, "P1 must be present for these guards to mean anything")
        sentences = _none_targets(_guidance(p1[0]))
        self.assertTrue(sentences, "P1's 'return None' sentence must be found by the extractor")
        # ...and it must still name the module slots, so the guards are reading a real instruction.
        self.assertIn("switch", " ".join(sentences).lower())

    def test_colour_is_no_longer_a_none_target_in_popup_p1(self):
        """The specific regression. P1 used to end '...the face plate and the colour', which cost
        BOQ-26-00196/263 its White default and gated the row."""
        popup = [c for c in self._configs() if c["category_id"] == "popup_boxes"][0]
        g = _guidance([r for r in _rules_of(popup) if r.get("id") == "P1"][0])
        self.assertNotIn("and the colour", g)
        self.assertIn("Colour is not a module attribute", g)


# ======================================================================================
# TPN POLE VOCABULARY (owner rulings 1/2/4, 2026-08-22)
#
# TPN, TP+2N and TP+2NL all mean FOUR POLE (three phases plus neutral). Before this slice the
# decomposition prompt told the model the opposite -- "TPN"/"3 phase"/"TP" -> TP -- and that
# sentence was asserted by NOTHING, so it could be reworded or reordered with a green suite.
#
# THE TWO HALVES ARE NOT THE SAME KIND OF THING, AND THESE TESTS MUST NOT PRETEND THEY ARE.
# db_switchgear's half is an INSTRUCTION TO A MODEL: these pins are EVIDENCE the sentence now
# reads correctly, never proof the model obeys it. industrial_sockets' half is a CONFIG TABLE
# consumed by `map_attribute` -- that one IS deterministic, and its pins are proof.
# ======================================================================================
class TestTpnPoleVocabulary(FrappeTestCase):
    """Pins for the pole-vocabulary correction: the prompt sentence, its longest-first ordering,
    and the industrial_sockets normalisation table."""

    # the SEVEN spellings the owner approved for #57 item 4, all meaning four pole
    # (TP+NL added by ruling 6, TP+N by ruling 7, both 2026-08-22)
    _FOUR_POLE_SPELLINGS = ("TPN", "TP+N", "TP+NL", "TP+2N", "TP+2NL", "4P", "Four Pole")

    # ⚠️ THE CONTAINMENT PAIRS, re-derived rather than copied. A longer token must be tested
    # BEFORE any token it contains, or the shorter one matches first and truncates it:
    #   "TP+2N"  is a prefix of "TP+2NL"
    #   "TP+N"   is a prefix of "TP+NL"     <- introduced with ruling 7; did not exist before
    #   "TP"     is a prefix of ALL of them
    # "TP+N" is NOT contained in "TP+2N"/"TP+2NL" -- the "2" breaks it -- and "TPN" is contained
    # in none of them. Ordering longest-first satisfies every pair above.
    _CONTAINMENT_PAIRS = (("TP+2NL", "TP+2N"), ("TP+NL", "TP+N"),
                          ("TP+2NL", "TP"), ("TP+2N", "TP"), ("TP+NL", "TP"),
                          ("TP+N", "TP"), ("TPN", "TP"))

    def _configs(self):
        with open(_asset_path(CURRENT_EALL_ASSET), "r", encoding="utf-8") as fh:
            return json.load(fh)["category_configs"]

    def _config(self, category_id):
        hit = [c for c in self._configs() if c["category_id"] == category_id]
        self.assertEqual(len(hit), 1, "expected exactly one %s config" % category_id)
        return hit[0]

    def _decomposition_prompt(self):
        """Read it the way PRODUCTION reads it -- through select_prompt_text on the SHIPPED
        db_switchgear config -- so a pin can never pass against a prompt the config does not use."""
        cfg = self._config("db_switchgear")
        self.assertEqual(cfg.get("matching_mode"), "composite_decomposition")
        text = extraction.select_prompt_text(cfg)
        self.assertIn("SLOT_SPEC", text)  # sanity: this really is the decomposition prompt
        return text

    def _pole_line(self):
        lines = [ln for ln in self._decomposition_prompt().splitlines() if ln.startswith("- POLE")]
        self.assertEqual(len(lines), 1, "expected exactly one POLE line in the decomposition prompt")
        return lines[0]

    # ---- (1) the prompt sentence: POSITIVE ---------------------------------------------
    def test_prompt_maps_every_four_pole_spelling_to_fp(self):
        """POSITIVE. Every spelling the owner named must appear on the POLE line resolving to FP.
        Protects: a model reading a TPN / TP+2N / TP+2NL / 4P / Four Pole row is told four pole."""
        line = self._pole_line()
        for tok in ("TP+2NL", "TP+2N", "TP+NL", "TP+N", "TPN"):
            self.assertIn('"%s" -> FP' % tok, line, "POLE line does not map %r to FP" % tok)
        for tok in ("Four Pole", "4 pole", "4P", "FP"):
            self.assertIn('"%s"' % tok, line, "POLE line does not carry %r" % tok)
        self.assertIn("-> FP", line)
        self.assertIn("-> TP", line)

    def test_prompt_states_that_tpn_means_four_pole(self):
        """POSITIVE. The WHY, not just the mapping -- a bare table invites a future editor to
        'simplify' TPN back onto TP because the reason was never written down."""
        self.assertIn("TPN means four pole", self._pole_line())

    # ---- (1) the prompt sentence: ORDERING ---------------------------------------------
    def test_pole_tokens_are_ordered_longest_first(self):
        """POSITIVE, and the one a careless reorder breaks. "TP+2NL" CONTAINS "TP+2N", which
        CONTAINS "TP"; "TPN" also contains "TP". A model scanning for the first match must meet
        the longest token first, so the mapping list must be written longest-first.

        Protects: the exact defect this slice fixes being silently rebuilt by an editor who tidies
        the list into alphabetical or "logical" order.

        ⚠️ SCANS THE MAPPING LIST ONLY, not the whole line. The line's own explanation legitimately
        names the tokens in a different order while describing the containment ("TP+2NL" contains
        "TP+2N", which contains "TP"), so asserting over the whole line measures the prose rather
        than the mapping and fails on a correct prompt."""
        line = self._pole_line()
        self.assertIn("In order:", line, "the mapping list must be introduced by 'In order:'")
        mapping = line.split("In order:", 1)[1]
        # The containment relation is re-derived here from the tokens themselves, so this test
        # cannot drift from reality if another spelling is folded in later.
        for longer, shorter in self._CONTAINMENT_PAIRS:
            self.assertIn(shorter, longer,
                          "%r is not actually contained in %r -- the pair list is wrong" % (shorter, longer))
            self.assertLess(mapping.index('"%s"' % longer), mapping.index('"%s"' % shorter),
                            "%r must be listed BEFORE %r, which it contains" % (longer, shorter))

    def test_the_pole_line_says_its_own_order_is_load_bearing(self):
        """POSITIVE. The ordering above is invisible to a reader who does not know why it matters,
        so the line must say so IN ITSELF -- a test alone cannot reach a future editor."""
        line = self._pole_line()
        self.assertIn("LONGEST TOKEN FIRST", line)
        self.assertIn("LOAD-BEARING", line)
        self.assertIn("do not reorder", line)

    # ---- (1) the prompt sentence: NEGATIVES --------------------------------------------
    def test_the_retired_tpn_to_tp_mapping_is_gone(self):
        """NEGATIVE, the regression itself. The pre-slice line read
        "TPN"/"3 phase"/"TP" -> TP. If that clause ever returns, TPN prices as three-pole again."""
        prompt = self._decomposition_prompt()
        self.assertNotIn('"TPN"/"3 phase"/"TP" -> TP', prompt)
        for tok in ("TPN", "TP+N", "TP+NL", "TP+2N", "TP+2NL"):
            self.assertNotIn('"%s" -> TP' % tok, prompt,
                             "%r must never map to three-pole TP" % tok)

    def test_plain_tp_still_means_three_pole_in_the_prompt(self):
        """NEGATIVE CONTROL, and the one that stops an over-correction. A bare "TP" is genuinely
        three-pole; sweeping it into the four-pole family would be a NEW wrong-price defect in the
        opposite direction."""
        line = self._pole_line()
        self.assertIn('"3 phase"/"3P"/"TP" -> TP', line)
        self.assertIn('"DP" -> DP', line)
        self.assertIn('"SP"/"1 phase" -> SP', line)

    def test_the_pole_line_does_not_rewrite_db_shell_names(self):
        """NEGATIVE. TPN also names a BOARD TYPE ("TPN DB 8WAY"). Now that TPN maps to FP for
        breakers, the line must fence that off, or the model may hunt for an "FP DB" that does not
        exist and lose the shell."""
        self.assertIn("board type", self._pole_line())

    # ---- (3) the industrial_sockets normalisation table --------------------------------
    def _norm_steps(self):
        cfg = self._config("industrial_sockets")
        out = {}
        for pname, pl in (cfg.get("pipelines") or {}).items():
            steps = pl.get("steps") or []
            norm = [s for s in steps
                    if s.get("step") == "map_attribute"
                    and (s.get("params") or {}).get("result_attr") == "mcb_pole_norm"]
            out[pname] = (steps, norm)
        return out

    def test_normalisation_maps_every_four_pole_spelling_to_fp(self):
        """POSITIVE, and this half is DETERMINISTIC -- a config table read by `map_attribute`, not
        an instruction. Protects: an industrial-socket row whose text says TPN pairs a FOUR-POLE
        MCB, decided by code rather than by the model."""
        for pname, (_steps, norm) in self._norm_steps().items():
            self.assertEqual(len(norm), 1, "%s must carry exactly one mcb_pole_norm step" % pname)
            table = norm[0]["params"]["table"]
            for tok in self._FOUR_POLE_SPELLINGS:
                self.assertEqual(table.get(tok), "FP",
                                 "%s: %r must normalise to FP, got %r" % (pname, tok, table.get(tok)))
            self.assertEqual(table.get("FP"), "FP", "%s: FP must pass through" % pname)

    def test_normalisation_runs_before_the_pole_map_and_feeds_it(self):
        """POSITIVE, the wiring. `map_attribute`'s stated-wins branch copies `prefer_attr` VERBATIM
        and never consults its own table (ratePipelineInterpreter.ts), so the normalisation cannot
        live inside the existing step -- it must run AHEAD of it and become its prefer_attr.

        Protects: the whole mechanism. Get this wrong and the table exists but nothing reads it."""
        for pname, (steps, norm) in self._norm_steps().items():
            idx_norm = steps.index(norm[0])
            pole = [s for s in steps
                    if s.get("step") == "map_attribute"
                    and (s.get("params") or {}).get("result_attr") == "mcb_pole"]
            self.assertEqual(len(pole), 1, "%s must carry exactly one mcb_pole step" % pname)
            self.assertLess(idx_norm, steps.index(pole[0]),
                            "%s: the normalisation must run BEFORE the mcb_pole map" % pname)
            # it must ALWAYS run: a prefer_attr would re-introduce the stated-wins bypass
            self.assertIsNone(norm[0]["params"].get("prefer_attr"),
                              "%s: the normalising step must have NO prefer_attr" % pname)
            self.assertEqual(norm[0]["params"].get("from_attr"), "mcb_pole_stated", pname)
            self.assertEqual(pole[0]["params"].get("prefer_attr"), "mcb_pole_norm",
                             "%s: the mcb_pole map must prefer the NORMALISED value" % pname)

    def test_the_normalisation_exists_in_both_pipelines(self):
        """POSITIVE shape guard. indsock_boq and indsock_install each run the pair independently;
        normalising in one and not the other makes supply and install disagree about the pole --
        silently, because each pipeline is internally consistent."""
        steps_by_pipeline = self._norm_steps()
        self.assertEqual(set(steps_by_pipeline), {"indsock_boq", "indsock_install"})
        tables = [norm[0]["params"]["table"] for _s, norm in steps_by_pipeline.values()]
        self.assertEqual(tables[0], tables[1], "both pipelines must normalise IDENTICALLY")

    def test_plain_tp_is_not_swept_up_by_the_normalisation(self):
        """NEGATIVE, THE ONE THAT MATTERS. Every four-pole spelling except 4P / Four Pole starts
        with the characters "TP". A substring rule -- or a careless extra table key -- would drag a
        genuine three-pole TP into FP and over-price it. The lookup is an EXACT whole-value dict
        match, so TP maps to TP and stays there."""
        for pname, (_steps, norm) in self._norm_steps().items():
            table = norm[0]["params"]["table"]
            self.assertEqual(table.get("TP"), "TP", "%s: a bare TP must stay three-pole" % pname)
            self.assertEqual(table.get("DP"), "DP", pname)
            self.assertEqual(table.get("SP"), "SP", pname)

    def test_tp_2nl_is_not_truncated_to_tp_2n_or_tp(self):
        """NEGATIVE. "TP+2NL" must be its OWN key, distinct from "TP+2N" and "TP". If it were ever
        dropped on the assumption that the TP+2N key covers it, TP+2NL would fall through to
        whatever TP maps to -- three-pole -- which is the original defect wearing a longer name."""
        for pname, (_steps, norm) in self._norm_steps().items():
            table = norm[0]["params"]["table"]
            # EVERY containing token needs its OWN key. Dropping one on the assumption that the
            # shorter key "covers" it would truncate it -- TP+2NL -> TP+2N, TP+NL -> TP+N -- and a
            # bare TP resolves three-pole, which is the original defect wearing a longer name.
            for longer, shorter in self._CONTAINMENT_PAIRS:
                self.assertIn(longer, table, "%s: %s needs its own key" % (pname, longer))
                self.assertEqual(table[longer], "FP",
                                 "%s: %s must resolve four-pole" % (pname, longer))
            self.assertNotEqual(table["TP+2NL"], table["TP"], pname)
            self.assertNotEqual(table["TP+NL"], table["TP"], pname)
            self.assertNotEqual(table["TP+N"], table["TP"], pname)

    def test_the_pin_count_table_is_untouched(self):
        """NEGATIVE. The socket's OWN pin-count -> pole table is a different mechanism (it answers
        "no MCB pole was stated, infer one from the socket"). This slice must not have touched it."""
        for pname, (steps, _norm) in self._norm_steps().items():
            pole = [s for s in steps
                    if s.get("step") == "map_attribute"
                    and (s.get("params") or {}).get("result_attr") == "mcb_pole"][0]
            self.assertEqual(pole["params"].get("table"),
                             {"3 Pin / 2P+E": "SP", "5 Pin / 3P+N+E": "FP"}, pname)

    # ---- #57 item 4: the approved dropdown values, and NO sixth ------------------------
    def test_mcb_pole_stated_gained_only_the_approved_values(self):
        """POSITIVE + NEGATIVE on the UI change control. `mcb_pole_stated` renders on the Rate
        Master Derivation configurator (no `selector: false`, and `prefer_attr` is not collected by
        derivedAttrIds), so its `values` list IS a user-visible dropdown. The owner approved exactly
        five additions.

        The owner approved SEVEN additions in total: TPN, TP+2N, TP+2NL (rulings 1-4), TP+NL
        (ruling 6) and TP+N (ruling 7), plus 4P and Four Pole.

        Protects: an EIGHTH spelling being added without a ruling. The corpus sweep for
        `TP+<anything>` finds exactly TP+N, TP+NL, TP+2N and TP+2NL and nothing else, so any new
        member here would be a spelling nobody has measured."""
        cfg = self._config("industrial_sockets")
        d = [x for x in cfg["attribute_definitions"] if x["id"] == "mcb_pole_stated"][0]
        self.assertEqual(sorted(d["values"]),
                         sorted(["SP", "DP", "TP", "FP",
                                 "TPN", "TP+N", "TP+NL", "TP+2N", "TP+2NL", "4P", "Four Pole"]))
        # the four ORIGINAL catalogue poles must survive untouched
        for original in ("SP", "DP", "TP", "FP"):
            self.assertIn(original, d["values"])
        # and every approved addition must be present, none of them dropped
        for approved in self._FOUR_POLE_SPELLINGS:
            self.assertIn(approved, d["values"], "%r is an approved value and must be offerable" % approved)
        # the pricing PANEL is unaffected -- this is what keeps the pricer's screen out of scope
        self.assertIs(d.get("panel"), False)

    def test_every_normalisation_key_is_an_offerable_value(self):
        """NEGATIVE on drift between the two halves. A table key the domain cannot hold is dead
        config: `_coerce_value_ex` discards an out-of-domain answer before storage, so the model
        could never supply it and the row would silently fall through to the pin-count default."""
        cfg = self._config("industrial_sockets")
        d = [x for x in cfg["attribute_definitions"] if x["id"] == "mcb_pole_stated"][0]
        allowed = set(d["values"])
        for pname, (_steps, norm) in self._norm_steps().items():
            for key in norm[0]["params"]["table"]:
                self.assertIn(key, allowed,
                              "%s: table key %r is not an offerable mcb_pole_stated value"
                              % (pname, key))

    def test_the_normalisation_explains_itself_on_the_step_not_in_its_params(self):
        """POSITIVE + NEGATIVE, and this one was earned by a live defect.

        The v3 amendment first wrote the widened vocabulary to `params.explain` -- a key
        `MapAttributeStep` does not declare and the Rate Master Derivation screen never reads. The
        config validated, every other test stayed green, the table was correct, and the screen went
        on showing the OLD sentence. Only opening the page caught it.

        Protects two things: the reader-facing text names the FULL vocabulary, and no step smuggles
        an undeclared `explain` into `params`, where it is inert but round-trips into the asset
        forever."""
        for pname, (steps, norm) in self._norm_steps().items():
            explain = norm[0].get("explain") or ""
            self.assertTrue(explain, "%s: the normalisation must explain itself ON THE STEP" % pname)
            for tok in self._FOUR_POLE_SPELLINGS:
                self.assertIn(tok, explain,
                              "%s: step explain does not name %r" % (pname, tok))
            # NEGATIVE: nothing anywhere in this category may carry params.explain
            for st in steps:
                params = st.get("params")
                if isinstance(params, dict):
                    self.assertNotIn("explain", params,
                                     "%s: %s carries a stray params.explain -- it belongs on the STEP"
                                     % (pname, st.get("step")))

    def test_r12_tells_the_model_to_report_the_token_not_convert_it(self):
        """POSITIVE. The table can only normalise what the model REPORTS. R12(3) used to instruct a
        conversion at read time ("'4P' meaning FP"), which would leave the table idle and put the
        decision back in the model. It must now ask for the token verbatim.

        This is the standing "the model reads facts; code does the substitution" rule, applied."""
        cfg = self._config("industrial_sockets")
        r12 = [r for r in (cfg.get("rules") or []) if r.get("id") == "R12"][0]
        g = r12["guidance"]
        self.assertIn("VERBATIM", g)
        self.assertIn("computed downstream", g)
        self.assertNotIn("'4P' meaning FP", g)  # the retired conversion instruction


class TestConduitInTheCableRate(FrappeTestCase):
    """v47 config-shape guards for the conduit component on `wiring_cabling`.

    The vitest suite pins the ARITHMETIC against an inline catalog; this pins what actually
    SHIPPED in the asset, which is the half a fixture cannot vouch for."""

    def _configs(self):
        with open(_asset_path(CURRENT_EALL_ASSET), "r", encoding="utf-8") as fh:
            return json.load(fh)["category_configs"]

    def _config(self, category_id):
        hit = [c for c in self._configs() if c["category_id"] == category_id]
        self.assertEqual(len(hit), 1, "expected exactly one %s config" % category_id)
        return hit[0]

    def _maps(self, cfg):
        steps = cfg["pipelines"]["cable_boq"]["steps"]
        return {
            s["params"]["result_attr"]: s["params"]
            for s in steps
            if s.get("step") == "map_attribute"
        }

    def test_the_three_conduit_attributes_are_extracted_AND_panel_visible(self):
        """⚠️ prefer_attr MUST equal result_attr for a PANEL-VISIBLE attribute.

        `applyDerivedDisplay`'s STATED branch publishes NO display value -- it deliberately falls
        back to the attribute's OWN extracted value, so that a pricer's entry is shown rather than
        the pipeline taking credit for it. That only works when the map's `prefer_attr` IS the
        target. A first cut split each fact into a `panel: false` raw attribute plus an
        `extract: false` resolved one; pricing was correct and all three fields rendered BLANK,
        because nothing extracts the resolved id. This is the cabletray_raceway `thickness_mm`
        shape, which is the shipped precedent for a panel-visible mapped attribute."""
        cfg = self._config("wiring_cabling")
        defs = {d["id"]: d for d in cfg["attribute_definitions"]}
        maps = self._maps(cfg)
        for a in ("conduit_included", "conduit_type", "size_mm"):
            self.assertIn(a, defs)
            # EXTRACTED: the model answers it (no `extract: false`)
            self.assertNotEqual(defs[a].get("extract"), False, "%s must be extracted" % a)
            # PANEL-VISIBLE: R9 -- the pricer is the authority over any value pricing used
            self.assertNotEqual(defs[a].get("panel"), False, "%s must stay panel-visible" % a)
            self.assertTrue(defs[a].get("allow_none"), "%s needs allow_none for the sentinel" % a)
            # ...and the map prefers the attribute ITSELF
            self.assertEqual(maps[a]["prefer_attr"], a,
                             "%s: prefer_attr must be the attribute itself or the panel renders blank" % a)
        # NEGATIVE: the superseded split shape must not come back
        for gone in ("conduit_included_stated", "conduit_type_stated", "size_mm_stated"):
            self.assertNotIn(gone, defs)

    def test_size_mm_carries_a_default_and_that_default_is_load_bearing(self):
        """⚠️ DO NOT REMOVE `size_mm`'s default to 'tidy' the config.

        pricingSheetHelper.ts:520-533 narrows a `map_attribute` target OUT of the missing-gate
        exemption when it has NO default and its source reads blank -- and `valueOfDef` reads the
        RAW extraction, which is null on EVERY row for an attribute nothing extracts. Without this
        default, `size_mm` is narrowed on every wiring row and roughly 5,000 of them render
        "Complete the missing attributes to price" instead of their rate.

        The default is the "None" SENTINEL, not 25: the 25 comes from the TABLE keyed on the
        resolved material, which is what makes it fire ONLY when a material is known (ruling vi)."""
        maps = self._maps(self._config("wiring_cabling"))
        self.assertEqual(maps["size_mm"]["default"], "None")
        self.assertEqual(maps["size_mm"]["table"], {"MS": 25, "PVC": 25})
        self.assertEqual(maps["size_mm"]["from_attr"], "conduit_type")
        self.assertEqual(maps["size_mm"]["prefer_attr"], "size_mm")

    def test_no_material_is_ever_defaulted_and_absence_is_the_sentinel(self):
        """Ruling (vii) 'dont use dfault for material type'. conduit_type's default is the
        positive-absence sentinel -- which is ALSO the thing `none_skips` reads to zero the
        component on a row that names no conduit. One value, two jobs."""
        maps = self._maps(self._config("wiring_cabling"))
        self.assertEqual(maps["conduit_type"]["default"], "None")
        self.assertNotIn(maps["conduit_type"]["default"], ("PVC", "MS"))
        # ruling (v): where the system cannot judge, default to NOT included
        self.assertEqual(maps["conduit_included"]["default"], "No")

    def test_the_two_zero_paths_are_both_present(self):
        """A no-conduit row zeroes via `none_skips` (type = None); a not-included row zeroes via
        `qty.if_attr`. Either alone leaves a case that would price when it must not."""
        steps = self._config("wiring_cabling")["pipelines"]["cable_boq"]["steps"]
        ref = [s for s in steps if s.get("step") == "component_ref" and s.get("name") == "conduit"]
        self.assertEqual(len(ref), 1)
        ref = ref[0]
        self.assertIs(ref["none_skips"], True)
        self.assertEqual(ref["qty"], {"if_attr": {"conduit_included": "Yes"}, "then": 1, "else": 0})
        # ruling (iv): conduit prices through its OWN arithmetic -- list x 0.7, UNROUNDED
        self.assertEqual(ref["rate_stages"], [{"mult": 0.7}])
        self.assertEqual(ref["ref"]["kind"], "conduit")

    def test_termination_boq_has_a_zero_line_diff(self):
        """Ruling (ii): 'Termination is not impacted by this.' NEGATIVE, and the search space is
        the whole pipeline -- no conduit token may appear anywhere in it."""
        cfg = self._config("wiring_cabling")
        term = json.dumps(cfg["pipelines"]["termination_boq"])
        self.assertNotIn("conduit", term.lower())
        # and the conduit steps live on cable_boq ONLY
        self.assertIn("conduit", json.dumps(cfg["pipelines"]["cable_boq"]).lower())

    def test_gi_maps_to_ms_through_the_shipped_synonym_mechanism(self):
        """The same mechanism conduit_piping uses. It matters that this is a SYNONYM and not a
        model instruction: the coercion applies it before the allowed-values check, so a stated GI
        arrives as MS and is marked PLAIN, not '(computed)'."""
        cfg = self._config("wiring_cabling")
        self.assertEqual(cfg["synonyms"]["conduit_type"], {"GI": "MS"})

    def test_the_extraction_rule_teaches_facts_and_never_the_substitution(self):
        """Standing rule: the model READS FACTS; every substitution lives in code or config.
        R11 must never mention the 25mm fallback -- that is the map table's job -- and must not
        restate ancestor precedence, which the shipped _ROW_CONTEXT_SHAPE_GUIDANCE already gives."""
        cfg = self._config("wiring_cabling")
        r11 = [r for r in (cfg.get("rules") or []) if r.get("id") == "R11"]
        self.assertEqual(len(r11), 1)
        g = r11[0]["guidance"]
        self.assertNotIn("25", g)                       # no substitution in the prompt
        self.assertNotIn("nearest", g.lower())          # precedence is already shipped elsewhere
        for token in ("Yes", "No", "Unclear"):
            self.assertIn(token, g)

    def test_every_wiring_golden_is_unchanged_and_that_is_the_regression_proof(self):
        """None of g1-g5 names a conduit, so conduit_type resolves to the sentinel, the component
        is zero, and both added `scale` steps add 0. If a wiring golden ever moves, the conduit
        component has leaked onto a row that names no conduit."""
        cfg = self._config("wiring_cabling")
        by_id = {g["id"]: g for g in cfg["goldens"]}
        self.assertEqual(by_id["g1"]["expect"]["cable_boq"], {"supply_per_mtr": 130, "install_per_mtr": 20})
        self.assertEqual(by_id["g2"]["expect"]["cable_boq"], {"supply_per_mtr": 170, "install_per_mtr": 28})
        self.assertEqual(by_id["g3"]["expect"]["cable_boq"], {"supply_per_mtr": 200, "install_per_mtr": 44})
        self.assertEqual(by_id["g5"]["expect"]["cable_boq"], {"supply_per_mtr": 720, "install_per_mtr": 40})
        # and no golden carries a conduit attribute -- which is WHY they are unchanged
        for g in cfg["goldens"]:
            self.assertFalse([k for k in g["attrs"] if "conduit" in k or k == "size_mm"])


# ---- PW-LENGTH-BY-POINT-TYPE + PW-CONDUIT-OPTIONAL: the v48 point_wiring slice ------------------
class TestPointWiringConduitAndLength(FrappeTestCase):
    """PIECE 4's matcher (pure, no DB) and the v48 config SHAPE that pieces 1-3 depend on.

    The matcher is the half that cannot be tested in vitest: it reads the payload `_ai_item` builds,
    which is Python. The config assertions are what make the interpreter's fixture tests honest --
    a green interpreter test over a fixture that has drifted from the shipped config proves nothing.
    """

    # ---------- PIECE 4: the point-type matcher ----------
    @staticmethod
    def _item(desc, ancestors=()):
        """A payload item in `_ai_item`'s exact shape. distance 1 == the immediate parent."""
        chain = [{"relation": "sheet", "description": "Electrical"}]
        n = len(ancestors)
        for i, a in enumerate(ancestors):
            d = n - i
            chain.append({"relation": "parent" if d == 1 else "grandparent", "distance": d,
                          "tier": "full" if d <= 2 else "lean", "node_type": "Preamble",
                          "description": a})
        return {"id": 1, "description": desc, "ancestor_chain": chain}

    def test_pw_pt_01_primary_only_is_primary(self):
        """POSITIVE: a row naming only a primary/first point -> 15 m downstream."""
        from nirmaan_stack.services.boq_rate_master.extraction import point_type_of
        self.assertEqual(point_type_of(self._item("Primary Light Point controlled by switch board")), "Primary")
        self.assertEqual(point_type_of(self._item("Wiring to the first light point")), "Primary")

    def test_pw_pt_02_secondary_only_is_secondary(self):
        """POSITIVE: secondary / looping / second / third -> 5 m downstream."""
        from nirmaan_stack.services.boq_rate_master.extraction import point_type_of
        self.assertEqual(point_type_of(self._item("Secondary light points wiring")), "Secondary")
        self.assertEqual(point_type_of(self._item("LOOP POINT wiring for the fixture")), "Secondary")

    def test_pw_pt_03_the_decisive_row_looped_to_primary_is_SECONDARY(self):
        """⚠️ THE ONE THAT DECIDES IT. The owner ruled that

              "Secondary Light / Fan Point / AC Circuit Wiring Looped to Primary Point"

        IS A SECONDARY POINT. The word "Primary" appears in it, so a word-presence rule reads BOTH
        types and falls back to the formula -- which is the wrong answer, not merely a cautious one.
        The preposition guard is what separates the type a row IS from a type it REFERS TO.
        """
        from nirmaan_stack.services.boq_rate_master.extraction import point_type_of
        row = "Secondary Light / Fan Point / AC Circuit Wiring Looped to Primary Point with 2.5 sqmm x 3 Wire"
        self.assertEqual(point_type_of(self._item(row)), "Secondary")

    def test_pw_pt_04_other_referential_verbs_are_also_guarded(self):
        """POSITIVE: the guard covers the verb list drawn from the corpus, not just 'looped'."""
        from nirmaan_stack.services.boq_rate_master.extraction import point_type_of
        for row in ("Secondary point wiring looped from first point",
                    "Secondary light point wiring looped with first point",
                    "Secondary point extended from primary point"):
            self.assertEqual(point_type_of(self._item(row)), "Secondary", row)

    def test_pw_pt_05_nearest_wins_over_an_ancestor_naming_both(self):
        """⚠️ NEAREST WINS -- and the guard ALONE is not sufficient without it.

        The live shape (BOQ-26-00141 r130): the row's parent says "Secondary ... Looped to Primary
        Point", and its grandparent's note names BOTH types. A flat scan over the whole chain reads
        BOTH and falls to the formula. Only the shallowest level carrying a type token votes.
        """
        from nirmaan_stack.services.boq_rate_master.extraction import point_type_of
        item = self._item(
            "Upto 6 Meters",
            ancestors=("Switch board to Primary & Secondary Point wiring shall be 1.5 sqmm x 3 wire",
                       "Secondary Light / Fan Point / AC Circuit Wiring Looped to Primary Point"),
        )
        self.assertEqual(point_type_of(item), "Secondary")

    def test_pw_pt_06_primary_from_the_parent_when_the_row_is_a_bare_band(self):
        """POSITIVE: the mirror case -- the parent says Primary, the row is only a length band."""
        from nirmaan_stack.services.boq_rate_master.extraction import point_type_of
        item = self._item("Upto 6 Meters",
                          ancestors=("LIGHT / FAN / AC WIRING",
                                     "Primary Light / Fan Point / AC Circuit Wiring Controlled from DB"))
        self.assertEqual(point_type_of(item), "Primary")

    def test_pw_pt_07_NEGATIVE_both_types_at_the_nearest_level_returns_none(self):
        """NEGATIVE: both types named at the SAME level -> None -> the formula stands, as ruled
        ("that formula is valid if the line item ... includes both type of points")."""
        from nirmaan_stack.services.boq_rate_master.extraction import point_type_of
        self.assertIsNone(point_type_of(self._item("Primary and secondary light point wiring")))

    def test_pw_pt_08_NEGATIVE_neither_type_returns_none(self):
        """NEGATIVE: no type named anywhere -> None -> the formula stands, untouched."""
        from nirmaan_stack.services.boq_rate_master.extraction import point_type_of
        self.assertIsNone(point_type_of(self._item("Supply and wiring of light point with 1.5 sq mm wire")))
        self.assertIsNone(point_type_of(self._item("")))

    def test_pw_pt_09_NEGATIVE_a_referential_primary_alone_does_not_make_it_primary(self):
        """NEGATIVE, and the sharp edge of the guard: a row whose ONLY primary token is referential
        and which names no secondary token either must yield None -- never Primary. Reading it as
        Primary would substitute 15 m on a row that never claimed to be one."""
        from nirmaan_stack.services.boq_rate_master.extraction import point_type_of
        self.assertIsNone(point_type_of(self._item("Wiring drawn from the first point to the fixture")))

    def test_pw_pt_10_notes_are_read_at_the_full_tier(self):
        """POSITIVE: the matcher reads the payload's note block, not just descriptions."""
        from nirmaan_stack.services.boq_rate_master.extraction import point_type_of
        item = self._item("Upto 8 Meters")
        item["notes"] = {"attached": ["Secondary point wiring, looped"]}
        self.assertEqual(point_type_of(item), "Secondary")

    # ---------- the v48 CONFIG SHAPE that pieces 1-3 ride on ----------
    def _pw_cfg(self):
        import json, os
        from nirmaan_stack.api.boq.test_rate_master import CURRENT_EALL_ASSET, _asset_path
        with open(_asset_path(CURRENT_EALL_ASSET), "r", encoding="utf-8") as fh:
            d = json.load(fh)
        return [c for c in d["category_configs"] if c["category_id"] == "point_wiring"][0]

    def test_pw_cfg_01_circuit_fit_declares_positive_absence(self):
        """PIECE 1's config half: without `absent_when` the engine branch is unreachable and a
        dropped conduit would kill the whole row instead of zeroing one line."""
        cfg = self._pw_cfg()
        # SCOPED TO THE THREE ASSEMBLY PIPELINES (v51). `pw_circuit_supply` / `pw_circuit_install`
        # are DISPLAY-ONLY and deliberately size no conduit at all -- their shape is asserted by
        # TestPointWiringCircuitStretch.test_pw_cs_10, which is also what stops them acquiring one.
        for pid in _PW_ASSEMBLY_PIPELINES:
            pl = cfg["pipelines"][pid]
            cf = [s for s in pl["steps"] if s["step"] == "circuit_fit"][0]
            self.assertEqual(cf["params"].get("absent_when"),
                             {"attr": "conduit_type", "equals": "None"}, pid)
            cd = [s for s in pl["steps"] if s.get("name") == "conduit"][0]
            self.assertTrue(cd.get("none_skips"), pid)

    def test_pw_cfg_02_the_decision_table_chain_is_present_and_ordered(self):
        """PIECE 2: the three-step chain, IN ORDER. The order IS the table -- the explicit-exclusion
        step must come LAST so it outranks every inference above it, and the drop-to-None step must
        come AFTER the PVC default so the default does not undo it."""
        cfg = self._pw_cfg()
        # SCOPED TO THE THREE ASSEMBLY PIPELINES (v51) -- see test_pw_cfg_01. The last three entries
        # are the circuit stretch's own chain, appended AFTER the whole conduit table so not one
        # pre-existing step moved; their meaning is asserted by test_pw_cs_06 / test_pw_cs_07.
        for pid in _PW_ASSEMBLY_PIPELINES:
            pl = cfg["pipelines"][pid]
            maps = [s for s in pl["steps"] if s["step"] == "map_attribute"]
            got = [(m["params"]["result_attr"], m["params"].get("from_attr")) for m in maps]
            self.assertEqual(got, [
                ("circuit_length_m", "point_type"),
                ("conduit_included", "conduit_handoff"),
                ("conduit_included", "other_conduit"),
                ("conduit_included", "conduit_price_excluded"),
                ("conduit_type", None),
                ("conduit_type", "conduit_included"),
                ("circuit_wire_length_m", "circuit_wire_included"),
                ("circuit_qty_m", None),
                ("circuit_qty_m", "point_type"),
            ], pid)

    def test_pw_cfg_03_silence_includes_PVC_the_OPPOSITE_of_cables(self):
        """PIECE 3 + the contrast that must never be harmonised.

        wiring_cabling (F-28) maps conduit_included with default "No": a CABLE row silent on conduit
        EXCLUDES it. point_wiring defaults "Yes" and conduit_type defaults "PVC": a POINT WIRING row
        silent on conduit INCLUDES it. Point wiring normally carries conduit; cables normally do not.
        This test asserts BOTH defaults so a future editor cannot quietly make them agree.
        """
        import json
        from nirmaan_stack.api.boq.test_rate_master import CURRENT_EALL_ASSET, _asset_path
        cfg = self._pw_cfg()
        pl = cfg["pipelines"]["pw_boq_supply"]["steps"]
        handoff = [s for s in pl if s["step"] == "map_attribute"
                   and s["params"].get("from_attr") == "conduit_handoff"][0]
        self.assertEqual(handoff["params"]["default"], "Yes")
        ctype = [s for s in pl if s["step"] == "map_attribute"
                 and s["params"]["result_attr"] == "conduit_type"
                 and s["params"].get("prefer_attr") == "conduit_type"][0]
        self.assertEqual(ctype["params"]["default"], "PVC")
        # the cable side, in the SAME asset, must still say No
        with open(_asset_path(CURRENT_EALL_ASSET), "r", encoding="utf-8") as fh:
            d = json.load(fh)
        wc = [c for c in d["category_configs"] if c["category_id"] == "wiring_cabling"][0]
        cable_ci = [s for s in wc["pipelines"]["cable_boq"]["steps"]
                    if s["step"] == "map_attribute" and s["params"]["result_attr"] == "conduit_included"][0]
        self.assertEqual(cable_ci["params"]["default"], "No",
                         "cables must still EXCLUDE on silence -- the defaults are opposite BY DESIGN")

    def test_pw_cfg_04_the_facts_are_declared_and_hidden_but_still_extracted(self):
        """The three conduit facts are `panel: false` -- hidden from the pricing panel (the pricer's
        override surface is conduit_type) but STILL EXTRACTED, and exempt from the whole-row missing
        gate. `point_type` and `conduit_included` are additionally `extract: false`: code supplies
        them, so the model must never be asked."""
        cfg = self._pw_cfg()
        by_id = {a["id"]: a for a in cfg["attribute_definitions"]}
        for fid in ("conduit_handoff", "other_conduit", "conduit_price_excluded"):
            self.assertIs(by_id[fid]["panel"], False, fid)
            self.assertIsNot(by_id[fid].get("extract"), False, fid)
        for cid in ("point_type", "conduit_included"):
            self.assertIs(by_id[cid]["panel"], False, cid)
            self.assertIs(by_id[cid]["extract"], False, cid)
        self.assertTrue(by_id["conduit_type"].get("allow_none"))

    def test_pw_cfg_05_NEGATIVE_no_other_category_gained_absent_when(self):
        """NEGATIVE: piece 1 must not change any other category's behaviour. `circuit_fit` is
        point_wiring's alone today, but the assertion is over EVERY config so it stays true if
        another category adopts the step."""
        import json
        from nirmaan_stack.api.boq.test_rate_master import CURRENT_EALL_ASSET, _asset_path
        with open(_asset_path(CURRENT_EALL_ASSET), "r", encoding="utf-8") as fh:
            d = json.load(fh)
        for c in d["category_configs"]:
            if c["category_id"] == "point_wiring":
                continue
            for pid, pl in (c.get("pipelines") or {}).items():
                for s in pl.get("steps") or []:
                    if s.get("step") == "circuit_fit":
                        self.assertIsNone(s["params"].get("absent_when"),
                                          f"{c['category_id']}.{pid}")


class TestPointWiringCircuitStretch(FrappeTestCase):
    """PW-CIRCUIT-STRETCH (v51, 2026-09-02) -- the CIRCUIT (submain) run from the DB, priced as a
    COMPONENT of the point rate.

    THE THREE THINGS THAT COULD GO WRONG, AND WHICH TEST HOLDS EACH:

      (a) a row with NO circuit wiring changes price. `test_pw_cs_12` pins every expected value on
          the four no-circuit goldens; `test_pw_cs_06` pins `none_skips` on both components, which
          is the mechanism that zeroes them.
      (b) the circuit amount is charged where the owner ruled it must not be, or scaled by the point
          count. `test_pw_cs_07` pins the Secondary exclusion; `test_pw_cs_06` pins the flat qty.
      (c) the "None" / BLANK distinction collapses on the circuit thicknesses -- the one that turns
          the owner's ruled LOUD failure into a silent under-quote. `test_pw_cs_03` pins the wording
          and `test_pw_cs_04` pins that the wording actually reaches the model.
    """

    # ---------- shared readers ----------
    def _payload(self):
        import json
        with open(_asset_path(CURRENT_EALL_ASSET), "r", encoding="utf-8") as fh:
            return json.load(fh)

    def _prev_payload(self):
        import json
        with open(_asset_path("rate_master_electrical_all_v50.json"), "r", encoding="utf-8") as fh:
            return json.load(fh)

    def _cfg(self):
        return [c for c in self._payload()["category_configs"]
                if c["category_id"] == "point_wiring"][0]

    def _prev_cfg(self):
        return [c for c in self._prev_payload()["category_configs"]
                if c["category_id"] == "point_wiring"][0]

    # The three pipelines that PRICE. The two `pw_circuit_*` ones are DISPLAY ONLY and are asserted
    # separately (test_pw_cs_09) -- they deliberately carry neither circuit_fit nor module_fit.
    ASSEMBLY = ("pw_boq_supply", "pw_boq_install", "pw_bcs")
    # SLICE B: RETIRED at v53. Kept as a NAMED roster so the "these are gone" assertions read
    # in terms of what was removed, rather than repeating two bare strings at each site.
    RETIRED_DISPLAY = ("pw_circuit_supply", "pw_circuit_install")

    THICKNESSES = ("circuit_wire1_thickness_sqmm", "circuit_wire2_thickness_sqmm")
    # SLICE B: the eight PANEL-VISIBLE circuit fields that carry `group_label`. Deliberately NOT
    # `EIGHT` (that tuple is the ABSENT-spec set the extraction corrector fills) and deliberately
    # excluding `circuit_length_m` (the POINT stretch) and `circuit_qty_m` (panel:false).
    EIGHT_GROUP = (
        "circuit_wire_included",
        "circuit_wire1_core", "circuit_wire1_runs", "circuit_wire1_thickness_sqmm",
        "circuit_wire2_core", "circuit_wire2_runs", "circuit_wire2_thickness_sqmm",
        "circuit_wire_length_m",
    )
    EIGHT = (
        "circuit_wire_included",
        "circuit_wire1_core", "circuit_wire1_runs", "circuit_wire1_thickness_sqmm",
        "circuit_wire2_core", "circuit_wire2_runs", "circuit_wire2_thickness_sqmm",
        "circuit_wire_length_m",
    )

    # ---------- the fields ----------
    def test_pw_cs_01_the_eight_fields_are_declared_visible_and_editable(self):
        """POSITIVE (owner: "all the fields will be user editable as we have for the other helper
        fields"). All eight are panel-visible and none is `selector: false`, so the pricer can see
        and correct every one. They sit CONTIGUOUSLY so they read as one block on the panel."""
        cfg = self._cfg()
        ids = [d["id"] for d in cfg["attribute_definitions"]]
        by_id = {d["id"]: d for d in cfg["attribute_definitions"]}
        for fid in self.EIGHT:
            self.assertIn(fid, by_id, fid)
            self.assertIsNot(by_id[fid].get("panel"), False, "%s must be visible" % fid)
            self.assertIsNot(by_id[fid].get("selector"), False, "%s must be editable" % fid)
        first = ids.index(self.EIGHT[0])
        self.assertEqual(ids[first:first + len(self.EIGHT)], list(self.EIGHT),
                         "the eight fields must be contiguous, in the owner's order")
        # the ninth is the pipeline's own working value and is deliberately NOT a pricer field:
        # it carries the Secondary exclusion, which is a CODE decision.
        self.assertIs(by_id["circuit_qty_m"]["panel"], False)
        self.assertIs(by_id["circuit_qty_m"]["extract"], False)

    def test_pw_cs_02_neither_circuit_thickness_carries_a_default(self):
        """THE OWNER'S LOUD-FAILURE RULING (2026-09-02): "if it cannot be detremined then it is left
        blank as we do for all other fields also. in this case the row would not price till the user
        enters the correct thickness."

        A default would price a GUESSED gauge, which is exactly what was rejected. No default means
        a blank thickness is a blank PANEL-VISIBLE NON-DERIVED field, which the helper's whole-row
        missing gate turns into "Complete the missing attributes to price".

        `allow_none` is a different axis and does NOT weaken this: it rescues only the literal string
        "None" (positive absence), never a blank. Both are asserted here so the pair cannot drift.
        """
        cfg = self._cfg()
        by_id = {d["id"]: d for d in cfg["attribute_definitions"]}
        for tid in self.THICKNESSES:
            self.assertNotIn(tid, cfg["extraction_defaults"],
                             "%s must have NO default -- an unreadable gauge must REFUSE" % tid)
            self.assertTrue(by_id[tid]["allow_none"], tid)
            self.assertEqual(by_id[tid]["disables_when_none"],
                             [tid.replace("_thickness_sqmm", "_core"),
                              tid.replace("_thickness_sqmm", "_runs")], tid)
        # ... and the four core/runs fields DO carry the mirrored default of 1, exactly as the point
        # wiring wire fields do, so a stated circuit wire with an unstated core count still prices.
        for fid in ("circuit_wire1_core", "circuit_wire1_runs",
                    "circuit_wire2_core", "circuit_wire2_runs"):
            self.assertEqual(cfg["extraction_defaults"][fid], 1.0, fid)
        # SILENCE IS NOT INCLUSION -- the necessary criterion, as a default.
        self.assertEqual(cfg["extraction_defaults"]["circuit_wire_included"], "No")

    # ---------- the wording: "None" vs BLANK ----------
    def test_pw_cs_03_the_wording_draws_the_None_vs_blank_line(self):
        """⚠️ THE TEST THIS SLICE MOST NEEDS. `allow_none` on a circuit thickness is safe ONLY while
        the model is told, unmistakably, that the two answers mean different things:

            the document positively indicates there is NO such wire -> "None"
            the model CANNOT TELL what the gauge is                 -> NOTHING (blank)

        If the model answers "None" for "I could not read it", `none_skips` zeroes the component and
        the row prices with no circuit charge -- the owner's ruled LOUD failure becomes a SILENT
        under-quote, on the ~103 qualifying rows whose inclusion sentence names no gauge.

        The guidance REPLACES the shipped truthy flag, so the first assertion is that the ORIGINAL
        default sentence survives verbatim -- the other allow_none fields on this category (socket,
        plate, wire 2, conduit type) must keep reading exactly as they did.
        """
        g = self._cfg()["extraction_none_guidance"]
        self.assertIsInstance(g, str)
        # (1) the shipped default wording, preserved word for word
        self.assertIn(
            'return "None" when the row\'s enumerated bill names NO such component (positive '
            "absence -- a real light point may have a switch and plate but no socket, or a single "
            "wire and no second wire); return null/blank ONLY when the row is too vague to tell.",
            g,
        )
        # (2) the new line, named at BOTH circuit thickness fields
        for tid in self.THICKNESSES:
            self.assertIn(tid, g, "the wording must name %s explicitly" % tid)
        # (3) the two directions, each stated
        self.assertIn("positively indicates there is no such circuit wire", g)
        self.assertIn("you cannot tell what gauge it is, answer NOTHING", g)
        # (4) the prohibition, in the model's own words
        self.assertIn('NEVER answer "None" to mean "I could not read it"', g)
        # (5) and WHY -- the consequences, so the instruction is not merely a rule to be traded off
        self.assertIn("a BLANK stops the row and a pricer is asked to supply the size", g)

    def test_pw_cs_04_the_wording_reaches_the_model(self):
        """POSITIVE, and the reason (3) above is not enough on its own: the guidance is CONFIG DATA,
        and config data that never reaches the prompt is inert. This drives the REAL prompt builder
        (`_extract_batch`) with a stub client and reads the payload it would have sent.

        It also pins the two things that make the section fire at all: `_extraction_attr_defs` must
        publish both thicknesses as `allow_none` (that list is what the section enumerates), and the
        custom string must be used VERBATIM rather than the default wording.
        """
        from nirmaan_stack.services.boq_rate_master import extraction as ex

        cfg = self._cfg()
        captured = {}

        class _Block(object):
            text = "[]"

        class _Resp(object):
            content = [_Block()]
            stop_reason = "end_turn"
            usage = None

        class _Messages(object):
            def create(self, **kw):
                captured["content"] = kw["messages"][0]["content"]
                return _Resp()

        class _Client(object):
            messages = _Messages()

        defs = ex.build_attribute_defs(cfg, discipline="Electrical")
        none_ids = [d["id"] for d in defs if d.get("allow_none")]
        for tid in self.THICKNESSES:
            self.assertIn(tid, none_ids,
                          "%s must reach the model as an allow_none field, or the "
                          "OPTIONAL COMPONENTS section never mentions it" % tid)
        # `circuit_wire_length_m` is extract:false -- the pipeline supplies 30 and the pricer edits
        # it; the model is never asked. (`circuit_qty_m` likewise.)
        sent_ids = [d["id"] for d in defs]
        self.assertNotIn("circuit_wire_length_m", sent_ids)
        self.assertNotIn("circuit_qty_m", sent_ids)

        rows = [{"excel_row": 11, "description": "Primary light point wiring",
                 "sheet_name": "S", "committed_version": 1, "category_id": "point_wiring",
                 "ancestors": [], "notes": {}}]
        ex._extract_batch(_Client(), "stub-model", "PROMPT", defs, rows,
                          defaults=cfg["extraction_defaults"],
                          none_guidance=cfg["extraction_none_guidance"],
                          rules=cfg["rules"])
        sent = captured["content"]
        self.assertIn('OPTIONAL COMPONENTS (may be "None"):', sent)
        self.assertIn('NEVER answer "None" to mean "I could not read it"', sent)
        self.assertIn("you cannot tell what gauge it is, answer NOTHING", sent)
        # the estimator rule rides the same payload
        self.assertIn("SILENCE IS No", sent)

    def test_pw_cs_05_the_inclusion_rule_requires_positive_language(self):
        """THE NECESSARY CRITERION (owner: "The row must carry positive inclusion language").

        The model REPORTS what the row says and never applies the charge rule -- the F-5 failure this
        codebase already paid for. R13 must therefore (a) demand positive language, (b) say silence
        is No, (c) forbid the model deciding whether to charge, and (d) repeat the blank-not-None
        instruction where the estimator reads it.
        """
        cfg = self._cfg()
        r13 = [r for r in cfg["rules"] if r["id"] == "R13"]
        self.assertEqual(len(r13), 1, "R13 must exist exactly once")
        r13 = r13[0]
        for fid in self.EIGHT[:7]:          # the seven the model is asked for
            self.assertIn(fid, r13["applies_to"], fid)
        self.assertNotIn("circuit_wire_length_m", r13["applies_to"],
                         "the stretch is fixed at 30 m by ruling; the model is never asked for it")
        guidance = r13["guidance"]
        self.assertIn("answer Yes ONLY when the line POSITIVELY says", guidance)
        self.assertIn("SILENCE IS No", guidance)
        self.assertIn("Never decide whether the circuit wiring should be charged", guidance)
        self.assertIn('leave the thickness BLANK -- never "None"', guidance)
        # ⚠️ THE NEGATIVE THE TEAM RULED ON (2026-09-02), pinned so the widening cannot come back
        # by good intentions. A heading that merely DESCRIBES the point wiring -- even one naming a
        # distribution board AND a wire size, as BOQ-26-00065 r131's parent does -- is NOT an
        # inclusion statement. It was briefly read as one; the team ruled it is not.
        self.assertIn("Controlled from DB with 2.5 sqmm x 3 Wire", guidance)
        self.assertIn("describes what the point wiring IS, and the answer there is No", guidance)

    # ---------- the composition ----------
    def test_pw_cs_06_the_composition_is_flat_and_once_per_row(self):
        """OWNER: "circuit wiring rate will be purely additive number added to th eper point rate"
        and "once per row".

        The two circuit components sit LAST, immediately before `sum_components`, so they land after
        every per-point figure and are simply added. Their quantity is `circuit_qty_m` -- NOT
        `circuit_length_m`, which is the POINT stretch and is itself derived from the point count. A
        circuit component reading that attribute would multiply the charge by the number of points.
        """
        cfg = self._cfg()
        for pid in self.ASSEMBLY:
            steps = cfg["pipelines"][pid]["steps"]
            names = [s.get("name") for s in steps if s.get("step") == "component_ref"]
            self.assertEqual(names[-2:], ["circuit_wire1", "circuit_wire2"],
                             "%s: the circuit components must come LAST" % pid)
            self.assertEqual(steps[-1]["step"], "sum_components", pid)
            self.assertEqual([s.get("name") for s in steps[-3:-1]],
                             ["circuit_wire1", "circuit_wire2"],
                             "%s: nothing may sit between the circuit lines and the sum" % pid)
            for s in steps[-3:-1]:
                self.assertEqual(s["qty"], {"from_attr": "circuit_qty_m"}, pid)
                self.assertTrue(s["none_skips"],
                                "%s/%s: absence must ZERO, not refuse" % (pid, s["name"]))
                self.assertEqual(s["ref"]["kind"], "cable")
                self.assertEqual(s["ref"]["core"], "@%s_core" % s["name"])
                self.assertEqual(s["ref"]["thickness_sqmm"], "@%s_thickness_sqmm" % s["name"])

    def test_pw_cs_07_the_secondary_exclusion_reuses_the_shipped_verdict(self):
        """OWNER: "the ciricuit wiring cost wil be added only to thr eprimary point rows or mixed
        rows and not secondary point rows" -- and a SILENT row (no type token at all) IS charged.

        `point_type_of` returns "Secondary" only for a row that IS a secondary point; a mixed row and
        a silent row both return None, the map's `on_miss: "skip"` leaves the stretch standing, and
        they are charged. There is NO second reader -- the same verdict the 15/5 length substitution
        already uses.

        ⚠️ It writes `circuit_qty_m`, never the visible length: a Secondary row still SHOWS 30 m,
        because the owner's field shape puts 0 on the length only when the wiring is ABSENT.
        """
        from nirmaan_stack.services.boq_rate_master import extraction as ex
        cfg = self._cfg()
        for pid in self.ASSEMBLY:
            maps = [s for s in cfg["pipelines"][pid]["steps"] if s["step"] == "map_attribute"]
            excl = [m for m in maps if m["params"]["result_attr"] == "circuit_qty_m"
                    and m["params"].get("from_attr") == "point_type"]
            self.assertEqual(len(excl), 1, pid)
            p = excl[0]["params"]
            self.assertEqual(p["table"], {"Secondary": 0}, pid)
            self.assertEqual(p["on_miss"], "skip",
                             "%s: Primary, mixed and SILENT rows must keep the charge" % pid)
            self.assertNotIn("default", p,
                             "%s: a default here would charge or drop every row" % pid)
            # it must run AFTER the copy that seeds circuit_qty_m, or the copy would undo it
            seed = [m for m in maps if m["params"]["result_attr"] == "circuit_qty_m"
                    and m["params"].get("prefer_attr") == "circuit_wire_length_m"][0]
            self.assertLess(maps.index(seed), maps.index(excl[0]), pid)
        # the verdict itself is still CODE-SUPPLIED -- the model is never asked to judge point type
        self.assertIn("point_type", ex._CODE_SUPPLIED_ATTRS)
        self.assertEqual(ex.point_type_of({"description": "Secondary light point wiring"}),
                         "Secondary")
        self.assertIsNone(ex.point_type_of({"description": "Supply and wiring of light point"}),
                          "a SILENT row must return None so the charge stands")

    def test_pw_cs_08_NEGATIVE_no_circuit_step_touches_the_point_stretch(self):
        """⚠️ NEGATIVE, and the reason it is written as its own test: `circuit_length_m` and
        `circuit_wire_length_m` differ by one word, and a typo in a `result_attr` would silently
        retarget the POINT stretch -- 15/5 would become 30 on every row and NOTHING on screen would
        say so. This asserts the point stretch's two steps are byte-identical to the previous asset.
        """
        prev = self._prev_cfg()
        cfg = self._cfg()
        prev_defs = {d["id"]: d for d in prev["attribute_definitions"]}
        now_defs = {d["id"]: d for d in cfg["attribute_definitions"]}
        self.assertEqual(now_defs["circuit_length_m"], prev_defs["circuit_length_m"])
        for pid in self.ASSEMBLY:
            def stretch_steps(c):
                return [s for s in c["pipelines"][pid]["steps"]
                        if (s.get("params") or {}).get("result_attr") == "circuit_length_m"]
            self.assertEqual(stretch_steps(cfg), stretch_steps(prev), pid)
            # and spelled out, so a reader of this test knows WHAT is being protected
            m, d = stretch_steps(cfg)
            self.assertEqual(m["params"]["table"], {"Primary": 15, "Secondary": 5})
            self.assertEqual(m["params"]["prefer_attr"], "circuit_length_m")
            self.assertEqual(d["params"]["formula"], "base + (points - 1) * per_extra")
            self.assertEqual(d["params"]["constants"], {"base": 15, "per_extra": 5})
        # no circuit component anywhere may read the point stretch as its quantity
        for pid, pl in cfg["pipelines"].items():
            for s in pl["steps"]:
                if str(s.get("name") or "").startswith("circuit_wire"):
                    self.assertNotEqual((s.get("qty") or {}).get("from_attr"), "circuit_length_m",
                                        "%s/%s reads the POINT stretch" % (pid, s["name"]))

    def test_pw_cs_09_the_block_is_a_component_not_a_second_rate(self):
        """THE BLOCK (owner: "we canimplement the circuit wiring part as a second block like we do
        terminations in cable wire and termination category").

        Built from the SHIPPED presentation: the helper renders one labelled section per non-BCS
        pipeline and a section is DISPLAY-ONLY (`WorkingsGroup` -- "the applied value still comes
        from Suggestion.values, never a group's finals").

        ⚠️ THE LOAD-BEARING PART IS THE OUTPUT NAMES. Unlike wiring's Cable/Termination pair, this is
        ONE rate in two parts -- the circuit money is already inside `supply` / `install`. So the
        display pipelines must name outputs the helper maps to NO rate kind, or the circuit figure
        would be offered as a second appliable rate and could be double-counted. `kindForOutput`
        matches "supply"/"install" exactly or the prefixes "supply_"/"install_"; `circuit_supply`
        and `circuit_install` match none of those, and this test pins that rule literally.
        """
        # ⚠️ SLICE B REMOVED THE RISK THIS TEST GUARDED, RATHER THAN THE GUARD DRIFTING.
        # The original worry was that a display pipeline might name an output the helper maps to a
        # rate kind, so the circuit figure would be offered as a SECOND appliable rate. With both
        # display pipelines deleted there is no second block to offer -- the hazard is structural,
        # not conditional, which is strictly stronger than the naming rule below ever was.
        #
        # WHAT REPLACES THE GUARANTEE, so nothing is lost:
        #   * test_pw_cs_28 pins that both display pipelines AND their labels are gone, and that the
        #     circuit COMPONENTS still live inside the assembly pipelines (the money stayed).
        #   * test_pw_cs_13 pins that pw5's circuit amounts appear INSIDE `pw_boq_supply` /
        #     `pw_boq_install` -- i.e. one rate in two parts, which was the real claim all along.
        # The `kindForOutput` rule itself is still exercised below against the surviving outputs.
        cfg = self._cfg()
        self.assertEqual(list(cfg["pipelines"]),
                         ["pw_boq_supply", "pw_boq_install", "pw_bcs"],
                         "declaration order IS section order on the panel")
        self.assertEqual(cfg["pipeline_labels"], {},
                         "a label for a pipeline that no longer exists is a trap")
        for pid in self.RETIRED_DISPLAY:
            self.assertNotIn(pid, cfg["pipelines"])

        def would_fill_a_rate_kind(output):
            return (output in ("supply", "install")
                    or output.startswith("supply_") or output.startswith("install_"))

        # SLICE B: with no display pipeline left, the rule is exercised against the SURVIVORS --
        # the two that DO fill a rate kind must still name the kinds they always did, and the BCS
        # pipeline must still name one that fills none.
        self.assertTrue(would_fill_a_rate_kind(cfg["pipelines"]["pw_boq_supply"]["output"][0]))
        self.assertTrue(would_fill_a_rate_kind(cfg["pipelines"]["pw_boq_install"]["output"][0]))
        self.assertFalse(would_fill_a_rate_kind(cfg["pipelines"]["pw_bcs"]["output"][0]),
                         "the BCS output must never be offered as a client rate")
        # ⚠️ AND THE MONEY MUST STILL BE THERE. The pair the deleted display pipelines used to
        # restate is now asserted where it actually prices: inside the assembly pipelines.
        for pid in ("pw_boq_supply", "pw_boq_install"):
            names = [c.get("name") for c in cfg["pipelines"][pid]["steps"]
                     if c.get("step") == "component_ref"]
            self.assertIn("circuit_wire1", names, pid)
            self.assertIn("circuit_wire2", names, pid)

    def test_pw_cs_10_NEGATIVE_circuit_fit_is_untouched(self):
        """NEGATIVE: the conduit sizing must not move. `circuit_fit` sums wire diameters to pick a
        conduit; adding the circuit wires to `wire_specs` would enlarge the conduit -- and change the
        price -- on every point wiring row, including rows with no circuit wiring at all."""
        prev = self._prev_cfg()
        cfg = self._cfg()
        for pid in self.ASSEMBLY:
            now = [s for s in cfg["pipelines"][pid]["steps"] if s["step"] == "circuit_fit"][0]
            was = [s for s in prev["pipelines"][pid]["steps"] if s["step"] == "circuit_fit"][0]
            self.assertEqual(now, was, pid)
            flat = [a for spec in now["params"]["wire_specs"] for a in spec]
            self.assertFalse([a for a in flat if a.startswith("circuit_wire")], pid)
        # SLICE B: the display pipelines are GONE, so there is no longer a step vocabulary of
        # theirs to pin. What still matters is that their removal did not take a `circuit_fit` with
        # it -- the assembly pipelines above are compared byte-for-byte against the previous asset.
        for pid in self.RETIRED_DISPLAY:
            self.assertNotIn(pid, cfg["pipelines"], pid)

    def test_pw_cs_11_the_two_length_labels_are_distinct(self):
        """#57 item 6. Two lengths now live on one panel and they mean different things: the POINT
        stretch (15/5, per point) and the CIRCUIT stretch (a flat 30). `circuit_length_m` keeps its
        shipped label by ruling -- it is misnamed, and renaming it is a separate change -- so the
        NEW field carries the distinct one."""
        by_id = {d["id"]: d for d in self._cfg()["attribute_definitions"]}
        point = by_id["circuit_length_m"]["label"]
        circuit = by_id["circuit_wire_length_m"]["label"]
        self.assertEqual(point, "Circuit length (m)", "the shipped label must NOT be renamed")
        self.assertEqual(circuit, "Circuit wiring stretch (m)")
        self.assertNotEqual(point, circuit)

    # ---------- the goldens ----------
    def test_pw_cs_12_the_no_circuit_goldens_keep_every_expected_value(self):
        """⚠️ THE REGRESSION PROOF, and it is not a coincidence. pw1-pw4 carry no circuit wiring, so
        both circuit components hit `none_skips`, contribute 0, and the sum is unchanged. Every
        expected value is asserted against the PREVIOUS asset's, key by key. If one ever moves, the
        circuit stretch has leaked onto a row that carries none.

        Their INPUTS did grow -- the circuit wires are now stated as positively absent -- which is
        the same shape the v45 socket-slot mint took, and is what a real extracted row looks like.
        """
        prev = dict((g["id"], g) for g in self._prev_payload()["goldens"]["point_wiring"])
        now = dict((g["id"], g) for g in self._payload()["goldens"]["point_wiring"])
        self.assertEqual(sorted(now), ["pw1", "pw2", "pw3", "pw4", "pw5"])
        for gid in ("pw1", "pw2", "pw3", "pw4"):
            for pid, expected in prev[gid]["expect"].items():
                self.assertEqual(now[gid]["expect"][pid], expected, "%s/%s" % (gid, pid))
            # SLICE B: the display pipelines are gone, so their (always-zero) expectations went
            # with them. A no-circuit row is still proven to charge nothing -- by the ASSEMBLY
            # values compared against the previous asset in the loop directly above.
            for pid in self.RETIRED_DISPLAY:
                self.assertNotIn(pid, now[gid]["expect"], gid)
            for tid in self.THICKNESSES:
                self.assertEqual(now[gid]["attrs"][tid], "None", gid)
            self.assertEqual(now[gid]["attrs"]["circuit_wire_included"], "No", gid)

    def test_pw_cs_13_the_circuit_golden_is_hand_derived_from_the_catalog(self):
        """pw5 is the charged row, and it is derived from the CATALOG ROW AND THE RATE STAGES rather
        than from our own interpreter -- a golden recomputed by the thing it is meant to pin passes
        by construction and pins nothing (the pw4 precedent).

        It is ALSO the silent-row pin: pw5 states no `point_type`, so the Secondary map misses,
        `on_miss: "skip"` leaves the stretch standing, and the row is charged.
        """
        import math
        payload = self._payload()
        g = dict((x["id"], x) for x in payload["goldens"]["point_wiring"])
        pw1, pw5 = g["pw1"], g["pw5"]
        self.assertNotIn("point_type", pw5["attrs"], "pw5 must stay a SILENT row")
        self.assertEqual(pw5["attrs"]["circuit_wire_included"], "Yes")
        self.assertEqual(pw5["attrs"]["circuit_wire2_thickness_sqmm"], "None")

        cable = [it for it in payload["items"]
                 if it["kind"] == "cable"
                 and it["attributes"].get("material") == "COPPER"
                 and it["attributes"].get("insulation") == "UNARMOURED"
                 and it["attributes"].get("core") == pw5["attrs"]["circuit_wire1_core"]
                 and it["attributes"].get("thickness_sqmm")
                 == pw5["attrs"]["circuit_wire1_thickness_sqmm"]]
        self.assertEqual(len(cable), 1, "the circuit wire must resolve to exactly one catalog row")
        rates = cable[0]["rates"]
        runs = pw5["attrs"]["circuit_wire1_runs"]
        length = 30                                    # the config's default stretch

        supply_add = math.ceil(rates["list_price_per_mtr"] * 0.602 * runs) * length
        install_add = math.ceil(rates["install_base_per_mtr"] * 2.0
                                * math.ceil(runs / 3)) * length
        bcs_add = math.ceil(rates["list_price_per_mtr"] * 0.4515 * runs) * length

        # ⚠️ SLICE B: THIS IS NOW THE PRIMARY GUARANTEE THAT THE CIRCUIT MONEY IS REAL, because the
        # display pipelines that used to restate it are gone. The hand-derived adds must appear
        # INSIDE the assembly rates -- one rate in two parts, which was always the actual claim.
        for pid in self.RETIRED_DISPLAY:
            self.assertNotIn(pid, pw5["expect"])
        self.assertEqual(pw5["expect"]["pw_boq_supply"]["supply"],
                         pw1["expect"]["pw_boq_supply"]["supply"] + supply_add)
        self.assertEqual(pw5["expect"]["pw_boq_install"]["install"],
                         pw1["expect"]["pw_boq_install"]["install"] + install_add)
        self.assertEqual(pw5["expect"]["pw_bcs"]["bcs_supply"],
                         pw1["expect"]["pw_bcs"]["bcs_supply"] + bcs_add)
        # and the ONLY difference between pw1 and pw5 is the circuit block
        differing = set(k for k in set(pw1["attrs"]) | set(pw5["attrs"])
                        if pw1["attrs"].get(k) != pw5["attrs"].get(k))
        self.assertTrue(all(k.startswith("circuit_wire") for k in differing), differing)

    # ---------- blast radius ----------
    def test_pw_cs_14_NEGATIVE_no_other_category_gained_a_circuit_field(self):
        """NEGATIVE: exactly ONE config changed. Asserted over every category so a later mint that
        copies the block elsewhere has to say so."""
        payload = self._payload()
        prev = self._prev_payload()
        was = dict((c["category_id"], c) for c in prev["category_configs"])
        now = dict((c["category_id"], c) for c in payload["category_configs"])
        self.assertEqual(sorted(was), sorted(now))
        changed = sorted(k for k in now if now[k] != was[k])
        self.assertEqual(changed, ["point_wiring"])
        self.assertEqual(payload["items"], prev["items"], "no rate and no item may move")
        for cid, c in now.items():
            if cid == "point_wiring":
                continue
            ids = [d["id"] for d in c.get("attribute_definitions") or []]
            self.assertFalse([i for i in ids if i.startswith("circuit_wire")], cid)

    def test_pw_cs_15_the_minted_config_passes_the_server_validator(self):
        """The whitelist is CLOSED and the reference guard is real: every `@attr` a pipeline binds
        must be a declared attribute. Running the shipped validator over the minted config is what
        proves the asset is loadable at all -- the v47 slice lost a round to exactly this."""
        from nirmaan_stack.api.boq import rate_master as rm
        payload = self._payload()
        cfg = dict(self._cfg())
        cfg["discipline"] = payload["discipline"]
        cfg["goldens"] = payload["goldens"]["point_wiring"]
        rm._validate_config(cfg)          # throws on any violation
        # ⚠️ THE VALIDATOR DOES NOT REACH A component_ref's INLINE `@attr` REFS OR ITS
        # `qty.from_attr` -- `_ref` is called for rate_stages, circuit_fit and module_fit, but not
        # for these two. A typo there is a RUNTIME no-compute, so this test walks them by hand.
        # A ref may also name a STEP BIND (circuit_fit's `fitted_size`) rather than an attribute,
        # so the legal set is declared attributes PLUS every declared bind.
        legal = set(d["id"] for d in cfg["attribute_definitions"])
        for pl in cfg["pipelines"].values():
            for step in pl["steps"]:
                legal.update(step.get("binds") or [])
                for lad in ((step.get("params") or {}).get("ladders") or []):
                    if lad.get("bind"):
                        legal.add(lad["bind"])
                blanks = (step.get("params") or {}).get("blanks") or {}
                for key in ("bind", "bind_item"):
                    if blanks.get(key):
                        legal.add(blanks[key])
        for pid, pl in cfg["pipelines"].items():
            for step in pl["steps"]:
                for _k, v in (step.get("ref") or {}).items():
                    if isinstance(v, str) and v.startswith("@"):
                        self.assertIn(v[1:], legal, "%s: unbound ref %s" % (pid, v))
                q = step.get("qty")
                if isinstance(q, dict) and "from_attr" in q:
                    self.assertIn(q["from_attr"], legal, "%s: unbound qty %s" % (pid, q))

    # ---------- the ABSENT-SPEC enforcement (owner 2026-09-03) ----------
    def test_pw_cs_16_an_absent_component_declares_its_spec_absent_too(self):
        """CONFIG HALF. The controller declares, in config, what "absent" means and which fields it
        makes absent -- so no category is named in code (the HV-10 lesson)."""
        by_id = {d["id"]: d for d in self._cfg()["attribute_definitions"]}
        ctrl = by_id["circuit_wire_included"]
        self.assertEqual(ctrl["absent_when_value"], "No")
        self.assertEqual(ctrl["absent_dependents"], list(self.EIGHT[1:7]))
        # NEGATIVE: the STRETCH is not a dependent -- its own map already writes 0 when field 1 is
        # No, and listing it here would make it "None", which resolveQty reads as a no-compute.
        self.assertNotIn("circuit_wire_length_m", ctrl["absent_dependents"])

    def test_pw_cs_17_the_corrector_fills_blanks_only_and_never_overwrites(self):
        """⚠️ THE ONE THAT KEEPS IT HONEST. `extraction_none_guidance` ASKS the model to answer
        "None" for a component the bill does not carry; measured on the 251-row corpus it obeyed on
        137 rows and left the spec BLANK on 22 others, which refused rows that had already answered
        "No". This makes the owner's field shape true by construction.

        BLANKS ONLY: a row answering "No" while ALSO naming a gauge is contradicting itself, and
        overwriting the gauge would destroy the evidence. It costs nothing to keep -- the pipeline
        zeroes the quantity from the same controller either way.
        """
        from nirmaan_stack.services.boq_rate_master import extraction as ex
        rules = ex.absent_dependent_rules(self._cfg())
        self.assertIn("circuit_wire_included", rules)

        # (a) the shape the 22 rows were in -- controller says No, spec BLANK -> filled
        row = {"circuit_wire_included": {"value": "No", "confidence": 0.7},
               "circuit_wire1_thickness_sqmm": {"value": None},
               "circuit_wire2_core": {"value": ""}}
        filled = ex.force_absent_dependents(row, rules)
        self.assertEqual(sorted(filled), sorted(self.EIGHT[1:7]))
        for fid in self.EIGHT[1:7]:
            self.assertEqual(row[fid]["value"], "None", fid)

        # (b) NEGATIVE -- a STATED value survives untouched, contradiction and all
        row2 = {"circuit_wire_included": {"value": "No"},
                "circuit_wire1_thickness_sqmm": {"value": 2.5}}
        ex.force_absent_dependents(row2, rules)
        self.assertEqual(row2["circuit_wire1_thickness_sqmm"]["value"], 2.5)

        # (c) ⚠️ NEGATIVE, THE LOAD-BEARING ONE -- a QUALIFYING row is never touched, so the owner's
        # loud failure on an unreadable gauge cannot be filled in behind his back.
        row3 = {"circuit_wire_included": {"value": "Yes"},
                "circuit_wire1_thickness_sqmm": {"value": None}}
        self.assertEqual(ex.force_absent_dependents(row3, rules), [])
        self.assertIsNone(row3["circuit_wire1_thickness_sqmm"]["value"])

        # (d) NEGATIVE -- a config declaring no rule leaves every row alone
        self.assertEqual(ex.absent_dependent_rules({"attribute_definitions": [{"id": "x"}]}), {})
        row4 = {"circuit_wire_included": {"value": "No"}, "circuit_wire1_core": {"value": None}}
        self.assertEqual(ex.force_absent_dependents(row4, {}), [])
        self.assertIsNone(row4["circuit_wire1_core"]["value"])

    def test_pw_cs_18_NEGATIVE_no_other_category_declares_an_absent_rule(self):
        """NEGATIVE: the corrector is inert everywhere else. Asserted over every config so a later
        mint that adopts the mechanism has to say so."""
        from nirmaan_stack.services.boq_rate_master import extraction as ex
        for c in self._payload()["category_configs"]:
            rules = ex.absent_dependent_rules(c)
            if c["category_id"] == "point_wiring":
                self.assertTrue(rules)
            else:
                self.assertEqual(rules, {}, c["category_id"])


    # ---------- SLICE A: F2 the conduit false-friend, F5 the None checkbox ----------
    def test_pw_cs_19_the_conduit_example_cannot_be_matched_without_its_load_bearing_word(self):
        """⚠️ F2. R12's WORKED EXAMPLE was the defect, not its rule.

        It read "'recessed/surface existing conduit' ... so the answer there is Yes". Rows reading
        'recessed/surface 16SWG MS conduit' matched that SURFACE FORM while lacking `existing`, so
        `conduit_handoff` came back Yes and 36 rows silently dropped a conduit they supply -- the
        example overriding the rule's own closing clause, which was right all along.

        The corrected example must CONTRAST the two phrasings and name the one word that separates
        them. The NEGATIVE half is what stops a revert: the retired sentence must be GONE.
        """
        g = [r for r in self._cfg()["rules"] if r["id"] == "R12"][0]["guidance"]
        # NEGATIVE -- the false friend is gone. A revert re-introduces it and turns this red.
        self.assertNotIn("so the answer there is Yes.", g)
        self.assertNotIn("The old wording was kept here only as the thing NOT to do.", g)
        # ⚠️ AND THE SECOND NEGATIVE, WHICH IS THE WHOLE POINT OF ATTEMPT 2. Attempt 1 replaced the
        # false friend with a CONTRASTING PAIR OF QUOTED PHRASES, and its negative half quoted a
        # string that also lives on rows whose chain says "and circuit wiring with 2 x 2.5 sq mm" --
        # rows R13 must answer Yes. R13's verdict flipped Yes -> No on them, measured across four
        # config-switched runs. So R12 must quote NO corpus text at all: a phrase quoted in one rule
        # is visible to every other question the single ESTIMATOR_RULES payload asks.
        for corpus in ("16SWG", "16 SWG", "recessed/surface", "MS conduit", "circuit wiring with"):
            self.assertNotIn(corpus, g,
                             "R12 must quote no corpus text -- %r collides with other rules" % corpus)
        # POSITIVE -- it states the TEST instead of illustrating it
        self.assertIn("Decide this field by ONE TEST", g)
        self.assertIn("does the document say the conduit is ALREADY THERE?", g)
        self.assertIn("then this line supplies that conduit and the answer is No", g)
        # ⚠️ and it says out loud that it governs ONE field, which is the cheapest guard against
        # the cross-rule bleed that attempt 1 caused.
        self.assertIn("nothing you decide here should change any other answer", g)
        # ⚠️ THE CLAUSE THAT WAS ALWAYS CORRECT MUST NOT BE WEAKENED -- the fix is to the example.
        self.assertIn("Answer No when the run uses a conduit this line supplies.", g)
        # ⚠️ AND THE HAND-OFF RULE ITSELF IS UNCHANGED: an EXISTING container still answers Yes.
        self.assertIn("answer Yes when the document says this run uses something already there",
                      g)

    def test_pw_cs_20_the_decision_table_is_untouched_by_the_wording_fix(self):
        """NEGATIVE. F2 narrows when the MODEL should answer Yes; it must not touch what CODE does
        with that answer. The three-step conduit_included chain and the drop-to-None step are
        byte-compared against the previous asset."""
        import json
        with open(_asset_path("rate_master_electrical_all_v51.json"), "r", encoding="utf-8") as fh:
            prev = [c for c in json.load(fh)["category_configs"]
                    if c["category_id"] == "point_wiring"][0]
        cfg = self._cfg()
        for pid in _PW_ASSEMBLY_PIPELINES:
            def conduit_steps(c):
                return [s for s in c["pipelines"][pid]["steps"]
                        if (s.get("params") or {}).get("result_attr") in
                        ("conduit_included", "conduit_type")]
            self.assertEqual(conduit_steps(cfg), conduit_steps(prev), pid)
            # and circuit_fit's absent_when, which the drop feeds
            now = [s for s in cfg["pipelines"][pid]["steps"] if s["step"] == "circuit_fit"][0]
            was = [s for s in prev["pipelines"][pid]["steps"] if s["step"] == "circuit_fit"][0]
            self.assertEqual(now, was, pid)

    def test_pw_cs_21_the_None_option_is_gone_from_the_four_core_and_runs_fields(self):
        """⚠️ F5. `allow_none` on a number def is what makes the panel render a "None" checkbox.
        On the circuit RUNS that checkbox promised a drop it could not deliver: `none_skips` reads
        only the component's `ref` bindings (core, thickness_sqmm), and `runs` feeds
        `absentMeansOne`, which maps "None" to 1. So the option is removed.

        ⚠️ BOTH THICKNESSES KEEP IT. Thickness is the working drop control -- it is IN the ref, so
        `none_skips` fires on it, and its `disables_when_none` greys that wire's core and runs. The
        owner's loud-failure ruling (blank gauge -> the row refuses) rests on it having NO default.
        """
        cfg = self._cfg()
        by_id = {d["id"]: d for d in cfg["attribute_definitions"]}
        for fid in ("circuit_wire1_core", "circuit_wire1_runs",
                    "circuit_wire2_core", "circuit_wire2_runs"):
            self.assertNotIn("allow_none", by_id[fid], "%s must offer no None" % fid)
            # the mirrored default of 1 stays -- an unstated core/run count is still 1, not missing
            self.assertEqual(cfg["extraction_defaults"][fid], 1.0, fid)
        for tid in self.THICKNESSES:
            self.assertTrue(by_id[tid]["allow_none"], "%s must KEEP its None" % tid)
            self.assertNotIn(tid, cfg["extraction_defaults"], "%s must keep NO default" % tid)
            self.assertEqual(by_id[tid]["disables_when_none"],
                             [tid.replace("_thickness_sqmm", "_core"),
                              tid.replace("_thickness_sqmm", "_runs")], tid)

    def test_pw_cs_22_NEGATIVE_the_absent_shape_still_holds_without_the_flags(self):
        """⚠️ THE NEGATIVE THAT MADE THE REMOVAL SAFE, and the reason it is measured rather than
        assumed. The four flags were added 2026-09-02 so the owner's `No` / `None` x6 / `0` shape
        could survive `coerceForMatch`; removing them could have undone that.

        It does not, and this test pins WHY: `force_absent_dependents` still writes "None" into all
        six spec fields, and the THICKNESS -- which keeps `allow_none` -- carries that "None"
        through coercion and DISABLES its wire's core and runs. A disabled field is never treated
        as missing input, so the two whose "None" no longer survives are never asked for.

        Measured with the REAL shipped helper over the 251 run-covered rows: 190 priced / 61 refused
        with the flags AND without, on the identical row set.
        """
        from nirmaan_stack.services.boq_rate_master import extraction as ex
        cfg = self._cfg()
        rules = ex.absent_dependent_rules(cfg)
        # the corrector still fills all six -- unchanged by this slice
        self.assertEqual(sorted(rules["circuit_wire_included"][1]), sorted(self.EIGHT[1:7]))
        row = {"circuit_wire_included": {"value": "No"}}
        ex.force_absent_dependents(row, rules)
        for fid in self.EIGHT[1:7]:
            self.assertEqual(row[fid]["value"], "None", fid)
        # ... and the THICKNESS is the one that carries it through, disabling the other two
        by_id = {d["id"]: d for d in cfg["attribute_definitions"]}
        for tid in self.THICKNESSES:
            self.assertTrue(by_id[tid]["allow_none"])
            for dep in by_id[tid]["disables_when_none"]:
                self.assertNotIn("allow_none", by_id[dep],
                                 "%s is disabled by %s, so it needs no None of its own" % (dep, tid))

    def test_pw_cs_23_NEGATIVE_no_other_category_and_no_golden_moved(self):
        """NEGATIVE: Slice A is one config and one rule. Every other category byte-identical, no
        item touched, and EVERY golden value unmoved -- the goldens carry no conduit hand-off fact
        and no circuit runs the change could reach."""
        import json
        payload = self._payload()
        with open(_asset_path("rate_master_electrical_all_v51.json"), "r", encoding="utf-8") as fh:
            prev = json.load(fh)
        was = {c["category_id"]: c for c in prev["category_configs"]}
        now = {c["category_id"]: c for c in payload["category_configs"]}
        self.assertEqual(sorted(k for k in now if now[k] != was[k]), ["point_wiring"])
        self.assertEqual(payload["items"], prev["items"])
        # ⚠️ SUPERSEDED AT SLICE B. F4a removed two pipelines, and `_validate_config` refuses
        # a golden naming a pipeline the config no longer declares -- so their `expect` keys
        # were FORCED out. The precise claim (deletion only, every surviving value identical)
        # now lives in test_pw_cs_31; here we assert only that no golden was ADDED or DROPPED.
        self.assertEqual(sorted(payload["goldens"]), sorted(prev["goldens"]))
        for _cat, _golds in payload["goldens"].items():
            self.assertEqual([g["id"] for g in _golds],
                             [g["id"] for g in prev["goldens"][_cat]], _cat)


    # ---------- SLICE B: the conductor floor, the removed blocks, the labelled group ----------
    #
    # A note on what these protect, because the rule CHANGED between slices and the previous
    # formulation is the thing most likely to come back:
    #   24  the hardest case -- `3 core, 1 run` is ALREADY three conductors and must not move
    #   25  the FLOOR half -- 4 and 6 conductors are left alone; the rule never reduces
    #   26  where a missing conductor goes, all three owner-ruled shapes
    #   27  the clause the earlier brief told us to delete SURVIVES, and why
    #   28  the display-only pipelines are gone, and the labels with them
    #   29  the group is declared, contiguous, and GENERAL
    #   30  NEGATIVE: no corpus text in R9, R12 or R13 (the R12 guard, widened)
    #   31  NEGATIVE: no other category moved, no item moved, and the ONLY golden movement is the
    #       forced deletion of the two removed pipelines' expectations

    def _r9(self):
        return [r for r in self._cfg()["rules"] if r["id"] == "R9"][0]["guidance"]

    def test_pw_cs_24_R9_no_longer_carries_the_arithmetic(self):
        """SLICE B v4 -- THE ARITHMETIC LEFT THE PROMPT.

        The conductor floor is a SUBSTITUTION, and on this project substitutions live in
        deterministic code, not in extraction prose. Keeping it in R9 cost two prompt cross-talk
        failures in two days: every `rules` entry is injected into ONE `ESTIMATOR_RULES` block, so
        R12's rewrite flipped R13's conduit verdict, and extending R9's floor to NAME the circuit
        wires -- the only way prose could reach them -- moved R13's `circuit_wire_included`.

        Each banned phrase below carried part of the total. If one returns, so has the cross-talk.
        """
        g = self._r9()
        for banned in ("add up to three", "FLOOR", "CORES MULTIPLIED BY ITS RUNS",
                       "raise it to three", "conductors still missing", "reach three",
                       "three conductors"):
            self.assertNotIn(banned, g, "R9 must carry no arithmetic: %r" % banned)

    def test_pw_cs_25_R9_STAYS_POINT_SCOPED_and_names_no_circuit_wire(self):
        """⚠️ THE SPECIFIC CROSS-TALK THIS SLICE RETIRED. Prose could only reach the circuit fields
        by NAMING them, and naming them inside R9 put circuit vocabulary in front of R13 -- whose
        whole job is deciding whether a circuit run is included at all. `circuit_wire_included` on
        BOQ-26-00200 r11 then read Yes / Yes / No across three runs.

        The corrector reaches both axes from CONFIG, so R9 never has to mention a circuit again."""
        g = self._r9().lower()
        for word in ("circuit wire", "circuit_wire", "submain", "distribution board"):
            self.assertNotIn(word, g, "R9 must stay POINT-scoped: found %r" % word)

    def test_pw_cs_26_R9_still_teaches_how_to_READ_a_wire_spec(self):
        """⚠️ THE OTHER HALF, AND THE EASY THING TO GET WRONG. Removing the arithmetic must not
        gut the rule: reading a spec IS a fact-finding job and stays with the model. What the line
        SAYS -- which figure is cores, which is runs, whether a second conductor is named, how many
        points are covered -- is exactly what only the model can do."""
        g = self._r9()
        self.assertIn("Report the wire specification EXACTLY AS THE LINE STATES IT", g)
        for keep in ("3R x 1.5 sqmm", "the multiplier is the run count",
                     "A number before the size is a run" + chr(10) + "count, not a core count",
                     "NUMBER OF POINTS", "look for a second conductor named separately"):
            self.assertIn(keep, g, "R9 lost a READING rule: %r" % keep)
        # ... and the two readings that existed ONLY to reach three are now HONEST readings of what
        # is written -- the corrector supplies the missing conductors afterwards.
        self.assertIn("1 run of 1 core at that size", g)
        self.assertIn("ONE run each", g)

    def test_pw_cs_27_the_explicitly_states_otherwise_clause_is_REMOVED(self):
        """⚠️ A DELIBERATE REMOVAL, PINNED SO IT IS NOT RESTORED AS AN OVERSIGHT -- and the OPPOSITE
        of what Slice B v3 pinned, because the rule underneath it changed.

        The clause excepted a TOTAL. R9 no longer states a total, so it had nothing left to except,
        and prose that reads like a rule while governing nothing is worse than silence. The
        behaviour it protected -- a stated count at or above three wins -- is now STRUCTURAL:
        `apply_conductor_floor` has no branch that lowers a count.
        """
        self.assertNotIn("unless the line explicitly states otherwise", self._r9())

    def test_pw_cs_28_the_display_only_pipelines_are_gone(self):
        """F4a. The circuit money was ALWAYS inside the point rate; a second labelled block read as
        an extra charge (owner). Both display pipelines go, and their labels with them -- a label
        for a pipeline that does not exist is a trap for the next reader.

        The three ASSEMBLY pipelines are untouched: that is what makes this rate-neutral, and it was
        MEASURED so (190 priced / 61 refused, 0 rows moved, against the v52 config)."""
        cfg = self._cfg()
        self.assertEqual(sorted(cfg["pipelines"]), ["pw_bcs", "pw_boq_install", "pw_boq_supply"])
        for gone in ("pw_circuit_supply", "pw_circuit_install"):
            self.assertNotIn(gone, cfg["pipelines"])
            self.assertNotIn(gone, cfg.get("pipeline_labels") or {})
        # the circuit COMPONENTS survive INSIDE the assembly pipelines -- removing the display
        # blocks must not remove the money.
        for pid in ("pw_boq_supply", "pw_boq_install"):
            names = [s.get("name") for s in cfg["pipelines"][pid]["steps"] if s["step"] == "component_ref"]
            self.assertIn("circuit_wire1", names, pid)
            self.assertIn("circuit_wire2", names, pid)

    def test_pw_cs_29_the_group_is_declared_contiguous_and_general(self):
        """F4b. `group_label` is a NEW GENERAL capability: a plain string on ANY attribute definition
        in ANY category, and the panel emits a header whenever it CHANGES between consecutive
        rendered attributes.

        Three things are pinned. (1) exactly the eight circuit fields carry it, with one label.
        (2) they are CONTIGUOUS -- the header renders on CHANGE, so a gap would draw a second one.
        (3) the definition following them is `panel: false`, so no stray header can appear after the
        group closes.

        ⚠️ IT IS ON THE DEFINITION, NOT THE CONFIG'S TOP LEVEL, and that is what makes it free: the
        top level is allowlisted by `_KNOWN_CONFIG_KEYS`, attribute definitions are documented in the
        same validator as having NO key allowlist. Zero backend change.
        """
        cfg = self._cfg()
        defs = cfg["attribute_definitions"]
        grouped = [d for d in defs if d.get("group_label")]
        self.assertEqual([d["id"] for d in grouped], list(self.EIGHT_GROUP))
        self.assertEqual({d["group_label"] for d in grouped},
                         {"Circuit wiring (included in the point rate)"})
        order = [d["id"] for d in defs]
        idx = [order.index(f) for f in self.EIGHT_GROUP]
        self.assertEqual(idx, list(range(min(idx), min(idx) + len(self.EIGHT_GROUP))),
                         "the group must be contiguous or a second header renders")
        self.assertIs(defs[max(idx) + 1].get("panel"), False,
                      "the definition after the group must be hidden from the panel")
        # GENERAL: no other category declares one, and nothing in the key is point_wiring-specific.
        for c in self._payload()["category_configs"]:
            if c["category_id"] == "point_wiring":
                continue
            self.assertEqual([d for d in c.get("attribute_definitions") or [] if d.get("group_label")],
                             [], "%s must be unaffected" % c["category_id"])

    def test_pw_cs_30_NEGATIVE_no_corpus_text_in_R9_R12_or_R13(self):
        """⚠️ THE R12 GUARD, WIDENED TO THE OTHER TWO RULES THAT SHARE ITS PROMPT.

        Every `rules` entry is injected into ONE `ESTIMATOR_RULES` block, so a phrase quoted inside
        one rule is visible to every other question the payload asks. That is not a theory: R12's
        first rewrite quoted a conduit phrase that also lives on r63/r66's chain and flipped R13's
        circuit verdict Yes -> No on both, caught only by a two-axis A/B.

        A rule STATES ITS TEST; it does not QUOTE corpus text. Same token list as the R12 guard --
        this is that guard covering more rules, not a new notion of corpus text.
        """
        rules = {r["id"]: r["guidance"] for r in self._cfg()["rules"]}
        for rid in ("R9", "R12", "R13"):
            self.assertIn(rid, rules)
            for corpus in ("16SWG", "16 SWG", "recessed/surface", "MS conduit", "circuit wiring with"):
                self.assertNotIn(corpus, rules[rid],
                                 "%s must quote no corpus text -- %r collides with other rules"
                                 % (rid, corpus))

    def test_pw_cs_31_NEGATIVE_one_config_no_item_and_only_the_forced_golden_deletion(self):
        """NEGATIVE. Slice B is one config. Every other category byte-identical, no item touched.

        ⚠️ THE GOLDENS DO MOVE HERE, AND EXACTLY ONCE -- this test replaces Slice A's blanket "no
        golden may move". `_validate_config` refuses a golden naming a pipeline the config no longer
        declares, so removing the two display pipelines FORCED their `expect` keys out. That is a
        DELETION and nothing else: every surviving expectation must be byte-identical, which is the
        real guarantee (a revalued golden would mean the assembly rates moved).
        """
        import json
        payload = self._payload()
        with open(_asset_path("rate_master_electrical_all_v52.json"), "r", encoding="utf-8") as fh:
            prev = json.load(fh)
        was = {c["category_id"]: c for c in prev["category_configs"]}
        now = {c["category_id"]: c for c in payload["category_configs"]}
        self.assertEqual(sorted(k for k in now if now[k] != was[k]), ["point_wiring"])
        self.assertEqual(payload["items"], prev["items"], "no item may move")
        self.assertEqual(sorted(payload["goldens"]), sorted(prev["goldens"]))
        for cat, golds in payload["goldens"].items():
            prev_by = {g["id"]: g for g in prev["goldens"][cat]}
            self.assertEqual([g["id"] for g in golds], list(prev_by), cat)
            for g in golds:
                before, after = prev_by[g["id"]].get("expect") or {}, g.get("expect") or {}
                if cat != "point_wiring":
                    self.assertEqual(after, before, "%s/%s must not move" % (cat, g["id"]))
                    continue
                self.assertEqual(sorted(after), ["pw_bcs", "pw_boq_install", "pw_boq_supply"])
                self.assertEqual(sorted(set(before) - set(after)),
                                 ["pw_circuit_install", "pw_circuit_supply"],
                                 "the ONLY golden change may be those two deletions")
                for pid in after:
                    self.assertEqual(after[pid], before[pid],
                                     "%s/%s: %s VALUE moved" % (cat, g["id"], pid))



class TestBrandColumnProjection(FrappeTestCase):
    """READ-TIME COLUMN PROJECTION (owner-chosen option (C), 2026-09-03).

    A `BoQ Rate Master Item` stores `brand` as a top-level COLUMN, while every specification the
    pipelines match on lives inside the `attributes` JSON map. `extraction.project_item_columns`
    copies each column named in `extraction.PROJECTED_ITEM_COLUMNS` into `attributes` AT READ
    TIME, at exactly TWO chokepoints -- `api/boq/rate_master.get_rate_master_items` (which feeds
    every frontend reader AND all 13 `ratePipelineInterpreter.ts` matcher sites) and the three
    `extraction.py` catalogue readers.

    WHAT THESE TESTS PROTECT, one line each: that the projection REACHES the readers, that a
    STORED value still wins, that a missing brand stays missing, that adding a second column is
    one word in one tuple -- and, the four NEGATIVES, that nothing persists the projection, that
    the CSV round trip and the asset export never see it, and that no live config can notice it.

    The MATCHABILITY half (the one option (B) could not deliver) is necessarily a vitest test,
    because the matchers are TypeScript:
    `frontend/src/pages/pricing/rate-master/brandProjectionMatching.test.ts`.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._disciplines = set()

    @classmethod
    def tearDownClass(cls):
        for disc in cls._disciplines:
            for dt in ("BoQ Rate Category Config", "BoQ Rate Master Item"):
                for r in frappe.get_all(dt, filters={"discipline": disc}, fields=["name"]):
                    frappe.db.delete("Version", {"ref_doctype": dt, "docname": r.name})
            frappe.db.delete("BoQ Rate Master Item", {"discipline": disc})
            frappe.db.delete("BoQ Rate Category Config", {"discipline": disc})
        frappe.db.commit()
        super().tearDownClass()

    # ---- helpers ----
    def _new_disc(self):
        disc = "TEST_BP_" + frappe.generate_hash(length=8)
        type(self)._disciplines.add(disc)
        return disc

    def _item(self, disc, kind="lms_item", brand="Lutron", unit="Nos.", attrs=None):
        doc = frappe.get_doc({
            "doctype": "BoQ Rate Master Item",
            "discipline": disc, "kind": kind, "brand": brand, "unit": unit,
            "attributes": json.dumps(attrs if attrs is not None else {"description": "A widget"}),
            "rates": json.dumps({"rate": 100.0}),
            "source_sheet": "Test", "source_row": 1,
            "import_batch": "testbp-" + frappe.generate_hash(length=8),
            "active": 1,
        })
        doc.insert(ignore_permissions=True)
        return doc

    def _config(self, disc, attr_ids=("description", "brand")):
        defs = [{"id": a, "label": a.title(), "type": "choice", "values": ["x"]} for a in attr_ids]
        doc = frappe.get_doc({
            "doctype": "BoQ Rate Category Config",
            "discipline": disc, "category_id": "lighting_mgmt_system",
            "config": json.dumps({
                "category_id": "lighting_mgmt_system", "discipline": disc,
                "attribute_definitions": defs, "pipelines": {},
                "item_kinds": ["lms_item"],
                "matching_mode": "item_identity", "identity_attribute_id": "description",
            }),
            "source_workbook": "test.xlsx",
            "import_batch": "testbp-" + frappe.generate_hash(length=8),
            "active": 1,
        })
        doc.insert(ignore_permissions=True)
        return doc

    # ---- POSITIVE ----
    def test_bp_01_a_projected_item_reaches_the_dropdown_reader(self):
        """POSITIVE -- the whole point. `values_from_catalog` resolves a `values_from` dropdown
        (and, through build_slot_spec, the composite catalogues). Before the projection it could
        only see keys inside `attributes`, so a brand COLUMN was invisible to it and a brand
        dropdown was impossible without a hand-typed static values list."""
        disc = self._new_disc()
        self._item(disc, brand="Lutron", attrs={"description": "A"})
        self._item(disc, brand="Zen Control", attrs={"description": "B"})
        frappe.db.commit()
        got = extraction.values_from_catalog(disc, {"kind": "lms_item", "attr": "brand"})
        self.assertEqual(sorted(got), ["Lutron", "Zen Control"])

    def test_bp_02_the_projection_is_a_where_filter_key_too(self):
        """POSITIVE -- a projected column is a first-class MATCH KEY on the backend reader, not
        merely a list of options: it works on the `where` side of a values_from spec, which is
        how one catalogue gets narrowed by another's facts."""
        disc = self._new_disc()
        self._item(disc, brand="Lutron", attrs={"description": "A"})
        self._item(disc, brand="Zen Control", attrs={"description": "B"})
        frappe.db.commit()
        got = extraction.values_from_catalog(
            disc, {"kind": "lms_item", "attr": "description", "where": {"brand": "Lutron"}})
        self.assertEqual(got, ["A"], "the where filter must select on the projected column")

    def test_bp_03_the_api_endpoint_projects_for_every_frontend_reader_and_matcher(self):
        """POSITIVE -- the OTHER chokepoint. `get_rate_master_items` returns the single `items`
        array that both frontend dropdown readers and all 13 interpreter matcher sites consume,
        so projecting here is what makes brand matchable client-side."""
        disc = self._new_disc()
        self._item(disc, brand="Lutron", attrs={"description": "A"})
        frappe.db.commit()
        res = rate_master.get_rate_master_items(discipline=disc)
        self.assertEqual(len(res["items"]), 1)
        self.assertEqual(res["items"][0]["attributes"]["brand"], "Lutron")
        self.assertEqual(res["items"][0]["brand"], "Lutron",
                         "the column itself must still be returned -- its readers are unchanged")

    def test_bp_04_a_stored_attribute_wins_over_the_projection(self):
        """POSITIVE (precedence) -- nothing stores `attributes.brand` today, but if anything ever
        does, the STORED value is the authority. The projection must stay silent rather than mask
        it; a projection that overwrote real data would be a silent corruption."""
        disc = self._new_disc()
        self._item(disc, brand="Lutron", attrs={"description": "A", "brand": "StoredWins"})
        frappe.db.commit()
        got = extraction.values_from_catalog(disc, {"kind": "lms_item", "attr": "brand"})
        self.assertEqual(got, ["StoredWins"])
        res = rate_master.get_rate_master_items(discipline=disc)
        self.assertEqual(res["items"][0]["attributes"]["brand"], "StoredWins")

    def test_bp_05_an_item_with_no_brand_gains_no_key_at_all(self):
        """POSITIVE (absence) -- NOT an empty string and NOT None. An item with no brand must be
        indistinguishable from one the projection never touched, or every downstream reader would
        need its own blank test and `Object.keys(it.attributes)` would gain a phantom member."""
        disc = self._new_disc()
        self._item(disc, brand=None, attrs={"description": "A"})
        self._item(disc, brand="", attrs={"description": "B"})
        self._item(disc, brand="   ", attrs={"description": "C"})
        frappe.db.commit()
        res = rate_master.get_rate_master_items(discipline=disc)
        self.assertEqual(len(res["items"]), 3)
        for it in res["items"]:
            self.assertNotIn("brand", it["attributes"],
                             "a blank/absent column must contribute NO key")
        self.assertEqual(
            extraction.values_from_catalog(disc, {"kind": "lms_item", "attr": "brand"}), [])

    def test_bp_06_adding_a_column_is_one_word_in_one_tuple_read_by_both_sites(self):
        """POSITIVE -- THE EXTENSIBILITY BAR the owner set: a second column must be a word added
        to a list, never new code. This patches `PROJECTED_ITEM_COLUMNS` and asserts BOTH
        chokepoints pick the new column up with no other edit anywhere -- which also proves the
        two sites read ONE definition and can never drift apart."""
        disc = self._new_disc()
        self._item(disc, brand="Lutron", unit="Nos.", attrs={"description": "A"})
        frappe.db.commit()
        first = rate_master.get_rate_master_items(discipline=disc)["items"][0]
        self.assertNotIn("unit", first["attributes"], "baseline: unit is a column, not projected")
        self.assertEqual(extraction.values_from_catalog(disc, {"kind": "lms_item", "attr": "unit"}), [])
        original = extraction.PROJECTED_ITEM_COLUMNS
        try:
            extraction.PROJECTED_ITEM_COLUMNS = ("brand", "unit")
            it = rate_master.get_rate_master_items(discipline=disc)["items"][0]
            self.assertEqual(it["attributes"]["unit"], "Nos.", "api site must follow the tuple")
            self.assertEqual(it["attributes"]["brand"], "Lutron")
            self.assertEqual(
                extraction.values_from_catalog(disc, {"kind": "lms_item", "attr": "unit"}),
                ["Nos."], "the extraction site must follow the SAME tuple")
        finally:
            extraction.PROJECTED_ITEM_COLUMNS = original
        again = rate_master.get_rate_master_items(discipline=disc)["items"][0]
        self.assertNotIn("unit", again["attributes"], "restored")

    def test_bp_06b_all_three_extraction_readers_share_one_parse(self):
        """POSITIVE (structural) -- fails if a reader is added, or reverted, to its own inline
        `json.loads(row["attributes"])`, which would silently opt that reader out of the
        projection. THE MECHANISM IS THE SHARED HELPER, never three copies of it."""
        import inspect as _inspect
        for fn in ("catalog_values", "values_from_catalog", "attributes_by_item"):
            body = _inspect.getsource(getattr(extraction, fn))
            self.assertIn("_row_attributes(r)", body, "%s must use the shared parse" % fn)
            self.assertIn("_item_read_fields(", body, "%s must use the shared fields list" % fn)
        src = _inspect.getsource(extraction)
        self.assertEqual(src.count("\nPROJECTED_ITEM_COLUMNS = ("), 1,
                         "the projected-column list must have exactly ONE definition")

    # ---- NEGATIVE ----
    def test_bp_07_a_write_path_never_persists_the_projection(self):
        """NEGATIVE -- THE INVARIANT THAT KEEPS THIS DESIGN HONEST. If any write path ever read a
        PROJECTED item and wrote its `attributes` back, the projection would become STORED --
        recreating exactly the duplication option (A) was rejected for (a second `brand` CSV
        header, which makes the whole upload file unreadable). This drives the live edit endpoint
        AFTER a projected read -- the precise ordering that would poison a write -- and asserts
        the stored map is untouched."""
        disc = self._new_disc()
        self._config(disc)
        doc = self._item(disc, brand="Lutron", attrs={"description": "A"})
        frappe.db.commit()
        seen = rate_master.get_rate_master_items(discipline=disc)["items"][0]
        self.assertEqual(seen["attributes"]["brand"], "Lutron")
        rate_master.update_rate_master_item(
            name=doc.name, attributes_patch=json.dumps({"description": "A2"}))
        # PostgreSQL hydrates a JSON column, so this comes back as a dict, not text.
        raw = frappe.db.get_value("BoQ Rate Master Item", doc.name, "attributes")
        stored = raw if isinstance(raw, dict) else json.loads(raw or "{}")
        self.assertEqual(stored, {"description": "A2"},
                         "a write path must NEVER persist a projected key")
        self.assertNotIn("brand", stored)

    def test_bp_08_the_csv_round_trip_never_sees_the_projection(self):
        """NEGATIVE -- exactly ONE `brand` header, never two. `csv_exporter._keys_for` derives
        attribute columns from the keys OBSERVED in the items, while `LEAD_COLUMNS` already
        carries `brand`; a stored `attributes.brand` would emit a duplicate header and
        `csv_importer.classify_columns` would then refuse the ENTIRE file. That is the failure
        that rejected option (A) -- pinned so option (C) can never arrive at it by another route."""
        from nirmaan_stack.services.boq_rate_master import csv_exporter
        disc = self._new_disc()
        self._config(disc)
        self._item(disc, brand="Lutron", attrs={"description": "A"})
        frappe.db.commit()
        _text, headers, _n = csv_exporter.build_category_csv(disc, "lighting_mgmt_system")
        self.assertEqual(headers.count("brand"), 1,
                         "a duplicate brand header breaks every upload for the whole discipline")
        _t2, headers2, _n2 = csv_exporter.build_all_categories_csv(disc)
        self.assertEqual(headers2.count("brand"), 1)
        spec, errors = csv_importer.classify_columns(headers, {"description", "brand"}, {"rate"})
        self.assertEqual(errors, [], "the exported header row must be readable by the importer")
        self.assertIn("brand", spec["fixed"])
        self.assertNotIn("brand", spec["attributes"])

    def test_bp_09_a_fresh_asset_export_never_carries_the_projection(self):
        """NEGATIVE -- `exporter.build_asset` emits each item's `attributes` WHOLE and reads the
        database directly, so a projected key must never reach it. If it did, the asset would
        carry the same value twice with no rule saying which is authoritative on re-import, and
        every future asset diff would be noisy."""
        from nirmaan_stack.services.boq_rate_master import exporter
        disc = self._new_disc()
        self._config(disc)
        self._item(disc, brand="Lutron", attrs={"description": "A"})
        frappe.db.commit()
        asset = exporter.build_asset(disc)
        self.assertEqual(len(asset["items"]), 1)
        self.assertEqual(asset["items"][0]["attributes"], {"description": "A"},
                         "the asset must carry the STORED attributes only")
        self.assertEqual(asset["items"][0]["brand"], "Lutron",
                         "the column still rides as its own top-level key, exactly as before")

    def test_bp_10_no_live_config_matches_on_a_projected_column(self):
        """NEGATIVE (backwards compatibility) -- the projection adds a key to EVERY item in every
        category, so the question that matters is whether any existing dropdown or pipeline could
        notice. Measured over the shipped asset: no `values_from`, `where`, `ref` or `when`
        anywhere references a projected column, so no existing catalogue or match can move. This
        is also what proves no panel gains a visible field: panels render config-declared
        DEFINITIONS, and no config declares one backed by a projected column."""
        with open(_asset_path(CURRENT_EALL_ASSET), "r", encoding="utf-8") as fh:
            payload = json.load(fh)
        projected = set(extraction.PROJECTED_ITEM_COLUMNS)
        offenders = []

        def walk(node, path):
            if isinstance(node, dict):
                for k, v in node.items():
                    if k == "values_from" and isinstance(v, dict):
                        if v.get("attr") in projected or (projected & set(v.get("where") or {})):
                            offenders.append(path + "/values_from")
                    if k in ("where", "ref", "when", "attributes") and isinstance(v, dict):
                        if projected & set(v):
                            offenders.append(path + "/" + k)
                    walk(v, path + "/" + str(k))
            elif isinstance(node, list):
                for i, v in enumerate(node):
                    walk(v, path + "/%d" % i)

        for cfg in payload["category_configs"]:
            walk(cfg, cfg["category_id"])
        self.assertEqual(offenders, [],
                         "a live config already matches on a projected column -- the projection "
                         "would CHANGE its result; re-measure before shipping")
