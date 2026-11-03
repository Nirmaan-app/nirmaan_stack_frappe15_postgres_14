"""ELR-3a (owner R-9, R-R1 Q1-Q8) -- the four assembly-step arms, server side.

Point wiring's four numbers move from literals to Pricing Inputs read by `table_from_ctx` / `default_from_ctx`
(map_attribute), `constants_from_ctx` (derive_attribute) and `usable_from_ctx` (circuit_fit). This module pins the
server half: the config validator accepts exactly those keys and refuses everything around them by name (AC1); the
range every such input keeps, at BOTH write paths (AC4, owner Q4); used_by derives the new inputs with no code of its
own; and the extraction read-back multiplies by the live "per further point" input instead of a literal 5 (AC6, owner
Q3) -- proved with a synthetic model reply through the real post-processing, never a model call.

The configs are Electrical v68 with the 12 literals moved IN THE TEST, so the mechanism is proved without an asset.
No live value is changed: the write-path refusals happen before any write, and are asserted to leave the row as it was.
"""
import copy
import csv
import io
import json
import os
from unittest import mock

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq import rate_master
from nirmaan_stack.services.boq_rate_master import config_validation as cv
from nirmaan_stack.services.boq_rate_master import csv_exporter, csv_importer, extraction

_DATA = os.path.join(os.path.dirname(os.path.abspath(cv.__file__)), "data")
_V68 = "rate_master_electrical_all_v68.json"
_PIPES = ("pw_boq_supply", "pw_boq_install", "pw_bcs")
_INPUTS = ("pw_circuit_length_first", "pw_circuit_length_further", "pw_circuit_stretch",
           "conduit_fill_pvc_25", "conduit_fill_pvc_32", "conduit_fill_pvc_50",
           "conduit_fill_ms_25", "conduit_fill_ms_32", "conduit_fill_ms_50")


def _k(item):
    return "pi_%s_factor" % item


def _asset(name=_V68):
    with open(os.path.join(_DATA, name), encoding="utf-8") as fh:
        return json.load(fh)


def _moved_configs(asset):
    """{category_id: config}: v68 with point_wiring's 12 literals moved to the arms + 9 rate_ref per pipeline."""
    cfgs = {c["category_id"]: copy.deepcopy(c) for c in asset["category_configs"]}
    touched = 0
    for pid in _PIPES:
        steps = cfgs["point_wiring"]["pipelines"][pid]["steps"]
        for s in steps:
            p = s.get("params") or {}
            if s["step"] == "map_attribute" and p.get("result_attr") == "circuit_length_m":
                assert p.pop("table") == {"Primary": 15, "Secondary": 5}
                p["table_from_ctx"] = {"Primary": _k("pw_circuit_length_first"), "Secondary": _k("pw_circuit_length_further")}
                touched += 1
            elif s["step"] == "derive_attribute" and p.get("result_attr") == "circuit_length_m":
                assert p.pop("constants") == {"base": 15, "per_extra": 5}
                p["constants_from_ctx"] = {"base": _k("pw_circuit_length_first"), "per_extra": _k("pw_circuit_length_further")}
                touched += 1
            elif s["step"] == "map_attribute" and p.get("result_attr") == "circuit_wire_length_m":
                assert p.pop("default") == 30
                p["default_from_ctx"] = _k("pw_circuit_stretch")
                touched += 1
            elif s["step"] == "circuit_fit":
                assert p.pop("usable") == {"PVC": [0.55, 0.55, 0.55], "MS": [0.45, 0.45, 0.47]}
                p["usable_from_ctx"] = {"PVC": [_k("conduit_fill_pvc_%d" % z) for z in (25, 32, 50)],
                                        "MS": [_k("conduit_fill_ms_%d" % z) for z in (25, 32, 50)]}
                touched += 1
        for iid in _INPUTS:
            steps.append({"step": "rate_ref", "ref": {"kind": "electrical_pricing_input", "item": iid},
                          "target": "factor", "result": _k(iid)})
    assert touched == 12, touched
    return cfgs


_FIXTURE_NAME = "ELR3A-FIXTURE-NOT-A-ROW"


class _WriteReached(AssertionError):
    """Raised by `_writes_blocked` -- a test reached a database write it must never make."""


def _writes_blocked():
    """Every write a Rate Master endpoint could reach raises `_WriteReached` instead (ELR-3a incident, owner (a)):
    a document save / insert / delete / db_update, `frappe.db.set_value`, and any INSERT / UPDATE / DELETE statement."""
    import contextlib
    from frappe.model.document import Document

    def refuse(*a, **k):
        raise _WriteReached("a database write was reached")

    real_sql = frappe.db.sql

    def sql(query, *a, **k):
        if str(query).lstrip().split(None, 1)[0].lower() in ("insert", "update", "delete"):
            raise _WriteReached("a write statement was reached: %s" % str(query)[:60])
        return real_sql(query, *a, **k)

    stack = contextlib.ExitStack()
    for attr in ("save", "insert", "delete", "db_update", "db_insert"):
        stack.enter_context(mock.patch.object(Document, attr, refuse))
    stack.enter_context(mock.patch.object(frappe.db, "set_value", refuse))
    stack.enter_context(mock.patch.object(frappe.db, "sql", sql))
    return stack


class TestElr3aValidatorArms(FrappeTestCase):
    """AC1: the validator accepts exactly the four arms and refuses everything around them BY NAME."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.v68 = _asset()
        cls.moved = _moved_configs(cls.v68)

    def _refused(self, mutate, step_type, pid="pw_boq_supply", fragment=None):
        cfg = copy.deepcopy(self.moved["point_wiring"])
        hit = 0
        for s in cfg["pipelines"][pid]["steps"]:
            if s["step"] == step_type and mutate(s):
                hit += 1
        self.assertGreater(hit, 0, "the mutation found no %s step -- the negative would be vacuous" % step_type)
        with self.assertRaises(frappe.ValidationError) as cm:
            cv._validate_config(cfg)
        if fragment:
            self.assertIn(fragment, str(cm.exception))
        return str(cm.exception)

    def test_01_the_moved_point_wiring_validates_and_v68_still_does(self):
        cv._validate_config(self.moved["point_wiring"])
        cv._validate_config(next(c for c in self.v68["category_configs"] if c["category_id"] == "point_wiring"))

    def test_02_NEGATIVE_a_literal_and_its_arm_together_are_refused_by_name(self):
        for step_type, literal, value, arm, pred in (
                ("map_attribute", "table", {"Primary": 15}, "table_from_ctx", lambda s: "table_from_ctx" in s["params"]),
                ("map_attribute", "default", 30, "default_from_ctx", lambda s: "default_from_ctx" in s["params"]),
                ("derive_attribute", "constants", {"base": 15}, "constants_from_ctx", lambda s: True),
                ("circuit_fit", "usable", {"PVC": [0.5, 0.5, 0.5]}, "usable_from_ctx", lambda s: True)):
            def mutate(s, literal=literal, value=value, pred=pred):
                if not pred(s):
                    return False
                s["params"][literal] = value
                return True
            self._refused(mutate, step_type, fragment="'%s' REPLACES '%s'" % (arm, literal))

    def test_03_NEGATIVE_a_key_no_rate_ref_loads_is_refused_naming_it(self):
        def mutate(s):
            s["params"]["constants_from_ctx"]["base"] = "pi_nope"
            return True
        self._refused(mutate, "derive_attribute", fragment="reads 'pi_nope', which no rate_ref of this pipeline loads")

    def test_04_NEGATIVE_any_OTHER_from_ctx_on_these_steps_is_still_refused(self):
        def mutate(s):
            if "default_from_ctx" not in s["params"]:
                return False
            s["params"]["from_attr_from_ctx"] = _k("pw_circuit_stretch")
            return True
        self._refused(mutate, "map_attribute", fragment="'from_attr_from_ctx' is not read on a 'map_attribute' step")

    def test_05_NEGATIVE_an_arm_on_a_step_type_that_does_not_read_it(self):
        def mutate(s):
            s.setdefault("params", {})["default_from_ctx"] = _k("pw_circuit_stretch")
            return True
        self._refused(mutate, "component_ref", fragment="'default_from_ctx' is not read on a 'component_ref' step")

    def test_06_NEGATIVE_shapes(self):
        def not_a_map(s):
            if "table_from_ctx" not in s["params"]:
                return False
            s["params"]["table_from_ctx"] = _k("pw_circuit_length_first")
            return True
        self._refused(not_a_map, "map_attribute", fragment="'table_from_ctx' must be an object of name -> computed-value key")

        def short(s):
            s["params"]["usable_from_ctx"]["PVC"].pop()
            return True
        self._refused(short, "circuit_fit", fragment="names 2 input(s) for 3 size(s) -- one per size")

        def default_not_a_key(s):
            if "default_from_ctx" not in s["params"]:
                return False
            s["params"]["default_from_ctx"] = {"x": "y"}
            return True
        self._refused(default_not_a_key, "map_attribute", fragment="'default_from_ctx' must be a computed-value key (a string)")

    def test_07_the_two_registries_name_the_same_four_arms(self):
        self.assertEqual({k: sorted(v) for k, v in cv._ASSEMBLY_CTX_ARMS.items()},
                         {"map_attribute": ["default_from_ctx", "table_from_ctx"],
                          "derive_attribute": ["constants_from_ctx"], "circuit_fit": ["usable_from_ctx"]})
        ts = open(os.path.join(frappe.get_app_path("nirmaan_stack"), "..", "frontend", "src", "pages", "pricing",
                               "rate-master", "ratePipelineInterpreter.ts"), encoding="utf-8").read()
        self.assertIn('map_attribute: ["table_from_ctx", "default_from_ctx"],', ts)
        self.assertIn('derive_attribute: ["constants_from_ctx"],', ts)
        self.assertIn('circuit_fit: ["usable_from_ctx"],', ts)


class TestElr3aRangesAndUsedBy(FrappeTestCase):
    """AC4 (owner Q4): a length more than 0, a conduit fill more than 0 and at most 1 -- derived from the arm that reads
    the input -- refused at the Rate Master save AND on upload. used_by derives the new inputs from the rate_refs."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.moved = _moved_configs(_asset())

    def test_01_the_ranges_come_from_the_arms(self):
        ranges = cv.pricing_input_ranges(self.moved)
        self.assertEqual(ranges, {i: (cv.RANGE_FILL if i.startswith("conduit_fill") else cv.RANGE_LENGTH) for i in _INPUTS})
        # NEGATIVE: v68 has no arm, so no input has a range -- every existing input keeps exactly today's rule
        self.assertEqual(cv.pricing_input_ranges({c["category_id"]: c for c in _asset()["category_configs"]}), {})

    def test_02_the_value_rule_both_ways(self):
        v = csv_importer.validate_pricing_input_value
        L, F = cv.RANGE_LENGTH, cv.RANGE_FILL
        self.assertEqual(v(0, "Stretch (factor)", L), "Stretch (factor): a length must be more than 0 (got 0).")
        self.assertEqual(v(0, "Fill (factor)", F), "Fill (factor): a conduit fill must be more than 0 and at most 1 (got 0).")
        self.assertEqual(v(1.2, "Fill (factor)", F), "Fill (factor): a conduit fill must be more than 0 and at most 1 (got 1.2).")
        # INVERTED at ELR-4c (owner R-ELR2 (h) "check the range first"; P6 "Q2 a") by mechanical authority. BEFORE:
        # assertIn("cannot be negative", v(-5, "Stretch (factor)", L)). NOW the range answers a negative on a ranged input.
        self.assertEqual(v(-5, "Stretch (factor)", L), "Stretch (factor): a length must be more than 0 (got -5).")
        self.assertNotIn("cannot be negative", v(-5, "Stretch (factor)", L))
        self.assertIn("is not a number", v("abc", "Fill (factor)", F))
        for ok, rng in ((15, L), (0.001, L), (1, F), (0.55, F), (0.47, F)):
            self.assertIsNone(v(ok, "x", rng), (ok, rng))
        # NEGATIVE: an input no arm reads keeps today's rule -- ZERO allowed (three inputs are 0% by ruling)
        self.assertIsNone(v(0, "discount"))
        self.assertIsNone(v(1.2, "discount"))

    def test_02b_ELR4C_the_range_is_checked_before_cannot_be_negative(self):
        """ELR-4c (owner R-ELR2 (h): "check the range first (before 'cannot be negative')"; P6 "Q2 a")."""
        v = csv_importer.validate_pricing_input_value
        L, F = cv.RANGE_LENGTH, cv.RANGE_FILL
        self.assertEqual(v(-0.1, "Conduit fill - PVC 25 mm (factor)", F),
                         "Conduit fill - PVC 25 mm (factor): a conduit fill must be more than 0 and at most 1 (got -0.1).")
        self.assertEqual(v(-15, "Point wiring - circuit length of the first point (factor)", L),
                         "Point wiring - circuit length of the first point (factor): a length must be more than 0 (got -15).")
        # NEGATIVE: an input no arm reads keeps today's words for a negative, and still allows zero
        self.assertIn("cannot be negative", v(-0.2, "discount"))
        self.assertIsNone(v(0, "discount"))

    def test_02c_ELR4C_both_write_paths_give_the_range_sentence_for_a_negative(self):
        """The Rate Master save (update and create) and the upload preview, each with the range supplied by a stub and every
        write blocked -- no live row is touched (the ELR-3a incident rule)."""
        live = frappe.db.get_value("BoQ Rate Master Item", self._hvac_input("flexible_duct_length_m"),
                                   ["discipline", "kind", "brand", "unit", "attributes", "rates", "item_uid"], as_dict=True)
        copy_doc = frappe.get_doc(dict(live, doctype="BoQ Rate Master Item", name=_FIXTURE_NAME, active=1))
        real_get_doc = frappe.get_doc

        def get_doc(*args, **kwargs):
            if args == ("BoQ Rate Master Item", _FIXTURE_NAME):
                return copy_doc
            return real_get_doc(*args, **kwargs)

        with _writes_blocked(), mock.patch.object(rate_master.frappe, "get_doc", side_effect=get_doc),                 mock.patch.object(csv_importer, "pricing_input_ranges_for", return_value={"flexible_duct_length_m": cv.RANGE_LENGTH}):
            with self.assertRaises(frappe.ValidationError) as cm:
                rate_master.update_rate_master_item(name=_FIXTURE_NAME, rates_patch=json.dumps({"factor": -2}))
        self.assertNotIsInstance(cm.exception, _WriteReached)
        self.assertIn("Flexible duct length per piece (factor): a length must be more than 0 (got -2).", str(cm.exception))
        self.assertNotIn("cannot be negative", str(cm.exception))
        with _writes_blocked(), mock.patch.object(csv_importer, "pricing_input_ranges_for",
                                                  return_value={"elr3a_test_fill": cv.RANGE_FILL}):
            with self.assertRaises(frappe.ValidationError) as cm:
                rate_master.create_rate_master_item(
                    discipline="HVAC", kind="hvac_pricing_input", unit="fraction",
                    attributes=json.dumps({"item": "elr3a_test_fill", "name": "ELR-3a test fill"}),
                    rates=json.dumps({"factor": -0.1}))
        self.assertNotIsInstance(cm.exception, _WriteReached)
        self.assertIn("ELR-3a test fill (factor): a conduit fill must be more than 0 and at most 1 (got -0.1).", str(cm.exception))
        # the upload preview (writes nothing): the same sentence for a negative typed into the downloaded file
        cat = self._pi_category("HVAC")
        text, _h, _n = csv_exporter.build_category_csv("HVAC", cat)
        rows = list(csv.reader(io.StringIO(text)))
        fi = next(i for i, h in enumerate(rows[0]) if h.split(" [")[0] == "factor")
        ri = next(i for i, r in enumerate(rows) if "Flexible duct length per piece" in r)
        rows[ri][fi] = "-3"
        buf = io.StringIO()
        csv.writer(buf, lineterminator="\r\n").writerows(rows)
        with mock.patch.object(csv_importer, "pricing_input_ranges_for",
                               return_value={"flexible_duct_length_m": cv.RANGE_LENGTH}):
            plan = csv_importer.build_plan("HVAC", buf.getvalue().encode("utf-8"), category_id=cat)
        msgs = [e["message"] for e in plan.get("errors") or []]
        self.assertIn("Flexible duct length per piece (factor): a length must be more than 0 (got -3).", msgs)
        # NEGATIVE: with no range the same negative keeps today's words on the save path
        with self.assertRaises(frappe.ValidationError) as cm:
            rate_master._guard_pricing_input_values("hvac_pricing_input", {"factor": -1}, "HVAC", {"item": "x"})
        self.assertIn("cannot be negative", str(cm.exception))

    def test_03_the_RATE_MASTER_SAVE_refuses_by_name_and_writes_nothing(self):
        """The real endpoints, with the range supplied by a stub -- refused before any write.

        ⚠️ ELR-3a INCIDENT (2026-10-28 18:35, owner (a)): this test first drove the endpoint on the LIVE flexible duct
        input, and a vacuity break of the range check let the "expected refusal" save factor 0 on a live row. It now
        touches NO live row: the update runs on an in-memory COPY under a name no row has, and every write the endpoint
        could reach (a document save / insert / delete, a set_value, a write statement) raises `_WriteReached` instead.
        A broken guard therefore fails this test; it can never write."""
        live = frappe.db.get_value("BoQ Rate Master Item", self._hvac_input("flexible_duct_length_m"),
                                   ["discipline", "kind", "brand", "unit", "attributes", "rates", "item_uid"], as_dict=True)
        copy_doc = frappe.get_doc(dict(live, doctype="BoQ Rate Master Item", name=_FIXTURE_NAME, active=1))
        real_get_doc = frappe.get_doc

        def get_doc(*args, **kwargs):
            if args == ("BoQ Rate Master Item", _FIXTURE_NAME):
                return copy_doc
            return real_get_doc(*args, **kwargs)

        with _writes_blocked(), mock.patch.object(rate_master.frappe, "get_doc", side_effect=get_doc),                 mock.patch.object(csv_importer, "pricing_input_ranges_for",
                                  return_value={"flexible_duct_length_m": cv.RANGE_LENGTH}):
            with self.assertRaises(frappe.ValidationError) as cm:
                rate_master.update_rate_master_item(name=_FIXTURE_NAME, rates_patch=json.dumps({"factor": 0}))
        self.assertNotIsInstance(cm.exception, _WriteReached)
        self.assertIn("Flexible duct length per piece (factor): a length must be more than 0 (got 0).", str(cm.exception))
        # and a fill on the CREATE path (no fixture needed: nothing exists to change, and the insert is blocked)
        with _writes_blocked(), mock.patch.object(csv_importer, "pricing_input_ranges_for",
                                                  return_value={"elr3a_test_fill": cv.RANGE_FILL}):
            with self.assertRaises(frappe.ValidationError) as cm:
                rate_master.create_rate_master_item(
                    discipline="HVAC", kind="hvac_pricing_input", unit="fraction",
                    attributes=json.dumps({"item": "elr3a_test_fill", "name": "ELR-3a test fill"}),
                    rates=json.dumps({"factor": 1.2}))
        self.assertNotIsInstance(cm.exception, _WriteReached)
        self.assertIn("ELR-3a test fill (factor): a conduit fill must be more than 0 and at most 1 (got 1.2).", str(cm.exception))

    def test_03b_the_write_block_itself_blocks(self):
        """The guard on the guard: inside `_writes_blocked` a save, an insert, a set_value and a write statement all
        raise -- so test_03's safety does not rest on the range check it is testing."""
        doc = frappe.get_doc({"doctype": "BoQ Rate Master Item", "name": _FIXTURE_NAME})
        with _writes_blocked():
            for attempt in (doc.save, doc.insert, lambda: frappe.db.set_value("BoQ Rate Master Item", _FIXTURE_NAME, "unit", "x"),
                            lambda: frappe.db.sql('update "tabBoQ Rate Master Item" set unit=%s where name=%s', ("x", _FIXTURE_NAME))):
                with self.assertRaises(_WriteReached):
                    attempt()
            frappe.db.sql("select 1")          # a read still works

    def test_04_NEGATIVE_the_save_with_no_range_is_todays_rule(self):
        """Without a range (every input today) a zero is still refused by nothing and a negative by the old rule."""
        self.assertIsNone(rate_master._guard_pricing_input_values("hvac_pricing_input", {"factor": 0}, "HVAC",
                                                                 {"item": "elr3a_no_such_input"}))
        with self.assertRaises(frappe.ValidationError):
            rate_master._guard_pricing_input_values("hvac_pricing_input", {"factor": -1}, "HVAC", {"item": "x"})

    def test_05_the_UPLOAD_refuses_by_name(self):
        """The real upload preview (`build_plan`, writes nothing) over the downloaded HVAC Pricing Inputs file with one
        cell edited -- the range again supplied by a stub, so no live configuration is touched."""
        cat = self._pi_category("HVAC")
        text, _h, n = csv_exporter.build_category_csv("HVAC", cat)
        rows = list(csv.reader(io.StringIO(text)))
        fi = next(i for i, h in enumerate(rows[0]) if h.split(" [")[0] == "factor")
        ri = next(i for i, r in enumerate(rows) if "Flexible duct length per piece" in r)   # the file shows the name
        rows[ri][fi] = "0"
        buf = io.StringIO()
        csv.writer(buf, lineterminator="\r\n").writerows(rows)
        with mock.patch.object(csv_importer, "pricing_input_ranges_for",
                               return_value={"flexible_duct_length_m": cv.RANGE_LENGTH}):
            plan = csv_importer.build_plan("HVAC", buf.getvalue().encode("utf-8"), category_id=cat)
        msgs = [e["message"] for e in plan.get("errors") or []]
        self.assertIn("Flexible duct length per piece (factor): a length must be more than 0 (got 0).", msgs)
        # NEGATIVE: the same file with no edit uploads as no change, ranges on
        with mock.patch.object(csv_importer, "pricing_input_ranges_for",
                               return_value={"flexible_duct_length_m": cv.RANGE_LENGTH}):
            plan0 = csv_importer.build_plan("HVAC", text.encode("utf-8"), category_id=cat)
        self.assertEqual(plan0.get("errors") or [], [])
        self.assertEqual((plan0.get("counts") or {}).get("unchanged"), n)

    def test_06_both_write_paths_pass_the_discipline_and_the_attributes(self):
        src = open(rate_master.__file__, encoding="utf-8").read()
        self.assertIn("_guard_pricing_input_values(doc.kind, rates_patch, doc.discipline, attributes)", src)
        self.assertIn("_guard_pricing_input_values(kind, rates, discipline, attributes)", src)
        imp = open(csv_importer.__file__, encoding="utf-8").read()
        self.assertIn("pi_ranges = pricing_input_ranges_for(discipline)", imp)

    def test_07_used_by_derives_the_nine_with_no_code_of_its_own(self):
        used = csv_exporter.pricing_input_used_by(self.moved)
        for iid in _INPUTS:
            self.assertEqual(used[iid], (3, ["point_wiring"]), iid)
        before = csv_exporter.pricing_input_used_by({c["category_id"]: c for c in _asset()["category_configs"]})
        for iid, v in before.items():
            self.assertEqual(used[iid], v, iid)

    # ---------- helpers ----------
    @staticmethod
    def _hvac_input(item):
        for r in frappe.get_all("BoQ Rate Master Item", filters={"discipline": "HVAC", "kind": "hvac_pricing_input", "active": 1},
                                fields=["name", "attributes"]):
            a = r["attributes"] if isinstance(r["attributes"], dict) else json.loads(r["attributes"] or "{}")
            if a.get("item") == item:
                return r["name"]
        raise AssertionError("%s is not loaded" % item)

    @staticmethod
    def _pi_category(discipline):
        return {"HVAC": "hvac_pricing_inputs", "Electrical": "electrical_pricing_inputs"}[discipline]


class TestElr3aReadBack(FrappeTestCase):
    """AC6 (owner Q3): the n x 5 read-back multiplies by the LIVE "per further point" input. Proved with a SYNTHETIC
    reply through the real `_extract_batch`, the input stubbed at 5 (the stored length is today's) and at a scratch 6
    (it follows) -- no model call, and the question the model is asked is identical either way."""

    ROW = {"excel_row": 11, "description": "Secondary wiring for 4 loop points", "sheet_name": "S",
           "committed_version": 1, "category_id": "point_wiring", "ancestors": [], "notes": {}}

    def _run(self, per_point):
        configs = {("Electrical", c["category_id"]): c for c in _asset()["category_configs"]}
        gc = extraction._group_context(configs, "Electrical", "point_wiring")
        self.assertEqual(gc["code_attrs"], {"point_type"}, "the point_wiring context did not load -- the proof would be vacuous")
        sent = []

        class _Block:
            text = json.dumps([{"id": 11, "attributes": {"points": {"value": 4, "confidence": 0.9}}}])

        class _Resp:
            content = [_Block()]
            stop_reason = "end_turn"
            usage = None

        class _Messages:
            def create(self, **kw):
                sent.append(kw["messages"][0]["content"])
                return _Resp()

        class _Client:
            messages = _Messages()

        with mock.patch.object(extraction, "_capture_path", return_value=None), \
                mock.patch.object(extraction, "secondary_length_per_point", return_value=per_point) as reader:
            out = extraction._extract_batch(
                _Client(), "stub-model", gc["prompt"], gc["defs"], [dict(self.ROW)], gc["synonyms"], gc["defaults"],
                gc["none_guidance"], gc["slot_spec"], gc["resolution_rules"], gc["rules"], gc["pole_catalog"],
                gc["code_attrs"], gc["absent_rules"], gc["conductor_groups"], gc["paired_fill"], gc["module_count_attrs"],
                gc["inch_trade"], gc.get("items_spec"))
        return out[11], sent[0], reader.call_count

    def test_01_at_5_the_stored_length_is_todays_20_and_at_6_it_follows(self):
        r5, q5, n5 = self._run(5.0)
        r6, q6, _ = self._run(6.0)
        self.assertEqual(r5["point_type"]["value"], "Secondary")
        self.assertEqual(r5["circuit_length_m"]["value"], 20)
        self.assertIsInstance(r5["circuit_length_m"]["value"], int)    # 20, never 20.0: byte-identical to the literal era
        self.assertEqual(r6["circuit_length_m"]["value"], 24)
        self.assertEqual(q5, q6, "the model's question must not change with the input")
        self.assertEqual(n5, 1, "the input is read once per batch")

    def test_02_NEGATIVE_no_input_writes_no_length(self):
        r, _q, _n = self._run(None)
        self.assertEqual(r["point_type"]["value"], "Secondary")
        self.assertIsNone((r.get("circuit_length_m") or {}).get("value"))

    def test_03_the_function_itself(self):
        item = {"description": "Secondary wiring for 4 loop points"}
        self.assertEqual(extraction.secondary_length_m(item, 5), 20)
        self.assertEqual(extraction.secondary_length_m(item, 6.5), 26)
        self.assertIsNone(extraction.secondary_length_m(item))         # no input -> no length (never a guessed 5)
        self.assertIsNone(extraction.secondary_length_m({"description": "Primary and secondary wiring for 4 light points"}, 5))

    def test_04_the_reader_reads_the_live_input_by_id(self):
        rows = [{"attributes": {"item": "swsock"}, "rates": {"discount": 0.75}},
                {"attributes": json.dumps({"item": extraction.SECONDARY_LENGTH_INPUT}), "rates": json.dumps({"factor": 5})}]
        with mock.patch.object(extraction.frappe, "get_all", return_value=rows) as ga:
            self.assertEqual(extraction.secondary_length_per_point(), 5.0)
        self.assertEqual(ga.call_args.kwargs["filters"], {"active": 1, "kind": "electrical_pricing_input"})
        for bad in (0, -5, "5", None, float("nan")):
            rows[1]["rates"] = {"factor": bad}
            with mock.patch.object(extraction.frappe, "get_all", return_value=rows):
                self.assertIsNone(extraction.secondary_length_per_point(), bad)
        with mock.patch.object(extraction.frappe, "get_all", return_value=rows[:1]):
            self.assertIsNone(extraction.secondary_length_per_point())
        self.assertEqual(extraction.SECONDARY_LENGTH_INPUT, "pw_circuit_length_further")


# ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
# COMMIT 2 -- Electrical v69 (AC2), the examples key, the model's question (AC6 stub proof), and the live round trip (AC3)
# ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
_V69 = "rate_master_electrical_all_v69.json"
_NAMES = {
    "pw_circuit_length_first": ("Point wiring - circuit length of the first point", 15, "m"),
    "pw_circuit_length_further": ("Point wiring - circuit length per further point", 5, "m"),
    "pw_circuit_stretch": ("Point wiring - circuit wiring stretch, DB to the first point", 30, "m"),
    "conduit_fill_pvc_25": ("Conduit fill - PVC 25 mm", 0.55, "fraction of the bore"),
    "conduit_fill_pvc_32": ("Conduit fill - PVC 32 mm", 0.55, "fraction of the bore"),
    "conduit_fill_pvc_50": ("Conduit fill - PVC 50 mm", 0.55, "fraction of the bore"),
    "conduit_fill_ms_25": ("Conduit fill - MS 25 mm", 0.45, "fraction of the bore"),
    "conduit_fill_ms_32": ("Conduit fill - MS 32 mm", 0.45, "fraction of the bore"),
    "conduit_fill_ms_50": ("Conduit fill - MS 50 mm", 0.47, "fraction of the bore"),
}


class TestElr3aV69(FrappeTestCase):
    """AC2: v69 = v68 + the nine inputs + point_wiring's declared change, and nothing else."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.v68, cls.v69 = _asset(), _asset(_V69)

    def test_01_items_are_v68_plus_nine_and_no_other_item_changes(self):
        old = {it["item_uid"]: it for it in self.v68["items"]}
        new = {it["item_uid"]: it for it in self.v69["items"]}
        self.assertEqual(set(old) - set(new), set())
        for uid, it in old.items():
            self.assertEqual(new[uid], it, uid)                 # the 1,367 SKUs and the 35 existing inputs, byte for byte
        added = [new[u] for u in sorted(set(new) - set(old))]
        self.assertEqual(len(added), 9)
        got = {it["attributes"]["item"]: (it["attributes"]["name"], it["rates"], it["unit"], it["kind"]) for it in added}
        self.assertEqual(got, {k: (n, {"factor": v}, u, "electrical_pricing_input") for k, (n, v, u) in _NAMES.items()})
        self.assertEqual(len(new), 1411)

    def test_02_only_point_wiring_changes_and_only_as_declared(self):
        old = {c["category_id"]: c for c in self.v68["category_configs"]}
        new = {c["category_id"]: c for c in self.v69["category_configs"]}
        self.assertEqual(set(old), set(new))
        for cid in old:
            if cid != "point_wiring":
                self.assertEqual(new[cid], old[cid], cid)
        self.assertEqual(sorted(k for k in self.v69 if k != "category_configs" and k != "items"),
                         sorted(k for k in self.v68 if k != "category_configs" and k != "items"))
        for k in self.v68:
            if k not in ("category_configs", "items"):
                self.assertEqual(self.v69[k], self.v68[k], k)
        # point_wiring: the twelve literals became references, 27 rate_ref appended, impact_examples added -- nothing else
        expect = _moved_configs(self.v68)["point_wiring"]
        got = copy.deepcopy(new["point_wiring"])
        self.assertEqual([e["id"] for e in got.pop("impact_examples")], ["E1", "E2", "E3", "E4", "E5", "E6", "E7"])
        for pid in _PIPES:
            for s_got, s_exp in zip(got["pipelines"][pid]["steps"], expect["pipelines"][pid]["steps"]):
                s_got.pop("explain", None), s_exp.pop("explain", None)
            self.assertEqual(got["pipelines"][pid]["steps"], expect["pipelines"][pid]["steps"], pid)
        got.pop("pipelines"), expect.pop("pipelines")
        self.assertEqual(got, expect)

    def test_03_the_prose_names_the_input_instead_of_15_5_30(self):
        pw = next(c for c in self.v69["category_configs"] if c["category_id"] == "point_wiring")
        import re
        for pid in _PIPES:
            for s in pw["pipelines"][pid]["steps"]:
                p = s.get("params") or {}
                if s["step"] in ("map_attribute", "derive_attribute") and p.get("result_attr") in ("circuit_length_m", "circuit_wire_length_m"):
                    self.assertIsNone(re.search(r"\b(15|5|30)\s*m\b|\b15/5\b|\b(15|5|30)\b(?! *SWG)", s["explain"]), (pid, s["explain"][:120]))
                    self.assertTrue(any(n in s["explain"] for n, _v, _u in _NAMES.values()), pid)

    def test_04_v69_validates_and_its_ranges_are_the_nine(self):
        for c in self.v69["category_configs"]:
            cv._validate_config(c)
        self.assertEqual(cv.pricing_input_ranges({c["category_id"]: c for c in self.v69["category_configs"]}),
                         {i: (cv.RANGE_FILL if i.startswith("conduit_fill") else cv.RANGE_LENGTH) for i in _NAMES})

    def test_05_NEGATIVE_impact_examples_are_refused_by_name(self):
        pw = next(c for c in self.v69["category_configs"] if c["category_id"] == "point_wiring")
        for mutate, fragment in (
                (lambda ex: ex[0]["attrs"].__setitem__("no_such_attr", 1), "attribute 'no_such_attr' is not declared"),
                (lambda ex: ex[1].__setitem__("id", "E1"), "repeats the id 'E1'"),
                (lambda ex: ex[2].__setitem__("colour", "x"), "unknown key(s): colour"),
                (lambda ex: ex[3].pop("name"), "needs a non-empty string 'name'"),
                (lambda ex: ex[4].__setitem__("attrs", {}), "needs a non-empty 'attrs' object"),
                (lambda ex: ex.clear(), "must be a non-empty list")):
            c = copy.deepcopy(pw)
            mutate(c["impact_examples"])
            with self.assertRaises(frappe.ValidationError) as cm:
                cv._validate_config(c)
            self.assertIn(fragment, str(cm.exception))

    def test_06_STUB_PROOF_the_models_question_is_byte_identical_v68_v69(self):
        """AC6: `_group_context` -- everything the extraction prompt is built from -- for every Electrical category and the
        two HVAC aliases, v68 vs v69, byte for byte. No call is made."""
        hv = _asset("rate_master_hvac_all_v54.json")
        out = {}
        for tag, a in (("v68", self.v68), ("v69", self.v69)):
            configs = {("Electrical", c["category_id"]): dict(c, discipline="Electrical") for c in a["category_configs"]}
            configs.update({("HVAC", c["category_id"]): dict(c, discipline="HVAC") for c in hv["category_configs"]})
            out[tag] = {}
            for (disc, cid) in sorted(configs):
                if disc == "HVAC" and cid not in ("hvac_cables", "hvac_raceway"):
                    continue
                out[tag][cid] = json.dumps(extraction._group_context(configs, disc, cid), sort_keys=True, default=str)
        self.assertEqual(set(out["v68"]), set(out["v69"]))
        self.assertGreater(len(set(out["v68"].values())), 3, "the contexts hash alike -- the comparison would be vacuous")
        for cid in out["v68"]:
            self.assertEqual(out["v69"][cid], out["v68"][cid], cid)


class TestElr3aLive(FrappeTestCase):
    """AC3 / AC6 against the LIVE (dev) catalogue with v69 loaded. READ-ONLY: a download, a preview (`build_plan` never
    writes) and a read of the input."""

    def test_01_the_pricing_inputs_download_previews_as_ZERO_changes_nine_rows_included(self):
        text, _h, n = csv_exporter.build_category_csv("Electrical", "electrical_pricing_inputs")
        for name, _v, _u in _NAMES.values():
            self.assertIn(name, text)
        plan = csv_importer.build_plan("Electrical", text.encode("utf-8"), category_id="electrical_pricing_inputs")
        self.assertEqual(plan.get("errors") or [], [])
        counts = plan.get("counts") or {}
        self.assertEqual((counts.get("unchanged"), counts.get("rates_changed"), counts.get("items_added")), (n, 0, 0))
        self.assertEqual(n, 44)

    def test_02_the_read_back_reads_the_live_input(self):
        self.assertEqual(extraction.secondary_length_per_point(), 5.0)
