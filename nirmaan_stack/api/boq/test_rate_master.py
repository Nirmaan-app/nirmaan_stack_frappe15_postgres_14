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
"""

import copy
import json
import os

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq import rate_master
from nirmaan_stack.services.boq_rate_master import extraction, loader

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
            os.path.dirname(loader.__file__), "data", "rate_master_electrical_all_v12.json"
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

    # SLICE 1a: bump with the rebuild. `cls.eall` stays pinned to v12 on purpose (test_23 asserts that
    # asset's historical counts) -- the current asset is loaded by path, as test_31 does for v17.
    _ASSET = "rate_master_electrical_all_v22.json"

    def _asset_payload(self, discipline):
        path = os.path.join(os.path.dirname(loader.__file__), "data", self._ASSET)
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
        self.assertEqual(len(defs), 12)
        # NEGATIVE: the flat identity attributes are gone
        self.assertNotIn("family", defs)
        self.assertNotIn("item", defs)

        # the ONLY blanker (1M Blanker) is filed under the Switch family -- verified against the catalog
        families = {"switch_item": "Switch", "socket1_item": "Socket", "socket2_item": "Socket",
                    "blank_item": "Switch", "plate_item": "Grid and Face Plates"}
        for slot, family in families.items():
            d = defs[slot]
            self.assertEqual(d["type"], "choice")
            self.assertTrue(d.get("allow_none"), f"{slot} must be None-able")
            self.assertIsNone(d.get("values"), f"{slot} must use values_from, never a static list")
            self.assertEqual(d["values_from"]["kind"], "switch_socket_item")
            self.assertEqual(d["values_from"]["where"]["family"], family)
            qty = slot.replace("_item", "_qty")
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
        # the qty defaults ship; C2: NO colour default and NO rules this slice
        self.assertEqual(cfg["extraction_defaults"]["switch_qty"], 1.0)
        self.assertTrue(cfg.get("extraction_none_guidance"))
        self.assertNotIn("colour", cfg["extraction_defaults"])
        self.assertFalse(cfg.get("rules"))                     # C2: no rules, before or after

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
        # the VALUES are the invariant -- they must read identically before and after the rebuild
        self.assertEqual(s1["expect"]["swsock_boq"]["supply"], 110.0)
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
        self.assertEqual(ss1["expect"]["swsock_boq"]["supply"], 740.0)
        self.assertEqual(ss1["expect"]["swsock_boq"]["install"], 150.0)
        self.assertEqual(ss1["expect"]["swsock_bcs"]["bcs_supply"], 510.0)
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
        self.assertEqual(b["disables_when_none"], ["blank_qty"])
        self.assertIsNone(b.get("values"))                      # NEGATIVE: never a static list
        self.assertEqual(b["values_from"]["kind"], "switch_socket_item")
        self.assertEqual(b["values_from"]["where"]["family"], "Switch")
        self.assertEqual(defs["blank_qty"]["type"], "number")
        self.assertEqual(cfg["extraction_defaults"]["blank_qty"], 1.0)
        # POSITIVE: the live catalog behind the slot resolves, and contains the one blanker
        cat = extraction.values_from_catalog(disc, b["values_from"])
        self.assertIn("1M Blanker", cat)

        # every pipeline carries exactly ONE none_skips blank line
        self.assertEqual(sorted(cfg["pipelines"]), ["pw_bcs", "pw_boq_install", "pw_boq_supply"])
        for pid, pipe in cfg["pipelines"].items():
            blanks = [s for s in pipe["steps"]
                      if s.get("step") == "component_ref" and s.get("name") == "blank"]
            self.assertEqual(len(blanks), 1, f"{pid} must carry exactly one blank line")
            self.assertTrue(blanks[0]["none_skips"])
            self.assertEqual(blanks[0]["ref"]["family"], "Switch")
            self.assertEqual(blanks[0]["ref"]["item"], "@blank_item")
            self.assertEqual(blanks[0]["qty"], {"from_attr": "blank_qty"})
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
            # the back_box component binding is NOT part of this fix -- box module = the plate's module
            # when a plate exists; the no-plate fallback needs the module computation and is slice 2.
            step = next(s for s in cfg["pipelines"][pipeline_id]["steps"]
                        if s.get("step") == "component_ref" and s.get("name") == "back_box")
            self.assertEqual(step["ref"]["item"], "@plate_item")

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
        self.assertEqual(sorted(by_id), ["pw1", "pw2", "pw3"])
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
        self.assertEqual(ssg["s1"]["expect"]["swsock_boq"], {"supply": 110.0, "install": 30.0})
        self.assertEqual(ssg["s1"]["expect"]["swsock_bcs"], {"bcs_supply": 80.0})
        # ss1 was RE-MINTED coherent by slice 2 part 2 (8M plate, 7 occupied, 1 computed blank)
        self.assertEqual(ssg["ss1"]["expect"]["swsock_boq"], {"supply": 740.0, "install": 150.0})
        self.assertEqual(ssg["ss1"]["expect"]["swsock_bcs"], {"bcs_supply": 510.0})

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
                # CIRCUIT LENGTH part 1 (this slice). Same discipline: green at 12 types against the
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
                    self.assertEqual(ref.get("item"), "@blank_item", where)
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
        # it lives under family "Switch" -- there is NO blanker family (root CLAUDE.md invariant)
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

    def test_70_derive_attribute_is_in_the_known_step_vocabulary(self):
        """The vocabulary pin's server half. The frontend STEP_VOCABULARY carries the same 13 members
        (pinned in ratePipelineInterpreter.test.ts); a step known to only one side is unusable."""
        self.assertIn("derive_attribute", rate_master._KNOWN_STEP_TYPES)
        self.assertEqual(len(rate_master._KNOWN_STEP_TYPES), 13)
