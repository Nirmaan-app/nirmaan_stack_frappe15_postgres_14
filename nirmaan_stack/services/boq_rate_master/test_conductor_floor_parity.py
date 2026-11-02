"""ELR-4d (owner R-3C-CALC, 2026-10-29: "One shared floor (the TS twin of apply_conductor_floor)"): the server's floor on the
table `conductorFloor.test.ts` runs the TS floor on. The two languages agree because both must equal this one table.

PURE: a dict in, a dict out -- no DB, no AI. Vacuity: changing a `raised` value in the table fails both files.
"""

import copy
import glob
import json
import os
import re

from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.boq_rate_master import extraction

_APP = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
_TABLE = os.path.join(_APP, "frontend", "src", "pages", "boq-wizard", "rate-helper", "__fixtures__", "conductorFloorCases.json")
_DATA = os.path.join(_APP, "nirmaan_stack", "services", "boq_rate_master", "data")


def _cells(values):
    return {k: {"value": v, "confidence": 0.9} for k, v in values.items()}


class TestConductorFloorTable(FrappeTestCase):
    def setUp(self):
        with open(_TABLE, encoding="utf-8") as fh:
            self.table = json.load(fh)

    def _groups(self, case):
        return {g: [tuple(w) for w in wires] for g, wires in (case.get("groups") or self.table["groups"]).items()}

    def test_01_every_case_of_the_table(self):
        self.assertGreaterEqual(len(self.table["cases"]), 20)
        for case in self.table["cases"]:
            with self.subTest(case["id"]):
                row = _cells(case["inputs"])
                extraction.apply_conductor_floor(row, self._groups(case))
                got = {k: c["value"] for k, c in row.items()}
                self.assertEqual(got, {**case["inputs"], **case["raised"]})

    def test_02_the_table_names_the_config_groups(self):
        """The table's groups are point wiring's own, in definition order -- not a shape only this test knows."""
        versioned = [p for p in glob.glob(os.path.join(_DATA, "rate_master_electrical_all_v*.json")) if re.search(r"_v\d+\.json$", p)]
        latest = max(versioned, key=lambda p: int(re.search(r"_v(\d+)\.json$", p).group(1)))
        with open(latest, encoding="utf-8") as fh:
            asset = json.load(fh)
        cfg = next(c for c in asset["category_configs"] if c["category_id"] == "point_wiring")
        got = extraction.conductor_floor_groups(cfg)
        self.assertEqual({g: [list(w) for w in wires] for g, wires in got.items()}, self.table["groups"])

    def test_03_negative_nothing_at_or_above_three_moves(self):
        for case in self.table["cases"]:
            if case["raised"]:
                continue
            with self.subTest(case["id"]):
                row = _cells(case["inputs"])
                before = copy.deepcopy(row)
                self.assertEqual(extraction.apply_conductor_floor(row, self._groups(case)), [])
                self.assertEqual(row, before)
