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
    def test_no_fp_sibling_leaves_the_pick_alone_and_records_why(self):
        """NEGATIVE. The catalogue stocks no 63A FP MCB at D curve. Never approximate to another
        amp or curve, and never invent a row: leave the pick and say why, so a human can see it."""
        row = _row("Incomer 63A TPN MCB D Curve - 1 No")
        out = {"mcb1_item": _cell("63A TP MCB D CURVE")}
        rec = extraction.correct_four_pole_mcb_picks(out, row, _CAT)
        self.assertEqual(out["mcb1_item"]["value"], "63A TP MCB D CURVE", "the pick must not move")
        self.assertEqual(len(rec), 1)
        self.assertEqual(rec[0]["reason"], "no_unique_fp_sibling")
        self.assertIsNone(rec[0]["to"])

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
