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

import copy
import json
import os
from unittest import mock

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq import rate_master
from nirmaan_stack.services.boq_rate_master import extraction, loader

PIPELINE_KEYS = {"cable_boq", "termination_boq", "cable_bcs", "termination_bcs"}

# THE current Electrical asset -- named ONCE, here, and nowhere else. Three separate "current"
# pins had drifted independently (_ASSET on v22, _EALL_CURRENT on v27, an inline v29), which is
# the exact C4 trap _EALL_CURRENT's own docstring warns about and had itself fallen into twice.
# One constant is the whole point: a mint bumps this line and every current-asset test follows.
CURRENT_EALL_ASSET = "rate_master_electrical_all_v30.json"

# The SUPERSEDED wiring asset. It is RETAINED on disk (a mint-gate self-test operand) and is still
# read here on purpose: loader.load_rate_master's SINGLE-config path -- the one whose
# _deactivate_prior is DISCIPLINE-WIDE -- is reachable only by a payload carrying the SINGULAR
# `category_config` key, and the merged asset carries the LIST form. Repointing these tests at the
# merged asset would delete the only coverage the dangerous path has.
LEGACY_WIRING_ASSET = "rate_master_wiring_cabling_v3.json"


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
        # loader.DEFAULT_DATA_FILE; that now points at the merged LIST-shape asset, and
        # `_real_payload` below stamps `p["category_config"]["discipline"]`, so the ~30 tests built
        # on it cover the single-config loader path specifically. See LEGACY_WIRING_ASSET.
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
        self.assertEqual(r["items_total"], 1382)
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
        self.assertEqual(payload["retired_kinds"], ["ups_per_kva", "ups_reference"])
        self.assertEqual(payload["retired_category_ids"], ["ups", "switches_point"])

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
        self.assertEqual(len(stored), 1382)
        self.assertTrue(all((r["item_uid"] or "").startswith("rmi-") for r in stored),
                        "every stored row must carry the uid the asset supplied")
        self.assertEqual(len({r["item_uid"] for r in stored}), 1382)
        # and it is the SAME uid on the SAME item -- keyed by (kind, brand, attributes), the tuple
        # the backfill paired on. `brand` is load-bearing here: six lms_item pairs are identical on
        # (kind, attributes) and differ ONLY by brand, at materially different prices.
        def key(kind, brand, attrs):
            return json.dumps([kind, brand, attrs], sort_keys=True, separators=(",", ":"))
        want = {key(it["kind"].strip(), it.get("brand"),
                    loader._canonicalize_attributes(it["attributes"])): it["item_uid"]
                for it in payload["items"]}
        got = {key(r["kind"], r["brand"], _obj(r["attributes"])): r["item_uid"] for r in stored}
        self.assertEqual(len(want), 1382)
        self.assertEqual(want, got, "uid must land on the item the asset assigned it to")

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
        self.assertEqual(cfg["extraction_defaults"]["switch_qty"], 1.0)
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
        self.assertEqual(sorted(cfg["pipelines"]), ["pw_bcs", "pw_boq_install", "pw_boq_supply"])
        for pid, pipe in cfg["pipelines"].items():
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
        self.assertEqual(sorted(by_id), ["pw1", "pw2", "pw3", "pw4"])
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
        """The vocabulary pin's server half. The frontend STEP_VOCABULARY carries the same 13 members
        (pinned in ratePipelineInterpreter.test.ts); a step known to only one side is unusable."""
        self.assertIn("derive_attribute", rate_master._KNOWN_STEP_TYPES)
        self.assertEqual(len(rate_master._KNOWN_STEP_TYPES), 13)

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
        config may carry a `goldens` copy that disagrees with the top-level dict."""
        payload = self._current_eall_asset()

        ss = [c for c in payload["category_configs"] if c["category_id"] == "switches_sockets"][0]
        self.assertNotIn("goldens", ss)

        # the surviving authority is the slice-2 re-mint, not the incoherent 1a golden
        ss1 = {g["id"]: g for g in payload["goldens"]["switches_sockets"]}["ss1"]
        self.assertEqual(ss1["attrs"]["plate_item"], "8M")
        self.assertEqual(ss1["attrs"]["blank_qty"], 1.0)
        self.assertEqual(ss1["expect"]["swsock_boq"], {"supply": 740.0, "install": 150.0})
        self.assertEqual(ss1["expect"]["swsock_bcs"], {"bcs_supply": 510.0})

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
        for pid, pl in pw["pipelines"].items():
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
