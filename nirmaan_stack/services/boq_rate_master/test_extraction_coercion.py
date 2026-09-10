"""SERVER-SIDE attribute coercion -- `extraction._coerce_value`, every type, both directions.

WHY THIS FILE EXISTS. CP2 added the `number_choice` attribute type and taught it to the FRONTEND
match coercion (`rateMasterStructure.coerceForMatch`) and to the config validator, pinning both --
but not to THIS function, and NOTHING covered this path. The result shipped and broke live: every
core and thickness the model returned for a `number_choice` attribute was nulled on the way in, and
point_wiring went from 17 of 23 rows pricing to 0. The one-line fix is trivial; this coverage is the
actual deliverable, because its absence is what let the gap ship.

The function is PURE (a definition dict + a raw value in, a stored value out), so every case here is
a direct call -- no DB, no AI, no fixtures.
"""

import json
import os

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.boq_rate_master import extraction


def _num(**over):
    d = {"id": "circuit_length_m", "label": "Length", "type": "number"}
    d.update(over)
    return d


def _choice(**over):
    d = {"id": "conduit_type", "label": "Conduit", "type": "choice", "values": ["PVC", "MS"]}
    d.update(over)
    return d


def _number_choice(**over):
    """Mirrors the LIVE v24 shape: values resolved from the catalog, so they are FLOATS."""
    d = {
        "id": "wire1_core",
        "label": "Wire 1 - cores",
        "type": "number_choice",
        "values": [6.0, 5.0, 4.0, 3.0, 2.0, 1.0],
    }
    d.update(over)
    return d


class TestCoerceValueNumber(FrappeTestCase):
    """`number` -- unchanged by this slice; pinned so the fix cannot disturb it."""

    def test_01_numeric_forms_all_store(self):
        for raw in (1, "1", 1.0, "1.0"):
            self.assertEqual(extraction._coerce_value(_num(), raw), 1, msg=repr(raw))

    def test_02_a_fractional_value_keeps_its_fraction(self):
        self.assertEqual(extraction._coerce_value(_num(), "1.5"), 1.5)
        self.assertEqual(extraction._coerce_value(_num(), 2.5), 2.5)

    def test_03_NEGATIVE_a_non_numeric_string_is_rejected(self):
        self.assertIsNone(extraction._coerce_value(_num(), "abc"))
        self.assertIsNone(extraction._coerce_value(_num(), "1.5 sqmm"))

    def test_04_null_stays_null(self):
        self.assertIsNone(extraction._coerce_value(_num(), None))

    def test_05_a_number_def_ignores_a_values_list(self):
        """A `number` def carries no domain; even with one it is not membership-checked."""
        self.assertEqual(extraction._coerce_value(_num(values=[1.0, 2.0]), 99), 99)


class TestCoerceValueChoice(FrappeTestCase):
    """`choice` -- STRING semantics, membership-checked. Unchanged by this slice."""

    def test_06_an_allowed_value_stores_as_a_string(self):
        self.assertEqual(extraction._coerce_value(_choice(), "PVC"), "PVC")

    def test_07_NEGATIVE_a_value_outside_the_list_is_rejected(self):
        self.assertIsNone(extraction._coerce_value(_choice(), "GI"))

    def test_08_a_synonym_maps_to_its_canonical_before_the_check(self):
        self.assertEqual(extraction._coerce_value(_choice(), "GI", {"GI": "MS"}), "MS")

    def test_09_a_choice_with_no_values_list_accepts_anything_as_a_string(self):
        self.assertEqual(extraction._coerce_value(_choice(values=None), 3), "3")

    def test_10_NEGATIVE_a_number_against_a_string_domain_is_rejected(self):
        """The mirror image of the number_choice defect: a `choice` domain is strings, so a numeric
        answer is genuinely not a member and must NOT be coerced into one."""
        self.assertIsNone(extraction._coerce_value(_choice(values=["1", "2"]), 1.0))


class TestCoerceValueNumberChoice(FrappeTestCase):
    """`number_choice` -- THE CP2 GAP. A dropdown that produces a NUMBER, so it must coerce
    numerically and compare LIKE WITH LIKE against a numeric domain."""

    def test_11_all_four_representations_of_the_same_value_store(self):
        """THE FIX. The model may answer 1, "1", 1.0 or "1.0" for a def whose values are floats;
        all four are the same value and all four must land as the number 1.

        BEFORE the fix every one of these returned None -- `str(1)` was tested for membership in
        [6.0 ... 1.0] and never matched, so a correct answer was discarded."""
        for raw in (1, "1", 1.0, "1.0"):
            self.assertEqual(extraction._coerce_value(_number_choice(), raw), 1, msg=repr(raw))

    def test_12_a_fractional_domain_member_stores_with_its_fraction(self):
        thickness = _number_choice(id="wire1_thickness_sqmm", values=[1.5, 2.5, 4.0, 6.0])
        for raw in (1.5, "1.5"):
            self.assertEqual(extraction._coerce_value(thickness, raw), 1.5, msg=repr(raw))

    def test_13_NEGATIVE_a_value_genuinely_outside_the_domain_is_REJECTED(self):
        """Like-for-like comparison, NOT abandoning the check. 7 is not a catalog core count."""
        self.assertIsNone(extraction._coerce_value(_number_choice(), 7))
        self.assertIsNone(extraction._coerce_value(_number_choice(), "7"))
        self.assertIsNone(extraction._coerce_value(_number_choice(), 1.5))

    def test_14_NEGATIVE_a_non_numeric_string_is_rejected(self):
        self.assertIsNone(extraction._coerce_value(_number_choice(), "one"))
        self.assertIsNone(extraction._coerce_value(_number_choice(), ""))

    def test_15_null_stays_null(self):
        self.assertIsNone(extraction._coerce_value(_number_choice(), None))

    def test_16_the_None_sentinel_survives_on_an_allow_none_def(self):
        """POSITIVE ABSENCE. Handled EARLIER than the type branch and already working before this
        slice -- pinned so the fix cannot disturb it."""
        d = _number_choice(id="wire2_thickness_sqmm", allow_none=True, values=[1.5, 2.5])
        self.assertEqual(extraction._coerce_value(d, "None"), "None")

    def test_17_NEGATIVE_None_without_allow_none_is_not_the_sentinel(self):
        self.assertIsNone(extraction._coerce_value(_number_choice(), "None"))

    def test_18_a_number_choice_with_no_values_list_still_coerces_numerically(self):
        """No domain declared -> no membership check, but the TYPE promise still holds: a
        number_choice always stores a number, never a string."""
        got = extraction._coerce_value(_number_choice(values=None), "3")
        self.assertEqual(got, 3)
        self.assertIsInstance(got, int)

    def test_19_an_integral_float_stores_as_an_int_like_the_number_type(self):
        """Same normalisation `number` uses, so the two numeric types agree: 1.0 -> 1, 1.5 -> 1.5."""
        self.assertIsInstance(extraction._coerce_value(_number_choice(), 1.0), int)
        thickness = _number_choice(id="t", values=[1.5])
        self.assertIsInstance(extraction._coerce_value(thickness, 1.5), float)

    def test_20_a_string_domain_on_a_number_choice_still_matches_numerically(self):
        """Defensive: a hand-authored config may list its values as strings. Like-for-like means
        numeric comparison on BOTH sides, so "1" in the domain still accepts the answer 1."""
        d = _number_choice(values=["1", "2", "3"])
        self.assertEqual(extraction._coerce_value(d, 1), 1)
        self.assertIsNone(extraction._coerce_value(d, 9))


class TestCoerceValueUnknownType(FrappeTestCase):
    """An unknown / future type must degrade to the pre-existing STRING behaviour, never crash."""

    def test_21_an_unknown_type_falls_through_to_the_choice_semantics(self):
        d = {"id": "x", "label": "X", "type": "some_future_type", "values": ["A", "B"]}
        self.assertEqual(extraction._coerce_value(d, "A"), "A")

    def test_22_NEGATIVE_an_unknown_type_still_honours_its_domain(self):
        d = {"id": "x", "label": "X", "type": "some_future_type", "values": ["A", "B"]}
        self.assertIsNone(extraction._coerce_value(d, "C"))

    def test_23_an_unknown_type_with_no_domain_stringifies(self):
        d = {"id": "x", "label": "X", "type": "some_future_type"}
        self.assertEqual(extraction._coerce_value(d, 5), "5")


class TestCoerceValueAgainstTheLiveConfig(FrappeTestCase):
    """The live point_wiring defs, exactly as `build_attribute_defs` hands them to the model.

    This is the case the unit fixtures above are modelled on; pinning it against the REAL config
    means a future asset change that alters the domain's dtype cannot silently reopen the gap.
    Read-only: no AI call, no write.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cfgs = extraction._load_active_configs({"Electrical"})
        cls.cfg = cfgs.get(("Electrical", "point_wiring"))
        cls.defs = (
            {d["id"]: d for d in extraction.build_attribute_defs(cls.cfg, None, "Electrical")}
            if cls.cfg
            else {}
        )

    def test_24_the_live_wire_defs_are_number_choice_over_a_numeric_domain(self):
        if not self.defs:
            self.skipTest("point_wiring config not loaded on this site")
        for attr in ("wire1_core", "wire2_core", "wire1_thickness_sqmm", "wire2_thickness_sqmm"):
            d = self.defs[attr]
            self.assertEqual(d["type"], "number_choice", msg=attr)
            numeric = [v for v in (d.get("values") or []) if str(v) != "None"]
            self.assertTrue(numeric, msg=attr)
            for v in numeric:
                float(v)  # every domain member is numeric -- raises loudly if not

    def test_25_THE_LIVE_BREAK_a_real_answer_now_stores(self):
        """What run BRSR-26-00326 actually returned for rows 196-235: core 1, thickness 1.5.
        Before the fix BOTH were nulled and no point_wiring row could price."""
        if not self.defs:
            self.skipTest("point_wiring config not loaded on this site")
        self.assertEqual(extraction._coerce_value(self.defs["wire1_core"], 1), 1)
        self.assertEqual(extraction._coerce_value(self.defs["wire1_thickness_sqmm"], 1.5), 1.5)
        self.assertEqual(extraction._coerce_value(self.defs["wire2_thickness_sqmm"], "None"), "None")

    def test_26_NEGATIVE_the_live_defs_still_reject_a_non_member(self):
        if not self.defs:
            self.skipTest("point_wiring config not loaded on this site")
        self.assertIsNone(extraction._coerce_value(self.defs["wire1_core"], 12))


# ── SLICE 5 (B1 + B2) ────────────────────────────────────────────────────────────────────────


def _cell(value, **over):
    d = {"value": value, "confidence": 0.9}
    d.update(over)
    return d


class TestExtractFlagB1(FrappeTestCase):
    """`extract: false` withholds an attribute from the AI prompt and NOTHING else.

    Three flags hide an attribute from three different surfaces, and the whole point of adding a
    third was that neither existing one had the right blast radius: `selector: false` also strips
    the field from the Rate Master Derivation configurator, and `panel: false` keeps extracting it.
    """

    def _cfg(self, extra=None):
        d = {"id": "blank_qty", "label": "Blank plate qty", "type": "number"}
        d.update(extra or {})
        return {"attribute_definitions": [
            {"id": "plate_item", "label": "Plate", "type": "choice", "values": ["3M"]},
            d,
        ]}

    def test_absent_flag_is_extracted(self):
        """NEGATIVE control: without the flag the attribute is asked for, exactly as before."""
        ids = [d["id"] for d in extraction.build_attribute_defs(self._cfg())]
        self.assertIn("blank_qty", ids)
        self.assertIn("plate_item", ids)

    def test_extract_false_is_withheld(self):
        """POSITIVE: the model is not asked for it."""
        ids = [d["id"] for d in extraction.build_attribute_defs(self._cfg({"extract": False}))]
        self.assertNotIn("blank_qty", ids)
        self.assertIn("plate_item", ids, "only the flagged attribute is withheld")

    def test_extract_true_is_extracted(self):
        """Only the literal False withholds -- a truthy value must not be read as a flag."""
        ids = [d["id"] for d in extraction.build_attribute_defs(self._cfg({"extract": True}))]
        self.assertIn("blank_qty", ids)

    def test_panel_false_is_still_extracted(self):
        """`panel` hides from the PRICING PANEL and must never affect extraction."""
        ids = [d["id"] for d in extraction.build_attribute_defs(self._cfg({"panel": False}))]
        self.assertIn("blank_qty", ids)

    def test_selector_false_also_withholds(self):
        """The pre-existing flag still withholds -- `extract` is additional, not a replacement."""
        ids = [d["id"] for d in extraction.build_attribute_defs(self._cfg({"selector": False}))]
        self.assertNotIn("blank_qty", ids)


class TestScrubUnpairedSlotDefaults(FrappeTestCase):
    """B2 / R-B -- a quantity default belongs to a slot, and dies with it."""

    DEFAULTS = {
        "socket1_qty": {"default": 1.0, "requires_named": "socket1_item"},
        "plate_qty": {"default": 1.0, "requires_named": "plate_item"},
        "colour": "White",           # a plain default, no pairing
    }

    def test_scrubs_a_quantity_whose_slot_is_None(self):
        """POSITIVE: the ghost case -- 84 of these across the live corpus, all valued 1."""
        row = {"socket1_item": _cell("None"), "socket1_qty": _cell(1.0, defaulted=True)}
        scrubbed = extraction.scrub_unpaired_slot_defaults(row, self.DEFAULTS)
        self.assertEqual(scrubbed, ["socket1_qty"])
        self.assertIsNone(row["socket1_qty"]["value"])
        self.assertNotIn("defaulted", row["socket1_qty"], "the default mark goes with the value")

    def test_keeps_a_quantity_whose_slot_is_NAMED(self):
        """NEGATIVE: a real component keeps its default -- this is R-B's whole point."""
        row = {"socket1_item": _cell("6A 3-Pin Socket"), "socket1_qty": _cell(1.0, defaulted=True)}
        self.assertEqual(extraction.scrub_unpaired_slot_defaults(row, self.DEFAULTS), [])
        self.assertEqual(row["socket1_qty"]["value"], 1.0)

    def test_keeps_a_quantity_whose_slot_is_BLANK(self):
        """NEGATIVE, and the load-bearing one.

        BLANK is "unknown", not "absent". `plate_item` is blank on 94 of 122 live rows because the
        LADDER computes it; scrubbing `plate_qty` there makes `component_ref` refuse the whole
        pipeline and those rows stop pricing entirely.
        """
        row = {"plate_item": _cell(None), "plate_qty": _cell(1.0, defaulted=True)}
        self.assertEqual(extraction.scrub_unpaired_slot_defaults(row, self.DEFAULTS), [])
        self.assertEqual(row["plate_qty"]["value"], 1.0)

    def test_scrubs_regardless_of_provenance(self):
        """A quantity for a component the row says is absent is meaningless however it arose."""
        row = {"socket1_item": _cell("None"), "socket1_qty": _cell(3.0)}   # no `defaulted` mark
        self.assertEqual(extraction.scrub_unpaired_slot_defaults(row, self.DEFAULTS), ["socket1_qty"])
        self.assertIsNone(row["socket1_qty"]["value"])

    def test_already_null_is_not_reported_as_scrubbed(self):
        """Idempotent, and it must not inflate the drop report with no-ops."""
        row = {"socket1_item": _cell("None"), "socket1_qty": _cell(None)}
        self.assertEqual(extraction.scrub_unpaired_slot_defaults(row, self.DEFAULTS), [])

    def test_a_plain_default_is_untouched(self):
        """A default with no `requires_named` is not a slot quantity."""
        row = {"colour": _cell("White"), "socket1_item": _cell("None")}
        self.assertEqual(extraction.scrub_unpaired_slot_defaults(row, self.DEFAULTS), [])
        self.assertEqual(row["colour"]["value"], "White")

    def test_no_defaults_configured_is_a_no_op(self):
        """ABSENT => byte-identical to pre-slice-5, the gating discipline this codebase uses."""
        row = {"socket1_item": _cell("None"), "socket1_qty": _cell(1.0)}
        self.assertEqual(extraction.scrub_unpaired_slot_defaults(row, None), [])
        self.assertEqual(row["socket1_qty"]["value"], 1.0)

    def test_defaults_without_requires_named_are_a_no_op(self):
        """The legacy defaults shape (a bare value, or {default} alone) must not scrub anything."""
        row = {"socket1_item": _cell("None"), "socket1_qty": _cell(1.0)}
        legacy = {"socket1_qty": 1.0, "plate_qty": {"default": 1.0}}
        self.assertEqual(extraction.scrub_unpaired_slot_defaults(row, legacy), [])
        self.assertEqual(row["socket1_qty"]["value"], 1.0)

    def test_a_missing_pair_attribute_is_not_treated_as_absent(self):
        """If the paired slot was never returned at all, that is not a positive 'None'."""
        row = {"socket1_qty": _cell(1.0)}
        self.assertEqual(extraction.scrub_unpaired_slot_defaults(row, self.DEFAULTS), [])
        self.assertEqual(row["socket1_qty"]["value"], 1.0)


# ---------------------------------------------------------------------------------------
# TPN POST-MATCH POLE CORRECTION
# ---------------------------------------------------------------------------------------
#
# A synthetic catalogue in the LIVE shape. Its structure is the load-bearing part and is copied
# from the real one: MCB is the ONLY device carrying both a TP row and an FP row, MCCB is FP-only,
# RCCB/RCBO are DP/FP only, and shells carry no `device` at all. That structure is what bounds the
# correction, so the fixture has to reproduce it or the negative tests prove nothing.
_CAT = {
    # MCB -- the one device with a TP/FP pair, at two amps and two curves
    "32A TP MCB C CURVE": {"family": "Switchgear", "item": "32A TP MCB C CURVE",
                           "device": "MCB", "pole": "TP", "amp_a": 32.0, "curve": "C"},
    "32A FP MCB C CURVE": {"family": "Switchgear", "item": "32A FP MCB C CURVE",
                           "device": "MCB", "pole": "FP", "amp_a": 32.0, "curve": "C"},
    "40A TP MCB C CURVE": {"family": "Switchgear", "item": "40A TP MCB C CURVE",
                           "device": "MCB", "pole": "TP", "amp_a": 40.0, "curve": "C"},
    "40A FP MCB C CURVE": {"family": "Switchgear", "item": "40A FP MCB C CURVE",
                           "device": "MCB", "pole": "FP", "amp_a": 40.0, "curve": "C"},
    "63A TP MCB D CURVE": {"family": "Switchgear", "item": "63A TP MCB D CURVE",
                           "device": "MCB", "pole": "TP", "amp_a": 63.0, "curve": "D"},
    # DELIBERATELY NO "63A FP MCB D CURVE": the no-sibling case needs a real hole to fall into.
    # MCCB -- FP only, so a TPN MCCB row is already right and unreachable by this correction
    "63A FP MCCB": {"family": "Switchgear", "item": "63A FP MCCB",
                    "device": "MCCB", "pole": "FP", "amp_a": 63.0, "curve": "NA"},
    # residual-current devices -- DP/FP only, never TP
    "40A RCCB 100mA (FP)": {"family": "Switchgear", "item": "40A RCCB 100mA (FP)",
                            "device": "RCCB", "pole": "FP", "amp_a": 40.0, "curve": "NA"},
    "32A RCBO 30mA (DP)": {"family": "Switchgear", "item": "32A RCBO 30mA (DP)",
                           "device": "RCBO", "pole": "DP", "amp_a": 32.0, "curve": "NA"},
    # a DB shell -- no `device` at all
    "TPN 7 SEGMENT DB 6WAY": {"family": "DB", "item": "TPN 7 SEGMENT DB 6WAY"},
}


def _row(description="", attached=None, own=None, appended=None):
    return {"description": description, "attached_notes": attached,
            "own_notes_raw": own, "append_notes_raw": appended}


# The THREE genuinely mis-routed rows, with their REAL text, verbatim from the live sheets.
_REAL_198_R77 = _row(
    "Supply, installation, testing & commissioning of 6 Way TPN seven segment type, double door "
    "Lighting distribution boards (LDB ) conforming to the technical specifications for MCB DB's "
    "& comprising of the following.",
    attached=["Incomer:", '1No - 40A TPN MCB " C " Curve', "Phase control:",
              "3Nos - 32A, 30mA DP RCBO", "Outgoings:", '18Nos - 10A SP MCB " B " Curve'])
_REAL_198_R88 = _row(
    "Supply, installation, testing & commissioning of 6 Way TPN seven segment type, double door "
    "Lighting distribution boards (PDB ) conforming to the technical specifications for MCB DB's "
    "& comprising of the following.",
    attached=["Incomer:", '1No - 40A TPN MCB " C " Curve', "Phase control:",
              "3Nos - 32A, 100mA DP RCBO", "Outgoings:", '18Nos - 10/16A SP MCB " C " Curve'])
_REAL_200_R77 = _row(
    "Supply and installation of 32A, TPN C Curve MCB with IP55 weather proof enclosure with loto "
    "for AC's/Fans")

# The SIX real picks that read a bare "TP" and must never move.
_REAL_BARE_TP = [
    ("BOQ-26-00174 r94", _row("Outgoing :4 Nos. 32A TP, MCB of 'C' curve"), "32A TP MCB C CURVE"),
    ("BOQ-26-00174 r100", _row("Outgoing : 6 Nos. 32A TP, MCB of 'C' curve"), "32A TP MCB C CURVE"),
    ("BOQ-26-00196 r171", _row("Outgoing : 24 Nos. 16A, 10KA, SP MCB of 'D' curve"), "63A TP MCB D CURVE"),
    ("BOQ-26-00196 r196 slot2",
     _row("Outgoing : 1 No 63A TP MCB, 2 Nos. 40A TP MCB, 15 Nos 16/20/25/32 SP MCB of 'C' curve"),
     "63A TP MCB D CURVE"),
    ("BOQ-26-00196 r196 slot3",
     _row("Outgoing : 1 No 63A TP MCB, 2 Nos. 40A TP MCB, 15 Nos 16/20/25/32 SP MCB of 'C' curve"),
     "40A TP MCB C CURVE"),
    ("BOQ-26-00196 r206", _row("Outgoing :12 Nos. 32A SP MCB of 'D' curve"), "63A TP MCB D CURVE"),
]


class TestFourPoleVocabularyIsReadFromThePrompt(FrappeTestCase):
    """The correction's vocabulary comes from the SHIPPED prompt line, never a second copy."""

    def test_reads_the_nine_fp_tokens_in_prompt_order(self):
        """POSITIVE. The POLE line maps nine spellings to FP; all nine must arrive, longest first
        (so "TP+2NL" can never be truncated to "TP+2N")."""
        self.assertEqual(
            extraction.four_pole_tokens(),
            ["TP+2NL", "TP+2N", "TP+NL", "TP+N", "TPN", "Four Pole", "4 pole", "4P", "FP"])

    def test_every_token_actually_appears_in_the_shipped_prompt_line(self):
        """NEGATIVE -- THE ANTI-DRIFT PIN.

        This is the test that stops the defect being reintroduced one level down. If the
        vocabulary were duplicated in Python, a token added to the prompt would be silently
        uncorrected here -- a model told about a spelling the corrector has never heard of. Read
        the POLE line and prove every token this module acts on is quoted IN it.
        """
        line = next(ln for ln in extraction._read_prompt(extraction._DECOMPOSITION_PROMPT_PATH)
                    .splitlines() if ln.lstrip().startswith("- POLE"))
        for tok in extraction.four_pole_tokens():
            self.assertIn('"%s"' % tok, line,
                          "%r is acted on but is not quoted in the shipped POLE line" % tok)

    def test_a_prompt_with_no_pole_line_yields_nothing_rather_than_a_guess(self):
        """NEGATIVE. If the line is ever renamed the corrector goes INERT, it does not fall back
        to a hardcoded list -- silence beats a stale second copy."""
        real = extraction._read_prompt
        try:
            extraction._read_prompt = lambda _p: "no pole line here\n"
            self.assertEqual(extraction.four_pole_tokens(), [])
        finally:
            extraction._read_prompt = real


class TestFourPoleMcbCorrection(FrappeTestCase):
    """TPN POST-MATCH -- a three-pole MCB pick becomes its four-pole sibling when the row says so.

    Pure: a picked value + the row's text + a catalogue dict in, a corrected pick out. No DB.
    """

    # ---- POSITIVE: the three real mis-routed rows ------------------------------------
    def test_real_198_r77_swaps_tp_to_fp(self):
        """The incomer reads '40A TPN MCB " C " Curve'. TPN is four pole, so the 40A C-curve pick
        must move from TP to FP -- same amp, same curve."""
        out = {"mcb1_item": _cell("40A TP MCB C CURVE")}
        rec = extraction.correct_four_pole_mcb_picks(out, _REAL_198_R77, _CAT)
        self.assertEqual(out["mcb1_item"]["value"], "40A FP MCB C CURVE")
        self.assertEqual(rec, [{"attr": "mcb1_item", "from": "40A TP MCB C CURVE",
                                "to": "40A FP MCB C CURVE"}])

    def test_real_198_r88_swaps_tp_to_fp(self):
        """The second real row, same incomer wording, same swap."""
        out = {"mcb1_item": _cell("40A TP MCB C CURVE")}
        extraction.correct_four_pole_mcb_picks(out, _REAL_198_R88, _CAT)
        self.assertEqual(out["mcb1_item"]["value"], "40A FP MCB C CURVE")

    def test_real_200_r77_swaps_tp_to_fp(self):
        """The standalone breaker -- '32A, TPN C Curve MCB'. Two words separate TPN from MCB, the
        widest real hit, and the row is 17.6% underpriced until it moves."""
        out = {"mcb1_item": _cell("32A TP MCB C CURVE")}
        extraction.correct_four_pole_mcb_picks(out, _REAL_200_R77, _CAT)
        self.assertEqual(out["mcb1_item"]["value"], "32A FP MCB C CURVE")

    # ---- THE NEGATIVE THAT MATTERS: six real rows that read a bare "TP" --------------
    def test_the_six_real_bare_tp_rows_never_move(self):
        """NEGATIVE, and the one this whole design is guarded for.

        Six live picks are genuinely three-pole -- their text says "TP", not "TPN". Moving any of
        them would replace a silently-low price with a silently-HIGH one, which is worse, because
        nothing on the screen would say so.
        """
        for name, row, picked in _REAL_BARE_TP:
            with self.subTest(row=name):
                out = {"mcb1_item": _cell(picked)}
                rec = extraction.correct_four_pole_mcb_picks(out, row, _CAT)
                self.assertEqual(out["mcb1_item"]["value"], picked)
                self.assertEqual(rec, [])

    # ---- adjacency: the constructed case D2 exists for ------------------------------
    def test_a_tpn_board_with_a_genuine_three_pole_outgoing_does_not_swap(self):
        """NEGATIVE. 'TPN' here is the BOARD's phase type and the outgoing really is three-pole.
        Six words separate them, past the window, so the pick stands. Absent from today's corpus
        and perfectly constructible -- which is exactly why adjacency is required at all."""
        row = _row("12 Way TPN DB (double door) with 32A TP MCB outgoings")
        out = {"mcb1_item": _cell("32A TP MCB C CURVE")}
        self.assertEqual(extraction.correct_four_pole_mcb_picks(out, row, _CAT), [])
        self.assertEqual(out["mcb1_item"]["value"], "32A TP MCB C CURVE")

    def test_a_board_named_TPN_MCB_DB_does_not_swap(self):
        """NEGATIVE. 'TPN MCB DB' names a board, and its MCB sits at gap ZERO -- no adjacency
        window alone can separate it, which is why an MCB followed by board vocabulary is not a
        device anchor. Without this guard the outgoing below would be wrongly upgraded."""
        row = _row("For 6 way, Double door TPN MCB DB",
                   attached=["Outgoing 32A TP MCB - 4 Nos"])
        self.assertEqual(extraction.correct_four_pole_mcb_picks(out_ := {"mcb1_item": _cell("32A TP MCB C CURVE")},
                                                               row, _CAT), [])
        self.assertEqual(out_["mcb1_item"]["value"], "32A TP MCB C CURVE")

    def test_adjacency_is_never_manufactured_across_two_fragments(self):
        """NEGATIVE. A description ending 'TPN DB' beside a note beginning 'MCB 32A TP' would read
        as 'TPN DB MCB' -- gap 1 -- if the texts were joined. They are separate texts on the
        sheet and must stay separate here."""
        row = _row("12 Way TPN DB", attached=["MCB 32A TP outgoing - 4 Nos"])
        out = {"mcb1_item": _cell("32A TP MCB C CURVE")}
        self.assertEqual(extraction.correct_four_pole_mcb_picks(out, row, _CAT), [])

    def test_a_token_beyond_the_window_does_not_fire(self):
        """NEGATIVE. The window is a WINDOW: past it, a token is not describing this breaker."""
        row = _row("TPN one two three four 32A MCB C curve")
        out = {"mcb1_item": _cell("32A TP MCB C CURVE")}
        self.assertEqual(extraction.correct_four_pole_mcb_picks(out, row, _CAT), [])

    # ---- E4's structural bound, pinned ----------------------------------------------
    def test_an_mccb_pick_is_untouched_even_with_TPN_beside_it(self):
        """NEGATIVE, structural. MCCB has no TP row in the catalogue, so a TPN MCCB is already
        four-pole and there is nothing to correct. Pinned because it is the BOUND: if this ever
        fires, the correction has escaped the one device it was scoped to."""
        row = _row("63A, TPN , MCCB in IP 55 enclosure")
        out = {"mcb1_item": _cell("63A FP MCCB")}
        self.assertEqual(extraction.correct_four_pole_mcb_picks(out, row, _CAT), [])
        self.assertEqual(out["mcb1_item"]["value"], "63A FP MCCB")

    def test_an_rccb_pick_is_untouched_even_with_TPN_beside_it(self):
        """NEGATIVE, structural. RCCB is DP/FP only -- never TP -- so it is unreachable."""
        row = _row("Supply and installation of 40A, TPN C Curve RCCB 100mA")
        out = {"mcb1_item": _cell("40A RCCB 100mA (FP)")}
        self.assertEqual(extraction.correct_four_pole_mcb_picks(out, row, _CAT), [])

    def test_an_rcbo_pick_is_untouched_even_with_TPN_beside_it(self):
        """NEGATIVE, structural. Same bound as RCCB. This slice is POLE ON MCBs ONLY -- the
        separate, larger device/amp/curve gap is owner-DEFERRED and must not be touched here."""
        row = _row("1No - 32A TPN RCBO 30mA MCB board")
        out = {"mcb2_item": _cell("32A RCBO 30mA (DP)")}
        self.assertEqual(extraction.correct_four_pole_mcb_picks(out, row, _CAT), [])

    def test_a_db_shell_pick_is_untouched(self):
        """NEGATIVE, structural. A shell carries no `device`, so it can never be a breaker. This
        matters because a shell's name and its row text BOTH say TPN, every time."""
        out = {"db_shell_item": _cell("TPN 7 SEGMENT DB 6WAY")}
        self.assertEqual(extraction.correct_four_pole_mcb_picks(out, _REAL_198_R77, _CAT), [])
        self.assertEqual(out["db_shell_item"]["value"], "TPN 7 SEGMENT DB 6WAY")

    # ---- the honest gap --------------------------------------------------------------
    def test_no_rating_at_or_above_on_that_curve_blanks_the_pick(self):
        """NEGATIVE, INVERTED. The catalogue stocks no FP MCB on the D curve at all. Never approximate
        to another curve and never invent a row -- and never leave a three-pole pick pricing a
        four-pole row: the pick BLANKS (rung 3) and says why, so the row does not price and a human
        decides."""
        # Owner ruling, 2026-09-05: the ladder supersedes "swap, never blank" (2026-08-23). No rating
        # at or above, on that curve, blanks. This pin was INVERTED under that ruling, not silenced.
        row = _row("Incomer 63A TPN MCB D Curve - 1 No")
        out = {"mcb1_item": _cell("63A TP MCB D CURVE")}
        rec = extraction.correct_four_pole_mcb_picks(out, row, _CAT)
        self.assertIsNone(out["mcb1_item"]["value"], "the pick must blank, not stay three-pole")
        self.assertEqual(rec, [{"attr": "mcb1_item", "from": "63A TP MCB D CURVE", "to": None,
                                "reason": "no_rating_at_or_above", "rung": 3}])

    # ---- the other four tokens -------------------------------------------------------
    def test_each_compound_four_pole_token_also_fires(self):
        """POSITIVE. TPN is the token the model misreads, but the correction is defined over the
        whole shipped vocabulary -- owner rulings (2), (3) and (4) fold TP+2N, TP+2NL and TP+NL
        into four pole, and (1) covers 4P / FP / Four Pole."""
        for tok in ["TP+N", "TP+NL", "TP+2N", "TP+2NL", "Four Pole", "4P"]:
            with self.subTest(token=tok):
                row = _row("Incomer 32A %s MCB C Curve - 1 No" % tok)
                out = {"mcb1_item": _cell("32A TP MCB C CURVE")}
                extraction.correct_four_pole_mcb_picks(out, row, _CAT)
                self.assertEqual(out["mcb1_item"]["value"], "32A FP MCB C CURVE")

    def test_spaced_and_lowercase_spellings_still_fire(self):
        """POSITIVE. BoQ text spaces and cases these inconsistently; 'TP + N' and 'tpn' are the
        same claim as 'TP+N' and 'TPN'."""
        for text in ["Incomer 32A TP + N MCB C Curve", "incomer 32a tpn mcb c curve"]:
            with self.subTest(text=text):
                out = {"mcb1_item": _cell("32A TP MCB C CURVE")}
                extraction.correct_four_pole_mcb_picks(out, _row(text), _CAT)
                self.assertEqual(out["mcb1_item"]["value"], "32A FP MCB C CURVE")

    # ---- inertness / gating ----------------------------------------------------------
    def test_no_catalogue_is_a_no_op(self):
        """ABSENT => byte-identical. Every non-composite category passes no catalogue, so the
        correction cannot reach them at all -- the gating discipline this codebase uses."""
        out = {"mcb1_item": _cell("40A TP MCB C CURVE")}
        self.assertEqual(extraction.correct_four_pole_mcb_picks(out, _REAL_198_R77, None), [])
        self.assertEqual(out["mcb1_item"]["value"], "40A TP MCB C CURVE")

    def test_a_pick_that_is_not_in_the_catalogue_is_ignored(self):
        """A value the catalogue does not carry has no attributes to reason from, so there is
        nothing to correct -- and guessing from its NAME is exactly what this slice replaces."""
        out = {"mcb1_item": _cell("99A XP MCB Z CURVE")}
        self.assertEqual(extraction.correct_four_pole_mcb_picks(out, _REAL_198_R77, _CAT), [])

    def test_the_None_sentinel_and_nulls_are_ignored(self):
        """A positively-absent or unread slot is not a pick."""
        out = {"mcb1_item": _cell("None"), "mcb2_item": _cell(None), "mcb3_qty": _cell(3.0)}
        self.assertEqual(extraction.correct_four_pole_mcb_picks(out, _REAL_198_R77, _CAT), [])

    def test_an_already_four_pole_pick_is_left_alone(self):
        """Idempotent: running twice must not report a second change."""
        out = {"mcb1_item": _cell("40A TP MCB C CURVE")}
        first = extraction.correct_four_pole_mcb_picks(out, _REAL_198_R77, _CAT)
        second = extraction.correct_four_pole_mcb_picks(out, _REAL_198_R77, _CAT)
        self.assertEqual(len(first), 1)
        self.assertEqual(second, [], "a corrected pick is already FP and must not re-report")

    def test_only_the_rows_own_text_is_read_never_its_ancestors(self):
        """NEGATIVE, and deliberate. A DB row's ancestor is its board header, which is where TPN
        means the BOARD's phase type. Reading the chain would turn the one context that must not
        fire into the one most likely to."""
        row = _row("Outgoing : 4 Nos. 32A TP MCB of 'C' curve")
        row["ancestors"] = [{"description": "12 Way TPN MCB distribution board"}]
        row["anc_texts"] = ["12 Way TPN MCB distribution board"]
        out = {"mcb1_item": _cell("32A TP MCB C CURVE")}
        self.assertEqual(extraction.correct_four_pole_mcb_picks(out, row, _CAT), [])


class TestRowOwnTextFragments(FrappeTestCase):
    """The fragment surface the adjacency test runs over."""

    def test_description_and_each_note_line_are_separate_fragments(self):
        frags = extraction.row_own_text_fragments(_REAL_198_R77)
        self.assertEqual(frags[0][:20], "Supply, installation")
        self.assertIn('1No - 40A TPN MCB " C " Curve', frags)
        self.assertEqual(len(frags), 7, "one description + six attached note lines")

    def test_appended_notes_are_included_as_their_own_fragments(self):
        frags = extraction.row_own_text_fragments(_row("d", appended={"Spec": "32A TPN MCB"}))
        self.assertIn("32A TPN MCB", frags)

    def test_ancestors_are_not_a_fragment(self):
        row = _row("own text only")
        row["ancestors"] = [{"description": "ancestor text"}]
        self.assertEqual(extraction.row_own_text_fragments(row), ["own text only"])


class TestConductorFloor(FrappeTestCase):
    """SLICE B v4 -- `apply_conductor_floor`, the arithmetic that used to live in R9's prose.

    WHY IT MOVED HERE. The conductor floor is a SUBSTITUTION, and the standing rule on this project
    is that the model reads FACTS while substitutions live in deterministic code. Written as prose it
    cost two prompt cross-talk failures in two days: every `rules` entry shares ONE ESTIMATOR_RULES
    block, so R12's rewrite flipped R13's verdict, and extending R9's floor to NAME the circuit wires
    moved R13's `circuit_wire_included`. Here it is pure arithmetic and cannot reach another rule.

    The function is PURE (a row dict + a groups map in, the row mutated and records out), so every
    case below is a direct call -- no DB, no AI, no fixtures.
    """

    GROUPS = {
        "point": [("wire1_thickness_sqmm", "wire1_core", "wire1_runs"),
                  ("wire2_thickness_sqmm", "wire2_core", "wire2_runs")],
    }

    @staticmethod
    def _w(**kv):
        return {k: {"value": v, "confidence": 0.9} for k, v in kv.items()}

    def _apply(self, **kv):
        row = self._w(**kv)
        recs = extraction.apply_conductor_floor(row, self.GROUPS)
        return row, recs

    def _n(self, row, attr):
        return (row.get(attr) or {}).get("value")

    # ---------- the floor half: nothing is ever reduced ----------
    def test_cf_01_three_core_one_run_is_already_three_and_must_not_move(self):
        """THE CASE THAT KILLED THE FIRST FORMULATION. A 3-core single-run wire carries THREE
        conductors -- 31 corpus rows read exactly that, and their bills say so in words. The earlier
        rule counted RUNS and would have made this 3 runs x 3 cores = NINE conductors (+Rs 133,792
        across the corpus, individual rows up to +194%)."""
        row, recs = self._apply(wire1_core=3, wire1_runs=1, wire1_thickness_sqmm=1.5)
        self.assertEqual(recs, [], "a 3-conductor row must not be touched")
        self.assertEqual(self._n(row, "wire1_runs"), 1)
        self.assertEqual(self._n(row, "wire1_core"), 3)

    def test_cf_02_negative_a_row_above_the_floor_is_untouched(self):
        """A FLOOR, NEVER A CAP. Four corpus rows state six conductors (a three-phase plug point)
        and were read correctly at 0.8-0.95 confidence; coercing them DOWN would have cut Rs 27,535,
        up to -50.6% on one row. At or above three, the document wins."""
        for core1, runs1, core2, runs2 in ((1, 4, 1, 2), (1, 2, 1, 2), (2, 2, 1, 1)):
            row, recs = self._apply(wire1_core=core1, wire1_runs=runs1, wire1_thickness_sqmm=6,
                                    wire2_core=core2, wire2_runs=runs2, wire2_thickness_sqmm=6)
            self.assertEqual(recs, [], "%sc x %sr + %sc x %sr must not move"
                             % (core1, runs1, core2, runs2))
            self.assertEqual(self._n(row, "wire1_runs"), runs1)
            self.assertEqual(self._n(row, "wire2_runs"), runs2)

    def test_cf_03_exactly_three_is_untouched(self):
        row, recs = self._apply(wire1_core=1, wire1_runs=3, wire1_thickness_sqmm=2.5)
        self.assertEqual(recs, [])
        self.assertEqual(self._n(row, "wire1_runs"), 3)

    # ---------- the raising half ----------
    def test_cf_04_single_core_short_takes_runs_and_no_second_wire(self):
        """THE OWNER RULING, AND IT IS NOT COSMETIC. A second wire buys a SECOND install unit
        (`mult_step_divisor` is applied per COMPONENT, never summed across the pair), so 2 runs + 1
        run costs more to install than 3 runs on one wire."""
        row, recs = self._apply(wire1_core=1, wire1_runs=1, wire1_thickness_sqmm=2.5)
        self.assertEqual(self._n(row, "wire1_runs"), 3)
        self.assertIsNone(self._n(row, "wire2_thickness_sqmm"), "NO second wire may be created")
        self.assertEqual([r["action"] for r in recs], ["runs"])

    def test_cf_05_two_single_core_wires_raise_the_bigger_one(self):
        """Owner: always bump up the bigger wire. SIZE decides, not slot order."""
        row, _ = self._apply(wire1_core=1, wire1_runs=1, wire1_thickness_sqmm=1.5,
                             wire2_core=1, wire2_runs=1, wire2_thickness_sqmm=2.5)
        self.assertEqual(self._n(row, "wire1_runs"), 1, "the smaller wire is untouched")
        self.assertEqual(self._n(row, "wire2_runs"), 2, "the BIGGER wire absorbs the shortfall")

    def test_cf_06_multi_core_short_gains_a_one_core_wire_at_the_same_thickness(self):
        """A 2-core wire moves in steps of TWO, so no run count lands on three -- which is exactly
        why this case cannot take runs and must gain a wire instead."""
        row, recs = self._apply(wire1_core=2, wire1_runs=1, wire1_thickness_sqmm=4)
        self.assertEqual(self._n(row, "wire1_core"), 2, "its cores are kept")
        self.assertEqual(self._n(row, "wire1_runs"), 1, "its runs are kept")
        self.assertEqual(self._n(row, "wire2_core"), 1)
        self.assertEqual(self._n(row, "wire2_runs"), 1)
        self.assertEqual(self._n(row, "wire2_thickness_sqmm"), 4, "SAME thickness as the short wire")
        self.assertEqual([r["action"] for r in recs], ["added_wire"])

    # ---------- existence ----------
    def test_cf_07_a_none_thickness_wire_does_not_exist(self):
        """THE TRAP IN THIS DATA, and my own debug script fell into it once. An absent wire still
        carries the MIRRORED DEFAULT `runs = 1`, so a naive sum reports 3 + 1 = 4 for a row that is
        already three conductors on ONE wire. Existence is the THICKNESS, never the runs."""
        row, recs = self._apply(wire1_core=1, wire1_runs=3, wire1_thickness_sqmm=2.5,
                                wire2_core=1, wire2_runs=1, wire2_thickness_sqmm="None")
        self.assertEqual(recs, [], "wire 2 does not exist, so the row is already at three")
        self.assertEqual(self._n(row, "wire1_runs"), 3)
        row, recs = self._apply(wire1_core=1, wire1_runs=2, wire1_thickness_sqmm=2.5,
                                wire2_core=1, wire2_runs=1, wire2_thickness_sqmm="None")
        self.assertEqual(self._n(row, "wire1_runs"), 3, "a genuinely short row IS raised")
        self.assertEqual(self._n(row, "wire2_thickness_sqmm"), "None", "the absent wire stays absent")

    def test_cf_08_negative_no_wire_at_all_never_invents_one(self):
        """A row with no wire on the axis is not short -- it is silent, and inventing a run would
        charge for copper the document never mentions."""
        row, recs = self._apply(wire1_thickness_sqmm="None", wire2_thickness_sqmm="None")
        self.assertEqual(recs, [])
        self.assertIsNone(self._n(row, "wire1_core"))

    def test_cf_09_negative_a_config_declaring_no_group_is_inert(self):
        """CONFIG-DRIVEN, NAMING NO CATEGORY (the HV-10 lesson). Every category but point_wiring
        declares no `conductor_floor`, so this must do nothing for them."""
        row = self._w(wire1_core=1, wire1_runs=1, wire1_thickness_sqmm=2.5)
        self.assertEqual(extraction.apply_conductor_floor(row, {}), [])
        self.assertEqual(extraction.apply_conductor_floor(row, None), [])
        self.assertEqual(self._n(row, "wire1_runs"), 1)

    def test_cf_10_the_groups_are_read_from_config_and_both_axes_are_independent(self):
        """`conductor_floor_groups` reads the block off each THICKNESS definition. Both axes are
        declared, and each reaches three ON ITS OWN -- neither pair is ever added to the other."""
        cfg = {"attribute_definitions": [
            {"id": "wire1_thickness_sqmm",
             "conductor_floor": {"group": "point", "core_attr": "wire1_core",
                                 "runs_attr": "wire1_runs"}},
            {"id": "circuit_wire1_thickness_sqmm",
             "conductor_floor": {"group": "circuit", "core_attr": "circuit_wire1_core",
                                 "runs_attr": "circuit_wire1_runs"}},
            {"id": "colour"},
        ]}
        groups = extraction.conductor_floor_groups(cfg)
        self.assertEqual(sorted(groups), ["circuit", "point"])
        row = self._w(wire1_core=1, wire1_runs=3, wire1_thickness_sqmm=2.5,
                      circuit_wire1_core=1, circuit_wire1_runs=1, circuit_wire1_thickness_sqmm=4)
        extraction.apply_conductor_floor(row, groups)
        self.assertEqual(self._n(row, "wire1_runs"), 3, "the point axis was already at three")
        self.assertEqual(self._n(row, "circuit_wire1_runs"), 3, "the circuit axis is raised alone")

    def test_cf_11_negative_a_malformed_declaration_is_ignored_not_guessed(self):
        """Attribute-definition keys carry no backend type guard, so a malformed block must degrade
        to no-group rather than half-configuring a floor."""
        for bad in ({"group": "point"}, {"core_attr": "c", "runs_attr": "r"},
                    {"group": "", "core_attr": "c", "runs_attr": "r"}, "not-a-dict"):
            cfg = {"attribute_definitions": [{"id": "t", "conductor_floor": bad}]}
            self.assertEqual(extraction.conductor_floor_groups(cfg), {}, repr(bad))


# ---------------------------------------------------------------------------------------
# F-30 SLICE A -- THE POLES-PLUS-NEUTRAL LADDER (SPN family + TPN family), db_switchgear
# ---------------------------------------------------------------------------------------
#
# Owner rulings (2026-09-05): "for any pole + Neutral, should be matched with next higher pole:
# SPN with DP, TPN with 4p"; "we need to first match with SPN in catalog, if that is not there
# then we match with DP" (and the same ordering for TPN); "still build it so that if we later
# add SPN in catalog it gets matched first"; a rating the catalogue does not carry -> "next
# rating". The ladder: RUNG 1 a row whose structured `pole` is literally "SPN"/"TPN" at the
# same device/amp/curve; RUNG 2 count the neutral (SPN->DP, TPN->FP) at the same curve, exact
# amp else the NEXT amp UP, never down; RUNG 3 blank.
#
# The fixture EXTENDS `_CAT` with the SP/DP rows the live catalogue carries (SP at every amp,
# DP only from 25 A up), and keeps its structure: MCB is the only device with SP/DP/TP/FP rows,
# RCCB/RCBO are DP/FP only, shells carry no `device`. The two OWNER-RULED throwaway rows (pole
# "SPN" / pole "TPN") are added PER TEST, never to the base fixture, so every rung-2 pin runs
# against a catalogue that does not carry them -- exactly today's live catalogue.
_CAT_LADDER = dict(_CAT)
_CAT_LADDER.update({
    "16A SP MCB D CURVE": {"family": "Switchgear", "item": "16A SP MCB D CURVE",
                           "device": "MCB", "pole": "SP", "amp_a": 16.0, "curve": "D"},
    "40A SP MCB C CURVE": {"family": "Switchgear", "item": "40A SP MCB C CURVE",
                           "device": "MCB", "pole": "SP", "amp_a": 40.0, "curve": "C"},
    "40A SP MCB D CURVE": {"family": "Switchgear", "item": "40A SP MCB D CURVE",
                           "device": "MCB", "pole": "SP", "amp_a": 40.0, "curve": "D"},
    "63A SP MCB D CURVE": {"family": "Switchgear", "item": "63A SP MCB D CURVE",
                           "device": "MCB", "pole": "SP", "amp_a": 63.0, "curve": "D"},
    "32A SP MCB B CURVE": {"family": "Switchgear", "item": "32A SP MCB B CURVE",
                           "device": "MCB", "pole": "SP", "amp_a": 32.0, "curve": "B"},
    "25A DP MCB D CURVE": {"family": "Switchgear", "item": "25A DP MCB D CURVE",
                           "device": "MCB", "pole": "DP", "amp_a": 25.0, "curve": "D"},
    "40A DP MCB C CURVE": {"family": "Switchgear", "item": "40A DP MCB C CURVE",
                           "device": "MCB", "pole": "DP", "amp_a": 40.0, "curve": "C"},
    "40A DP MCB D CURVE": {"family": "Switchgear", "item": "40A DP MCB D CURVE",
                           "device": "MCB", "pole": "DP", "amp_a": 40.0, "curve": "D"},
    "63A DP MCB C CURVE": {"family": "Switchgear", "item": "63A DP MCB C CURVE",
                           "device": "MCB", "pole": "DP", "amp_a": 63.0, "curve": "C"},
    # DELIBERATELY NO DP row at B curve, and NO DP row at or above 63 A on D curve.
    # the live catalogue's THREE mA variants of a residual-current device at one amp and pole --
    # what makes a counted-pole re-selection AMBIGUOUS for RCCB/RCBO, and why the ladder must not
    # enter from an already-FP residual-current pick (see the silence pin)
    "40A RCCB 30mA (FP)": {"family": "Switchgear", "item": "40A RCCB 30mA (FP)",
                           "device": "RCCB", "pole": "FP", "amp_a": 40.0, "curve": "NA"},
    "40A RCCB 300mA (FP)": {"family": "Switchgear", "item": "40A RCCB 300mA (FP)",
                            "device": "RCCB", "pole": "FP", "amp_a": 40.0, "curve": "NA"},
    # a shell NAMED SPN -- the row the ladder must never reach
    "SPN DB 8WAY": {"family": "DB", "item": "SPN DB 8WAY"},
})
# The two owner-ruled throwaway rows, in the shape a real import would give them.
_SPN_FIXTURE = {"40A SPN MCB C CURVE": {"family": "Switchgear", "item": "40A SPN MCB C CURVE",
                                        "device": "MCB", "pole": "SPN", "amp_a": 40.0, "curve": "C"}}
_TPN_FIXTURE = {"40A TPN MCB C CURVE": {"family": "Switchgear", "item": "40A TPN MCB C CURVE",
                                        "device": "MCB", "pole": "TPN", "amp_a": 40.0, "curve": "C"}}

# The live SPN population for this slice, verbatim (BOQ-26-00193 r135/136/138 share the wording).
_REAL_193_R135 = _row(
    "Supply Installation and commossioing Sheet metal enclosed 8 way SPN DB with 6 Nos of "
    "10/16/20/32 amps SP MCB's i.e. 6 Nos of 16 amp SP MCB's arranged in 1 rows and controlled by "
    "1 No. 40 amp SPN MCB and neutral link. (Also provide 1 nos. 40 amp DP RCCB of 300 mA "
    "Sensitivity for each phase)")
_REAL_015_R311 = _row(
    "3ø, 4Way, ETPN DB with PPI KIT for Hubrooms",
    attached=["Incoming -40A 3Pole MCB with Double NL",
              "Replaceable cartridge type 15kA 3P+N Surge Suppressor",
              "Sub incommer: 3No.s. 40A DP MCB (D' curve) for each phase",
              "Outgoings: 6No.s.10/16A SPN MCB ( 'D' curve)", "Supply & Installation"])


class TestSpnFamilyVocabulary(FrappeTestCase):
    """Where the SPN-family spellings come from, and why that is not a second drifting copy."""

    def test_the_spn_tokens_are_a_code_constant_longest_first(self):
        """POSITIVE. The prompt's POLE line carries no SPN breaker clause (the model correctly
        reports SP for an SPN row -- reading, not counting), so there is nothing in the prompt to
        read the SPN vocabulary FROM. It is a code-side constant, the `_BOARD_WORDS_AFTER_DEVICE`
        precedent, ordered longest-first so "SP+N" can never truncate "SP+NL"."""
        toks = extraction.spn_family_tokens()
        self.assertEqual(toks, ["SP+NL", "SP+N", "SP&N", "SPN", "1P+N"])
        self.assertEqual(len(toks[0]), max(len(t) for t in toks), "the longest token must come first")

    def test_the_prompt_carries_no_spn_breaker_clause(self):
        """NEGATIVE -- THE ANTI-DRIFT PIN, inverted. The reason the SPN list may live in code is
        that the prompt says NOTHING about SPN as a breaker pole. The day someone adds an
        `"SPN" -> DP` clause to the POLE line there WOULD be two vocabularies, and this pin is
        what makes that day loud: reconcile the two, do not let them drift."""
        line = next(ln for ln in extraction._read_prompt(extraction._DECOMPOSITION_PROMPT_PATH)
                    .splitlines() if ln.lstrip().startswith("- POLE"))
        for tok in extraction.spn_family_tokens():
            self.assertNotIn('"%s" ->' % tok, line,
                             "%r has gained a prompt clause -- the code constant and the prompt "
                             "must be reconciled, not left to drift" % tok)
        # and the TPN family still comes from the prompt, not from code
        self.assertEqual(extraction.four_pole_tokens()[:5], ["TP+2NL", "TP+2N", "TP+NL", "TP+N", "TPN"])

    def test_the_two_families_are_tpn_then_spn(self):
        """The ladder walks TPN first (today's behaviour, byte-identical) and SPN second; each
        family names its stated pole, its counted pole and the literal `pole` value rung 1 looks
        for."""
        fams = extraction.pole_plus_neutral_families()
        self.assertEqual([f["family"] for f in fams], ["TPN", "SPN"])
        self.assertEqual((fams[0]["stated_pole"], fams[0]["counted_pole"], fams[0]["named_pole"]),
                         ("TP", "FP", "TPN"))
        self.assertEqual((fams[1]["stated_pole"], fams[1]["counted_pole"], fams[1]["named_pole"]),
                         ("SP", "DP", "SPN"))

    def test_the_legacy_name_is_the_ladder(self):
        """`correct_four_pole_mcb_picks` is kept as the call-site and test name; it IS the
        ladder, not a second implementation."""
        self.assertIs(extraction.correct_four_pole_mcb_picks, extraction.apply_pole_plus_neutral_ladder)


class TestPolePlusNeutralLadderSpn(FrappeTestCase):
    """The SPN family through the ladder. Pure: pick + row text + catalogue dict in."""

    # ---- RUNG 2 -- today's catalogue carries no SPN pole, so the neutral is counted ----
    def test_real_193_r135_rung_2_swaps_sp_to_dp_same_amp_same_curve(self):
        """POSITIVE. '40 amp SPN MCB' picked as 40A SP C -> 40A DP C. The record is the plain
        three-key swap, exactly the shape the TPN swap has always had."""
        out = {"mcb2_item": _cell("40A SP MCB C CURVE")}
        rec = extraction.correct_four_pole_mcb_picks(out, _REAL_193_R135, _CAT_LADDER)
        self.assertEqual(out["mcb2_item"]["value"], "40A DP MCB C CURVE")
        self.assertEqual(rec, [{"attr": "mcb2_item", "from": "40A SP MCB C CURVE",
                                "to": "40A DP MCB C CURVE"}])

    def test_real_015_r311_rung_2_goes_up_to_the_next_amp_and_says_so(self):
        """POSITIVE -- the next-rating case. The note reads '10/16A SPN MCB (D curve)', picked as
        16A SP D. There is no DP row below 25 A, so the ladder lands on 25A DP D and RECORDS that
        the amp moved up, 16 -> 25 -- the fact the panel must be able to say in words."""
        out = {"mcb1_item": _cell("16A SP MCB D CURVE")}
        rec = extraction.correct_four_pole_mcb_picks(out, _REAL_015_R311, _CAT_LADDER)
        self.assertEqual(out["mcb1_item"]["value"], "25A DP MCB D CURVE")
        self.assertEqual(rec, [{"attr": "mcb1_item", "from": "16A SP MCB D CURVE",
                                "to": "25A DP MCB D CURVE",
                                "amp_moved_up": {"from": 16.0, "to": 25.0}}])

    def test_rung_2_never_goes_down_an_amp(self):
        """NEGATIVE. 63A SPN on D curve: DP D exists at 25 and 40 only, both BELOW. Never down
        -> rung 3, blank."""
        out = {"mcb1_item": _cell("63A SP MCB D CURVE")}
        rec = extraction.correct_four_pole_mcb_picks(out, _row("Incomer 63A SPN MCB D curve"),
                                                     _CAT_LADDER)
        self.assertIsNone(out["mcb1_item"]["value"], "40A DP would be DOWN; the pick must blank")
        self.assertEqual(rec[0]["reason"], "no_rating_at_or_above")

    def test_rung_2_takes_the_exact_amp_when_it_exists_not_the_next(self):
        """POSITIVE. 40A SPN on D curve: 40A DP D exists, so no move-up record."""
        out = {"mcb1_item": _cell("40A SP MCB D CURVE")}
        rec = extraction.correct_four_pole_mcb_picks(out, _row("Incomer 40A SPN MCB D curve"),
                                                     _CAT_LADDER)
        self.assertEqual(out["mcb1_item"]["value"], "40A DP MCB D CURVE")
        self.assertNotIn("amp_moved_up", rec[0])

    # ---- RUNG 3 -- blank, only when the curve carries nothing at or above ----
    def test_rung_3_blanks_when_the_curve_has_no_two_pole_rating_at_all(self):
        """NEGATIVE. 32A SPN on B curve: the catalogue has no DP row at B. The pick is BLANKED
        (value None) so the row does not price and a human decides -- and the reason is
        recorded."""
        out = {"mcb1_item": _cell("32A SP MCB B CURVE")}
        rec = extraction.correct_four_pole_mcb_picks(out, _row("Outgoing 32A SPN MCB B curve"),
                                                     _CAT_LADDER)
        self.assertIsNone(out["mcb1_item"]["value"])
        self.assertEqual(rec, [{"attr": "mcb1_item", "from": "32A SP MCB B CURVE", "to": None,
                                "reason": "no_rating_at_or_above", "rung": 3}])

    def test_the_curve_is_never_changed_by_any_rung(self):
        """NEGATIVE. 63A SPN on D curve: a 63A DP row EXISTS -- at C curve. The ladder must not
        borrow it; with nothing at or above 63 A on D the pick blanks instead."""
        self.assertIn("63A DP MCB C CURVE", _CAT_LADDER)
        out = {"mcb1_item": _cell("63A SP MCB D CURVE")}
        extraction.correct_four_pole_mcb_picks(out, _row("Incomer 63A SPN MCB D curve"), _CAT_LADDER)
        self.assertIsNone(out["mcb1_item"]["value"], "the C-curve row must not serve a D-curve pick")

    # ---- RUNG 1 -- the owner's forward-compatibility ruling ----
    def test_rung_1_selects_a_catalogue_row_whose_pole_is_literally_spn(self):
        """POSITIVE. With a row carrying pole "SPN" at 40 A C, an SP pick on '40 amp SPN MCB'
        goes to THAT row, not to DP -- rung 1 outranks rung 2."""
        cat = dict(_CAT_LADDER); cat.update(_SPN_FIXTURE)
        out = {"mcb2_item": _cell("40A SP MCB C CURVE")}
        rec = extraction.correct_four_pole_mcb_picks(out, _REAL_193_R135, cat)
        self.assertEqual(out["mcb2_item"]["value"], "40A SPN MCB C CURVE")
        self.assertEqual(rec, [{"attr": "mcb2_item", "from": "40A SP MCB C CURVE",
                                "to": "40A SPN MCB C CURVE", "rung": 1}])

    def test_rung_1_also_lifts_an_already_two_pole_pick_onto_the_spn_row(self):
        """POSITIVE. If the model had picked DP, the named row still wins."""
        cat = dict(_CAT_LADDER); cat.update(_SPN_FIXTURE)
        out = {"mcb2_item": _cell("40A DP MCB C CURVE")}
        extraction.correct_four_pole_mcb_picks(out, _REAL_193_R135, cat)
        self.assertEqual(out["mcb2_item"]["value"], "40A SPN MCB C CURVE")

    def test_rung_1_is_exact_on_amp_and_curve(self):
        """NEGATIVE. The SPN fixture is 40 A C. A 40 A D pick does NOT take it (curve differs)
        and falls to rung 2 -> 40A DP D; a 16 A D pick does NOT take it either -> 25A DP D."""
        cat = dict(_CAT_LADDER); cat.update(_SPN_FIXTURE)
        out = {"mcb1_item": _cell("40A SP MCB D CURVE")}
        extraction.correct_four_pole_mcb_picks(out, _row("Incomer 40A SPN MCB D curve"), cat)
        self.assertEqual(out["mcb1_item"]["value"], "40A DP MCB D CURVE")
        out = {"mcb1_item": _cell("16A SP MCB D CURVE")}
        extraction.correct_four_pole_mcb_picks(out, _REAL_015_R311, cat)
        self.assertEqual(out["mcb1_item"]["value"], "25A DP MCB D CURVE")

    def test_rung_1_never_reaches_a_shell_named_spn(self):
        """NEGATIVE, the engineering call. 54 live rows are NAMED SPN/TPN/VTPN and every one is a
        DB shell with no `pole` key. Rung 1 matches the structured `pole` FIELD, so with only the
        shell present the SPN row goes to rung 2 (DP), and the shell pick itself is untouched."""
        out = {"db_shell_item": _cell("SPN DB 8WAY"), "mcb2_item": _cell("40A SP MCB C CURVE")}
        rec = extraction.correct_four_pole_mcb_picks(out, _REAL_193_R135, _CAT_LADDER)
        self.assertEqual(out["db_shell_item"]["value"], "SPN DB 8WAY")
        self.assertEqual(out["mcb2_item"]["value"], "40A DP MCB C CURVE")
        self.assertEqual([r["attr"] for r in rec], ["mcb2_item"])

    def test_a_rung_1_pick_is_idempotent(self):
        cat = dict(_CAT_LADDER); cat.update(_SPN_FIXTURE)
        out = {"mcb2_item": _cell("40A SP MCB C CURVE")}
        extraction.correct_four_pole_mcb_picks(out, _REAL_193_R135, cat)
        self.assertEqual(extraction.correct_four_pole_mcb_picks(out, _REAL_193_R135, cat), [])

    # ---- the guards carry over unchanged ----
    def test_the_board_name_guard_holds_for_spn(self):
        """NEGATIVE. '8 Way SPN MCB DB' names a board; its SP MCB outgoings must not move."""
        out = {"mcb1_item": _cell("40A SP MCB C CURVE")}
        self.assertEqual(extraction.correct_four_pole_mcb_picks(
            out, _row("8 Way SPN MCB DB", attached=["Incomer : 1No. 40A SP MCB"]), _CAT_LADDER), [])
        self.assertEqual(out["mcb1_item"]["value"], "40A SP MCB C CURVE")

    def test_the_adjacency_window_holds_for_spn(self):
        """NEGATIVE. SPN six words away from the device word is outside the 3-word window."""
        out = {"mcb1_item": _cell("40A SP MCB C CURVE")}
        row = _row("12 Way SPN type board fitted with one two 40A SP MCB outgoing")
        self.assertEqual(extraction.correct_four_pole_mcb_picks(out, row, _CAT_LADDER), [])

    def test_only_the_rows_own_text_is_read_for_spn(self):
        """NEGATIVE. An ancestor board header saying SPN must not fire on a child SP MCB row."""
        row = _row("Outgoing : 6 Nos. 40A SP MCB of 'C' curve")
        row["ancestors"] = [{"description": "12 Way SPN MCB distribution board"}]
        row["anc_texts"] = ["12 Way SPN MCB distribution board"]
        out = {"mcb1_item": _cell("40A SP MCB C CURVE")}
        self.assertEqual(extraction.correct_four_pole_mcb_picks(out, row, _CAT_LADDER), [])

    def test_a_bare_sp_row_never_moves(self):
        """NEGATIVE, the one that matters. 'SP' without a neutral is single pole and stays so."""
        out = {"mcb1_item": _cell("40A SP MCB C CURVE")}
        self.assertEqual(extraction.correct_four_pole_mcb_picks(
            out, _row("Outgoing : 6 Nos. 40A SP MCB of 'C' curve"), _CAT_LADDER), [])
        self.assertEqual(out["mcb1_item"]["value"], "40A SP MCB C CURVE")

    def test_residual_current_devices_are_untouched_by_spn(self):
        """NEGATIVE, structural. RCCB/RCBO carry no SP row, so an SPN-worded RCBO pick has
        nothing to ladder from; it is left exactly alone."""
        out = {"mcb1_item": _cell("32A RCBO 30mA (DP)")}
        self.assertEqual(extraction.correct_four_pole_mcb_picks(
            out, _row("Incomer 32A SPN RCBO 30mA"), _CAT_LADDER), [])
        self.assertEqual(out["mcb1_item"]["value"], "32A RCBO 30mA (DP)")

    # ---- FOUND ON THE LIVE CERT (2026-09-05), the row-wide over-fire ------------------------
    def test_only_the_pick_whose_amp_the_spn_token_names_is_laddered(self):
        """NEGATIVE, found on screen. BOQ-26-00193 r135 names '6 Nos of 16 amp SP MCB's' (single
        pole, genuinely) AND 'controlled by 1 No. 40 amp SPN MCB'. The first run laddered BOTH SP
        picks -- the 16 A outgoings became 25A DP D with an amp-moved-up note -- because the
        adjacency test was row-wide. The ruling is 'a breaker whose OWN row text names IT': the
        token is anchored to the amp stated beside it, so only the 40 A pick moves."""
        out = {"mcb1_item": _cell("16A SP MCB D CURVE"), "mcb2_item": _cell("40A SP MCB D CURVE")}
        rec = extraction.correct_four_pole_mcb_picks(out, _REAL_193_R135, _CAT_LADDER)
        self.assertEqual(out["mcb1_item"]["value"], "16A SP MCB D CURVE", "the SP outgoings must not move")
        self.assertEqual(out["mcb2_item"]["value"], "40A DP MCB D CURVE")
        self.assertEqual([r["attr"] for r in rec], ["mcb2_item"])

    def test_a_range_beside_the_token_anchors_every_amp_in_it(self):
        """POSITIVE. '6No.s.10/16A SPN MCB' names 10 and 16; a 16 A pick is the named breaker."""
        out = {"mcb1_item": _cell("16A SP MCB D CURVE"), "mcb2_item": _cell("40A SP MCB D CURVE")}
        rec = extraction.correct_four_pole_mcb_picks(out, _REAL_015_R311, _CAT_LADDER)
        self.assertEqual(out["mcb1_item"]["value"], "25A DP MCB D CURVE")
        self.assertEqual(out["mcb2_item"]["value"], "40A SP MCB D CURVE", "40 A is not named beside SPN")
        self.assertEqual([r["attr"] for r in rec], ["mcb1_item"])

    def test_the_fallback_does_not_fire_when_the_named_breaker_is_already_accounted_for(self):
        """NEGATIVE, found on the live cert (C4). With the SPN fixture in the catalogue the model
        picked '40A SPN MCB D CURVE' ITSELF for the incomer, and returned the outgoings as 32A SP.
        32 is not the named amp, so the row-wide fallback laddered the outgoings to 32A DP -- the
        over-fire again by another door. The fallback exists for '45A TPN' fitted to 63 A, where NO
        pick on the row carries the named amp; when a pick DOES (here the SPN row at 40 A, already
        resolved), the named breaker is accounted for and nothing else on the row may move."""
        cat = dict(_CAT_LADDER); cat.update({"40A SPN MCB D CURVE": {"family": "Switchgear", "item": "40A SPN MCB D CURVE",
                                                                    "device": "MCB", "pole": "SPN", "amp_a": 40.0, "curve": "D"}})
        cat["32A SP MCB D CURVE"] = {"family": "Switchgear", "item": "32A SP MCB D CURVE", "device": "MCB", "pole": "SP", "amp_a": 32.0, "curve": "D"}
        cat["32A DP MCB D CURVE"] = {"family": "Switchgear", "item": "32A DP MCB D CURVE", "device": "MCB", "pole": "DP", "amp_a": 32.0, "curve": "D"}
        out = {"mcb1_item": _cell("32A SP MCB D CURVE"), "mcb2_item": _cell("40A SPN MCB D CURVE")}
        self.assertEqual(extraction.correct_four_pole_mcb_picks(out, _REAL_193_R135, cat), [])
        self.assertEqual(out["mcb1_item"]["value"], "32A SP MCB D CURVE", "the SP outgoings must not move")
        self.assertEqual(out["mcb2_item"]["value"], "40A SPN MCB D CURVE")

    def test_no_amp_beside_the_token_falls_back_to_the_row_wide_rule(self):
        """REGRESSION guard for today's behaviour. 'TPN MCB with weather proof enclosure' names no
        amp, so the anchor has nothing to hold and every stated-pole pick is laddered, exactly as
        before -- the fallback is what keeps TPN byte-identical."""
        out = {"mcb1_item": _cell("32A TP MCB C CURVE")}
        extraction.correct_four_pole_mcb_picks(
            out, _row("Supply, erection, testing and commissioning of TPN MCB with weather proof enclosure"), _CAT_LADDER)
        self.assertEqual(out["mcb1_item"]["value"], "32A FP MCB C CURVE")

    def test_a_named_amp_that_matches_no_pick_falls_back_too(self):
        """REGRESSION guard. '45A TPN MCB' -> the model fits 63 A (next higher); 45 matches no pick,
        so the fallback ladders the one TP pick, as today."""
        out = {"mcb1_item": _cell("63A TP MCB D CURVE")}
        cat = dict(_CAT_LADDER); cat["63A FP MCB D CURVE"] = {"family": "Switchgear", "item": "63A FP MCB D CURVE",
                                                              "device": "MCB", "pole": "FP", "amp_a": 63.0, "curve": "D"}
        extraction.correct_four_pole_mcb_picks(out, _row("Incomer 45A TPN MCB D curve"), cat)
        self.assertEqual(out["mcb1_item"]["value"], "63A FP MCB D CURVE")

    def test_every_spn_spelling_fires(self):
        for tok in ["SPN", "SP+N", "SP + N", "SP+NL", "SP&N", "1P+N", "spn"]:
            with self.subTest(token=tok):
                out = {"mcb1_item": _cell("40A SP MCB C CURVE")}
                extraction.correct_four_pole_mcb_picks(out, _row("Incomer 40A %s MCB C curve" % tok),
                                                       _CAT_LADDER)
                self.assertEqual(out["mcb1_item"]["value"], "40A DP MCB C CURVE")


class TestPoleLadderStamp(FrappeTestCase):
    """FOUND ON THE LIVE CERT (C3, 2026-09-05): the `pole_ladder` marker was written to `row_map`,
    which is the CAPTURE-log map (observation only), never to the RESULT cell the run stores and
    the panel reads -- so the rating-up sentence could not render. `stamp_pole_ladder` writes it on
    the result cell, exactly as `defaulted` rides there, and this pins the contract the frontend's
    `ratingUpNote` consumes."""

    def test_an_amp_move_is_stamped_on_the_result_cell(self):
        out = {"mcb1_item": _cell("16A SP MCB D CURVE")}
        recs = extraction.correct_four_pole_mcb_picks(out, _REAL_015_R311, _CAT_LADDER)
        extraction.stamp_pole_ladder(out, recs)
        self.assertEqual(out["mcb1_item"]["pole_ladder"],
                         {"amp_moved_up": {"from": 16.0, "to": 25.0}, "to": "25A DP MCB D CURVE"})
        self.assertEqual(out["mcb1_item"]["value"], "25A DP MCB D CURVE")

    def test_a_plain_same_amp_swap_stamps_nothing(self):
        """NEGATIVE. A plain TPN/SPN swap carries no extras, so the stored cell stays byte-identical
        to before this slice -- the marker exists to explain a CHANGE of rating, not a swap."""
        out = {"mcb2_item": _cell("40A SP MCB C CURVE")}
        recs = extraction.correct_four_pole_mcb_picks(out, _REAL_193_R135, _CAT_LADDER)
        extraction.stamp_pole_ladder(out, recs)
        self.assertEqual(out["mcb2_item"]["value"], "40A DP MCB C CURVE")
        self.assertNotIn("pole_ladder", out["mcb2_item"])
        # and the TPN real row, the same way
        out = {"mcb1_item": _cell("40A TP MCB C CURVE")}
        extraction.stamp_pole_ladder(out, extraction.correct_four_pole_mcb_picks(out, _REAL_198_R77, _CAT_LADDER))
        self.assertNotIn("pole_ladder", out["mcb1_item"])

    def test_a_rung_1_hit_and_a_blank_are_stamped_with_their_reason(self):
        cat = dict(_CAT_LADDER); cat.update(_SPN_FIXTURE)
        out = {"mcb2_item": _cell("40A SP MCB C CURVE")}
        extraction.stamp_pole_ladder(out, extraction.correct_four_pole_mcb_picks(out, _REAL_193_R135, cat))
        self.assertEqual(out["mcb2_item"]["pole_ladder"], {"rung": 1, "to": "40A SPN MCB C CURVE"})
        out = {"mcb1_item": _cell("32A SP MCB B CURVE")}
        extraction.stamp_pole_ladder(out, extraction.correct_four_pole_mcb_picks(out, _row("Outgoing 32A SPN MCB B curve"), _CAT_LADDER))
        self.assertEqual(out["mcb1_item"]["pole_ladder"], {"reason": "no_rating_at_or_above", "rung": 3, "to": None})
        self.assertIsNone(out["mcb1_item"]["value"])

    def test_no_records_stamps_nothing_and_an_unknown_attr_is_ignored(self):
        out = {"mcb1_item": _cell("40A SP MCB C CURVE")}
        extraction.stamp_pole_ladder(out, [])
        extraction.stamp_pole_ladder(out, [{"attr": "ghost_item", "from": "x", "to": "y", "rung": 1}])
        self.assertNotIn("pole_ladder", out["mcb1_item"])
        self.assertNotIn("ghost_item", out)


class TestPolePlusNeutralLadderTpn(FrappeTestCase):
    """The TPN family: rung 1 reachable only with the throwaway fixture, and today's outcomes
    byte-identical without it."""

    def test_tpn_outcomes_are_byte_identical_on_the_existing_fixtures(self):
        """REGRESSION. The three real mis-routed rows and the six real bare-TP rows produce
        exactly the records they produced before the ladder existed."""
        expected = []
        for name, row, picked in [("198 r77", _REAL_198_R77, "40A TP MCB C CURVE"),
                                  ("198 r88", _REAL_198_R88, "40A TP MCB C CURVE"),
                                  ("200 r77", _REAL_200_R77, "32A TP MCB C CURVE")]:
            out = {"mcb1_item": _cell(picked)}
            rec = extraction.correct_four_pole_mcb_picks(out, row, _CAT_LADDER)
            expected.append((name, out["mcb1_item"]["value"], rec))
        self.assertEqual(expected, [
            ("198 r77", "40A FP MCB C CURVE",
             [{"attr": "mcb1_item", "from": "40A TP MCB C CURVE", "to": "40A FP MCB C CURVE"}]),
            ("198 r88", "40A FP MCB C CURVE",
             [{"attr": "mcb1_item", "from": "40A TP MCB C CURVE", "to": "40A FP MCB C CURVE"}]),
            ("200 r77", "32A FP MCB C CURVE",
             [{"attr": "mcb1_item", "from": "32A TP MCB C CURVE", "to": "32A FP MCB C CURVE"}]),
        ])
        for name, row, picked in _REAL_BARE_TP:
            with self.subTest(row=name):
                out = {"mcb1_item": _cell(picked)}
                self.assertEqual(extraction.correct_four_pole_mcb_picks(out, row, _CAT_LADDER), [])
                self.assertEqual(out["mcb1_item"]["value"], picked)

    def test_rung_1_selects_a_row_whose_pole_is_literally_tpn(self):
        """POSITIVE. With the TPN fixture present, the 198 r77 incomer goes to the TPN row, not
        to FP -- and an FP pick on the same text is lifted onto it too."""
        cat = dict(_CAT_LADDER); cat.update(_TPN_FIXTURE)
        out = {"mcb1_item": _cell("40A TP MCB C CURVE")}
        rec = extraction.correct_four_pole_mcb_picks(out, _REAL_198_R77, cat)
        self.assertEqual(out["mcb1_item"]["value"], "40A TPN MCB C CURVE")
        self.assertEqual(rec[0]["rung"], 1)
        out = {"mcb1_item": _cell("40A FP MCB C CURVE")}
        extraction.correct_four_pole_mcb_picks(out, _REAL_198_R77, cat)
        self.assertEqual(out["mcb1_item"]["value"], "40A TPN MCB C CURVE")

    def test_rung_1_never_reaches_a_shell_named_tpn(self):
        """NEGATIVE. The base fixture carries 'TPN 7 SEGMENT DB 6WAY' (no pole key); without a
        pole-TPN breaker the incomer goes to rung 2 (FP), and the shell is untouched."""
        out = {"db_shell_item": _cell("TPN 7 SEGMENT DB 6WAY"), "mcb1_item": _cell("40A TP MCB C CURVE")}
        extraction.correct_four_pole_mcb_picks(out, _REAL_198_R77, _CAT_LADDER)
        self.assertEqual(out["db_shell_item"]["value"], "TPN 7 SEGMENT DB 6WAY")
        self.assertEqual(out["mcb1_item"]["value"], "40A FP MCB C CURVE")

    def test_rung_2_goes_up_an_amp_for_tpn_too(self):
        """POSITIVE. A 25A TP C pick with FP C only at 32/40 -> 32A FP C, move-up recorded."""
        cat = dict(_CAT_LADDER)
        cat["25A TP MCB C CURVE"] = {"family": "Switchgear", "item": "25A TP MCB C CURVE",
                                    "device": "MCB", "pole": "TP", "amp_a": 25.0, "curve": "C"}
        out = {"mcb1_item": _cell("25A TP MCB C CURVE")}
        rec = extraction.correct_four_pole_mcb_picks(out, _row("Incomer 25A TPN MCB C curve"), cat)
        self.assertEqual(out["mcb1_item"]["value"], "32A FP MCB C CURVE")
        self.assertEqual(rec[0]["amp_moved_up"], {"from": 25.0, "to": 32.0})

    def test_a_four_pole_residual_current_pick_beside_4p_text_stays_silent(self):
        """NEGATIVE -- FOUND ON LIVE DATA, not invented. 46 stored rows read '40A FP 30mA, RCBO'
        or '63A 4P RCCB': the pick is already FP and today's code never touches it, emits
        nothing. The ladder must enter from a COUNTED-pole pick ONLY when a named-pole (rung 1)
        row exists for it -- otherwise the three mA variants at rung 2 look ambiguous and a
        marker appears on rows that never had one."""
        for text, picked in [("40A FP 30mA, RCBO", "32A RCBO 30mA (DP)"),
                             ("25A, 4P RCCB @ 300mA - VRF Unit", "40A RCCB 100mA (FP)"),
                             ("Incomer 40A FP RCCB 100mA", "40A RCCB 100mA (FP)")]:
            with self.subTest(text=text):
                out = {"mcb1_item": _cell(picked)}
                self.assertEqual(extraction.correct_four_pole_mcb_picks(out, _row(text), _CAT_LADDER), [])
                self.assertEqual(out["mcb1_item"]["value"], picked)

    def test_an_fp_pick_with_tpn_text_and_no_tpn_row_is_untouched(self):
        """NEGATIVE. Today's idempotence, restated under the ladder: rung 1 has nothing, rung 2
        resolves to the pick itself, no record."""
        out = {"mcb1_item": _cell("40A FP MCB C CURVE")}
        self.assertEqual(extraction.correct_four_pole_mcb_picks(out, _REAL_198_R77, _CAT_LADDER), [])


class TestFillPairedSlotDefaults(FrappeTestCase):
    """PAIRED-QUANTITY FILL (owner rulings 2026-09-07) -- the scrub's mirror.

    Owner, verbatim: "if the item is filled but qty is blank then it should be populated default 1.
    when item is none or blank it, the default qty rule sshould not be applied"; the blank-plate-but-
    computed case: "this should be included"; and "it fills 1 only when it is blank".

    Measured before building (all 372 switches_sockets rows in the 40 active runs): case (a) -- item
    FILLED, qty BLANK -- is ZERO across all six pairs; case (b) -- plate BLANK, qty BLANK, an occupant
    named -- is 54 rows (30 of them priced only after a pricer typed the 1). The 18 blank-plate rows
    with NO occupant and the 20 "None" plates are untouched by construction.
    """

    DEFAULTS = {
        "switch_qty": {"default": 1.0, "requires_named": "switch_item"},
        "socket1_qty": {"default": 1.0, "requires_named": "socket1_item"},
        "socket2_qty": {"default": 1.0, "requires_named": "socket2_item"},
        "socket3_qty": {"default": 1.0, "requires_named": "socket3_item"},
        "socket4_qty": {"default": 1.0, "requires_named": "socket4_item"},
        "plate_qty": {"default": 1.0, "requires_named": "plate_item"},
        "back_box": "Yes",           # plain defaults, no pairing
        "colour": "White",
    }
    # The switches_sockets module_fit shape (asserted against the live asset in test_plan_from_live_configs).
    PLAN = {
        "computed_items": ["plate_item"],
        "occupancy_terms": [
            {"attr": "socket1_qty", "none_when": "socket1_item"},
            {"attr": "socket2_qty", "none_when": "socket2_item"},
            {"attr": "socket3_qty", "none_when": "socket3_item"},
            {"attr": "socket4_qty", "none_when": "socket4_item"},
            {"attr": "switch_qty", "none_when": "switch_item"},
        ],
    }
    PAIRS = (("switch_qty", "switch_item", "16A 1 WAY SWITCH"),
             ("socket1_qty", "socket1_item", "6A 3-Pin Socket"),
             ("socket2_qty", "socket2_item", "6A/16A 3-Pin Socket"),
             ("socket3_qty", "socket3_item", "RJ 11 Telephone"),
             ("socket4_qty", "socket4_item", "USB Charger - A Type"),
             ("plate_qty", "plate_item", "3M"))

    # ── case (a): item FILLED, quantity BLANK -> the declared default, marked defaulted ──────────
    def test_case_a_fills_a_blank_quantity_beside_a_named_item_on_every_pair(self):
        """POSITIVE, all six pairs. The filled cell carries `defaulted: True` -- the SAME flag the
        model's own claimed defaults carry (kept at the coercion site), which is what the panel's
        amber badge reads. No second mechanism."""
        for qty, item, label in self.PAIRS:
            row = {item: _cell(label), qty: _cell(None)}
            filled = extraction.fill_paired_slot_defaults(row, self.DEFAULTS, self.PLAN)
            # An OCCUPANT pair also makes the (plate-less) row occupied, so case (b) fills the plate
            # quantity beside it; the plate pair fills itself alone. Both are the rule, stated.
            self.assertEqual(filled, [qty] if qty == "plate_qty" else [qty, "plate_qty"], qty)
            self.assertEqual(row[qty]["value"], 1.0, qty)
            self.assertIs(row[qty]["defaulted"], True, qty)
            self.assertEqual(row[qty]["confidence"], extraction._PAIRED_FILL_CONFIDENCE, qty)

    def test_case_a_fills_a_quantity_the_model_omitted_entirely(self):
        """The coercion loop always writes a null cell for a declared attribute, but the function
        must not depend on it: a missing key is a blank."""
        row = {"socket1_item": _cell("6A 3-Pin Socket")}
        # (the occupied, plate-less row also earns its plate quantity through case (b))
        self.assertEqual(extraction.fill_paired_slot_defaults(row, self.DEFAULTS, self.PLAN), ["socket1_qty", "plate_qty"])
        self.assertEqual(row["socket1_qty"]["value"], 1.0)

    def test_case_a_needs_no_plan(self):
        """Case (a) is the rule for EVERY paired quantity, plan or not."""
        row = {"socket1_item": _cell("6A 3-Pin Socket"), "socket1_qty": _cell(None)}
        self.assertEqual(extraction.fill_paired_slot_defaults(row, self.DEFAULTS, None), ["socket1_qty"])

    # ── NEVER when the item is "None" ────────────────────────────────────────────────────────────
    def test_never_fills_beside_a_None_item(self):
        """NEGATIVE. "None" is positive absence -- there is nothing to count. All six pairs, with
        every occupant None so case (b) has no occupancy either."""
        row = {item: _cell("None") for _q, item, _l in self.PAIRS}
        row.update({qty: _cell(None) for qty, _i, _l in self.PAIRS})
        self.assertEqual(extraction.fill_paired_slot_defaults(row, self.DEFAULTS, self.PLAN), [])
        for qty, _i, _l in self.PAIRS:
            self.assertIsNone(row[qty]["value"], qty)

    # ── NEVER when the item is blank -- except case (b), plate only ─────────────────────────────
    def test_never_fills_beside_a_blank_occupant_item(self):
        """NEGATIVE. A socket nobody identified is never purchased, so its quantity stays blank even
        when the row is otherwise occupied -- case (b) is PLATE ONLY."""
        row = {"switch_item": _cell("16A 1 WAY SWITCH"), "switch_qty": _cell(1.0),
               "socket1_item": _cell(None), "socket1_qty": _cell(None),
               "plate_item": _cell("3M"), "plate_qty": _cell(1.0)}
        self.assertEqual(extraction.fill_paired_slot_defaults(row, self.DEFAULTS, self.PLAN), [])
        self.assertIsNone(row["socket1_qty"]["value"])

    def test_bare_box_blank_plate_no_occupants_is_untouched(self):
        """NEGATIVE, the bare box (F-25): every occupant None, plate blank, qty blank -> the zero
        path buys no plate, so no quantity is filled. Slice 2 is still owed and this must not
        pre-empt it."""
        row = {"switch_item": _cell("None"), "socket1_item": _cell("None"), "socket2_item": _cell("None"),
               "socket3_item": _cell("None"), "socket4_item": _cell("None"),
               "switch_qty": _cell(None), "socket1_qty": _cell(None), "socket2_qty": _cell(None),
               "socket3_qty": _cell(None), "socket4_qty": _cell(None),
               "plate_item": _cell(None), "plate_qty": _cell(None), "back_box": _cell("Yes")}
        self.assertEqual(extraction.fill_paired_slot_defaults(row, self.DEFAULTS, self.PLAN), [])
        self.assertIsNone(row["plate_qty"]["value"])
        self.assertNotIn("defaulted", row["plate_qty"])

    # ── case (b): PLATE ONLY, item blank, quantity blank, an occupant named -> 1 ────────────────
    def test_case_b_fills_the_plate_quantity_when_the_row_will_buy_a_computed_plate(self):
        """POSITIVE (the row-50 shape, BOQ-26-00242 / LT Electrical works): one switch, one socket,
        plate BLANK (the ladder computes it), plate qty BLANK -> 1, defaulted. This is the 54-row
        population the owner ruled on."""
        row = {"switch_item": _cell("16A 1 WAY SWITCH"), "switch_qty": _cell(1),
               "socket1_item": _cell("6A/16A 3-Pin Socket"), "socket1_qty": _cell(1),
               "socket2_item": _cell("None"), "socket2_qty": _cell(None),
               "socket3_item": _cell("None"), "socket3_qty": _cell(None),
               "socket4_item": _cell("None"), "socket4_qty": _cell(None),
               "plate_item": _cell(None), "plate_qty": _cell(None)}
        self.assertEqual(extraction.fill_paired_slot_defaults(row, self.DEFAULTS, self.PLAN), ["plate_qty"])
        self.assertEqual(row["plate_qty"]["value"], 1.0)
        self.assertIs(row["plate_qty"]["defaulted"], True)
        self.assertIsNone(row["plate_item"]["value"], "the plate ITEM stays blank -- the ladder computes it")

    def test_case_b_counts_an_occupant_whose_quantity_case_a_just_filled(self):
        """ORDER WITHIN THE FUNCTION: (a) runs before (b), so a named socket with an unread quantity
        is both filled AND counted as occupancy for the plate."""
        row = {"socket1_item": _cell("6A 3-Pin Socket"), "socket1_qty": _cell(None),
               "switch_item": _cell("None"), "switch_qty": _cell(None),
               "plate_item": _cell(None), "plate_qty": _cell(None)}
        self.assertEqual(extraction.fill_paired_slot_defaults(row, self.DEFAULTS, self.PLAN),
                         ["socket1_qty", "plate_qty"])

    def test_case_b_needs_a_positive_occupancy_not_merely_a_named_item(self):
        """NEGATIVE. Occupancy mirrors module_fit's sum: a named occupant whose READ quantity is 0
        contributes nothing, so no plate is bought and none is counted."""
        row = {"switch_item": _cell("16A 1 WAY SWITCH"), "switch_qty": _cell(0),
               "socket1_item": _cell("None"), "socket1_qty": _cell(None),
               "plate_item": _cell(None), "plate_qty": _cell(None)}
        self.assertEqual(extraction.fill_paired_slot_defaults(row, self.DEFAULTS, self.PLAN), [])
        self.assertIsNone(row["plate_qty"]["value"])

    def test_case_b_ignores_an_occupant_whose_item_is_blank(self):
        """NEGATIVE. A blank occupant ITEM with a quantity would bindMiss the whole row in the
        interpreter, so it is not evidence a plate will be bought."""
        row = {"socket1_item": _cell(None), "socket1_qty": _cell(2),
               "switch_item": _cell("None"), "switch_qty": _cell(None),
               "plate_item": _cell(None), "plate_qty": _cell(None)}
        self.assertEqual(extraction.fill_paired_slot_defaults(row, self.DEFAULTS, self.PLAN), [])

    def test_case_b_is_inert_without_a_plan(self):
        """NEGATIVE. A config with paired defaults but no module_fit ladder over a paired item never
        fills a blank-item quantity -- the plate exception exists only because the ladder buys one."""
        row = {"switch_item": _cell("16A 1 WAY SWITCH"), "switch_qty": _cell(1),
               "plate_item": _cell(None), "plate_qty": _cell(None)}
        self.assertEqual(extraction.fill_paired_slot_defaults(row, self.DEFAULTS, None), [])
        self.assertIsNone(row["plate_qty"]["value"])

    # ── NEVER over a quantity the model READ -- including 0 ─────────────────────────────────────
    def test_never_overwrites_a_read_quantity_including_zero(self):
        """NEGATIVE, written explicitly because 0 is the case a careless implementation gets wrong:
        a read 0 is a VALUE, not a blank. Also a read 3 and a model-claimed default 1."""
        row = {"switch_item": _cell("16A 1 WAY SWITCH"), "switch_qty": _cell(0),
               "socket1_item": _cell("6A 3-Pin Socket"), "socket1_qty": _cell(3),
               "plate_item": _cell("6M"), "plate_qty": _cell(1.0, defaulted=True)}
        before = {k: dict(v) for k, v in row.items()}
        self.assertEqual(extraction.fill_paired_slot_defaults(row, self.DEFAULTS, self.PLAN), [])
        self.assertEqual(row, before)
        self.assertEqual(row["switch_qty"]["value"], 0)
        self.assertNotIn("defaulted", row["switch_qty"])

    # ── the scrub is unchanged, and the two commute ────────────────────────────────────────────
    def test_the_scrub_still_removes_a_quantity_whose_item_is_None(self):
        """UNCHANGED sibling: a model-supplied quantity beside a None item is still scrubbed, and
        the fill never puts it back."""
        row = {"socket1_item": _cell("None"), "socket1_qty": _cell(1.0, defaulted=True)}
        self.assertEqual(extraction.scrub_unpaired_slot_defaults(row, self.DEFAULTS), ["socket1_qty"])
        self.assertEqual(extraction.fill_paired_slot_defaults(row, self.DEFAULTS, self.PLAN), [])
        self.assertIsNone(row["socket1_qty"]["value"])

    def test_the_scrub_keeps_a_blank_item_quantity_and_the_fill_extends_that_contract(self):
        """THE BOUNDARY. `test_keeps_a_quantity_whose_slot_is_BLANK` pins that a blank-item quantity
        is KEPT; case (b) EXTENDS it (a blank plate on an occupied row gains one), it never breaks
        it (a kept quantity is never touched)."""
        row = {"plate_item": _cell(None), "plate_qty": _cell(1.0, defaulted=True),
               "switch_item": _cell("16A 1 WAY SWITCH"), "switch_qty": _cell(1)}
        self.assertEqual(extraction.scrub_unpaired_slot_defaults(row, self.DEFAULTS), [])
        self.assertEqual(extraction.fill_paired_slot_defaults(row, self.DEFAULTS, self.PLAN), [])
        self.assertEqual(row["plate_qty"]["value"], 1.0)

    def test_scrub_then_fill_equals_fill_then_scrub_on_a_mixed_row(self):
        """ORDER AGAINST THE SCRUB. The call site runs scrub -> fill; on a row carrying every shape
        at once the two orders give the identical row, because None vs filled/blank are disjoint
        conditions. Pinned so the chosen order is a documented preference, not a hidden dependency."""
        def mixed():
            return {"switch_item": _cell("None"), "switch_qty": _cell(1.0, defaulted=True),     # scrubbed
                    "socket1_item": _cell("6A 3-Pin Socket"), "socket1_qty": _cell(None),      # (a)
                    "socket2_item": _cell(None), "socket2_qty": _cell(None),                   # blank, stays
                    "socket3_item": _cell("None"), "socket3_qty": _cell(None),
                    "socket4_item": _cell("None"), "socket4_qty": _cell(None),
                    "plate_item": _cell(None), "plate_qty": _cell(None)}                       # (b)
        a = mixed()
        extraction.scrub_unpaired_slot_defaults(a, self.DEFAULTS)
        extraction.fill_paired_slot_defaults(a, self.DEFAULTS, self.PLAN)
        b = mixed()
        extraction.fill_paired_slot_defaults(b, self.DEFAULTS, self.PLAN)
        extraction.scrub_unpaired_slot_defaults(b, self.DEFAULTS)
        self.assertEqual(a, b)
        self.assertIsNone(a["switch_qty"]["value"])
        self.assertEqual(a["socket1_qty"]["value"], 1.0)
        self.assertIsNone(a["socket2_qty"]["value"])
        self.assertEqual(a["plate_qty"]["value"], 1.0)

    # ── configs without paired defaults are untouched ───────────────────────────────────────────
    def test_no_defaults_or_no_pairs_is_a_no_op(self):
        """NEGATIVE. ABSENT => byte-identical, the gating discipline this codebase uses."""
        row = {"socket1_item": _cell("6A 3-Pin Socket"), "socket1_qty": _cell(None)}
        self.assertEqual(extraction.fill_paired_slot_defaults(row, None, self.PLAN), [])
        self.assertEqual(extraction.fill_paired_slot_defaults(row, {"colour": "White", "runs": 1}, self.PLAN), [])
        self.assertEqual(extraction.fill_paired_slot_defaults(row, {"socket1_qty": {"default": 1.0}}, self.PLAN), [])
        self.assertIsNone(row["socket1_qty"]["value"])

    def test_plan_from_live_configs(self):
        """`paired_fill_plan` is derived from the CONFIG: the three live configs carrying paired
        defaults over a module_fit (switches_sockets, point_wiring, popup_boxes) yield the plate as
        the ONE computed item and their module_fit terms as occupancy; every other config yields
        None (case (b) inert), and a config with pairs but no ladder yields None."""
        import os
        with open(os.path.join(os.path.dirname(extraction.__file__), "data",
                               "rate_master_electrical_all_v57.json"), "r", encoding="utf-8") as fh:
            configs = {c["category_id"]: c for c in json.load(fh)["category_configs"]}
        plans = {cid: extraction.paired_fill_plan(cfg) for cid, cfg in configs.items()}
        self.assertEqual(sorted(cid for cid, p in plans.items() if p),
                         ["point_wiring", "popup_boxes", "switches_sockets"])
        for cid in ("switches_sockets", "point_wiring", "popup_boxes"):
            self.assertEqual(plans[cid]["computed_items"], ["plate_item"], cid)
            self.assertNotIn("box_item", plans[cid]["computed_items"], cid)  # a bind, but NOT a paired item
        self.assertEqual([t["attr"] for t in plans["switches_sockets"]["occupancy_terms"]],
                         ["socket1_qty", "socket2_qty", "socket3_qty", "socket4_qty", "switch_qty"])
        self.assertIsNone(extraction.paired_fill_plan({"extraction_defaults": self.DEFAULTS, "pipelines": {}}))
        self.assertIsNone(extraction.paired_fill_plan({}))
        self.assertIsNone(extraction.paired_fill_plan(None))

    def test_the_fill_is_recorded_in_the_capture_the_same_way_the_scrub_is(self):
        """The call site mirrors the scrub's bookkeeping: a `drops` key beside
        `slot_paired_defaults_scrubbed`, and a row_map entry naming the correction. Pinned at the
        source, the way the rule-text pins are, because the batch call needs a live model."""
        import inspect
        src = inspect.getsource(extraction._extract_batch)
        self.assertIn('"paired_slot_defaults_filled": {}', src)
        self.assertIn('for _aid in fill_paired_slot_defaults(row_out, defaults, paired_fill):', src)
        self.assertIn('drops["paired_slot_defaults_filled"].setdefault(str(rid), []).append(_aid)', src)
        self.assertIn('"reason": "paired default filled (code)"', src)
        # ORDER: the fill is called AFTER the scrub and BEFORE force_absent_dependents.
        i_scrub = src.index("for _aid in scrub_unpaired_slot_defaults(row_out, defaults):")
        i_fill = src.index("for _aid in fill_paired_slot_defaults(row_out, defaults, paired_fill):")
        i_absent = src.index("for _aid in force_absent_dependents(row_out, absent_rules):")
        self.assertLess(i_scrub, i_fill)
        self.assertLess(i_fill, i_absent)
        # and run_extraction threads the plan through, derived from the config
        src2 = inspect.getsource(extraction.run_extraction)
        self.assertIn('"paired_fill": paired_fill_plan(cfg)', src2)
        self.assertIn('_gc["paired_fill"]', src2)


class TestFillPairedSlotDefaultsAcrossCategories(FrappeTestCase):
    """GENERAL BUILD (owner 2026-09-07: "lets make a general build") -- the rule is config-DERIVED and
    reaches every config that declares `requires_named` defaults; these pins say what that means on
    the two OTHER live categories, measured before building on the 40 active runs:
      point_wiring 263 rows -> case (a) 0, case (b) 0 (its blank-plate occupied rows already carry a
        quantity; its `on_zero_modules: 3` sits on the BOX ladder, not the plate's, so a zero-module
        row still buys no plate);
      popup_boxes 40 rows -> case (a) 1 (a named socket2 with an unread quantity), case (b) 0.
    And a category with NO module_fit plate ladder is untouched entirely."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        import os
        with open(os.path.join(os.path.dirname(extraction.__file__), "data",
                               "rate_master_electrical_all_v57.json"), "r", encoding="utf-8") as fh:
            cls.configs = {c["category_id"]: c for c in json.load(fh)["category_configs"]}

    def _plan_and_defaults(self, cid):
        cfg = self.configs[cid]
        return extraction.paired_fill_plan(cfg), cfg.get("extraction_defaults")

    def test_point_wiring_blank_plate_with_a_present_quantity_is_untouched(self):
        """NEGATIVE, the cross-category one. point_wiring's live shape: a named socket, a blank plate
        (the ladder computes it), plate_qty ALREADY 1 -- 132 such rows today. The rule must not
        invent a case (b) row here: nothing is blank, so nothing is filled and nothing moves."""
        plan, defaults = self._plan_and_defaults("point_wiring")
        self.assertEqual(plan["computed_items"], ["plate_item"])
        row = {"socket_item": _cell("6A 3-Pin Socket"), "socket_qty": _cell(1),
               "switch_item": _cell("None"), "switch_qty": _cell(None),
               "plate_item": _cell(None), "plate_qty": _cell(1.0, defaulted=True),
               "back_box": _cell("Yes"), "colour": _cell("White")}
        before = {k: dict(v) for k, v in row.items()}
        self.assertEqual(extraction.fill_paired_slot_defaults(row, defaults, plan), [])
        self.assertEqual(row, before)

    def test_point_wiring_zero_module_row_buys_a_box_but_no_plate_so_no_quantity_is_filled(self):
        """NEGATIVE. `on_zero_modules: 3` is on point_wiring's BOX ladder only (asserted from the
        asset); the plate ladder binds absent at zero modules, so the row buys no plate and the
        blank plate quantity stays blank -- the light-point-on-an-MCB shape, 143 rows today."""
        cfg = self.configs["point_wiring"]
        ladders = cfg["pipelines"]["pw_boq_supply"]["steps"][11]["params"]["ladders"]
        self.assertEqual(ladders[1]["bind"], "box_item")
        self.assertEqual(ladders[1]["on_zero_modules"], 3)
        self.assertNotIn("on_zero_modules", ladders[0])          # the PLATE ladder has none
        plan, defaults = self._plan_and_defaults("point_wiring")
        row = {"socket_item": _cell("None"), "socket_qty": _cell(None),
               "switch_item": _cell("None"), "switch_qty": _cell(None),
               "plate_item": _cell(None), "plate_qty": _cell(None), "back_box": _cell("Yes")}
        self.assertEqual(extraction.fill_paired_slot_defaults(row, defaults, plan), [])
        self.assertIsNone(row["plate_qty"]["value"])

    def test_popup_boxes_case_a_the_one_live_row_gains_its_socket_quantity(self):
        """POSITIVE. popup_boxes' one case (a) row today: `socket2_item` named, `socket2_qty` blank
        -> 1, defaulted. Its plate is named with a quantity, so case (b) has nothing to do."""
        plan, defaults = self._plan_and_defaults("popup_boxes")
        self.assertEqual(plan["computed_items"], ["plate_item"])
        row = {"switch_item": _cell("None"), "switch_qty": _cell(None),
               "socket1_item": _cell("6A 3-Pin Socket"), "socket1_qty": _cell(2),
               "socket2_item": _cell("USB Charger - A Type"), "socket2_qty": _cell(None),
               "socket3_item": _cell("None"), "socket3_qty": _cell(None),
               "socket4_item": _cell("None"), "socket4_qty": _cell(None),
               "plate_item": _cell("6M"), "plate_qty": _cell(1)}
        self.assertEqual(extraction.fill_paired_slot_defaults(row, defaults, plan), ["socket2_qty"])
        self.assertEqual(row["socket2_qty"]["value"], 1.0)
        self.assertIs(row["socket2_qty"]["defaulted"], True)

    def test_a_category_with_no_module_fit_plate_ladder_is_untouched_entirely(self):
        """NEGATIVE. Nine of the twelve live configs declare no `requires_named` default at all
        (the plan is None and the fill returns nothing whatever the row holds); and a synthetic
        config with pairs but NO module_fit never fills a blank-item quantity."""
        for cid, cfg in self.configs.items():
            if cid in ("switches_sockets", "point_wiring", "popup_boxes"):
                continue
            self.assertIsNone(extraction.paired_fill_plan(cfg), cid)
            row = {"item": _cell("Industrial Socket with MCB"), "rating": _cell(None),
                   "plate_item": _cell(None), "plate_qty": _cell(None), "switch_qty": _cell(None)}
            self.assertEqual(extraction.fill_paired_slot_defaults(row, cfg.get("extraction_defaults"), None), [], cid)
        pairs_no_ladder = {"pipelines": {"x": {"steps": [{"step": "component_ref", "name": "sw"}]}},
                           "extraction_defaults": {"plate_qty": {"default": 1.0, "requires_named": "plate_item"},
                                                   "switch_qty": {"default": 1.0, "requires_named": "switch_item"}}}
        self.assertIsNone(extraction.paired_fill_plan(pairs_no_ladder))
        row = {"switch_item": _cell("16A 1 WAY SWITCH"), "switch_qty": _cell(1),
               "plate_item": _cell(None), "plate_qty": _cell(None)}
        self.assertEqual(extraction.fill_paired_slot_defaults(
            row, pairs_no_ladder["extraction_defaults"], extraction.paired_fill_plan(pairs_no_ladder)), [])
        self.assertIsNone(row["plate_qty"]["value"])


# ── F-25 SLICE 2: the back box's STATED module count -- read by the model AS WRITTEN, picked by CODE ──
class TestModuleCountFromText(FrappeTestCase):
    """F-25 SLICE 2 (owner rulings 2026-09-06/07). The model records the box's module size exactly as
    the text writes it; the HIGHER-OF-A-RANGE pick is a calculation and lives HERE, at the extraction
    layer, because the attribute is number-typed and the raw token exists only before coercion.

    Owner, verbatim: "for such cases extraction should provide the higher copunt and then we match it
    as per our rulr - exact opr next higher if exact is not available"; on the millimetre-only rows
    defaulting to 3M: "this is ok"."""

    def test_a_number_arrives_as_itself(self):
        self.assertEqual(extraction.module_count_from_text(3), 3)
        self.assertEqual(extraction.module_count_from_text(9.0), 9)
        self.assertEqual(extraction.module_count_from_text("12"), 12)

    def test_a_range_yields_the_HIGHER_count(self):
        """The three owner-named shapes: 9/8M -> 9, 1 or 2 Module -> 2, 2/3 module way -> 3."""
        self.assertEqual(extraction.module_count_from_text("9/8M"), 9)
        self.assertEqual(extraction.module_count_from_text("9/8"), 9)
        self.assertEqual(extraction.module_count_from_text("1 or 2 Module"), 2)
        self.assertEqual(extraction.module_count_from_text("2/3 module way"), 3)
        self.assertEqual(extraction.module_count_from_text("1/2 module GI box"), 2)  # H2's parent text
        self.assertEqual(extraction.module_count_from_text("3 Module GI Boxes"), 3)   # H1's own text

    def test_NEGATIVE_a_millimetre_dimension_is_not_a_count(self):
        """H5's shape: only millimetres -> None, so the ladder's declared 3M is ASSUMED downstream."""
        self.assertIsNone(extraction.module_count_from_text("72 mm x 90 mm x 50 mm"))
        self.assertIsNone(extraction.module_count_from_text("100x100x50mm"))
        self.assertIsNone(extraction.module_count_from_text("75 mm deep"))
        self.assertIsNone(extraction.module_count_from_text("100 x 100 mm"))
        # a millimetre depth BESIDE a module count does not hide the count
        self.assertEqual(extraction.module_count_from_text("3M box 75 mm deep"), 3)

    def test_NEGATIVE_nothing_readable_is_None(self):
        for raw in (None, "", "   ", "GI box", "abc", 0, -2, 2.5, True, False):
            self.assertIsNone(extraction.module_count_from_text(raw), repr(raw))

    def test_NEGATIVE_a_port_or_node_count_is_not_a_count_HERE_either(self):
        """The parse never sees a port count -- the PROMPT tells the model to leave the attribute null
        for one -- but if a model wrote "4 port" into the field the parse cannot tell; this pins that the
        guard is the rule text (test_f25s2 in test_rate_master), not a heuristic here."""
        self.assertEqual(extraction.module_count_from_text("4 port"), 4)


class TestZeroPathStatedAttrs(FrappeTestCase):
    """The parse set is CONFIG-DERIVED from the ladders' `on_zero_from` (the HV-10 lesson: no category or
    attribute name in code). Read from the CURRENT asset, not the live DB, so the pin holds before and
    after the import."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        here = os.path.dirname(os.path.abspath(extraction.__file__))
        with open(os.path.join(here, "data", "rate_master_electrical_all_v58.json"), encoding="utf-8") as fh:
            cls.configs = {c["category_id"]: c for c in json.load(fh)["category_configs"]}

    def test_switches_sockets_declares_the_one_attribute(self):
        self.assertEqual(extraction.zero_path_stated_attrs(self.configs["switches_sockets"]), ["box_modules_stated"])

    def test_NEGATIVE_every_other_config_declares_none(self):
        """point_wiring carries `on_zero_modules` ONLY -- the shared zero branch, untouched -- and the
        other ten declare no module_fit zero path at all."""
        for cid, cfg in self.configs.items():
            if cid == "switches_sockets":
                continue
            self.assertEqual(extraction.zero_path_stated_attrs(cfg), [], cid)
        pw = self.configs["point_wiring"]
        for pid, pl in pw["pipelines"].items():
            mf = [s for s in pl["steps"] if s["step"] == "module_fit"][0]
            self.assertEqual(mf["params"]["ladders"][1].get("on_zero_modules"), 3, pid)
            self.assertNotIn("on_zero_from", mf["params"]["ladders"][1], pid)

    def test_shape_tolerance(self):
        self.assertEqual(extraction.zero_path_stated_attrs({}), [])
        self.assertEqual(extraction.zero_path_stated_attrs(None), [])
        self.assertEqual(extraction.zero_path_stated_attrs({"pipelines": {}}), [])
        self.assertEqual(extraction.zero_path_stated_attrs(
            {"pipelines": {"p": {"steps": [{"step": "module_fit", "params": {"ladders": [{"on_zero_from": " x "}, {"on_zero_from": ""}]}}]}}}), ["x"])


class TestModuleCountAtTheBatchSite(FrappeTestCase):
    """The parse sits BEFORE coercion in `_extract_batch`, gated on the config-derived attribute set, and
    is recorded in the capture beside the model's raw token. Proven end to end through a fake client:
    the model writes "9/8M" as a string into a `number` attribute and the stored value is 9."""

    DEFS = [
        {"id": "back_box", "label": "Back box", "type": "choice", "values": ["Yes", "No"]},
        {"id": "box_modules_stated", "label": "Back box module count", "type": "number"},
    ]
    ROWS = [{"excel_row": 169, "description": "9/8M MS GI Coated Box", "ancestors": [], "sheet_name": "s"},
            {"excel_row": 115, "description": "72 mm x 90 mm x 50 mm MS box", "ancestors": [], "sheet_name": "s"},
            {"excel_row": 428, "description": "3 Module GI Boxes", "ancestors": [], "sheet_name": "s"}]

    @staticmethod
    def _client(reply):
        from nirmaan_stack.api.boq.wizard.test_classify import _FakeClient, _Resp
        return _FakeClient(lambda call, kwargs: _Resp(json.dumps(reply)))

    def _reply(self):
        return [
            {"id": 169, "attributes": {"back_box": {"value": "Yes", "confidence": 0.9},
                                       "box_modules_stated": {"value": "9/8M", "confidence": 0.8}}},
            {"id": 115, "attributes": {"back_box": {"value": "Yes", "confidence": 0.9},
                                       "box_modules_stated": {"value": "72 mm x 90 mm x 50 mm", "confidence": 0.4}}},
            {"id": 428, "attributes": {"back_box": {"value": "Yes", "confidence": 0.9},
                                       "box_modules_stated": {"value": 3, "confidence": 0.9}}},
        ]

    def test_POSITIVE_the_token_is_parsed_before_coercion_when_the_attribute_is_in_the_set(self):
        out = extraction._extract_batch(self._client(self._reply()), "m", "P", self.DEFS, self.ROWS,
                                        None, None, None, None, None, None, None, None, None, None,
                                        None, ["box_modules_stated"])
        self.assertEqual(out[169]["box_modules_stated"]["value"], 9)      # the HIGHER of 9/8
        self.assertIsNone(out[115]["box_modules_stated"]["value"])        # millimetres -> nothing read
        self.assertEqual(out[428]["box_modules_stated"]["value"], 3)
        self.assertEqual(out[169]["back_box"]["value"], "Yes")            # nothing else touched

    def test_NEGATIVE_without_the_set_the_token_is_dropped_by_number_coercion_exactly_as_before(self):
        """The pre-slice behaviour for a string in a number attribute: COERCE_NOT_A_NUMBER -> None. This is
        why the pick had to sit BEFORE coercion, and why an empty set leaves every other config alone."""
        out = extraction._extract_batch(self._client(self._reply()), "m", "P", self.DEFS, self.ROWS)
        self.assertIsNone(out[169]["box_modules_stated"]["value"])
        self.assertEqual(out[428]["box_modules_stated"]["value"], 3)      # a real number still coerces
        out2 = extraction._extract_batch(self._client(self._reply()), "m", "P", self.DEFS, self.ROWS,
                                         None, None, None, None, None, None, None, None, None, None,
                                         None, [])
        self.assertIsNone(out2[169]["box_modules_stated"]["value"])

    def test_the_parse_is_recorded_in_the_capture_beside_the_raw_token(self):
        """Pinned at the source, the way the paired-fill call site is: the drops key, the row_map raw
        keeping the MODEL's token, the parse placed BEFORE `_coerce_value_ex`, and run_extraction
        threading the config-derived set through."""
        import inspect
        src = inspect.getsource(extraction._extract_batch)
        self.assertIn('"module_count_parsed": {}', src)
        self.assertIn('parsed_count = module_count_from_text(raw)', src)
        self.assertIn('drops["module_count_parsed"].setdefault(str(rid), []).append(', src)
        self.assertIn('"raw": model_raw,', src)
        i_parse = src.index("parsed_count = module_count_from_text(raw)")
        i_coerce = src.index("value, reason = _coerce_value_ex(defn, raw, (synonyms or {}).get(aid))")
        self.assertLess(i_parse, i_coerce)
        src2 = inspect.getsource(extraction.run_extraction)
        self.assertIn('"module_count_attrs": zero_path_stated_attrs(cfg)', src2)
        self.assertIn('_gc["module_count_attrs"]', src2)


class TestPrefacedReplyAtTheRateCallSite(FrappeTestCase):
    """2026-09-08 -- the shared parser's scalar-list skip, proven at THE RATE EXTRACTOR'S call site
    (`extraction.py` `for el in _extract_json_array(text): rid = int(el["id"])`), which is where the
    2026-09-07 halt actually happened. The reply is the captured one: prose quoting the allowed face
    sizes `[350, 250, 200, 150, 100, 300]`, then the row array. Through the real `_extract_batch`
    with a fake client -- the same replay the cert uses -- it now yields the rows; a reply holding
    ONLY the scalar list ends in the named ExtractionHalted, with a ValueError inside, never a
    TypeError."""

    DEFS = [{"id": "face_mm", "label": "Face size (mm)", "type": "number_choice",
             "values": [100, 150, 200, 250, 300, 350]}]
    ROWS = [{"excel_row": r, "description": d, "ancestors": [], "sheet_name": "s"} for r, d in
            ((359, "175x175x50MM"), (361, "275x275x50MM"), (363, "375x375x50MM"), (365, "475x475x50MM"), (367, "125x1255x50MM"))]
    # The 2026-09-07 02:54:13 attempt-1 reply, verbatim from the capture log (rows 359-367).
    REPLY = (
            "Looking at each row, the face sizes are non-standard and must map to the allowed values [350, 250, 200, 150, 100, 300].\n"
            "\n"
            "Row 359: 175x175 \u2192 face 175, not an allowed value \u2192 null\n"
            "Row 361: 275x275 \u2192 275, not allowed \u2192 null\n"
            "Row 363: 375x375 \u2192 375, not allowed \u2192 null\n"
            "Row 365: 475x475 \u2192 475, not allowed \u2192 null\n"
            "Row 367: 125x1255 \u2192 125/1255 (larger 1255), not allowed \u2192 null\n"
            "\n"
            "None match the allowed values, so all return null.\n"
            "\n"
            "[{\"id\": 359, \"attributes\": {\"face_mm\": {\"value\": null, \"confidence\": 0.9}}}, {\"id\": 361, \"attributes\": {\"face_mm\": {\"value\": null, \"confidence\": 0.9}}}, {\"id\": 363, \"attributes\": {\"face_mm\": {\"value\": null, \"confidence\": 0.9}}}, {\"id\": 365, \"attributes\": {\"face_mm\": {\"value\": null, \"confidence\": 0.9}}}, {\"id\": 367, \"attributes\": {\"face_mm\": {\"value\": null, \"confidence\": 0.9}}}]"
)
    ARRAY = REPLY[REPLY.rfind("\n[") + 1:]
    PREFACE = REPLY[: REPLY.rfind("\n[") + 1]

    @staticmethod
    def _client(text):
        from nirmaan_stack.api.boq.wizard.test_classify import _FakeClient, _Resp
        return _FakeClient(lambda call, kwargs: _Resp(text))

    def test_POSITIVE_the_captured_prefaced_reply_now_yields_the_rows(self):
        out = extraction._extract_batch(self._client(self.REPLY), "m", "P", self.DEFS, self.ROWS)
        self.assertEqual(sorted(out), [359, 361, 363, 365, 367])
        self.assertTrue(all(out[r]["face_mm"]["value"] is None for r in out))
        self.assertEqual(out[359]["face_mm"]["confidence"], 0.9)

    def test_INVARIANT_the_bare_array_reply_is_unchanged(self):
        a = extraction._extract_batch(self._client(self.ARRAY), "m", "P", self.DEFS, self.ROWS)
        b = extraction._extract_batch(self._client(self.REPLY), "m", "P", self.DEFS, self.ROWS)
        self.assertEqual(a, b)

    def test_NEGATIVE_a_scalar_list_alone_halts_cleanly_not_a_TypeError(self):
        """What the run sees: the batch fails on every attempt with the parser's own ValueError and the
        extractor raises its named halt -- the same shape as any unparseable reply, no crash."""
        with self.assertRaises(extraction.ExtractionHalted) as cm:
            extraction._extract_batch(self._client("Allowed values are [350, 250, 200, 150, 100, 300]. None fit."),
                                      "m", "P", self.DEFS, self.ROWS)
        detail = getattr(cm.exception, "detail", "") or ""
        self.assertIn("ValueError", detail)
        self.assertNotIn("TypeError", detail)


class TestInchTradeSize(FrappeTestCase):
    """CONDUIT TRADE SIZE (v63, owner 2026-09-10) -- the inch -> TRADE-size conversion, IN CODE.

    The model read the same token `1"` as 25.4 on BOQ-26-00198 and as 25 on BOQ-26-00242 (same prompt).
    The arithmetic reading buys the wrong rung: 25.4 overshoots the 25 rung by 0.4 mm so a next-higher
    ladder buys 32, and 50.8 sits above the top rung (50) so a stocked 2" conduit refuses. So the
    corrector writes the catalogue's TRADE size from a five-entry table on the def (`inch_trade_mm`) --
    never `x 25.4` -- and fires ONLY for a def carrying the table (key presence, never a category name),
    ONLY on an inch token in the row's own description. Every text below is verbatim from the live corpus."""

    TABLE = {"3/4": 20, "1": 25, "1 1/4": 32, "1 1/2": 40, "2": 50}

    def _cfg(self, table=TABLE):
        d = {"id": "size_mm", "label": "Size (mm)", "type": "number_choice",
             "values_from": {"kind": "conduit", "attr": "size_mm"}, "extract_as": "number"}
        if table is not None:
            d["inch_trade_mm"] = table
        return {"attribute_definitions": [
            {"id": "conduit_type", "label": "Conduit Type", "type": "choice", "values": ["PVC", "MS"]}, d]}

    def _apply(self, description, model_value, table=TABLE):
        row_out = {"size_mm": {"value": model_value, "confidence": 0.9}}
        recs = extraction.apply_inch_trade_size(row_out, _row(description), extraction.inch_trade_tables(self._cfg(table)))
        return row_out["size_mm"]["value"], recs

    # -- the table (positive) ------------------------------------------------------------------
    def test_it_01_each_of_the_five_forms_converts_to_its_trade_size(self):
        cases = [('3/4" Dia PVC Pipe', 19.05, 20), ('1" Dia PVC Pipe', 25.4, 25), ('1 1/4" Dia PVC Pipe', 31.75, 32),
                 ('1 1/2" PVC Pipe', 38.1, 40), ('2" PVC Pipe', 50.8, 50),
                 ('Supply and Fixing of 1 1/4" PVC Conduits', 32, 32), ('Supply and Fixing of 1" GI hose', 25, 25)]
        for text, model, want in cases:
            got, recs = self._apply(text, model)
            self.assertEqual(got, want, text)
            self.assertEqual(recs[0]["action"], "trade", text)
            self.assertEqual((recs[0]["from"], recs[0]["to"]), (model, want), text)

    def test_it_02_one_inch_gives_25_not_25_4_the_overshoot_that_buys_32(self):
        """`1"` -> 25, the rung the catalogue stocks. 25.4 (what the model wrote on BOQ-26-00198 rows 214 and 278,
        400 m) overshoots the 25 rung by 0.4 mm, so a next-higher ladder buys 32 -- 70/20 per metre instead of
        42/10. The trade table is what stops that."""
        got, _ = self._apply('1" Dia PVC Pipe', 25.4)
        self.assertEqual(got, 25)
        self.assertNotEqual(got, 25.4)
        self.assertNotEqual(round(1 * 25.4, 2), got)

    def test_it_03_two_inch_gives_50_not_50_8_which_refuses_a_stocked_size(self):
        """`2"` -> 50, the top rung. 50.8 (BOQ-26-00198 rows 220 and 284) sits ABOVE the top rung, so the ladder
        computes nothing and a stocked 2" conduit refuses. The trade table lands it on the rung."""
        got, _ = self._apply('2" Dia PVC Pipe', 50.8)
        self.assertEqual(got, 50)
        self.assertNotEqual(got, 50.8)

    def test_it_04_one_and_a_half_inch_maps_to_40_which_is_unstocked_by_design(self):
        """1 1/2" -> 40 (the trade size), NOT 50: the table speaks trade sizes; the LADDER takes 40 to 50."""
        got, _ = self._apply('1 1/2" Dia PVC Pipe', 38.1)
        self.assertEqual(got, 40)

    def test_it_05_a_blank_model_answer_is_filled_from_the_text_with_full_confidence(self):
        row_out = {"size_mm": {"value": None, "confidence": 0.0}}
        recs = extraction.apply_inch_trade_size(row_out, _row('1" Dia PVC Pipe'), extraction.inch_trade_tables(self._cfg()))
        self.assertEqual(row_out["size_mm"]["value"], 25)
        self.assertEqual(recs[0]["from"], None)
        # a cell the model never produced at all (no confidence to keep) is written at full confidence
        row_out = {"conduit_type": {"value": "PVC", "confidence": 0.9}}
        recs = extraction.apply_inch_trade_size(row_out, _row('1" Dia PVC Pipe'), extraction.inch_trade_tables(self._cfg()))
        self.assertEqual(row_out["size_mm"], {"value": 25, "confidence": 1.0})
        # an EMPTY row dict is left alone -- the corrector never manufactures a row
        self.assertEqual(extraction.apply_inch_trade_size({}, _row('1" Dia PVC Pipe'), extraction.inch_trade_tables(self._cfg())), [])

    # -- confinement (negative) ------------------------------------------------------------------
    def test_it_06_negative_the_corrector_fires_only_for_a_def_carrying_the_table(self):
        """KEY PRESENCE: the SAME text on a config whose defs carry no `inch_trade_mm` is untouched -- which is
        how the corpus's 88 non-conduit inch tokens stay out (they sit on rows of other categories)."""
        self.assertEqual(extraction.inch_trade_tables(self._cfg(table=None)), {})
        got, recs = self._apply('1" Dia PVC Pipe', 25.4, table=None)
        self.assertEqual(got, 25.4)
        self.assertEqual(recs, [])
        self.assertEqual(extraction.inch_trade_tables({}), {})
        self.assertEqual(extraction.inch_trade_tables(None), {})

    def test_it_07_negative_three_of_the_88_non_conduit_inch_tokens_carry_no_trade_size(self):
        """Verbatim corpus text: an HVAC copper-pipe fraction (BOQ-26-00231 / 128), brick thickness in an earth-pit
        note (BOQ-26-00232 / 180), a GI strip length (BOQ-26-00184 / 101). None sits on a conduit row, so the
        corrector never reads them; and even handed to it, none is a fraction the table carries -- the model's
        value is LEFT ALONE and the record says `unmapped`."""
        for text in ("3/8 inch dia.-21SWG",
                     '2\' dia/ 450 x 450mm 9" thick brick masonry, GI funnel, salt and charcoal',
                     "3 mm thick, 4 inches long ,15 mm wide which will be nut bolted"):
            got, recs = self._apply(text, 7.5)
            self.assertEqual(got, 7.5, text)
            self.assertNotIn("trade", [r["action"] for r in recs], text)
        # and the word forms never even match: `in`, `inch`, `inches` are not the mark
        for text in ("connecting testing and commissioning of TV Coaxial cable RG 6 in existing conduit",
                     "4x4 Inch-PVC Junction Box with 25A Terminal Block", "1 inch dia.- 19SWG"):
            self.assertEqual(extraction.inch_trade_size_from_text(text, self.TABLE), (None, None), text)

    def test_it_08_negative_a_metric_size_is_untouched_row_444_shape(self):
        """`40 mm` carries no inch mark: the corrector never fires, 40 stays 40 -- for the four genuine 40 mm
        conduits AND for BOQ-26-00174 / 444 (`40 mm width chipping...`), whose misread is a category call the
        table cannot touch."""
        for text, model in (("40mm dia medium gauge", 40), ("40 mm dia conduit (2.0 mm thick)", 40),
                            ("40 mm width chipping and refilling to lay the conduit in floor", 40)):
            got, recs = self._apply(text, model)
            self.assertEqual(got, 40, text)
            self.assertEqual(recs, [], text)

    def test_it_09_negative_an_inch_fraction_outside_the_table_leaves_the_model_value(self):
        """`3/8"` is an inch mark the table does not carry: recorded as `unmapped`, the value untouched. The
        corrector never invents a size."""
        got, recs = self._apply('3/8" dia', 9.5)
        self.assertEqual(got, 9.5)
        self.assertEqual(recs[0]["action"], "unmapped")

    def test_it_10_the_surface_is_one_form_the_straight_double_quote_after_a_number_or_mixed_fraction(self):
        """Measured across every row of the 42 active sheets: the ONLY conduit form is N" / N/N" / N N/N". The
        typographic quotes are tolerated as the same mark; nothing else is a size."""
        for text, tok in (('3/4"', '3/4"'), ('1"', '1"'), ('1 1/4"', '1 1/4"'), ('1 1/2"', '1 1/2"'), ('2"', '2"'),
                          ("1” Dia", "1”"), ("2″ pipe", "2″")):
            self.assertEqual(extraction.inch_trade_size_from_text(text, self.TABLE)[0], tok, text)

    def test_it_11_wired_the_batch_hook_reads_the_table_from_the_config_and_only_there(self):
        """`inch_trade_tables` normalises whitespace in the keys and keeps definition order; a def without the key
        contributes nothing."""
        cfg = self._cfg({" 1  1/2 ": 40, "1": 25})
        self.assertEqual(extraction.inch_trade_tables(cfg), {"size_mm": {"1 1/2": 40, "1": 25}})
