# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""SLICE 1c -- THE SPEC READER: item name + item detail are the source of truth for an opted-in
category's attributes (owner rulings S-a..S-e, quoted in services/boq_rate_master/spec_reader.py).

Plain-English coverage (positive AND negative):
  t01  THE REPRODUCTION (S-c 1): run over every v2 item's text, the reader yields EXACTLY the v1
       attributes of the same item_uid -- 95 of 95, no difference tolerated.
  t02  THE SLICE 1a RULINGS, each by name: "9/10 NM" is torque 10; "1:10 /12" is ratio 12; row 33's
       "1200MM X300MM" is a FACE size with no neck; "eye ball" and jet are ONE family; the canvas row
       is three items of three units sharing one text.
  t03  NEVER A GUESS (S-c 2): an unknown family, and a known family with an unreadable size, are NOT
       understood -- each with a precise reason and NO derived attribute; `attributes_for` then stores
       the text plus the two flag keys and nothing else.
  t04  the ONE stored shape: understood = text keys + derived keys; the reader is deterministic.
  t05  HVAC CSV (S-b / U1): Mode A header is exactly the identity columns, item_name, item_detail, the
       four rate columns, the provenance pair -- no derived column; 95 rows; rows 89 and 91 carry
       cost_install 0 (S-d). Mode B likewise.
  t06  ELECTRICAL UNCHANGED (U5, the negative guard): no Electrical config carries the key, the resolver
       returns {} for it, and its Mode A / Mode B headers are the pre-slice construction to the byte.
  t07  IMPORT (D6): an untouched re-upload plans zero changes; a NEW row with only text + unit + numbers
       gets read attributes; a CHANGED detail is re-read; an UNCHANGED row keeps its attributes even when
       the derived columns are present-but-blank; an UNREADABLE row is planned and saved FLAGGED;
       NEGATIVE: a hand-typed derived value is refused by name; a new row without item_name is refused.
  t08  MANUAL ADD / EDIT (D7, S-c 3): the endpoints take text only and run the same reader; NEGATIVE: a
       derived key in `attributes` / `attributes_patch` is refused; an unchanged text leaves the
       stored attributes untouched; an unreadable text is saved flagged.
  t09  v1 -> v2 IDENTITY (D9): item_uids identical and in the same order; unit / kind / source identical;
       v2 attributes == text + v1 attributes; rates identical except the two S-d zeros.
  t10  the v2 config validates; the two text defs are never a model question nor a pricing input
       (selector:false + panel:false); the key is read as `is True` only (a string does not opt in).
  t11  a category without the key: the legacy create path still refuses an unknown attribute.
"""

import copy
import json
import os

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq import rate_master
from nirmaan_stack.services.boq_rate_master import (
    config_validation,
    csv_exporter,
    csv_importer,
    exporter,
    loader,
    spec_reader,
)

_DATA_DIR = os.path.join(os.path.dirname(loader.__file__), "data")
V1_ASSET = "rate_master_hvac_all_v1.json"
V2_ASSET = "rate_master_hvac_all_v2.json"
ELECTRICAL_ASSET = "rate_master_electrical_all_v63.json"

ITEM = "BoQ Rate Master Item"
CONFIG = "BoQ Rate Category Config"


def _asset(name):
    with open(os.path.join(_DATA_DIR, name), "r", encoding="utf-8") as fh:
        return json.load(fh)


def _by_uid(payload):
    return {it["item_uid"]: it for it in payload["items"]}


class TestSpecReader(FrappeTestCase):
    _disciplines = set()

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.v1 = _asset(V1_ASSET)
        cls.v2 = _asset(V2_ASSET)
        # ONE read-only fixture for the read tests: v2 loaded under a fresh test discipline.
        cls.ro_disc = cls._mk_disc()
        cls._load(cls.v2, cls.ro_disc)

    @classmethod
    def tearDownClass(cls):
        for disc in cls._disciplines:
            frappe.db.delete("BoQ Rate Master Snapshot", {"discipline": disc})
            for dt in (CONFIG, ITEM, "BoQ Rate Master Retirement"):
                for r in frappe.get_all(dt, filters={"discipline": disc}, fields=["name"]):
                    frappe.db.delete("Version", {"ref_doctype": dt, "docname": r.name})
            frappe.db.delete(ITEM, {"discipline": disc})
            frappe.db.delete(CONFIG, {"discipline": disc})
            frappe.db.delete("BoQ Rate Master Retirement", {"discipline": disc})
        frappe.db.commit()
        super().tearDownClass()

    @classmethod
    def _mk_disc(cls):
        disc = "TEST_RM_" + frappe.generate_hash(length=8)
        cls._disciplines.add(disc)
        return disc

    @classmethod
    def _load(cls, payload, disc):
        p = copy.deepcopy(payload)
        p["discipline"] = disc
        return loader.load_rate_master(payload=p)

    def _new_disc(self):
        return type(self)._mk_disc()

    def _item(self, disc, row, unit=None):
        f = {"discipline": disc, "active": 1, "source_row": row}
        if unit:
            f["unit"] = unit
        rows = frappe.get_all(ITEM, filters=f, fields=["name", "unit", "attributes", "rates"])
        self.assertEqual(len(rows), 1, (row, unit, rows))
        r = rows[0]
        r["attributes"] = rate_master._parse_json(r["attributes"], {})
        r["rates"] = rate_master._parse_json(r["rates"], {})
        return r

    # -- t01 ----------------------------------------------------------------------------------------
    def test_t01_the_reader_reproduces_all_95_v1_items_exactly(self):
        v1, v2 = _by_uid(self.v1), _by_uid(self.v2)
        self.assertEqual(len(v1), 95)
        self.assertEqual(set(v1), set(v2))
        diffs = []
        for uid, it in v2.items():
            name, detail = spec_reader.text_of(it["attributes"])
            derived, reason = spec_reader.read_spec("hvac_adp", name, detail, it["unit"])
            if reason is not None or derived != v1[uid]["attributes"]:
                diffs.append((it["source"]["row"], it["unit"], name, detail, reason, derived, v1[uid]["attributes"]))
        self.assertEqual(diffs, [], "the reader must reproduce every v1 item; differences: %r" % (diffs,))

    # -- t02 ----------------------------------------------------------------------------------------
    def test_t02_the_slice_1a_rulings_by_name(self):
        r = spec_reader.read_adp_spec
        self.assertEqual(r("Fire Damper Actuator", "9/10 NM")["torque_nm"], 10.0)          # R-d (1)
        self.assertEqual(r("Fire Damper Actuator", "20 NM")["torque_nm"], 20.0)
        self.assertEqual(r("Fire damper Control Panel", "1:10 /12")["panel_ratio"], 12.0)   # R-d (2)
        self.assertEqual(r("Fire damper Control Panel", "1:8")["panel_ratio"], 8.0)
        # row 33: a bare W x H on a square diffuser is a FACE size, neck NA (R-d 6)
        row33 = [it for it in self.v2["items"] if it["source"]["row"] == 33]
        self.assertEqual(len(row33), 1)
        a = row33[0]["attributes"]
        self.assertEqual(a["family"], "square diffuser")
        self.assertEqual((a["face_w_mm"], a["face_h_mm"]), (1200.0, 300.0))
        self.assertNotIn("neck_mm", a)
        # eyeball + jet are ONE family (R-d 4)
        self.assertEqual(r("Jet / Eye Ball Diffuser", "200 mm dia")["family"], "jet / eyeball diffuser")
        # the canvas row is THREE items of three units sharing one text (R-d 3)
        canvas = [it for it in self.v2["items"] if it["source"]["row"] == 80]
        self.assertEqual(sorted(it["unit"] for it in canvas), ["NOS", "RMT", "SQM"])
        self.assertEqual(len({spec_reader.text_of(it["attributes"]) for it in canvas}), 1)
        self.assertTrue(all(it["attributes"]["family"] == "canvas connection" for it in canvas))

    # -- t03 ----------------------------------------------------------------------------------------
    def test_t03_never_a_guess_unknown_family_and_unreadable_size_are_not_understood(self):
        cases = [
            (("Widget of unknown kind", "12 mm"), "no known ADP family"),
            (("Round Diffuser with damper", "no size given"), "no diameter found"),
            (("Butterfly Damper", "large"), "no diameter found"),
            (("Access Door", "big"), "no size found"),
            (("Double Skin Plenum", "thick"), "no thickness found"),
            (("Fire Damper Actuator", "strong"), "no torque found"),
            (("Fire damper Control Panel", "1/12"), "not of the form '1:N'"),
            (("Grill", "something else"), "names none of"),
            (("Fire Damper", "gold plated"), "names none of"),
            (("Volume control Damper (VCD)", "Titanium"), "not one of"),
            (("Diffuser with damper", "NECK: 300X450"), "not square"),
            (("", "300 mm dia"), "Item is blank"),
        ]
        for (name, detail), needle in cases:
            derived, reason = spec_reader.read_spec("hvac_adp", name, detail, "Nos")
            self.assertEqual(derived, {}, (name, detail))
            self.assertIsNotNone(reason, (name, detail))
            self.assertIn(needle, reason, (name, detail, reason))
            stored, reason2 = spec_reader.attributes_for("hvac_adp", name, detail, "Nos")
            self.assertEqual(reason2, reason)
            self.assertEqual(set(stored), {"item_name", "item_detail",
                                           spec_reader.SPEC_STATUS_ATTR, spec_reader.SPEC_NOTE_ATTR})
            self.assertEqual(stored[spec_reader.SPEC_STATUS_ATTR], spec_reader.NOT_UNDERSTOOD)
            self.assertEqual(stored[spec_reader.SPEC_NOTE_ATTR], reason)
            self.assertTrue(spec_reader.is_not_understood(stored))
        # a category with no reader is a CONFIGURATION error, raised, never passed through
        with self.assertRaises(KeyError):
            spec_reader.read_spec("no_such_category", "x", "y")

    # -- t04 ----------------------------------------------------------------------------------------
    def test_t04_the_one_stored_shape_and_determinism(self):
        a, reason = spec_reader.attributes_for("hvac_adp", "Diffuser with damper", "NECK: 375X375", "Nos")
        self.assertIsNone(reason)
        self.assertEqual(list(a)[:2], ["item_name", "item_detail"])
        self.assertEqual(a["item_name"], "Diffuser with damper")
        self.assertEqual(a["item_detail"], "NECK: 375X375")
        self.assertEqual(a["family"], "square diffuser")
        self.assertEqual(a["damper"], "with")
        self.assertEqual(a["neck_mm"], 375.0)
        self.assertNotIn(spec_reader.SPEC_STATUS_ATTR, a)
        self.assertFalse(spec_reader.is_not_understood(a))
        b, _ = spec_reader.attributes_for("hvac_adp", "Diffuser with damper", "NECK: 375X375", "Nos")
        self.assertEqual(a, b)

    # -- t05 ----------------------------------------------------------------------------------------
    def test_t05_hvac_csv_carries_text_and_rates_and_no_derived_column(self):
        disc = self.ro_disc
        self.assertEqual(spec_reader.spec_categories(disc), {"hvac_adp_item": "hvac_adp"})
        text, headers, n = csv_exporter.build_category_csv(disc, "hvac_adp")
        self.assertEqual(headers, ["item_uid", "kind", "brand", "unit", "item_name", "item_detail",
                                   "cost_install", "cost_supply", "install_markup", "supply_markup",
                                   "source_sheet", "source_row"])
        self.assertEqual(n, 95)
        for derived in spec_reader.ADP_DERIVED_ATTRS + spec_reader.RESERVED_ATTRS:
            self.assertNotIn(derived, headers)
        rows = list(__import__("csv").reader(text.lstrip("﻿").splitlines()))
        hdr, body = rows[0], rows[1:]
        self.assertEqual(hdr, headers)
        ci, ri = hdr.index("cost_install"), hdr.index("source_row")
        by_row = {}
        for r in body:
            by_row.setdefault(r[ri], []).append(r[ci])
        self.assertEqual(by_row["89"], ["0.0"])
        self.assertEqual(by_row["91"], ["0.0"])
        # Mode B: same text-first rule, the category column in place
        text_b, headers_b, n_b = csv_exporter.build_all_categories_csv(disc)
        self.assertEqual(headers_b, ["item_uid", "category", "kind", "brand", "unit", "item_name", "item_detail",
                                     "cost_install", "cost_supply", "install_markup", "supply_markup",
                                     "source_sheet", "source_row"])
        self.assertEqual(n_b, 95)

    # -- t06 ----------------------------------------------------------------------------------------
    def test_t06_electrical_is_unchanged_no_key_no_branch_same_headers(self):
        e = _asset(ELECTRICAL_ASSET)
        self.assertTrue(all(spec_reader.CONFIG_KEY not in c for c in e["category_configs"]))
        disc = self._new_disc()
        self._load(e, disc)
        self.assertEqual(spec_reader.spec_categories(disc), {})
        items, kind_cat, cat_kinds = csv_exporter._load(disc)
        # the PRE-SLICE construction, recomputed here from the same rows: LEAD + sorted attrs + sorted
        # rates + TAIL for a category; LEAD[0], category, LEAD[1:] + union for all
        for cat in ("cabletray_raceway", "lighting_mgmt_system", "wiring_cabling"):
            rows_in = [it for it in items if it["kind"] in set(cat_kinds[cat])]
            attrs, rates = csv_exporter._keys_for(rows_in)
            expected = list(csv_exporter.LEAD_COLUMNS) + attrs + rates + list(csv_exporter.TAIL_COLUMNS)
            _t, headers, n = csv_exporter.build_category_csv(disc, cat)
            self.assertEqual(headers, expected, cat)
            self.assertEqual(n, len(rows_in))
            self.assertNotIn("item_name", headers)
        attrs, rates = csv_exporter._keys_for(items)
        expected_b = ([csv_exporter.LEAD_COLUMNS[0], csv_exporter.CATEGORY_COLUMN]
                      + list(csv_exporter.LEAD_COLUMNS[1:]) + attrs + rates + list(csv_exporter.TAIL_COLUMNS))
        _tb, headers_b, n_b = csv_exporter.build_all_categories_csv(disc)
        self.assertEqual(headers_b, expected_b)
        self.assertEqual(n_b, len(items))
        self.assertEqual(len(items), 1367)
        # an Electrical round trip is still a no-op, exactly as before
        text, _h, _n = csv_exporter.build_category_csv(disc, "cabletray_raceway")
        plan = csv_importer.build_plan(disc, text)
        self.assertEqual(plan["errors"], [])
        self.assertEqual(plan["changes"], [])

    # -- t07 ----------------------------------------------------------------------------------------
    def test_t07_import_reads_new_and_changed_rows_keeps_unchanged_flags_unreadable(self):
        disc = self._new_disc()
        self._load(self.v2, disc)
        text, headers, n = csv_exporter.build_category_csv(disc, "hvac_adp")
        # (a) untouched round trip: nothing to apply
        plan = csv_importer.build_plan(disc, text)
        self.assertEqual(plan["errors"], [])
        self.assertEqual(plan["changes"], [])
        self.assertEqual(plan["counts"]["unchanged"], 95)

        lines = text.lstrip("﻿").split("\r\n")
        hdr = lines[0].split(",")
        col = {h: i for i, h in enumerate(hdr)}

        def row(**kw):
            cells = [""] * len(hdr)
            for k, v in kw.items():
                cells[col[k]] = v
            return ",".join(cells)

        # (b) a NEW row: name, detail, unit, the four numbers, blank uid -> read attributes
        new_line = row(kind="hvac_adp_item", unit="Nos", item_name="Diffuser with damper",
                       item_detail="NECK: 375X375", cost_supply="1200", cost_install="150",
                       supply_markup="0.45", install_markup="0.6")
        plan = csv_importer.build_plan(disc, "\r\n".join([lines[0], new_line]))
        self.assertEqual(plan["errors"], [])
        self.assertEqual(len(plan["changes"]), 1)
        ch = plan["changes"][0]
        self.assertEqual(ch["kind"], "add")
        self.assertEqual(ch["spec"]["status"], "ok")
        self.assertIsNone(ch["spec"]["reason"])
        self.assertEqual(ch["spec"]["read"], {"family": "square diffuser", "damper": "with", "neck_mm": 375.0})
        self.assertEqual(ch["_payload"]["attributes"]["item_name"], "Diffuser with damper")
        self.assertEqual(ch["_payload"]["attributes"]["neck_mm"], 375.0)
        self.assertIn("spec", csv_importer.public_plan(plan)["changes"][0])
        res = csv_importer.apply_plan(disc, "\r\n".join([lines[0], new_line]), expected_digest=plan["digest"])
        frappe.db.commit()
        self.assertEqual(res["items_added"], 1)
        added = frappe.get_all(ITEM, filters={"discipline": disc, "active": 1, "import_batch": res["batch"]},
                               fields=["item_uid", "attributes", "unit"])
        self.assertEqual(len(added), 1)
        a = rate_master._parse_json(added[0]["attributes"], {})
        self.assertEqual(a, {"item_name": "Diffuser with damper", "item_detail": "NECK: 375X375",
                             "family": "square diffuser", "damper": "with", "neck_mm": 375.0})
        new_uid = added[0]["item_uid"]

        # (c) a CHANGED detail on that row is re-read; (d) the derived columns present-but-blank on an
        # UNCHANGED row do not clear anything
        text2, _h2, _n2 = csv_exporter.build_category_csv(disc, "hvac_adp")
        lines2 = text2.lstrip("﻿").split("\r\n")
        hdr2 = lines2[0] + ",neck_mm,family"          # derived columns present, blank
        body2 = []
        for ln in lines2[1:]:
            if not ln:
                continue
            cells = ln.split(",")
            if cells[col["item_uid"]] == new_uid:
                cells[col["item_detail"]] = "NECK: 450X450"
            body2.append(",".join(cells) + ",,")
        plan2 = csv_importer.build_plan(disc, "\r\n".join([hdr2] + body2))
        self.assertEqual(plan2["errors"], [])
        self.assertEqual(len(plan2["changes"]), 1)
        self.assertEqual(plan2["counts"]["unchanged"], 95)
        ch2 = plan2["changes"][0]
        self.assertEqual(ch2["item_uid"], new_uid)
        self.assertEqual(ch2["spec"]["read"]["neck_mm"], 450.0)
        moved = {f["column"]: (f["old"], f["new"]) for f in ch2["fields"]}
        self.assertEqual(moved["item_detail"], ("NECK: 375X375", "NECK: 450X450"))
        self.assertEqual(moved["neck_mm"], ("375.0", "450.0"))

        # (e) an UNREADABLE new row is planned, not refused, and saved flagged
        bad_line = row(kind="hvac_adp_item", unit="Nos", item_name="Frobnicator",
                       item_detail="nonsense wording", cost_supply="10", cost_install="1",
                       supply_markup="0.45", install_markup="0.6")
        plan3 = csv_importer.build_plan(disc, "\r\n".join([lines[0], bad_line]))
        self.assertEqual(plan3["errors"], [])
        ch3 = plan3["changes"][0]
        self.assertEqual(ch3["spec"]["status"], spec_reader.NOT_UNDERSTOOD)
        self.assertIn("no known ADP family", ch3["spec"]["reason"])
        self.assertEqual(ch3["spec"]["read"], {})
        res3 = csv_importer.apply_plan(disc, "\r\n".join([lines[0], bad_line]), expected_digest=plan3["digest"])
        frappe.db.commit()
        flagged = frappe.get_all(ITEM, filters={"discipline": disc, "active": 1, "import_batch": res3["batch"]},
                                 fields=["attributes"])
        fa = rate_master._parse_json(flagged[0]["attributes"], {})
        self.assertTrue(spec_reader.is_not_understood(fa))
        self.assertEqual(set(fa), {"item_name", "item_detail", "spec_status", "spec_note"})

        # NEGATIVE: a hand-typed derived value is refused by name
        hdr4 = lines[0] + ",neck_mm"
        typed = row(kind="hvac_adp_item", unit="Nos", item_name="Diffuser with damper",
                    item_detail="NECK: 375X375", cost_supply="1", cost_install="1",
                    supply_markup="0.45", install_markup="0.6") + ",300"
        plan4 = csv_importer.build_plan(disc, "\r\n".join([hdr4, typed]))
        self.assertEqual(len(plan4["errors"]), 1)
        self.assertIn("read from Item and Item detail", plan4["errors"][0]["message"])
        self.assertTrue(plan4["errors"][0]["message"].startswith("neck_mm:"))
        # NEGATIVE: a new row with no item_name is refused
        nameless = row(kind="hvac_adp_item", unit="Nos", item_detail="NECK: 375X375", cost_supply="1")
        plan5 = csv_importer.build_plan(disc, "\r\n".join([lines[0], nameless]))
        self.assertTrue(any("item_name is required" in e["message"] for e in plan5["errors"]))

    # -- t08 ----------------------------------------------------------------------------------------
    def test_t08_manual_add_and_edit_go_through_the_same_reader(self):
        disc = self._new_disc()
        self._load(self.v2, disc)
        res = rate_master.create_rate_master_item(
            discipline=disc, kind="hvac_adp_item", unit="Nos",
            attributes=json.dumps({"item_name": "Round Diffuser with damper", "item_detail": "250 mm dia"}),
            rates=json.dumps({"cost_supply": 900.0, "cost_install": 120.0, "supply_markup": 0.45, "install_markup": 0.6}),
        )
        self.assertTrue(res["ok"])
        self.assertEqual(res["spec"], {"status": "ok", "reason": None})
        self.assertEqual(res["item"]["attributes"], {"item_name": "Round Diffuser with damper",
                                                     "item_detail": "250 mm dia", "family": "round diffuser",
                                                     "damper": "with", "dia_mm": 250.0})
        name = res["item"]["name"]
        # NEGATIVE: a derived key cannot be typed in on create ...
        with self.assertRaises(frappe.ValidationError):
            rate_master.create_rate_master_item(
                discipline=disc, kind="hvac_adp_item", unit="Nos",
                attributes=json.dumps({"item_name": "Round Diffuser with damper", "item_detail": "250 mm dia",
                                       "dia_mm": 300}),
                rates=json.dumps({}),
            )
        # ... nor on edit
        with self.assertRaises(frappe.ValidationError):
            rate_master.update_rate_master_item(name=name, attributes_patch=json.dumps({"dia_mm": 300}))
        # an edit of the detail is re-read
        res2 = rate_master.update_rate_master_item(name=name, attributes_patch=json.dumps({"item_detail": "300 mm dia"}))
        self.assertEqual(res2["spec"], {"status": "ok", "reason": None})
        self.assertEqual(res2["item"]["attributes"]["dia_mm"], 300.0)
        self.assertEqual(res2["item"]["attributes"]["item_detail"], "300 mm dia")
        # an unchanged text with a rate patch leaves the attributes exactly as stored
        res3 = rate_master.update_rate_master_item(name=name, rates_patch=json.dumps({"cost_supply": 950.0}),
                                                   attributes_patch=json.dumps({"item_detail": "300 mm dia"}))
        self.assertNotIn("spec", res3)
        self.assertEqual(res3["item"]["attributes"], res2["item"]["attributes"])
        self.assertEqual(res3["item"]["rates"]["cost_supply"], 950.0)
        # an unreadable text is saved FLAGGED, not refused
        res4 = rate_master.update_rate_master_item(name=name, attributes_patch=json.dumps({"item_detail": "huge"}))
        self.assertEqual(res4["spec"]["status"], spec_reader.NOT_UNDERSTOOD)
        self.assertIn("no diameter found", res4["spec"]["reason"])
        self.assertTrue(spec_reader.is_not_understood(res4["item"]["attributes"]))
        self.assertNotIn("dia_mm", res4["item"]["attributes"])
        # a blank item_name is refused
        with self.assertRaises(frappe.ValidationError):
            rate_master.update_rate_master_item(name=name, attributes_patch=json.dumps({"item_name": "  "}))

    # -- t09 ----------------------------------------------------------------------------------------
    def test_t09_v1_to_v2_identity_uids_units_sources_rates(self):
        v1, v2 = self.v1["items"], self.v2["items"]
        self.assertEqual([i["item_uid"] for i in v1], [i["item_uid"] for i in v2])
        for a, b in zip(v1, v2):
            self.assertEqual((a["kind"], a["unit"], a["brand"], a["source"]), (b["kind"], b["unit"], b["brand"], b["source"]))
            self.assertEqual({k: v for k, v in b["attributes"].items() if k not in spec_reader.TEXT_ATTRS}, a["attributes"])
            self.assertTrue(b["attributes"]["item_name"])
            if b["source"]["row"] in (89, 91):
                self.assertEqual(b["rates"], dict(a["rates"], cost_install=0.0))    # S-d
                self.assertNotIn("cost_supply", b["rates"])                         # R-f stands
            else:
                self.assertEqual(b["rates"], a["rates"])
        # and the loaded rows say the same
        for r in (89, 91):
            self.assertEqual(self._item(self.ro_disc, r)["rates"]["cost_install"], 0.0)
        # the asset export of the loaded v2 is semantically the v2 file
        payload, _text = exporter.export_asset_text(self.ro_disc)
        self.assertEqual(len(payload["items"]), 95)
        self.assertEqual({i["item_uid"] for i in payload["items"]}, {i["item_uid"] for i in v2})
        self.assertTrue(all(i["attributes"].get("item_name") for i in payload["items"]))

    # -- t10 ----------------------------------------------------------------------------------------
    def test_t10_the_v2_config_validates_and_the_text_defs_are_hidden_from_model_and_panel(self):
        cfg = copy.deepcopy(self.v2["category_configs"][0])
        cfg["discipline"] = "HVAC"
        config_validation._validate_config(cfg)     # raises on any problem
        self.assertIs(cfg[spec_reader.CONFIG_KEY], True)
        defs = {d["id"]: d for d in cfg["attribute_definitions"]}
        for k in spec_reader.TEXT_ATTRS:
            self.assertIs(defs[k]["selector"], False)
            self.assertIs(defs[k]["panel"], False)
        self.assertEqual([d["id"] for d in cfg["attribute_definitions"]][:2], ["item_name", "item_detail"])
        self.assertEqual(spec_reader.derived_attr_ids(cfg), list(spec_reader.ADP_DERIVED_ATTRS))
        # NEGATIVE: the key is read as `is True` -- a string does not opt in
        disc = self._new_disc()
        p = copy.deepcopy(self.v2)
        p["category_configs"][0][spec_reader.CONFIG_KEY] = "yes"
        p["discipline"] = disc
        loader.load_rate_master(payload=p)
        self.assertEqual(spec_reader.spec_categories(disc), {})
        # NEGATIVE: an unregistered key is still refused by the validator (the allowlist is the gate)
        bad = copy.deepcopy(cfg)
        bad["attributes_from_specc"] = True
        with self.assertRaises(frappe.ValidationError):
            config_validation._validate_config(bad)

    # -- t11 ----------------------------------------------------------------------------------------
    def test_t11_a_category_without_the_key_keeps_the_legacy_create_path(self):
        disc = self._new_disc()
        p = copy.deepcopy(self.v2)
        del p["category_configs"][0][spec_reader.CONFIG_KEY]
        p["discipline"] = disc
        loader.load_rate_master(payload=p)
        self.assertEqual(spec_reader.spec_categories(disc), {})
        with self.assertRaises(frappe.ValidationError):
            rate_master.create_rate_master_item(discipline=disc, kind="hvac_adp_item", unit="Nos",
                                                attributes=json.dumps({"not_an_attr": "x"}), rates=json.dumps({}))
        # and the exporter takes the legacy branch: every observed attribute is a column again
        _t, headers, _n = csv_exporter.build_category_csv(disc, "hvac_adp")
        self.assertIn("family", headers)
        self.assertIn("item_name", headers)
