"""VAV-1 (2026-11-19, B6) -- the one validator change of the slice: `list_spec.pricing.numbers` may be an EMPTY object, for a category
whose SKUs match on choices only (VAV Box: shape / type / integrator / CFM band; Sensors: the family alone). The client's spec reader
already takes `{}` (itemListPricing.ts `!p.numbers` is false for it). A missing key or a non-object is still refused.

Read off the v76 mint's own VAV Box / Sensors configs (its pure builders) and the v75 Misc config. Pure: the validator reads no database. Run:
bench --site localhost run-tests --module nirmaan_stack.services.boq_rate_master.test_config_validation_vav1
"""
import copy
import json
import os
import unittest

import frappe

from nirmaan_stack.services.boq_rate_master import config_validation as cv

DATA = os.path.join(os.path.dirname(__file__), "data")


def _mint():
    import importlib.util
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "scripts", "_instruments", "mint_hvac_v76_vav1.py")
    spec = importlib.util.spec_from_file_location("mint_hvac_v76_vav1", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _new(cid):
    """the v76 mint's own VAV Box / Sensors config (pure builders: no asset file read -- this commits before the asset)"""
    m = _mint()
    c = m.vav_config("calculator_only") if cid == "hvac_vav_box" else m.sensors_config(_cfg(75, "hvac_misc"))
    c = copy.deepcopy(dict(c, discipline="HVAC"))
    # VAV-2b2 K2 (R1, owner 2026-11-19 02:55 "removed in VAV-2b"; ANSWER 28): the switch is refused by name now -- the B6 checks read the v76 VAV config with the key taken out ON THE COPY
    c.pop("calculator_only", None)
    return c


def _cfg(v, cid):
    with open(os.path.join(DATA, f"rate_master_hvac_all_v{v}.json"), encoding="utf-8") as f:
        return dict(next(c for c in json.load(f)["category_configs"] if c["category_id"] == cid), discipline="HVAC")


class TestEmptyNumbers(unittest.TestCase):
    def test_01_empty_numbers_accepted(self):
        for cid in ("hvac_vav_box", "hvac_sensors"):
            c = _new(cid)
            self.assertEqual(c["list_spec"]["pricing"]["numbers"], {}, cid)
            self.assertEqual(c["list_spec"]["pricing"]["ladders"], [], cid)
            cv._validate_config(c)
        # VAV-2b2 K2 (R1, owner 2026-11-19 02:55 "removed in VAV-2b"; ANSWER 28): the v76 VAV config AS MINTED (with the key) is refused by name
        with self.assertRaises(frappe.ValidationError) as e:
            cv._validate_config(copy.deepcopy(dict(_mint().vav_config("calculator_only"), discipline="HVAC")))
        self.assertIn("Unknown top-level config key(s): calculator_only", str(e.exception))

    def test_02_missing_or_non_object_refused(self):
        for cid in ("hvac_vav_box", "hvac_sensors"):
            for bad in ("drop", [], None, "size"):
                c = copy.deepcopy(_new(cid))
                if bad == "drop":
                    del c["list_spec"]["pricing"]["numbers"]
                else:
                    c["list_spec"]["pricing"]["numbers"] = bad
                with self.assertRaises(frappe.ValidationError, msg=f"{cid} {bad!r}") as e:
                    cv._validate_config(c)
                self.assertIn("numbers must be an object", str(e.exception))

    def test_03_a_number_reader_still_checked(self):
        # an empty object is the only new shape: Misc's real reader still validates, and a broken reader is still refused
        m = _cfg(75, "hvac_misc")
        cv._validate_config(m)
        bad = copy.deepcopy(m)
        bad["list_spec"]["pricing"]["numbers"]["size_mm"]["from"] = ["no_such_text_attr"]
        with self.assertRaises(frappe.ValidationError):
            cv._validate_config(bad)

    def test_04_ladders_and_match_attrs_still_name_sku_attributes(self):
        # with no number reader, a ladder or match attribute must be a choice: a stray ladder name is refused
        c = copy.deepcopy(_new("hvac_vav_box"))
        c["list_spec"]["pricing"]["ladders"] = ["cfm"]
        with self.assertRaises(frappe.ValidationError) as e:
            cv._validate_config(c)
        self.assertIn("ladders must list SKU attributes", str(e.exception))


if __name__ == "__main__":
    unittest.main()
