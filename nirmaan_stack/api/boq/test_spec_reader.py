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
from unittest.mock import patch

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
        # SLICE 1e (owner X-b / X-d): no kind (ONE item kind), no source pair -- inverted, not deleted.
        # SLICE 1g (owner Z-c): discipline + category right after item_uid -- inverted again, not deleted.
        self.assertEqual(headers, ["item_uid", "discipline", "category", "brand", "unit", "item_name", "item_detail",
                                   "cost_install", "cost_supply", "install_markup", "supply_markup"])
        for gone in ("kind", "source_sheet", "source_row", "import_batch"):
            self.assertNotIn(gone, headers)                    # NEGATIVE (1e; 1g: no other system column)
        self.assertEqual(n, 95)
        for derived in spec_reader.ADP_DERIVED_ATTRS + spec_reader.RESERVED_ATTRS:
            self.assertNotIn(derived, headers)
        rows = list(__import__("csv").reader(text.lstrip("﻿").splitlines()))
        hdr, body = rows[0], rows[1:]
        self.assertEqual(hdr, headers)
        # rows 89 / 91 carry cost_install 0 (S-d): keyed by item_uid now that the file has no source_row
        ci, ui = hdr.index("cost_install"), hdr.index("item_uid")
        uid_of = {r["source_row"]: r["item_uid"] for r in frappe.get_all(
            ITEM, filters={"discipline": disc, "active": 1, "source_row": ["in", [89, 91]]},
            fields=["source_row", "item_uid"])}
        by_uid = {r[ui]: r[ci] for r in body}
        self.assertEqual(by_uid[uid_of[89]], "0.0")
        self.assertEqual(by_uid[uid_of[91]], "0.0")
        # Mode B: same text-first rule, the category column in place; still no kind (no multi-kind category)
        text_b, headers_b, n_b = csv_exporter.build_all_categories_csv(disc)
        self.assertEqual(headers_b, ["item_uid", "discipline", "category", "brand", "unit", "item_name", "item_detail",
                                     "cost_install", "cost_supply", "install_markup", "supply_markup"])
        self.assertEqual(n_b, 95)

    # -- t06 ----------------------------------------------------------------------------------------
    def test_t06_electrical_is_unchanged_no_key_no_branch_same_headers(self):
        e = _asset(ELECTRICAL_ASSET)
        self.assertTrue(all(spec_reader.CONFIG_KEY not in c for c in e["category_configs"]))
        disc = self._new_disc()
        self._load(e, disc)
        self.assertEqual(spec_reader.spec_categories(disc), {})
        items, kind_cat, cat_kinds = csv_exporter._load(disc)
        # the 1e construction (owner X-b / X-d), recomputed here from the same rows: item_uid, kind ONLY
        # for a multi-kind category, brand, unit + sorted attrs + sorted rates; NO source pair. Mode B:
        # item_uid, category, kind (Electrical holds multi-kind categories), brand, unit + the union.
        # (Pre-1e this pinned LEAD + attrs + rates + TAIL; inverted, not deleted.)
        for cat in ("cabletray_raceway", "lighting_mgmt_system", "wiring_cabling"):
            rows_in = [it for it in items if it["kind"] in set(cat_kinds[cat])]
            attrs, rates = csv_exporter._keys_for(rows_in)
            # SLICE 1g: discipline + category after item_uid, in every file (owner Z-c) -- inverted, not deleted.
            lead = (["item_uid", "discipline", "category", "kind", "brand", "unit"] if cat == "wiring_cabling"
                    else ["item_uid", "discipline", "category", "brand", "unit"])
            expected = lead + attrs + rates
            _t, headers, n = csv_exporter.build_category_csv(disc, cat)
            self.assertEqual(headers, expected, cat)
            self.assertEqual(n, len(rows_in))
            self.assertNotIn("item_name", headers)
            self.assertNotIn("source_sheet", headers); self.assertNotIn("source_row", headers)
        attrs, rates = csv_exporter._keys_for(items)
        expected_b = ["item_uid", "discipline", "category", "kind", "brand", "unit"] + attrs + rates
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
        new_line = row(unit="Nos", item_name="Diffuser with damper",
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
        bad_line = row(unit="Nos", item_name="Frobnicator",
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
        typed = row(unit="Nos", item_name="Diffuser with damper",
                    item_detail="NECK: 375X375", cost_supply="1", cost_install="1",
                    supply_markup="0.45", install_markup="0.6") + ",300"
        plan4 = csv_importer.build_plan(disc, "\r\n".join([hdr4, typed]))
        self.assertEqual(len(plan4["errors"]), 1)
        self.assertIn("read from Item and Item detail", plan4["errors"][0]["message"])
        self.assertTrue(plan4["errors"][0]["message"].startswith("neck_mm:"))
        # NEGATIVE: a new row with no item_name is refused
        nameless = row(unit="Nos", item_detail="NECK: 375X375", cost_supply="1")
        plan5 = csv_importer.build_plan(disc, "\r\n".join([lines[0], nameless]))
        self.assertTrue(any("item_name is required" in e["message"] for e in plan5["errors"]))

    # -- t08 ----------------------------------------------------------------------------------------
    def test_t08_manual_add_and_edit_go_through_the_same_reader(self):
        disc = self._new_disc()
        self._load(self.v2, disc)
        # SLICE 1f (inverted under owner Y-a / Y-c): "Round Diffuser with damper / 250 mm dia / Nos" MEANS THE
        # SAME as v2 row 41 ("Round Diffuser With GI Damper / 250 MM DIA"), so the create now ASKS and inserts
        # nothing; the reader claims below continue on a size no v2 item carries.
        before = frappe.db.count(ITEM, {"discipline": disc, "active": 1})
        twin = rate_master.create_rate_master_item(
            discipline=disc, kind="hvac_adp_item", unit="Nos",
            attributes=json.dumps({"item_name": "Round Diffuser with damper", "item_detail": "250 mm dia"}),
            rates=json.dumps({"cost_supply": 900.0, "cost_install": 120.0, "supply_markup": 0.45, "install_markup": 0.6}),
        )
        self.assertFalse(twin["ok"]); self.assertTrue(twin["needs_twin_confirmation"])
        self.assertEqual(twin["twin"]["item_uid"], "rmi-fa0c8236a474")
        self.assertEqual(frappe.db.count(ITEM, {"discipline": disc, "active": 1}), before)
        res = rate_master.create_rate_master_item(
            discipline=disc, kind="hvac_adp_item", unit="Nos",
            attributes=json.dumps({"item_name": "Round Diffuser with damper", "item_detail": "225 mm dia"}),
            rates=json.dumps({"cost_supply": 900.0, "cost_install": 120.0, "supply_markup": 0.45, "install_markup": 0.6}),
        )
        self.assertTrue(res["ok"])
        self.assertEqual(res["spec"], {"status": "ok", "reason": None})
        self.assertEqual(res["item"]["attributes"], {"item_name": "Round Diffuser with damper",
                                                     "item_detail": "225 mm dia", "family": "round diffuser",
                                                     "damper": "with", "dia_mm": 225.0})
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
        # an edit of the detail is re-read (310: 300 would make it mean the same as v2 row 40 -- slice 1f)
        res2 = rate_master.update_rate_master_item(name=name, attributes_patch=json.dumps({"item_detail": "310 mm dia"}))
        self.assertEqual(res2["spec"], {"status": "ok", "reason": None})
        self.assertEqual(res2["item"]["attributes"]["dia_mm"], 310.0)
        self.assertEqual(res2["item"]["attributes"]["item_detail"], "310 mm dia")
        # an unchanged text with a rate patch leaves the attributes exactly as stored
        res3 = rate_master.update_rate_master_item(name=name, rates_patch=json.dumps({"cost_supply": 950.0}),
                                                   attributes_patch=json.dumps({"item_detail": "310 mm dia"}))
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

    # ══════════════════════════════════════════════════════════════════════════════════════════
    # SLICE 1d -- SUGGEST THE BEST MATCH, THE USER CONFIRMS (owner T-a / T-b). Plain-English coverage:
    #   t12  EXACT FIRST: every v2 item still reads exactly and the suggester is NEVER invoked for it
    #        (pinned by counting calls); forced on the 95 correct texts it yields the same family or none.
    #   t13  the owner's named suggestions: "Grille" -> linear grille with the detail's damper; "Louver"
    #        -> intake louvre; "Motorised" VCD -> motorised; "Fire Damper UL" -> fire damper, UL.
    #   t14  NEVER INVENTED: "Frobnicator" -> none; an AMBIGUOUS word (one edit from two family words)
    #        -> none; a recognised family whose REQUIRED size is unreadable -> none, the size never made up.
    #   t15  the E2 self-consistency sweep: each family word of each sheet name misspelt two ways -- never
    #        suggested as a DIFFERENT family.
    #   t16  the flag shape: confirmed = text + suggested keys + status + who + when; the fingerprint is
    #        stable for the same inputs and moves when the attributes move.
    #   t17  CSV: the preview shows the suggestion (or why none) and plans not_understood; an ACCEPT
    #        applies the suggestion as CONFIRMED with user + time, a REJECT as not_understood; NEGATIVE:
    #        an accept with the wrong fingerprint is refused, an accept for a row with no suggestion is
    #        refused -- nothing written either time.
    #   t18  RE-UPLOAD: an unchanged confirmed row is not asked again and keeps its status; a changed
    #        detail gets a fresh exact read; a changed detail that must be ASKED about is shown in full
    #        (major) while an exact-reading change stays a smaller change.
    #   t19  MANUAL create / edit: needs_confirmation with NOTHING written; accept -> confirmed; reject ->
    #        flagged; NEGATIVE: wrong fingerprint refused; an exact-reading text asks nothing.
    #   t20  ELECTRICAL / no key: decisions are inert -- an Electrical apply with an empty / absent
    #        decisions map is the same no-op; the legacy create path ignores spec_decision.
    # ══════════════════════════════════════════════════════════════════════════════════════════

    def _hvac_csv(self, disc, rows):
        """A Mode A HVAC file in the OLD (1c) shape -- kind + source pair present -- with the given new
        rows: (name, detail, unit) tuples. Kept old on purpose since 1e: every test using it also proves
        that an old-format file still uploads with those columns ignored (owner X-e)."""
        hdr = ["item_uid", "kind", "brand", "unit", "item_name", "item_detail", "cost_install", "cost_supply",
               "install_markup", "supply_markup", "source_sheet", "source_row"]
        out = [",".join(hdr)]
        for name, detail, unit in rows:
            out.append(",".join(["", "hvac_adp_item", "", unit, name, detail, "100", "1000", "0.6", "0.45", "", ""]))
        return "\r\n".join(out) + "\r\n"

    # -- t12 ----------------------------------------------------------------------------------------
    def test_t12_exact_first_the_95_never_take_the_suggestion_path(self):
        calls = []
        real = spec_reader.suggest_spec

        def counting(*a, **k):
            calls.append(a)
            return real(*a, **k)

        disc = self._new_disc()
        self._load(self.v2, disc)
        with patch.object(spec_reader, "suggest_spec", counting):
            # the import path: an untouched round trip of all 95 rows -- exact reads only
            text, _h, _n = csv_exporter.build_category_csv(disc, "hvac_adp")
            plan = csv_importer.build_plan(disc, text)
            self.assertEqual(plan["errors"], [])
            self.assertEqual(plan["counts"]["unchanged"], 95)
            # and a re-read of every text through the manual resolver
            for it in self.v2["items"]:
                n, d = spec_reader.text_of(it["attributes"])
                attrs, spec_out, ask = rate_master._resolve_spec_write("hvac_adp", n, d, it["unit"], None, None)
                self.assertIsNone(ask)
                self.assertEqual(spec_out["status"], "ok")
                self.assertEqual({k: v for k, v in attrs.items() if k not in spec_reader.TEXT_ATTRS},
                                 {k: v for k, v in it["attributes"].items() if k not in spec_reader.TEXT_ATTRS})
        self.assertEqual(calls, [], "the suggester must never run for a text the exact read accepts")
        # FORCED on the 95 correct texts (never happens in the product): same family or none, never another
        for it in self.v2["items"]:
            n, d = spec_reader.text_of(it["attributes"])
            s, _why = spec_reader.suggest_spec("hvac_adp", n, d, it["unit"])
            if s is not None:
                self.assertEqual(s["attributes"]["family"], it["attributes"]["family"], (n, d))

    # -- t13 ----------------------------------------------------------------------------------------
    def test_t13_the_owners_named_suggestions(self):
        def sug(name, detail):
            _d, reason = spec_reader.read_spec("hvac_adp", name, detail, "Nos")
            self.assertIsNotNone(reason, (name, detail))          # the exact read refuses first
            s, why = spec_reader.suggest_spec("hvac_adp", name, detail, "Nos")
            self.assertIsNotNone(s, (name, detail, why))
            return s
        s = sug("Grille", "Linear grille without damper")
        self.assertEqual(s["attributes"], {"family": "linear grille", "damper": "without"})
        s = sug("Grille", "linear grille with damper")
        self.assertEqual(s["attributes"], {"family": "linear grille", "damper": "with"})
        s = sug("Grille", "Intake Louver")
        self.assertEqual(s["attributes"], {"family": "intake louvre"})
        s = sug("Volume control Damper (VCD)", "Motorised")
        self.assertEqual(s["attributes"], {"family": "VCD", "variant": "motorised"})
        self.assertIn('"Motorised" is read as "Motorized"', s["notes"])
        s = sug("Fire Damper UL", "with sleeve")
        self.assertEqual(s["attributes"], {"family": "fire damper", "variant": "UL", "ul": "yes"})
        # a one-letter slip in a family word
        s = sug("Round Difuser with damper", "250 mm dia")
        self.assertEqual(s["attributes"], {"family": "round diffuser", "damper": "with", "dia_mm": 250.0})
        self.assertIn("'difuser' is read as 'diffuser'", s["notes"])
        self.assertEqual(s["fingerprint"], spec_reader.suggestion_fingerprint(
            "Round Difuser with damper", "250 mm dia", "Nos", s["attributes"]))

    # -- t14 ----------------------------------------------------------------------------------------
    def test_t14_never_invented_unknown_ambiguous_and_unreadable_size(self):
        s, why = spec_reader.suggest_spec("hvac_adp", "Frobnicator", "nonsense wording", "Nos")
        self.assertIsNone(s); self.assertIn("no close match to a known wording", why)
        # 'sround' is one edit from BOTH 'round' and 'sound' -> ambiguous, no suggestion
        self.assertEqual(spec_reader._edit_distance("sround", "round"), 1)
        self.assertEqual(spec_reader._edit_distance("sround", "sound"), 1)
        s, why = spec_reader.suggest_spec("hvac_adp", "Sround diffuser with damper", "250 mm dia", "Nos")
        self.assertIsNone(s); self.assertIn("ambiguous", why); self.assertIn("'round'", why); self.assertIn("'sound'", why)
        # a recognised family whose REQUIRED size cannot be read: the size is never invented
        s, why = spec_reader.suggest_spec("hvac_adp", "Round Difuser with damper", "no size given", "Nos")
        self.assertIsNone(s); self.assertIn("no diameter found", why)
        s, why = spec_reader.suggest_spec("hvac_adp", "Acces Door", "big", "Nos")
        self.assertIsNone(s); self.assertIn("no size found", why)
        # short words are never corrected (four letters): 'dict valve' is not a disc valve
        s, why = spec_reader.suggest_spec("hvac_adp", "Dict Valve", "150 mm dia", "Nos")
        self.assertIsNone(s)
        # a reader-less category raises, never passes through
        with self.assertRaises(KeyError):
            spec_reader.suggest_spec("no_such_category", "x", "y")

    # -- t15 ----------------------------------------------------------------------------------------
    def test_t15_self_consistency_sweep_no_cross_family_suggestion(self):
        def misspell(word):
            m = len(word) // 2
            return [word[:m] + word[m + 1:], word[:m] + ("q" if word[m] != "q" else "z") + word[m + 1:]]
        seen = set()
        variants = same = none = 0
        cross = []
        for it in self.v2["items"]:
            name, detail = spec_reader.text_of(it["attributes"])
            key = (name, detail, it["unit"])
            if key in seen:
                continue
            seen.add(key)
            fam = it["attributes"]["family"]
            for w in [w for w in name.lower().split() if w.isalpha() and w in spec_reader.FAMILY_WORDS]:
                for bad in misspell(w):
                    bad_name = " ".join(bad if x.lower() == w else x for x in name.split())
                    variants += 1
                    d2, r2 = spec_reader.read_spec("hvac_adp", bad_name, detail, it["unit"])
                    if r2 is None:
                        if d2["family"] != fam:
                            cross.append((bad_name, d2["family"], fam))
                        else:
                            same += 1
                        continue
                    s2, _why = spec_reader.suggest_spec("hvac_adp", bad_name, detail, it["unit"])
                    if s2 is None:
                        none += 1
                    elif s2["attributes"]["family"] == fam:
                        same += 1
                    else:
                        cross.append((bad_name, s2["attributes"]["family"], fam))
        self.assertEqual(cross, [], cross)
        self.assertGreater(variants, 300)
        self.assertGreater(same, none)
        # the only family-word pair one edit apart is round / sound -- and both ARE family words, so
        # neither is ever rewritten into the other
        fw = sorted(spec_reader.FAMILY_WORDS)
        pairs = [(a, b) for i, a in enumerate(fw) for b in fw[i + 1:] if spec_reader._edit_distance(a, b) <= 1]
        self.assertEqual(pairs, [("round", "sound")])

    # -- t16 ----------------------------------------------------------------------------------------
    def test_t16_the_confirmed_shape_and_a_stable_fingerprint(self):
        c = spec_reader.confirmed_attributes("Grille", "Linear grille without damper",
                                             {"family": "linear grille", "damper": "without"}, "who@x", "2026-09-21T20:00:00")
        self.assertEqual(c, {"item_name": "Grille", "item_detail": "Linear grille without damper",
                             "family": "linear grille", "damper": "without",
                             "spec_status": "confirmed", "spec_confirmed_by": "who@x", "spec_confirmed_at": "2026-09-21T20:00:00"})
        self.assertTrue(spec_reader.is_confirmed(c))
        self.assertFalse(spec_reader.is_not_understood(c))
        self.assertEqual(set(spec_reader.RESERVED_ATTRS), {"spec_status", "spec_note", "spec_confirmed_by", "spec_confirmed_at"})
        a = spec_reader.suggestion_fingerprint("Grille", "x", "Nos", {"family": "linear grille", "damper": "without"})
        b = spec_reader.suggestion_fingerprint("Grille", "x", "Nos", {"family": "linear grille", "damper": "without"})
        c2 = spec_reader.suggestion_fingerprint("Grille", "x", "Nos", {"family": "linear grille", "damper": "with"})
        self.assertEqual(a, b)
        self.assertNotEqual(a, c2)
        self.assertEqual(spec_reader.suggestion_label({"family": "linear grille", "damper": "without"}),
                         "family = linear grille, damper = without")

    # -- t17 ----------------------------------------------------------------------------------------
    def test_t17_csv_preview_shows_apply_confirms_only_an_accept_and_verifies_it(self):
        disc = self._new_disc()
        self._load(self.v2, disc)
        text = self._hvac_csv(disc, [("Grille", "Linear grille without damper", "Nos"),
                                     ("Fire Damper UL", "with sleeve", "SQM"),
                                     ("Frobnicator", "nonsense wording", "Nos")])
        plan = csv_importer.build_plan(disc, text)
        self.assertEqual(plan["errors"], [])
        by_row = {c["row"]: c for c in plan["changes"]}
        self.assertEqual(sorted(by_row), [1, 2, 3])
        for r in (1, 2):
            self.assertEqual(by_row[r]["spec"]["status"], "not_understood")     # the preview plans as today
            self.assertIsNotNone(by_row[r]["spec"]["suggestion"])
            self.assertIsNone(by_row[r]["spec"]["decision"])
        self.assertEqual(by_row[1]["spec"]["suggestion"]["attributes"], {"family": "linear grille", "damper": "without"})
        self.assertEqual(by_row[2]["spec"]["suggestion"]["attributes"], {"family": "fire damper", "variant": "UL", "ul": "yes"})
        self.assertIsNone(by_row[3]["spec"]["suggestion"])
        self.assertIn("no close match to a known wording", by_row[3]["spec"]["no_suggestion_reason"])
        self.assertIn("suggestion", csv_importer.public_plan(plan)["changes"][0]["spec"])
        fp1 = by_row[1]["spec"]["suggestion"]["fingerprint"]
        fp2 = by_row[2]["spec"]["suggestion"]["fingerprint"]
        # NEGATIVE 1: an accept with the WRONG fingerprint is refused, nothing written
        before = frappe.db.count(ITEM, {"discipline": disc, "active": 1})
        with self.assertRaises(frappe.ValidationError):
            csv_importer.apply_plan(disc, text, expected_digest=plan["digest"], decisions={"1": "accept"},
                                    accepted_fingerprints={"1": "deadbeef"})
        # NEGATIVE 2: an accept for a row with NO suggestion is refused, nothing written
        with self.assertRaises(frappe.ValidationError):
            csv_importer.apply_plan(disc, text, expected_digest=plan["digest"], decisions={"3": "accept"},
                                    accepted_fingerprints={"3": "x"})
        self.assertEqual(frappe.db.count(ITEM, {"discipline": disc, "active": 1}), before)
        # accept row 1, reject row 2, say nothing about row 3
        res = csv_importer.apply_plan(disc, text, expected_digest=plan["digest"],
                                      decisions={"1": "accept", "2": "reject"}, accepted_fingerprints={"1": fp1})
        frappe.db.commit()
        self.assertEqual(res["items_added"], 3)
        rows = frappe.get_all(ITEM, filters={"discipline": disc, "active": 1, "import_batch": res["batch"]}, fields=["attributes"])
        by_name = {}
        for r in rows:
            a = rate_master._parse_json(r["attributes"], {})
            by_name[a["item_name"]] = a
        g = by_name["Grille"]
        self.assertEqual(g["spec_status"], "confirmed")
        self.assertEqual(g["family"], "linear grille"); self.assertEqual(g["damper"], "without")
        self.assertEqual(g["spec_confirmed_by"], frappe.session.user)
        self.assertTrue(g["spec_confirmed_at"].startswith("20"))
        self.assertNotIn("spec_note", g)
        f = by_name["Fire Damper UL"]
        self.assertEqual(f["spec_status"], "not_understood"); self.assertNotIn("family", f)
        x = by_name["Frobnicator"]
        self.assertEqual(x["spec_status"], "not_understood")
        # the applied plan echoes the decisions and the confirmed status
        applied = {c["row"]: c["spec"] for c in res["plan"]["changes"]}
        self.assertEqual(applied[1]["status"], "confirmed"); self.assertEqual(applied[1]["decision"], "accept")
        self.assertEqual(applied[2]["decision"], "reject")
        self.assertEqual(fp2, by_row[2]["spec"]["suggestion"]["fingerprint"])

    # -- t18 ----------------------------------------------------------------------------------------
    def test_t18_reupload_keeps_a_confirmed_row_and_rereads_a_changed_one(self):
        disc = self._new_disc()
        self._load(self.v2, disc)
        text = self._hvac_csv(disc, [("Grille", "Linear grille without damper", "Nos")])
        plan = csv_importer.build_plan(disc, text)
        fp = plan["changes"][0]["spec"]["suggestion"]["fingerprint"]
        csv_importer.apply_plan(disc, text, expected_digest=plan["digest"], decisions={"1": "accept"}, accepted_fingerprints={"1": fp})
        frappe.db.commit()
        # the same wording again, via the catalog's own export: no change, not asked again, status kept
        export, _h, _n = csv_exporter.build_category_csv(disc, "hvac_adp")
        plan2 = csv_importer.build_plan(disc, export)
        self.assertEqual(plan2["errors"], []); self.assertEqual(plan2["changes"], [])
        self.assertEqual(plan2["counts"]["unchanged"], 96)
        row = [r for r in frappe.get_all(ITEM, filters={"discipline": disc, "active": 1}, fields=["attributes"])
               if rate_master._parse_json(r["attributes"], {}).get("item_name") == "Grille"]
        self.assertEqual(rate_master._parse_json(row[0]["attributes"], {})["spec_status"], "confirmed")
        # a changed detail: a fresh exact read -> this one reads exactly ('grill' is the sheet's word)
        lines = export.lstrip("﻿").split("\r\n")
        hdr = lines[0].split(","); ci = hdr.index("item_detail"); ni = hdr.index("item_name")
        body = []
        for ln in lines[1:]:
            if not ln:
                continue
            cells = ln.split(",")
            if cells[ni] == "Grille":
                cells[ni] = "Grill"; cells[ci] = "Linear grille with damper"
            body.append(",".join(cells))
        plan3 = csv_importer.build_plan(disc, "\r\n".join([lines[0]] + body))
        self.assertEqual(len(plan3["changes"]), 1)
        sp = plan3["changes"][0]["spec"]
        self.assertEqual(sp["status"], "ok")                          # exact read, no suggestion needed
        self.assertNotIn("suggestion", sp)
        self.assertEqual(sp["read"], {"family": "linear grille", "damper": "with"})
        self.assertFalse(plan3["changes"][0]["major"])                # NEGATIVE: an exact-reading wording change
        #                                                             #   is still a "smaller change"
        # a changed detail on the still-misspelt name: asked again -- and SHOWN IN FULL (major), because
        # the question box renders only in the expanded group and "Accept all shown" acts on it (found
        # live at the 1d cert: it was a collapsed "smaller change" with an invisible question)
        body4 = []
        for ln in lines[1:]:
            if not ln:
                continue
            cells = ln.split(",")
            if cells[ni] == "Grille":
                cells[ci] = "Linear grille with damper"
            body4.append(",".join(cells))
        plan4 = csv_importer.build_plan(disc, "\r\n".join([lines[0]] + body4))
        self.assertEqual(len(plan4["changes"]), 1)
        c4 = plan4["changes"][0]
        self.assertEqual(c4["spec"]["status"], "not_understood")
        self.assertEqual(c4["spec"]["suggestion"]["attributes"], {"family": "linear grille", "damper": "with"})
        self.assertTrue(c4["major"], "a row with a question to answer must be shown in full")
        # the verdict names BOTH halves of the text, though only the detail changed (the preview quotes it)
        self.assertEqual(c4["spec"]["text"], {"item_name": "Grille", "item_detail": "Linear grille with damper"})
        self.assertFalse(any(f["space"] == "rate" for f in c4["fields"]))   # major came from the spec, not a rate
        # the fresh read DROPS the confirmed trio (the new payload is the exact-read shape)
        self.assertNotIn("spec_status", plan3["changes"][0]["_payload"]["attributes"])

    # -- t19 ----------------------------------------------------------------------------------------
    def test_t19_manual_create_and_edit_ask_first_then_confirm_or_flag(self):
        disc = self._new_disc()
        self._load(self.v2, disc)
        before = frappe.db.count(ITEM, {"discipline": disc, "active": 1})
        # SLICE 1f (inverted under owner Y-a / Y-c): 250 means the same as v2 row 41 -> the duplicate question,
        # nothing inserted; the exact-reading claim continues on 225.
        dup = rate_master.create_rate_master_item(discipline=disc, kind="hvac_adp_item", unit="Nos",
                                                  attributes=json.dumps({"item_name": "Round Diffuser with damper", "item_detail": "250 mm dia"}),
                                                  rates=json.dumps({}))
        self.assertFalse(dup["ok"]); self.assertTrue(dup["needs_twin_confirmation"])
        self.assertNotIn("needs_confirmation", dup)          # the spec read was exact; only the duplicate asks
        self.assertEqual(frappe.db.count(ITEM, {"discipline": disc, "active": 1}), before)
        # 1. an exact-reading text asks nothing
        res = rate_master.create_rate_master_item(discipline=disc, kind="hvac_adp_item", unit="Nos",
                                                  attributes=json.dumps({"item_name": "Round Diffuser with damper", "item_detail": "225 mm dia"}),
                                                  rates=json.dumps({}))
        self.assertTrue(res["ok"]); self.assertEqual(res["spec"]["status"], "ok")
        # 2. a misspelt text: needs confirmation, NOTHING inserted
        ask = rate_master.create_rate_master_item(discipline=disc, kind="hvac_adp_item", unit="Nos",
                                                  attributes=json.dumps({"item_name": "Round Difuser with damper", "item_detail": "310 mm dia"}),
                                                  rates=json.dumps({"cost_supply": 1.0}))
        self.assertFalse(ask["ok"]); self.assertTrue(ask["needs_confirmation"])
        self.assertIn("Couldn't read 'Round Difuser with damper / 310 mm dia' exactly. Best match:", ask["question"])
        self.assertEqual(ask["suggestion"]["attributes"], {"family": "round diffuser", "damper": "with", "dia_mm": 310.0})
        self.assertEqual(frappe.db.count(ITEM, {"discipline": disc, "active": 1}), before + 1)
        # SLICE 1f (inverted): an ACCEPTED suggestion that means the same as v2 row 40 (with / 300) asks the
        # duplicate question AFTER the spec one -- the spec is resolved first, then the meaning is compared --
        # and inserts nothing.
        ask300 = rate_master.create_rate_master_item(discipline=disc, kind="hvac_adp_item", unit="Nos",
                                                     attributes=json.dumps({"item_name": "Round Difuser with damper", "item_detail": "300 mm dia"}),
                                                     rates=json.dumps({"cost_supply": 1.0}))
        self.assertTrue(ask300["needs_confirmation"])
        dup300 = rate_master.create_rate_master_item(discipline=disc, kind="hvac_adp_item", unit="Nos",
                                                     attributes=json.dumps({"item_name": "Round Difuser with damper", "item_detail": "300 mm dia"}),
                                                     rates=json.dumps({"cost_supply": 1.0}),
                                                     spec_decision="accept", spec_fingerprint=ask300["suggestion"]["fingerprint"])
        self.assertFalse(dup300["ok"]); self.assertTrue(dup300["needs_twin_confirmation"])
        self.assertEqual(dup300["twin"]["item_uid"], "rmi-16b7d2716dbb")
        self.assertEqual(frappe.db.count(ITEM, {"discipline": disc, "active": 1}), before + 1)
        # NEGATIVE: the wrong fingerprint is refused; an accept with no suggestion is refused
        with self.assertRaises(frappe.ValidationError):
            rate_master.create_rate_master_item(discipline=disc, kind="hvac_adp_item", unit="Nos",
                                                attributes=json.dumps({"item_name": "Round Difuser with damper", "item_detail": "310 mm dia"}),
                                                rates=json.dumps({}), spec_decision="accept", spec_fingerprint="nope")
        with self.assertRaises(frappe.ValidationError):
            rate_master.create_rate_master_item(discipline=disc, kind="hvac_adp_item", unit="Nos",
                                                attributes=json.dumps({"item_name": "Frobnicator", "item_detail": "x"}),
                                                rates=json.dumps({}), spec_decision="accept", spec_fingerprint="x")
        self.assertEqual(frappe.db.count(ITEM, {"discipline": disc, "active": 1}), before + 1)
        # 3. accept -> confirmed with who + when
        ok = rate_master.create_rate_master_item(discipline=disc, kind="hvac_adp_item", unit="Nos",
                                                 attributes=json.dumps({"item_name": "Round Difuser with damper", "item_detail": "310 mm dia"}),
                                                 rates=json.dumps({"cost_supply": 1.0}),
                                                 spec_decision="accept", spec_fingerprint=ask["suggestion"]["fingerprint"])
        self.assertTrue(ok["ok"]); self.assertEqual(ok["spec"]["status"], "confirmed")
        a = ok["item"]["attributes"]
        self.assertEqual((a["family"], a["dia_mm"], a["spec_status"], a["spec_confirmed_by"]),
                         ("round diffuser", 310.0, "confirmed", frappe.session.user))
        name = ok["item"]["name"]
        # 4. reject -> flagged
        rej = rate_master.create_rate_master_item(discipline=disc, kind="hvac_adp_item", unit="Nos",
                                                  attributes=json.dumps({"item_name": "Grille", "item_detail": "Intake Louver"}),
                                                  rates=json.dumps({}), spec_decision="reject")
        self.assertTrue(rej["ok"]); self.assertEqual(rej["spec"]["status"], "not_understood")
        self.assertTrue(spec_reader.is_not_understood(rej["item"]["attributes"]))
        # 5. a text with NO suggestion is stored flagged without asking (owner T-b 4)
        flat = rate_master.create_rate_master_item(discipline=disc, kind="hvac_adp_item", unit="Nos",
                                                   attributes=json.dumps({"item_name": "Frobnicator", "item_detail": "x"}), rates=json.dumps({}))
        self.assertTrue(flat["ok"]); self.assertEqual(flat["spec"]["status"], "not_understood")
        self.assertIn("no close match to a known wording", flat["spec"]["no_suggestion_reason"])
        # 6. EDIT: a changed detail on the still-misspelt name asks first, nothing written; then accept
        stored_before = rate_master._parse_json(frappe.db.get_value(ITEM, name, "attributes"), {})
        ask2 = rate_master.update_rate_master_item(name=name, attributes_patch=json.dumps({"item_detail": "350 mm dia"}),
                                                   rates_patch=json.dumps({"cost_supply": 2.0}))
        self.assertTrue(ask2["needs_confirmation"])
        self.assertEqual(rate_master._parse_json(frappe.db.get_value(ITEM, name, "attributes"), {}), stored_before)
        self.assertEqual(rate_master._parse_json(frappe.db.get_value(ITEM, name, "rates"), {})["cost_supply"], 1.0)
        self.assertEqual(ask2["suggestion"]["attributes"]["dia_mm"], 350.0)
        # NEGATIVE: the wrong fingerprint is refused on the edit path too, nothing written
        with self.assertRaises(frappe.ValidationError):
            rate_master.update_rate_master_item(name=name, attributes_patch=json.dumps({"item_detail": "350 mm dia"}),
                                                spec_decision="accept", spec_fingerprint="nope")
        self.assertEqual(rate_master._parse_json(frappe.db.get_value(ITEM, name, "attributes"), {}), stored_before)
        ok2 = rate_master.update_rate_master_item(name=name, attributes_patch=json.dumps({"item_detail": "350 mm dia"}),
                                                  rates_patch=json.dumps({"cost_supply": 2.0}),
                                                  spec_decision="accept", spec_fingerprint=ask2["suggestion"]["fingerprint"])
        self.assertEqual(ok2["spec"]["status"], "confirmed")
        self.assertEqual(ok2["item"]["attributes"]["dia_mm"], 350.0)
        self.assertEqual(ok2["item"]["rates"]["cost_supply"], 2.0)
        # 7. an edit whose REQUIRED size is unreadable has no suggestion: stored flagged, no question asked
        #    ('dai' is a three-letter word, below the correction floor; a size is never invented)
        flag2 = rate_master.update_rate_master_item(name=name, attributes_patch=json.dumps({"item_detail": "350 mm dai"}))
        self.assertTrue(flag2["ok"]); self.assertEqual(flag2["spec"]["status"], "not_understood")
        self.assertIsNone(flag2["spec"]["suggestion"])
        self.assertIn("no diameter found", flag2["spec"]["no_suggestion_reason"])
        # 8. an edit to exact wording reads exactly and drops the flag / confirmed keys
        ok3 = rate_master.update_rate_master_item(name=name, attributes_patch=json.dumps(
            {"item_name": "Round Diffuser with damper", "item_detail": "350 mm dia"}))
        self.assertEqual(ok3["spec"]["status"], "ok")
        self.assertNotIn("spec_status", ok3["item"]["attributes"])
        self.assertNotIn("spec_confirmed_by", ok3["item"]["attributes"])

    # -- t20 ----------------------------------------------------------------------------------------
    def test_t20_electrical_and_no_key_categories_ignore_decisions(self):
        e = _asset(ELECTRICAL_ASSET)
        disc = self._new_disc()
        self._load(e, disc)
        text, _h, _n = csv_exporter.build_category_csv(disc, "cabletray_raceway")
        plan_a = csv_importer.build_plan(disc, text)
        plan_b = csv_importer.build_plan(disc, text, decisions={})
        plan_c = csv_importer.build_plan(disc, text, decisions={"1": "accept"})   # no spec row -> inert
        for p in (plan_a, plan_b, plan_c):
            self.assertEqual(p["errors"], []); self.assertEqual(p["changes"], [])
        self.assertEqual(plan_a["digest"], plan_b["digest"]); self.assertEqual(plan_a["digest"], plan_c["digest"])
        self.assertEqual(csv_importer.apply_plan(disc, text)["applied"], 0)
        self.assertEqual(csv_importer.apply_plan(disc, text, decisions={"1": "accept"}, accepted_fingerprints={"1": "x"})["applied"], 0)
        # the legacy create path never reaches the SPEC resolver: spec_decision is inert there. SLICE 1f (inverted
        # under owner Y-f): it DOES reach the duplicate resolver -- this cable means the same as the live
        # rmi-2c2f8e25a3e0 (Polycab / Mtr / 3 x 2.5 COPPER ARMOURED), so it asks first and inserts nothing.
        dup = rate_master.create_rate_master_item(discipline=disc, kind="cable", brand="Polycab", unit="Mtr",
                                                  attributes=json.dumps({"material": "copper", "insulation": "armoured", "core": 3.0, "thickness_sqmm": 2.5}),
                                                  rates=json.dumps({"list_price_per_mtr": 10.0}), spec_decision="accept", spec_fingerprint="x")
        self.assertFalse(dup["ok"]); self.assertTrue(dup["needs_twin_confirmation"]); self.assertNotIn("spec", dup)
        self.assertEqual(dup["twin"]["item_uid"], "rmi-2c2f8e25a3e0")
        # differing ONLY in brand is NOT a twin (owner G1): the same entry under another brand is a plain create
        res = rate_master.create_rate_master_item(discipline=disc, kind="cable", brand="TestBrand", unit="Mtr",
                                                  attributes=json.dumps({"material": "copper", "insulation": "armoured", "core": 3.0, "thickness_sqmm": 2.5}),
                                                  rates=json.dumps({"list_price_per_mtr": 10.0}), spec_decision="accept", spec_fingerprint="x")
        self.assertTrue(res["ok"]); self.assertNotIn("spec", res); self.assertNotIn("twin", res)
        self.assertEqual(res["item"]["attributes"]["material"], "COPPER")
        self.assertEqual(spec_reader.spec_categories(disc), {})

    # ══════════════════════════════════════════════════════════════════════════════════════════
    # SLICE 1e -- EXCEL BY DEFAULT; NO SYSTEM COLUMNS (owner X-a..X-e), the HVAC half:
    #   t21  the HVAC .xlsx: columns exactly item_uid, brand, unit, item_name, item_detail, the four
    #        numbers (no kind -- one item kind; no source pair); 95 rows; "1:6" / "1:4" / "1:10 /12" /
    #        "9/10 NM" read back byte-for-byte as TEXT (the owner's defect); an UNCHANGED re-upload
    #        plans zero changes; the .csv of the same content gives the same digest.
    #   t22  the OWNER'S NEW SKU: a row with only name, detail, unit and the four numbers (no kind, no
    #        uid) is accepted from the .xlsx -- kind filled `hvac_adp_item`, source stamped by the
    #        system, the reader's verdict carried; the SAME row on an OLD-FORMAT csv carrying kind +
    #        source_sheet "ADP" + source_row uploads with those columns IGNORED (source stays the
    #        system's, never "ADP") -- NEGATIVE: the ignored value is not applied.
    #   t23  a datetime Excel manufactured in a TEXT column is SURFACED, never repaired: it lands as the
    #        cell's ISO text, the reader refuses it by name, nothing is silently stored.
    # ══════════════════════════════════════════════════════════════════════════════════════════

    # SLICE 1g (owner Z-c): discipline + category after item_uid -- the 1e nine columns became eleven.
    HVAC_FILE_COLUMNS = ["item_uid", "discipline", "category", "brand", "unit", "item_name", "item_detail",
                         "cost_install", "cost_supply", "install_markup", "supply_markup"]

    def test_t21_hvac_xlsx_columns_text_survives_and_round_trips_to_zero(self):
        from nirmaan_stack.services.boq_rate_master import xlsx_io
        disc = self.ro_disc
        raw, headers, n = csv_exporter.build_category_xlsx(disc, "hvac_adp")
        self.assertEqual(headers, self.HVAC_FILE_COLUMNS)
        self.assertEqual(n, 95)
        self.assertNotIn("kind", headers); self.assertNotIn("source_sheet", headers); self.assertNotIn("source_row", headers)
        hdr, rows = xlsx_io.read_xlsx(raw)
        self.assertEqual(hdr, headers)
        self.assertEqual(len(rows), 95)
        di, ni = hdr.index("item_detail"), hdr.index("item_name")
        details = [c[di] for _i, c in rows]
        for must in ("1:6", "1:4", "1:10 /12", "9/10 NM", "NECK:300X300/OUTER: 595X595"):
            self.assertIn(must, details, must)                 # the owner's defect, byte-for-byte
        # the cells are TEXT-formatted, so Excel shows and keeps them as typed
        import io as _io
        import openpyxl
        ws = openpyxl.load_workbook(_io.BytesIO(raw)).worksheets[0]
        self.assertEqual({ws.cell(row=r, column=di + 1).number_format for r in range(2, 97)}, {"@"})
        self.assertEqual({ws.cell(row=r, column=ni + 1).number_format for r in range(2, 97)}, {"@"})
        ci = hdr.index("cost_supply")
        vals = [ws.cell(row=r, column=ci + 1).value for r in range(2, 97)]
        self.assertTrue(all(v is None or isinstance(v, (int, float)) for v in vals))   # numbers or blank, never text
        self.assertGreater(sum(1 for v in vals if isinstance(v, (int, float))), 80)
        # unchanged re-upload: nothing to apply; csv of the same content: the same digest
        plan = csv_importer.build_plan(disc, raw, category_id="hvac_adp")
        self.assertEqual(plan["errors"], []); self.assertEqual(plan["changes"], [])
        self.assertEqual(plan["counts"]["unchanged"], 95)
        self.assertEqual(plan["format"], "xlsx")
        text, headers_c, n_c = csv_exporter.build_category_csv(disc, "hvac_adp")
        self.assertEqual((headers_c, n_c), (headers, 95))
        plan_c = csv_importer.build_plan(disc, text, category_id="hvac_adp")
        self.assertEqual(plan_c["changes"], []); self.assertEqual(plan_c["digest"], plan["digest"])
        # Mode B for HVAC: category kept, kind absent (no multi-kind category in the discipline)
        _b, hb, nb = csv_exporter.build_all_categories_xlsx(disc)
        # SLICE 1g (owner Z-c): discipline joins right after item_uid -- inverted, not deleted.
        self.assertEqual(hb, ["item_uid", "discipline", "category", "brand", "unit", "item_name", "item_detail",
                              "cost_install", "cost_supply", "install_markup", "supply_markup"])
        self.assertEqual(nb, 95)

    def test_t22_the_owners_new_sku_without_kind_and_the_old_format_source_is_ignored(self):
        from nirmaan_stack.services.boq_rate_master import xlsx_io
        disc = self._new_disc()
        self._load(self.v2, disc)
        raw, hdr, _n = csv_exporter.build_category_xlsx(disc, "hvac_adp")
        h, rows = xlsx_io.read_xlsx(raw)
        new = {"unit": "Nos", "item_name": "Diffuser with damper", "item_detail": "NECK: 375X375",
               "cost_install": 150.0, "cost_supply": 800.0, "install_markup": 0.6, "supply_markup": 0.45}
        row = [new.get(c) for c in h]                          # item_uid + brand blank
        numeric = {"cost_install", "cost_supply", "install_markup", "supply_markup"}
        edited = xlsx_io.write_xlsx(h, [[(c if c not in ("",) else None) for c in cells] for _i, cells in rows] + [row], numeric)
        plan = csv_importer.build_plan(disc, edited, category_id="hvac_adp")
        self.assertEqual(plan["errors"], [], plan["errors"][:2])
        self.assertEqual(plan["counts"]["items_added"], 1)
        self.assertEqual(plan["counts"]["unchanged"], 95)
        ch = plan["changes"][0]
        self.assertEqual(ch["_payload"]["kind"], "hvac_adp_item")           # filled from the category
        self.assertEqual(ch["_payload"]["source_sheet"], csv_importer.DEFAULT_SOURCE_SHEET)
        self.assertEqual(ch["_payload"]["source_row"], 96)
        self.assertEqual(ch["spec"]["status"], "ok")
        self.assertEqual(ch["spec"]["read"], {"family": "square diffuser", "damper": "with", "neck_mm": 375.0})
        self.assertEqual(ch["_payload"]["rates"], {"cost_install": 150.0, "cost_supply": 800.0,
                                                   "install_markup": 0.6, "supply_markup": 0.45})
        # without the hint too: the file's own 95 rows type it
        plan_nohint = csv_importer.build_plan(disc, edited)
        self.assertEqual(plan_nohint["errors"], []); self.assertEqual(plan_nohint["digest"], plan["digest"])
        res = csv_importer.apply_plan(disc, edited, expected_digest=plan["digest"], category_id="hvac_adp")
        frappe.db.commit()
        self.assertEqual(res["items_added"], 1)
        added = frappe.get_all(ITEM, filters={"discipline": disc, "active": 1, "source_sheet": csv_importer.DEFAULT_SOURCE_SHEET},
                               fields=["kind", "source_row", "attributes", "rates"])
        self.assertEqual(len(added), 1)
        self.assertEqual((added[0]["kind"], added[0]["source_row"]), ("hvac_adp_item", 96))
        # OLD FORMAT (the owner's actual file): kind + source_sheet "ADP" + source_row present -> IGNORED
        old_hdr = ["item_uid", "kind", "brand", "unit", "item_name", "item_detail", "cost_install", "cost_supply",
                   "install_markup", "supply_markup", "source_sheet", "source_row"]
        old_row = ["", "hvac_adp_item", "", "Nos", "Round Diffuser without damper", "225 mm dia",
                   "150", "800", "0.6", "0.45", "ADP", "999"]
        p_old = csv_importer.build_plan(disc, "\r\n".join([",".join(old_hdr), ",".join(old_row)]) + "\r\n")
        self.assertEqual(p_old["errors"], [], p_old["errors"][:2])
        self.assertEqual(p_old["columns"]["ignored"], ["source_row", "source_sheet"])
        c2 = p_old["changes"][0]
        self.assertEqual(c2["_payload"]["source_sheet"], csv_importer.DEFAULT_SOURCE_SHEET)   # NEGATIVE: never "ADP"
        self.assertEqual(c2["_payload"]["source_row"], 1)                                     # the file's data row, not 999
        self.assertEqual(c2["_payload"]["kind"], "hvac_adp_item")
        self.assertEqual(c2["spec"]["read"], {"family": "round diffuser", "damper": "without", "dia_mm": 225.0})
        self.assertFalse(any(f["column"] in ("source_sheet", "source_row") for f in c2["fields"]))

    def test_t23_an_excel_made_time_in_a_text_column_is_surfaced_not_repaired(self):
        import datetime as _dt
        import io as _io
        import openpyxl
        disc = self._new_disc()
        self._load(self.v2, disc)
        raw, hdr, _n = csv_exporter.build_category_xlsx(disc, "hvac_adp")
        wb = openpyxl.load_workbook(_io.BytesIO(raw)); ws = wb.worksheets[0]
        di = hdr.index("item_detail") + 1
        target = next(r for r in range(2, ws.max_row + 1) if ws.cell(row=r, column=di).value == "1:6")
        # what Excel does to a CSV: the ratio becomes the time 01:06
        ws.cell(row=target, column=di).value = _dt.time(1, 6)
        ws.cell(row=target, column=di).number_format = "h:mm"
        buf = _io.BytesIO(); wb.save(buf)
        plan = csv_importer.build_plan(disc, buf.getvalue(), category_id="hvac_adp")
        self.assertEqual(plan["errors"], [])
        self.assertEqual(len(plan["changes"]), 1)
        ch = plan["changes"][0]
        self.assertEqual(ch["spec"]["status"], "not_understood")           # refused by name, visible
        self.assertEqual(ch["spec"]["text"]["item_detail"], "01:06:00")     # the ISO text, as read
        self.assertTrue(ch["major"])

    # ══════════════════════════════════════════════════════════════════════════════════════════
    # SLICE 1f -- SAME-MEANING DUPLICATES (owner Y-a..Y-f), the HVAC half. Plain-English coverage:
    #   t24  TWIN FOUND for the same derived attributes + unit + brand with DIFFERENT wording ("Dampers" vs
    #        "Damper"; a CONFIRMED item counts like a read one); the warning carries both wordings, both
    #        sets of numbers, the existing uid and a fingerprint; NEGATIVE: not a twin when the unit, the
    #        brand or any attribute differs; an INACTIVE item never counts; a NOT-UNDERSTOOD item never
    #        counts (and two of them in one file are not "the same").
    #   t25  CONFIRM (CSV): the existing item takes the row's rates and markups; its uid, wording,
    #        attributes and spec status (a confirmed target stays confirmed, same who / when) are
    #        untouched; NO new item (active count unchanged); the row rides the applied plan as an update.
    #   t26  DECLINE (CSV): that row is skipped, the other new row in the same file is applied; NEGATIVE:
    #        an UNANSWERED warning refuses the whole apply, nothing written; a confirm with the WRONG
    #        fingerprint is refused; a target that CHANGED since the preview is refused (by the digest with
    #        it, by the fingerprint without it), nothing written.
    #   t27  IN-FILE TWINS: two new rows meaning the same item are refused naming the rows, nothing written.
    #   t28  THE EDIT CASE (Y-e): editing A into a twin of B warns naming both; confirm -> B takes the row's
    #        rates, A is byte-for-byte unchanged; decline -> nothing changes.
    #   t29  NEGATIVE: a rates-only edit on an item that ALREADY has a twin never warns; the whole file with
    #        the twins present re-uploads to zero changes and zero warnings; a NEW row meaning the same as
    #        two existing twins is refused by name (the catalog is ambiguous, never guessed).
    #   t30  MANUAL ADD / EDIT: the same outcomes through the endpoints -- ask with nothing written, decline
    #        writes nothing, wrong fingerprint refused, confirm updates the existing item only (add: no new
    #        item; edit: the OTHER item's rates, the edited item untouched); a rates-only patch never asks.
    #   t31  THE ROUND TRIP: the HVAC .xlsx and .csv re-uploaded unchanged -> zero changes AND zero warnings.
    # ══════════════════════════════════════════════════════════════════════════════════════════

    HVAC_1E_HEADER = ["item_uid", "brand", "unit", "item_name", "item_detail",
                      "cost_install", "cost_supply", "install_markup", "supply_markup"]

    def _hvac_rows(self, rows):
        """A 1e-shape HVAC file (no kind, no source pair) from row dicts: name, detail, unit, and optional
        uid, brand, ci, cs, im, sm (rates default 100 / 1000 / 0.6 / 0.45)."""
        out = [",".join(self.HVAC_1E_HEADER)]
        for r in rows:
            out.append(",".join([r.get("uid", ""), r.get("brand", ""), r["unit"], r["name"], r["detail"],
                                 str(r.get("ci", 100)), str(r.get("cs", 1000)), str(r.get("im", 0.6)), str(r.get("sm", 0.45))]))
        return "\r\n".join(out) + "\r\n"

    def _doc_state(self, name):
        """Everything that identifies an item's stored state -- for byte-for-byte 'unchanged' claims."""
        d = frappe.db.get_value(ITEM, name, ["item_uid", "kind", "brand", "unit", "attributes", "rates",
                                             "source_sheet", "source_row", "import_batch", "active", "modified"], as_dict=True)
        d["attributes"] = rate_master._parse_json(d["attributes"], {}); d["rates"] = rate_master._parse_json(d["rates"], {})
        return d

    def _uid_name(self, disc, uid):
        rows = frappe.get_all(ITEM, filters={"discipline": disc, "active": 1, "item_uid": uid}, fields=["name"])
        self.assertEqual(len(rows), 1, (uid, rows))
        return rows[0]["name"]

    # -- t24 ----------------------------------------------------------------------------------------
    def test_t24_hvac_twin_same_meaning_different_wording_and_the_negatives(self):
        disc = self._new_disc()
        self._load(self.v2, disc)
        # v2 row 44: rmi-31fd9a7020d8 "Round Diffuser Without GI Damper" / "300 MM DIA" / Nos, 250 / 720
        text = self._hvac_rows([dict(name="Round Diffuser Without GI Dampers", detail="300 MM DIA", unit="Nos", ci=150, cs=800)])
        plan = csv_importer.build_plan(disc, text)
        self.assertEqual(plan["errors"], [])
        self.assertEqual(len(plan["changes"]), 1)
        ch = plan["changes"][0]
        self.assertEqual(ch["kind"], "add"); self.assertTrue(ch["major"])
        tw = ch["twin"]
        self.assertEqual(tw["case"], "new")
        self.assertEqual(tw["item_uid"], "rmi-31fd9a7020d8")
        self.assertEqual(tw["existing_wording"], "Round Diffuser Without GI Damper / 300 MM DIA")
        self.assertEqual(tw["row_wording"], "Round Diffuser Without GI Dampers / 300 MM DIA")
        self.assertEqual(tw["existing_rates"], {"cost_install": "250.0", "cost_supply": "720.0", "install_markup": "0.6", "supply_markup": "0.45"})
        self.assertEqual(tw["row_rates"], {"cost_install": "150.0", "cost_supply": "800.0", "install_markup": "0.6", "supply_markup": "0.45"})
        self.assertEqual(tw["compared"], ["damper", "dia_mm", "family"])       # the MEANING, never the wording
        self.assertIsNone(tw["decision"]); self.assertIsNone(tw["edited_item_uid"])
        self.assertRegex(tw["fingerprint"], r"^[0-9a-f]{24}$")
        self.assertEqual(plan["counts"]["twins"], 1); self.assertEqual(plan["counts"]["items_added"], 1)
        self.assertIn("twin", csv_importer.public_plan(plan)["changes"][0])
        # a CONFIRMED (1d) item counts like a read one: confirm a misspelt 325, then an exact 325 row twins it
        ask = rate_master.create_rate_master_item(discipline=disc, kind="hvac_adp_item", unit="Nos",
                                                  attributes=json.dumps({"item_name": "Round Difuser without damper", "item_detail": "325 mm dia"}),
                                                  rates=json.dumps({"cost_supply": 5.0}))
        ok = rate_master.create_rate_master_item(discipline=disc, kind="hvac_adp_item", unit="Nos",
                                                 attributes=json.dumps({"item_name": "Round Difuser without damper", "item_detail": "325 mm dia"}),
                                                 rates=json.dumps({"cost_supply": 5.0}),
                                                 spec_decision="accept", spec_fingerprint=ask["suggestion"]["fingerprint"])
        self.assertEqual(ok["spec"]["status"], "confirmed")
        p2 = csv_importer.build_plan(disc, self._hvac_rows([dict(name="Round Diffuser without damper", detail="325 mm dia", unit="Nos")]))
        self.assertEqual(p2["errors"], [])
        # SLICE 1g (owner Z-a): a hand-added item now carries a uid, and the warning names it
        self.assertEqual((p2["changes"][0]["twin"]["item_uid"], p2["changes"][0]["twin"]["name"]), (ok["item"]["item_uid"], ok["item"]["name"]))
        self.assertRegex(ok["item"]["item_uid"], r"^rmi-[0-9a-f]{12}$")
        self.assertEqual(p2["changes"][0]["twin"]["existing_wording"], "Round Difuser without damper / 325 mm dia")
        # an item ADDED BY HAND: before 1g it carried no uid (the manual endpoint never minted one); since 1g
        # (owner Z-a) it is minted one exactly as an uploaded row is, so the warning names it by uid and a
        # confirm's successor row carries the SAME uid; still no new item. (Inverted under Z-a, not deleted.)
        hand = rate_master.create_rate_master_item(discipline=disc, kind="hvac_adp_item", unit="Nos",
                                                   attributes=json.dumps({"item_name": "Round Diffuser with damper", "item_detail": "275 mm dia"}),
                                                   rates=json.dumps({"cost_supply": 50.0}))
        hand_uid = frappe.db.get_value(ITEM, hand["item"]["name"], "item_uid")
        self.assertRegex(hand_uid or "", r"^rmi-[0-9a-f]{12}$")
        t_hand = self._hvac_rows([dict(name="Round Diffuser With GI Damper", detail="275 MM DIA", unit="Nos", cs=60)])
        p_hand = csv_importer.build_plan(disc, t_hand)
        self.assertEqual(p_hand["errors"], [])
        self.assertEqual((p_hand["changes"][0]["twin"]["item_uid"], p_hand["changes"][0]["twin"]["name"]), (hand_uid, hand["item"]["name"]))
        n_now = frappe.db.count(ITEM, {"discipline": disc, "active": 1})
        r_hand = csv_importer.apply_plan(disc, t_hand, expected_digest=p_hand["digest"], twin_decisions={"1": "confirm"},
                                         twin_fingerprints={"1": p_hand["changes"][0]["twin"]["fingerprint"]})
        frappe.db.commit()
        self.assertEqual((r_hand["items_added"], r_hand["items_replaced"]), (0, 1))
        self.assertEqual(frappe.db.count(ITEM, {"discipline": disc, "active": 1}), n_now)
        succ = frappe.get_all(ITEM, filters={"discipline": disc, "active": 1, "import_batch": r_hand["batch"]}, fields=["item_uid", "attributes", "rates"])
        self.assertEqual(len(succ), 1); self.assertEqual(succ[0]["item_uid"], hand_uid)     # the SAME uid (1g)
        self.assertEqual(rate_master._parse_json(succ[0]["attributes"], {})["item_name"], "Round Diffuser with damper")
        self.assertEqual(rate_master._parse_json(succ[0]["rates"], {})["cost_supply"], 60.0)
        # NEGATIVES: unit, brand or an attribute differs -> NOT a twin (plain adds, no warning)
        for row in (dict(name="Round Diffuser Without GI Dampers", detail="300 MM DIA", unit="Set"),
                    dict(name="Round Diffuser Without GI Dampers", detail="300 MM DIA", unit="Nos", brand="Acme"),
                    dict(name="Round Diffuser Without GI Dampers", detail="275 MM DIA", unit="Nos")):
            p = csv_importer.build_plan(disc, self._hvac_rows([row]))
            self.assertEqual(p["errors"], [], row)
            self.assertEqual(len(p["changes"]), 1); self.assertNotIn("twin", p["changes"][0], row)
            self.assertEqual(p["counts"]["twins"], 0, row)
        # NEGATIVE: an INACTIVE item never counts
        rate_master.deactivate_rate_master_item(name=self._uid_name(disc, "rmi-31fd9a7020d8"))
        p = csv_importer.build_plan(disc, text)
        self.assertEqual(p["errors"], []); self.assertNotIn("twin", p["changes"][0]); self.assertEqual(p["counts"]["twins"], 0)
        # NEGATIVE: a NOT-UNDERSTOOD item has no meaning to compare -- it never counts, and two flagged rows in
        # one file are not "the same item"
        flat = rate_master.create_rate_master_item(discipline=disc, kind="hvac_adp_item", unit="Nos",
                                                   attributes=json.dumps({"item_name": "Frobnicator", "item_detail": "x"}), rates=json.dumps({}))
        self.assertEqual(flat["spec"]["status"], "not_understood")
        p = csv_importer.build_plan(disc, self._hvac_rows([dict(name="Frobnicator", detail="x", unit="Nos"),
                                                          dict(name="Frobnicator", detail="x", unit="Nos")]))
        self.assertEqual(p["errors"], []); self.assertEqual(len(p["changes"]), 2)
        self.assertTrue(all("twin" not in c for c in p["changes"])); self.assertEqual(p["counts"]["twins"], 0)

    # -- t25 ----------------------------------------------------------------------------------------
    def test_t25_confirm_updates_the_existing_items_rates_only_and_adds_nothing(self):
        disc = self._new_disc()
        self._load(self.v2, disc)
        target_name = self._uid_name(disc, "rmi-31fd9a7020d8")
        before_state = self._doc_state(target_name)
        n_before = frappe.db.count(ITEM, {"discipline": disc, "active": 1})
        text = self._hvac_rows([dict(name="Round Diffuser Without GI Dampers", detail="300 MM DIA", unit="Nos", ci=150, cs=800, im=0.7, sm=0.5)])
        plan = csv_importer.build_plan(disc, text)
        fp = plan["changes"][0]["twin"]["fingerprint"]
        res = csv_importer.apply_plan(disc, text, expected_digest=plan["digest"],
                                      twin_decisions={"1": "confirm"}, twin_fingerprints={"1": fp})
        frappe.db.commit()
        self.assertEqual((res["applied"], res["items_added"], res["items_replaced"]), (1, 0, 1))
        self.assertEqual(frappe.db.count(ITEM, {"discipline": disc, "active": 1}), n_before)     # NO new item
        # the same uid, ONE active row, the OLD wording, the same attributes, the ROW'S numbers
        new_name = self._uid_name(disc, "rmi-31fd9a7020d8")
        self.assertNotEqual(new_name, target_name)                       # freeze-and-supersede: a fresh document
        self.assertEqual(frappe.db.get_value(ITEM, target_name, "active"), 0)     # the old one retained inactive
        after = self._doc_state(new_name)
        self.assertEqual(after["attributes"], before_state["attributes"])
        self.assertEqual(after["attributes"]["item_name"], "Round Diffuser Without GI Damper")   # its own wording
        self.assertEqual((after["kind"], after["brand"], after["unit"]), (before_state["kind"], before_state["brand"], before_state["unit"]))
        self.assertEqual((after["source_sheet"], after["source_row"]), (before_state["source_sheet"], before_state["source_row"]))
        self.assertEqual(after["rates"], {"cost_install": 150.0, "cost_supply": 800.0, "install_markup": 0.7, "supply_markup": 0.5})
        # the applied plan carries the row as an UPDATE of the existing item, confirmed
        ch = res["plan"]["changes"][0]
        self.assertEqual((ch["kind"], ch["item_uid"], ch["name"]), ("update", "rmi-31fd9a7020d8", target_name))
        self.assertEqual(ch["twin"]["decision"], "confirm")
        self.assertEqual(sorted(f["column"] for f in ch["fields"]), ["cost_install", "cost_supply", "install_markup", "supply_markup"])
        self.assertTrue(all(f["space"] == "rate" for f in ch["fields"]))
        self.assertEqual(res["plan"]["counts"]["rates_changed"], 1); self.assertEqual(res["plan"]["counts"]["items_added"], 0)
        # a CONFIRMED target keeps its spec status, who and when
        ask = rate_master.create_rate_master_item(discipline=disc, kind="hvac_adp_item", unit="Nos",
                                                  attributes=json.dumps({"item_name": "Round Difuser without damper", "item_detail": "325 mm dia"}),
                                                  rates=json.dumps({"cost_supply": 5.0}))
        ok = rate_master.create_rate_master_item(discipline=disc, kind="hvac_adp_item", unit="Nos",
                                                 attributes=json.dumps({"item_name": "Round Difuser without damper", "item_detail": "325 mm dia"}),
                                                 rates=json.dumps({"cost_supply": 5.0}),
                                                 spec_decision="accept", spec_fingerprint=ask["suggestion"]["fingerprint"])
        conf_attrs = ok["item"]["attributes"]
        t2 = self._hvac_rows([dict(name="Round Diffuser without damper", detail="325 mm dia", unit="Nos", cs=77)])
        p2 = csv_importer.build_plan(disc, t2)
        r2 = csv_importer.apply_plan(disc, t2, expected_digest=p2["digest"], twin_decisions={"1": "confirm"},
                                     twin_fingerprints={"1": p2["changes"][0]["twin"]["fingerprint"]})
        frappe.db.commit()
        self.assertEqual((r2["items_added"], r2["items_replaced"]), (0, 1))
        self.assertEqual(frappe.db.get_value(ITEM, ok["item"]["name"], "active"), 0)     # superseded ...
        succ = frappe.get_all(ITEM, filters={"discipline": disc, "active": 1, "import_batch": r2["batch"]}, fields=["name"])
        self.assertEqual(len(succ), 1)
        st = self._doc_state(succ[0]["name"])                                                 # ... by its successor
        self.assertEqual(st["attributes"], conf_attrs)          # confirmed, same by / at, the misspelt wording kept
        self.assertEqual(st["attributes"]["spec_status"], "confirmed")
        self.assertEqual(st["rates"]["cost_supply"], 77.0)

    # -- t26 ----------------------------------------------------------------------------------------
    def test_t26_decline_skips_the_row_only_and_the_apply_refusals_write_nothing(self):
        disc = self._new_disc()
        self._load(self.v2, disc)
        target_name = self._uid_name(disc, "rmi-31fd9a7020d8")
        before_state = self._doc_state(target_name)
        n_before = frappe.db.count(ITEM, {"discipline": disc, "active": 1})
        snaps = frappe.db.count("BoQ Rate Master Snapshot", {"discipline": disc})
        text = self._hvac_rows([dict(name="Round Diffuser Without GI Dampers", detail="300 MM DIA", unit="Nos", ci=150, cs=800),
                                dict(name="Round Diffuser without damper", detail="275 mm dia", unit="Nos")])
        plan = csv_importer.build_plan(disc, text)
        self.assertEqual(plan["errors"], []); self.assertEqual(plan["counts"]["twins"], 1)
        self.assertIn("twin", plan["changes"][0]); self.assertNotIn("twin", plan["changes"][1])
        fp = plan["changes"][0]["twin"]["fingerprint"]
        # NEGATIVE 1: UNANSWERED -> the whole apply is refused, nothing written (with and without decisions)
        for kw in ({}, {"twin_decisions": {"2": "confirm"}, "twin_fingerprints": {}}):
            with self.assertRaises(frappe.ValidationError) as cm:
                csv_importer.apply_plan(disc, text, expected_digest=plan["digest"], **kw)
            self.assertIn("not answered", str(cm.exception))
        # NEGATIVE 2: a confirm with the WRONG fingerprint (or none) is refused
        for fps in ({"1": "deadbeef"}, {}):
            with self.assertRaises(frappe.ValidationError) as cm:
                csv_importer.apply_plan(disc, text, expected_digest=plan["digest"], twin_decisions={"1": "confirm"}, twin_fingerprints=fps)
            self.assertIn("not the one that was previewed", str(cm.exception))
        # NEGATIVE 3: a bad decision value is a row error
        with self.assertRaises(frappe.ValidationError):
            csv_importer.apply_plan(disc, text, expected_digest=plan["digest"], twin_decisions={"1": "maybe"}, twin_fingerprints={"1": fp})
        self.assertEqual(frappe.db.count(ITEM, {"discipline": disc, "active": 1}), n_before)
        self.assertEqual(frappe.db.count("BoQ Rate Master Snapshot", {"discipline": disc}), snaps)
        self.assertEqual(self._doc_state(target_name), before_state)
        # DECLINE: that row is skipped, the 275 row is added, the target is untouched
        res = csv_importer.apply_plan(disc, text, expected_digest=plan["digest"], twin_decisions={"1": "decline"})
        frappe.db.commit()
        self.assertEqual((res["applied"], res["items_added"], res["items_replaced"]), (1, 1, 0))
        self.assertEqual(res["plan"]["counts"]["twins_declined"], 1)
        self.assertEqual([c["row"] for c in res["plan"]["changes"]], [2])
        self.assertEqual(frappe.db.count(ITEM, {"discipline": disc, "active": 1}), n_before + 1)
        self.assertEqual(self._doc_state(target_name), before_state)
        added = frappe.get_all(ITEM, filters={"discipline": disc, "active": 1, "import_batch": res["batch"]}, fields=["attributes"])
        self.assertEqual(len(added), 1); self.assertEqual(rate_master._parse_json(added[0]["attributes"], {})["dia_mm"], 275.0)
        # NEGATIVE 4: the target CHANGED since the preview -> refused by the digest (the fingerprint is in it)
        # and, without a digest, by the fingerprint check itself; nothing written either way
        t3 = self._hvac_rows([dict(name="Round Diffuser Without GI Dampers", detail="300 MM DIA", unit="Nos", ci=150, cs=800)])
        p3 = csv_importer.build_plan(disc, t3)
        fp3 = p3["changes"][0]["twin"]["fingerprint"]
        rate_master.update_rate_master_item(name=target_name, rates_patch=json.dumps({"cost_supply": 721.0}))   # the target moved
        moved = self._doc_state(target_name)
        with self.assertRaises(frappe.ValidationError) as cm:
            csv_importer.apply_plan(disc, t3, expected_digest=p3["digest"], twin_decisions={"1": "confirm"}, twin_fingerprints={"1": fp3})
        self.assertIn("changed since", str(cm.exception))
        with self.assertRaises(frappe.ValidationError) as cm:
            csv_importer.apply_plan(disc, t3, twin_decisions={"1": "confirm"}, twin_fingerprints={"1": fp3})
        self.assertIn("not the one that was previewed", str(cm.exception))
        self.assertEqual(self._doc_state(target_name), moved)
        self.assertEqual(frappe.db.count(ITEM, {"discipline": disc, "active": 1}), n_before + 1)

    # -- t27 ----------------------------------------------------------------------------------------
    def test_t27_two_new_rows_meaning_the_same_item_are_refused_naming_the_rows(self):
        disc = self._new_disc()
        self._load(self.v2, disc)
        n_before = frappe.db.count(ITEM, {"discipline": disc, "active": 1})
        text = self._hvac_rows([dict(name="Round Diffuser without damper", detail="275 mm dia", unit="Nos", cs=1),
                                dict(name="Round Diffuser without GI Damper", detail="275 MM DIA", unit="Nos", cs=2)])
        plan = csv_importer.build_plan(disc, text)
        self.assertEqual(len(plan["errors"]), 1)
        self.assertIn("Rows 1 and 2 mean the same item", plan["errors"][0]["message"])
        self.assertIn("remove one", plan["errors"][0]["message"])
        self.assertIn("cannot know which rate", plan["errors"][0]["message"])
        with self.assertRaises(frappe.ValidationError):
            csv_importer.apply_plan(disc, text, expected_digest=plan["digest"])
        self.assertEqual(frappe.db.count(ITEM, {"discipline": disc, "active": 1}), n_before)
        # NEGATIVE: two new rows that differ in unit are two items, no error
        p = csv_importer.build_plan(disc, self._hvac_rows([dict(name="Round Diffuser without damper", detail="275 mm dia", unit="Nos"),
                                                          dict(name="Round Diffuser without damper", detail="275 mm dia", unit="Set")]))
        self.assertEqual(p["errors"], []); self.assertEqual(len(p["changes"]), 2)

    # -- t28 ----------------------------------------------------------------------------------------
    def test_t28_the_edit_case_confirm_updates_the_other_item_and_leaves_the_edited_one(self):
        disc = self._new_disc()
        self._load(self.v2, disc)
        seed = self._hvac_rows([dict(name="Round Diffuser without damper", detail="275 mm dia", unit="Nos", ci=10, cs=100),
                                dict(name="Round Diffuser without damper", detail="325 mm dia", unit="Nos", ci=20, cs=200)])
        r = csv_importer.apply_plan(disc, seed, expected_digest=csv_importer.build_plan(disc, seed)["digest"])
        frappe.db.commit()
        rows = frappe.get_all(ITEM, filters={"discipline": disc, "active": 1, "import_batch": r["batch"]}, fields=["name", "item_uid", "attributes"])
        by_dia = {rate_master._parse_json(x["attributes"], {})["dia_mm"]: x for x in rows}
        a, b = by_dia[275.0], by_dia[325.0]
        a_before, b_before = self._doc_state(a["name"]), self._doc_state(b["name"])
        # A's row edited: detail 275 -> 325 (now the same meaning as B) and A's numbers changed
        text = self._hvac_rows([dict(uid=a["item_uid"], name="Round Diffuser without damper", detail="325 mm dia", unit="Nos", ci=10, cs=999)])
        plan = csv_importer.build_plan(disc, text)
        self.assertEqual(plan["errors"], [])
        ch = plan["changes"][0]
        self.assertEqual((ch["kind"], ch["item_uid"]), ("update", a["item_uid"]))
        tw = ch["twin"]
        self.assertEqual((tw["case"], tw["item_uid"], tw["edited_item_uid"]), ("edit", b["item_uid"], a["item_uid"]))
        self.assertEqual(tw["existing_wording"], "Round Diffuser without damper / 325 mm dia")
        self.assertEqual(tw["row_wording"], "Round Diffuser without damper / 325 mm dia")
        self.assertEqual(tw["existing_rates"]["cost_supply"], "200.0"); self.assertEqual(tw["row_rates"]["cost_supply"], "999.0")
        # DECLINE: nothing changes at all
        res = csv_importer.apply_plan(disc, text, expected_digest=plan["digest"], twin_decisions={"1": "decline"})
        frappe.db.commit()
        self.assertEqual(res["applied"], 0)
        self.assertEqual(self._doc_state(a["name"]), a_before); self.assertEqual(self._doc_state(b["name"]), b_before)
        # CONFIRM: B takes the row's rates and markups; A is byte-for-byte unchanged (never superseded)
        res = csv_importer.apply_plan(disc, text, expected_digest=plan["digest"], twin_decisions={"1": "confirm"},
                                      twin_fingerprints={"1": tw["fingerprint"]})
        frappe.db.commit()
        self.assertEqual((res["applied"], res["items_added"], res["items_replaced"]), (1, 0, 1))
        self.assertEqual(self._doc_state(a["name"]), a_before)                        # A: untouched, still active
        self.assertEqual(frappe.db.get_value(ITEM, b["name"], "active"), 0)           # B: superseded ...
        b_after = self._doc_state(self._uid_name(disc, b["item_uid"]))                # ... by its successor
        self.assertEqual(b_after["attributes"], b_before["attributes"])
        self.assertEqual(b_after["rates"], {"cost_install": 10.0, "cost_supply": 999.0, "install_markup": 0.6, "supply_markup": 0.45})
        self.assertEqual(frappe.db.count(ITEM, {"discipline": disc, "active": 1, "item_uid": a["item_uid"]}), 1)

    # -- t29 ----------------------------------------------------------------------------------------
    def test_t29_a_rates_only_edit_on_an_item_that_already_has_a_twin_never_warns(self):
        disc = self._new_disc()
        self._load(self.v2, disc)
        # plant a twin of v2 row 44 DIRECTLY (the guard is on the upload and the endpoints, not the doctype)
        src = frappe.get_doc(ITEM, self._uid_name(disc, "rmi-31fd9a7020d8"))
        twin_doc = frappe.get_doc({"doctype": ITEM, "discipline": disc, "kind": src.kind, "brand": src.brand, "unit": src.unit,
                                   "item_uid": "rmi-1f1f1f1f1f1f", "attributes": src.attributes, "rates": src.rates,
                                   "source_sheet": "test", "source_row": 999, "import_batch": "test-1f", "active": 1})
        twin_doc.insert(ignore_permissions=True); frappe.db.commit()
        # the whole file, twins present, unchanged -> zero changes, zero warnings
        raw, _h, n = csv_exporter.build_category_xlsx(disc, "hvac_adp")
        self.assertEqual(n, 96)
        p = csv_importer.build_plan(disc, raw)
        self.assertEqual((p["errors"], p["changes"], p["counts"]["unchanged"], p["counts"]["twins"]), ([], [], 96, 0))
        # a RATES-ONLY edit of one twin: a plain update, no warning
        text = self._hvac_rows([dict(uid="rmi-31fd9a7020d8", name="Round Diffuser Without GI Damper", detail="300 MM DIA", unit="Nos", ci=250, cs=725)])
        p = csv_importer.build_plan(disc, text)
        self.assertEqual(p["errors"], []); self.assertEqual(len(p["changes"]), 1)
        self.assertNotIn("twin", p["changes"][0]); self.assertEqual(p["counts"]["twins"], 0)
        self.assertEqual([f["column"] for f in p["changes"][0]["fields"]], ["cost_supply"])
        res = csv_importer.apply_plan(disc, text, expected_digest=p["digest"]); frappe.db.commit()
        self.assertEqual(res["items_replaced"], 1)
        # a rates-only PATCH through the endpoint never asks either
        r2 = rate_master.update_rate_master_item(name=twin_doc.name, rates_patch=json.dumps({"cost_supply": 730.0}))
        self.assertTrue(r2["ok"]); self.assertNotIn("twin", r2)
        # a NEW row meaning the same as the TWO twins: refused by name (never a guess at which)
        p = csv_importer.build_plan(disc, self._hvac_rows([dict(name="Round Diffuser Without GI Dampers", detail="300 MM DIA", unit="Nos")]))
        self.assertEqual(len(p["errors"]), 1)
        self.assertIn("2 existing items", p["errors"][0]["message"]); self.assertIn("rmi-1f1f1f1f1f1f", p["errors"][0]["message"])
        with self.assertRaises(frappe.ValidationError) as cm:
            rate_master.create_rate_master_item(discipline=disc, kind="hvac_adp_item", unit="Nos",
                                                attributes=json.dumps({"item_name": "Round Diffuser Without GI Dampers", "item_detail": "300 MM DIA"}),
                                                rates=json.dumps({}))
        self.assertIn("already holds twins", str(cm.exception))

    # -- t30 ----------------------------------------------------------------------------------------
    def test_t30_manual_add_and_edit_ask_decline_writes_nothing_confirm_updates_the_existing_item(self):
        disc = self._new_disc()
        self._load(self.v2, disc)
        target_name = self._uid_name(disc, "rmi-31fd9a7020d8")
        before_state = self._doc_state(target_name)
        n_before = frappe.db.count(ITEM, {"discipline": disc, "active": 1})
        attrs = json.dumps({"item_name": "Round Diffuser Without GI Dampers", "item_detail": "300 MM DIA"})
        rates = json.dumps({"cost_install": 150.0, "cost_supply": 800.0})
        # ADD: ask, nothing inserted
        ask = rate_master.create_rate_master_item(discipline=disc, kind="hvac_adp_item", unit="Nos", attributes=attrs, rates=rates)
        self.assertFalse(ask["ok"]); self.assertTrue(ask["needs_twin_confirmation"])
        tw = ask["twin"]
        self.assertEqual((tw["case"], tw["item_uid"], tw["name"]), ("new", "rmi-31fd9a7020d8", target_name))
        self.assertEqual(tw["existing_wording"], "Round Diffuser Without GI Damper / 300 MM DIA")
        self.assertEqual(tw["row_wording"], "Round Diffuser Without GI Dampers / 300 MM DIA")
        self.assertEqual(tw["row_rates"], {"cost_install": "150.0", "cost_supply": "800.0"})
        self.assertEqual(frappe.db.count(ITEM, {"discipline": disc, "active": 1}), n_before)
        # DECLINE: nothing written
        dec = rate_master.create_rate_master_item(discipline=disc, kind="hvac_adp_item", unit="Nos", attributes=attrs, rates=rates,
                                                  twin_decision="decline")
        self.assertTrue(dec["ok"]); self.assertFalse(dec["written"]); self.assertNotIn("item", dec)
        self.assertEqual(frappe.db.count(ITEM, {"discipline": disc, "active": 1}), n_before)
        self.assertEqual(self._doc_state(target_name), before_state)
        # NEGATIVE: the wrong fingerprint / a bad decision are refused, nothing written
        with self.assertRaises(frappe.ValidationError):
            rate_master.create_rate_master_item(discipline=disc, kind="hvac_adp_item", unit="Nos", attributes=attrs, rates=rates,
                                                twin_decision="confirm", twin_fingerprint="nope")
        with self.assertRaises(frappe.ValidationError):
            rate_master.create_rate_master_item(discipline=disc, kind="hvac_adp_item", unit="Nos", attributes=attrs, rates=rates,
                                                twin_decision="maybe", twin_fingerprint=tw["fingerprint"])
        self.assertEqual(self._doc_state(target_name), before_state)
        # CONFIRM: the existing item's rates and markups, its own wording, NO new item
        ok = rate_master.create_rate_master_item(discipline=disc, kind="hvac_adp_item", unit="Nos", attributes=attrs, rates=rates,
                                                 twin_decision="confirm", twin_fingerprint=tw["fingerprint"])
        self.assertTrue(ok["ok"]); self.assertEqual(ok["item"]["name"], target_name)
        self.assertEqual(ok["twin"]["decision"], "confirm")
        self.assertEqual(ok["item"]["attributes"], before_state["attributes"])
        self.assertEqual(ok["item"]["rates"], {"cost_install": 150.0, "cost_supply": 800.0, "install_markup": 0.6, "supply_markup": 0.45})
        self.assertEqual(frappe.db.count(ITEM, {"discipline": disc, "active": 1}), n_before)
        self.assertEqual(frappe.db.get_value(ITEM, target_name, "item_uid"), "rmi-31fd9a7020d8")
        # EDIT (Y-e): A (275) edited to mean the same as the target (300): ask, A untouched
        a = rate_master.create_rate_master_item(discipline=disc, kind="hvac_adp_item", unit="Nos",
                                                attributes=json.dumps({"item_name": "Round Diffuser without damper", "item_detail": "275 mm dia"}),
                                                rates=json.dumps({"cost_install": 1.0, "cost_supply": 2.0}))
        a_name = a["item"]["name"]; a_state = self._doc_state(a_name)
        t_state = self._doc_state(target_name)
        ask2 = rate_master.update_rate_master_item(name=a_name, attributes_patch=json.dumps({"item_detail": "300 mm dia"}),
                                                   rates_patch=json.dumps({"cost_supply": 3.0}))
        self.assertFalse(ask2["ok"]); self.assertTrue(ask2["needs_twin_confirmation"])
        self.assertEqual((ask2["twin"]["case"], ask2["twin"]["item_uid"], ask2["twin"]["edited_item_uid"]),
                         ("edit", "rmi-31fd9a7020d8", a_state["item_uid"]))
        self.assertEqual(ask2["twin"]["row_rates"], {"cost_install": "1.0", "cost_supply": "3.0"})
        self.assertEqual(self._doc_state(a_name), a_state); self.assertEqual(self._doc_state(target_name), t_state)
        # decline on the edit path: nothing written
        dec2 = rate_master.update_rate_master_item(name=a_name, attributes_patch=json.dumps({"item_detail": "300 mm dia"}),
                                                   rates_patch=json.dumps({"cost_supply": 3.0}), twin_decision="decline")
        self.assertFalse(dec2["written"]); self.assertEqual(self._doc_state(a_name), a_state); self.assertEqual(self._doc_state(target_name), t_state)
        # confirm on the edit path: the OTHER item takes the row's rates and markups; A exactly as it was
        ok2 = rate_master.update_rate_master_item(name=a_name, attributes_patch=json.dumps({"item_detail": "300 mm dia"}),
                                                  rates_patch=json.dumps({"cost_supply": 3.0}),
                                                  twin_decision="confirm", twin_fingerprint=ask2["twin"]["fingerprint"])
        self.assertEqual(ok2["item"]["name"], target_name)
        self.assertEqual(ok2["item"]["rates"], {"cost_install": 1.0, "cost_supply": 3.0, "install_markup": 0.6, "supply_markup": 0.45})
        self.assertEqual(ok2["item"]["attributes"], before_state["attributes"])
        self.assertEqual(self._doc_state(a_name), a_state)                # A: byte-for-byte unchanged
        self.assertEqual(frappe.db.count(ITEM, {"discipline": disc, "active": 1}), n_before + 1)
        # NEGATIVE: a rates-only patch on A never asks, even though the catalog has twins elsewhere
        r3 = rate_master.update_rate_master_item(name=a_name, rates_patch=json.dumps({"cost_supply": 9.0}))
        self.assertTrue(r3["ok"]); self.assertNotIn("twin", r3); self.assertEqual(r3["item"]["rates"]["cost_supply"], 9.0)

    # -- t31 ----------------------------------------------------------------------------------------
    def test_t31_the_hvac_round_trip_is_zero_changes_and_zero_warnings(self):
        disc = self.ro_disc
        raw, _h, n = csv_exporter.build_category_xlsx(disc, "hvac_adp")
        text, _h2, n2 = csv_exporter.build_category_csv(disc, "hvac_adp")
        raw_b, _hb, nb = csv_exporter.build_all_categories_xlsx(disc)
        self.assertEqual((n, n2, nb), (95, 95, 95))
        for payload in (raw, text, raw_b):
            p = csv_importer.build_plan(disc, payload)
            self.assertEqual(p["errors"], []); self.assertEqual(p["changes"], [])
            self.assertEqual(p["counts"]["unchanged"], 95)
            self.assertEqual(p["counts"]["twins"], 0); self.assertEqual(p["counts"]["twins_declined"], 0)
            self.assertEqual(csv_importer.apply_plan(disc, payload)["applied"], 0)

    # ══════════════════════════════════════════════════════════════════════════════════════════
    # SLICE 1g -- SELF-DESCRIBING FILES + IDs FOR HAND-ADDED ITEMS (owner Z-a..Z-e), the HVAC half:
    #   t32  THE OWNER'S SCENARIO: one new row with discipline / category filled -> added, target HVAC >
    #        hvac_adp, not from the page; the same with both cells BLANK -> added, `from_page` set (Z-d);
    #        the HVAC file uploaded with an ELECTRICAL page -> refused naming every row, file-says vs page,
    #        nothing written; an existing HVAC item's category cell edited -> refused; the HVAC file itself
    #        (both formats) round-trips to zero changes and zero warnings with the columns present.
    #   t33  A hand-added HVAC item gets a uid, shows in the download, re-uploads with zero changes and
    #        zero warnings; NEGATIVE: never uid-less.
    # ══════════════════════════════════════════════════════════════════════════════════════════

    def test_t32_the_owners_scenario_and_the_refusals(self):
        from nirmaan_stack.services.boq_rate_master import xlsx_io
        disc = self._new_disc()
        self._load(self.v2, disc)
        raw, h, _n = csv_exporter.build_category_xlsx(disc, "hvac_adp")
        self.assertEqual(h[:3], ["item_uid", "discipline", "category"])
        numeric = {"cost_install", "cost_supply", "install_markup", "supply_markup"}
        def one_row(disc_cell, cat_cell, detail):
            row = {"discipline": disc_cell, "category": cat_cell, "unit": "Nos",
                   "item_name": "Round Diffuser with damper", "item_detail": detail,
                   "cost_install": 150.0, "cost_supply": 800.0, "install_markup": 0.6, "supply_markup": 0.45}
            return xlsx_io.write_xlsx(h, [[row.get(c) for c in h]], numeric)
        # 1. filled -> added, the target is the file's own word
        p = csv_importer.build_plan(disc, one_row(disc, "hvac_adp", "325 mm dia"), category_id="hvac_adp")
        self.assertEqual(p["errors"], [], p["errors"][:2]); self.assertEqual(p["counts"]["items_added"], 1)
        self.assertEqual(p["target"], {"discipline": disc, "category": "hvac_adp", "mode": "category", "from_page": False})
        # 2. both BLANK -> added, the page decides and the plan says so (owner Z-d)
        p2 = csv_importer.build_plan(disc, one_row(None, None, "335 mm dia"), category_id="hvac_adp")
        self.assertEqual(p2["errors"], []); self.assertEqual(p2["counts"]["items_added"], 1)
        self.assertEqual(p2["changes"][0]["_payload"]["kind"], "hvac_adp_item")
        self.assertEqual(p2["target"], {"discipline": disc, "category": "hvac_adp", "mode": "category", "from_page": True})
        res = csv_importer.apply_plan(disc, one_row(None, None, "335 mm dia"), expected_digest=p2["digest"], category_id="hvac_adp")
        frappe.db.commit()
        self.assertEqual(res["items_added"], 1)
        # 3. the HVAC file on an ELECTRICAL page: every row refused, file-says vs page, nothing written
        e_disc = self._new_disc()
        self._load(_asset(ELECTRICAL_ASSET), e_disc)
        n_e = frappe.db.count(ITEM, {"discipline": e_disc, "active": 1})
        pe = csv_importer.build_plan(e_disc, raw, category_id="cabletray_raceway")
        self.assertEqual(len(pe["errors"]), 95)                     # one per row, naming the row
        self.assertEqual([e["row"] for e in pe["errors"]], list(range(1, 96)))
        self.assertIn("the file says discipline '%s' but this page is '%s'" % (disc, e_disc), pe["errors"][0]["message"])
        self.assertFalse(any("Unknown column" in e["message"] for e in pe["errors"]))   # NEGATIVE: the real reason, not column noise
        # the same file with the DISCIPLINE cells matching the page but the category foreign: refused by category
        hdr_e, rows_e = xlsx_io.read_xlsx(raw)
        fixed = [[(e_disc if c == "discipline" else (float(v) if (c in numeric and v not in ("", None)) else (v or None)))
                  for c, v in zip(hdr_e, cells)] for _i, cells in rows_e[:2]]
        pe2 = csv_importer.build_plan(e_disc, xlsx_io.write_xlsx(hdr_e, fixed, numeric), category_id="cabletray_raceway")
        self.assertTrue(pe2["errors"])
        self.assertTrue(any("Unknown column" in e["message"] for e in pe2["errors"]))   # an HVAC column set is not Electrical's
        with self.assertRaises(frappe.ValidationError):
            csv_importer.apply_plan(e_disc, raw, expected_digest=pe["digest"], category_id="cabletray_raceway")
        self.assertEqual(frappe.db.count(ITEM, {"discipline": e_disc, "active": 1}), n_e)
        # 4. an existing HVAC item's category cell edited (to a name that is no category): refused, nothing written
        hdr, rows = xlsx_io.read_xlsx(raw)
        cells = list(rows[0][1]); cells[hdr.index("category")] = "hvac_ducting"
        bad = xlsx_io.write_xlsx(hdr, [[(float(v) if (c in numeric and v not in ("", None)) else (v or None)) for c, v in zip(hdr, cells)]], numeric)
        pb = csv_importer.build_plan(disc, bad, category_id="hvac_adp")
        self.assertEqual(len(pb["errors"]), 1); self.assertIn("not a category of", pb["errors"][0]["message"])
        # 5. the file itself, both formats: zero changes AND zero warnings, the columns present
        for payload in (raw, csv_exporter.build_category_csv(disc, "hvac_adp")[0], csv_exporter.build_all_categories_xlsx(disc)[0]):
            pr = csv_importer.build_plan(disc, payload, category_id="hvac_adp")
            self.assertEqual((pr["errors"], pr["changes"], pr["counts"]["twins"]), ([], [], 0))
            self.assertEqual(pr["target"]["from_page"], False)

    def test_t33_a_hand_added_hvac_item_gets_a_uid_and_round_trips(self):
        disc = self._new_disc()
        self._load(self.v2, disc)
        res = rate_master.create_rate_master_item(discipline=disc, kind="hvac_adp_item", unit="Nos",
                                                  attributes=json.dumps({"item_name": "Round Diffuser with damper", "item_detail": "345 mm dia"}),
                                                  rates=json.dumps({"cost_supply": 1.0}))
        self.assertTrue(res["ok"])
        uid = res["item"]["item_uid"]
        self.assertRegex(uid, r"^rmi-[0-9a-f]{12}$")
        self.assertEqual(frappe.db.get_value(ITEM, res["item"]["name"], "item_uid"), uid)
        raw, h, n = csv_exporter.build_category_xlsx(disc, "hvac_adp")
        self.assertEqual(n, 96)
        p = csv_importer.build_plan(disc, raw, category_id="hvac_adp")
        self.assertEqual((p["errors"], p["changes"], p["counts"]["unchanged"], p["counts"]["twins"]), ([], [], 96, 0))
        self.assertEqual(frappe.db.sql('select count(*) from "tabBoQ Rate Master Item" where discipline=%s and active=1 and (item_uid is null or item_uid=%s)', (disc, "")), [(0,)])   # NEGATIVE
