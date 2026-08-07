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
