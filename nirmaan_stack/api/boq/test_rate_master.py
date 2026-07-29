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
"""

import copy
import json
import os

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq import rate_master
from nirmaan_stack.services.boq_rate_master import loader

PIPELINE_KEYS = {"cable_boq", "termination_boq", "cable_bcs", "termination_bcs"}


def _obj(value):
    """JSON fields come back from frappe.get_all already parsed to dict; tolerate either a
    dict or a raw JSON string."""
    return value if isinstance(value, (dict, list)) else json.loads(value)


class TestRateMaster(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        with open(loader.DEFAULT_DATA_FILE, "r", encoding="utf-8") as fh:
            cls.raw = json.load(fh)
        # EA-1/EA-1b: the all-categories (E-ALL) asset, loaded by path (DEFAULT_DATA_FILE stays wiring).
        cls.eall_path = os.path.join(
            os.path.dirname(loader.__file__), "data", "rate_master_electrical_all_v5.json"
        )
        with open(cls.eall_path, "r", encoding="utf-8") as fh:
            cls.eall = json.load(fh)
        cls._disciplines = set()

    @classmethod
    def tearDownClass(cls):
        # RM-4a: audited edits create Version docs (track_changes) in the live DB -- delete them for
        # the synthetic docs BEFORE the docs, so no orphan Versions and the live count returns to 0.
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
        # per-kind counts land EXACTLY (EA-1b v4: ups removed, popup_box_module added -> 754)
        self.assertEqual(r["items_total"], 754)
        self.assertEqual(r["items_by_kind"]["cable_tray"], 450)
        self.assertEqual(r["items_by_kind"]["db_switchgear_item"], 137)
        self.assertEqual(r["items_by_kind"]["earthing_item"], 25)
        self.assertEqual(r["items_by_kind"]["popup_box_module"], 1)
        self.assertNotIn("ups_per_kva", r["items_by_kind"])  # UPS removed by the Floor BOX correction
        self.assertEqual(r["configs_loaded"], 10)
        # ONE shared batch across the whole scope (items + configs)
        item_batches = {
            x.import_batch
            for x in frappe.get_all("BoQ Rate Master Item", filters={"discipline": disc}, fields=["import_batch"])
        }
        self.assertEqual(item_batches, {r["batch"]})
        # 10 active configs, discipline stamped INTO the config JSON, per-category goldens merged
        cfgs = frappe.get_all(
            "BoQ Rate Category Config", filters={"discipline": disc, "active": 1}, fields=["category_id", "config"]
        )
        self.assertEqual(len(cfgs), 10)
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
        self.assertEqual(r1["configs_loaded"], 10)
        self.assertEqual(r1["items_deactivated"], 0)
        # wiring UNTOUCHED
        self.assertEqual(
            self._active_items(disc, kind="cable") + self._active_items(disc, kind="termination"), 588
        )

        # a SECOND E-ALL load now refuses (its scope is active)
        with self.assertRaises(frappe.ValidationError):
            loader.load_rate_master(payload=self._eall_payload(disc))

        # replace supersedes ONLY the E-ALL scope (754 items / 10 configs), never wiring
        r2 = loader.load_rate_master(payload=self._eall_payload(disc), replace=True)
        self.assertEqual(r2["items_deactivated"], 754)
        self.assertEqual(r2["configs_deactivated"], 10)
        # THE NAMED INVARIANT: wiring cable/termination still active + wiring_cabling config still active
        self.assertEqual(
            self._active_items(disc, kind="cable") + self._active_items(disc, kind="termination"), 588
        )
        self.assertEqual(
            frappe.db.count("BoQ Rate Category Config", {"discipline": disc, "category_id": "wiring_cabling", "active": 1}),
            1,
        )
        # a fresh active E-ALL batch: 754 items, 10 configs
        self.assertEqual(self._active_items(disc, kind="cable_tray"), 450)
        self.assertEqual(
            frappe.db.count("BoQ Rate Category Config", {"discipline": disc, "category_id": "earthing", "active": 1}),
            1,
        )

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
