"""VAV-2c1 (2026-11-22) -- THE SERVER HALF of HVAC v82: the edits file (one file for the mint and the frontend tests), the validators of the new
keys, NO model request moves (T5), the label guard (T4: red on v81, green on v82, the AI guidance byte-identical), the Pricing Input texts
(R6), and the harness that never holds an AI key (R13).

FIXTURES, no DB writes: v82 is built in memory (`mint_hvac_v82_vav2c1.apply_config` / `apply_items` on the v81 file + frontend/.../
__fixtures__/vav2c1Edits.json) -- the v82 file is not read, so this commits before or with the asset.
Run: bench --site localhost run-tests --module nirmaan_stack.services.boq_rate_master.test_vav2c1_keys
"""
import copy
import hashlib
import importlib.util
import json
import os
import re
import sys
import unittest

from nirmaan_stack.services.boq_rate_master import config_validation, extraction
from nirmaan_stack.services.boq_rate_master import vav2c1_undo_support as U

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
APP = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
FIX = os.path.join(APP, "frontend", "src", "pages", "boq-wizard", "rate-helper", "__fixtures__")
VAV = "hvac_vav_box"


def _load(name, *parts):
    d = os.path.join(APP, *parts)
    if d not in sys.path:
        sys.path.insert(0, d)
    spec = importlib.util.spec_from_file_location(name, os.path.join(d, name + ".py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


MINT = _load("mint_hvac_v82_vav2c1", "scripts", "_instruments")
TEXTS = _load("pricer_texts", "scripts")


def _v81():
    with open(os.path.join(DATA, "rate_master_hvac_all_v81.json"), encoding="utf-8") as f:
        return json.load(f)


def _edits():
    with open(os.path.join(FIX, "vav2c1Edits.json"), encoding="utf-8") as f:
        return json.load(f)


def _v82():
    a, k = _v81(), _edits()
    a["category_configs"] = [MINT.apply_config(c, [e for e in k["configs"] if e["c"] == c["category_id"]]) for c in a["category_configs"]]
    a["items"] = MINT.apply_items(a["items"], k["pricing_inputs"])
    return a


def _labelled(asset):
    """The label-carrying texts a pricer can read: (category, key path, labels). A Pricing Input / field id in a working line is written as
    its name when it is drawn, so a `key` label is none there."""
    out = []
    for cat, path, text in TEXTS.walk(asset):
        w, _ = TEXTS.where(cat, path, text)
        lab = [x for x in TEXTS.labels(text) if not x.startswith("key:")]
        if w and lab:
            out.append((cat, TEXTS.key(path), lab))
    return out


class TestVav2c1(unittest.TestCase):
    def test_01_every_config_validates_and_undoing_the_edits_gives_v81_back(self):
        a, b, k = _v81(), _v82(), _edits()
        for x, y in zip(a["category_configs"], b["category_configs"]):
            config_validation._validate_config(dict(y, discipline="HVAC"))
            back = MINT.apply_config(y, [dict(e, **{"from": e["to"], "to": e["from"]}) for e in k["configs"] if e["c"] == y["category_id"]])
            self.assertEqual(json.dumps(back, sort_keys=True), json.dumps(x, sort_keys=True), y["category_id"])
        untouched = {"hvac_ahu", "hvac_cables", "hvac_dx_unit", "hvac_panels", "hvac_piping", "hvac_pumps", "hvac_raceway", "hvac_sensors"}
        self.assertEqual({x["category_id"] for x, y in zip(a["category_configs"], b["category_configs"]) if x == y}, untouched)

    def test_02_an_edit_whose_from_the_file_does_not_hold_is_refused(self):
        c = {"category_id": "x", "p": {"t": "now"}}
        with self.assertRaises(SystemExit):
            MINT.apply_config(c, [{"c": "x", "p": ["p", "t"], "from": "before", "to": "after"}])
        self.assertEqual(MINT.apply_config(c, [{"c": "x", "p": ["p", "t"], "from": "now", "to": None}]), {"category_id": "x", "p": {}})

    def test_03_T5_no_model_request_moves_v81_to_v82(self):
        def spec(asset):
            cfgs = {("HVAC", c["category_id"]): dict(c, discipline="HVAC") for c in asset["category_configs"]}
            return {cid: json.dumps(extraction.build_items_spec(c, cfgs, "HVAC"), sort_keys=True, ensure_ascii=False)
                    for (_, cid), c in cfgs.items() if c.get("list_spec")}
        a, b = spec(_v81()), spec(_v82())
        self.assertEqual(len(a), 9)
        self.assertEqual([k for k in a if a[k] != b[k]], [])
        # VACUITY: a guidance note changed by one character IS a moved request
        bad = _v82()
        for c in bad["category_configs"]:
            if c["category_id"] == VAV:
                c["list_spec"]["attribute_definitions"][0]["note"] += "."
        self.assertEqual([k for k in a if a[k] != spec(bad)[k]], [VAV])

    def test_04_T4_no_pricer_facing_text_carries_a_label_red_on_v81_green_on_v82(self):
        self.assertEqual(_labelled(_v82()), [])
        red = _labelled(_v81())
        self.assertGreater(len(red), 400)
        self.assertEqual({c for c, _, _ in red}, {"hvac_adp", "hvac_ducting", "hvac_insulation", "hvac_misc", "hvac_valve_package", VAV, "hvac_vrf", "pricing_inputs"})

    def test_05_T4_the_AI_guidance_and_every_text_on_no_screen_is_byte_identical(self):
        a = {(c, TEXTS.key(p)): t for c, p, t in TEXTS.walk(_v81())}
        b = {(c, TEXTS.key(p)): t for c, p, t in TEXTS.walk(_v82())}
        moved = [k for k in a if k in b and a[k] != b[k]]
        hidden = [k for k in moved if TEXTS.where(k[0], k[1].split("/"), a[k])[0] is None]
        self.assertEqual(hidden, [])
        self.assertEqual([k for k in moved if "attribute_definitions" in k[1] or k[1] == "notes"], [])
        self.assertGreater(len(moved), 480)

    def test_06_a_label_the_guard_must_catch_and_words_it_must_not(self):
        for t in ("(owner DR8, 2026-11-13 21:03)", "x (R11)", "(owner VR4)", "ANSWER 16", "QR-K2 (a)", "chat-Claude's", "slice 12a", "VAV-2b1", "(R-ROUND)",
                  "Case 7", "owner Q-pre 5", "cert finding a"):
            self.assertTrue([x for x in TEXTS.labels(t) if not x.startswith("key:")], t)
        for t in ("(owner, 2026-11-13 21:03)", 'owner 2026-11-22 10:49 "a"', "R/O, QRO", "BOQ-26-00020 r194", "Refrigerant Gas Filling (R-410)", "3.14 x dia + 110",
                  "S+I", "P/T test points", "VRF - installation-only uplift", "100 mm (W x H)"):
            self.assertEqual([x for x in TEXTS.labels(t) if not x.startswith("key:")], [], t)

    def test_07_the_new_keys_are_validated(self):
        cfg = {c["category_id"]: dict(c, discipline="HVAC") for c in _v82()["category_configs"]}
        cases = [
            (VAV, lambda c: c["list_spec"]["pricing"]["scope"].__setitem__("lines_follow", {}), "lines_follow needs exactly word"),
            (VAV, lambda c: c["list_spec"]["pricing"]["scope"].__setitem__("lines_follow", {"word": ""}), "word"),
            (VAV, lambda c: c["list_spec"]["pricing"]["sheet_shares"]["labels"].__setitem__("need_vavs_whole", ""), "need_vavs_whole"),
            (VAV, lambda c: c["list_spec"]["pricing"]["own_row_check"]["lines"].__setitem__("rate_only_some", "no rows here"), "rate_only_some must name"),
            (VAV, lambda c: c["list_spec"]["pricing"]["own_row_check"]["lines"].__setitem__("other", "x"), "own_row_check.lines needs exactly"),
            ("hvac_pricing_inputs", lambda c: c.__setitem__("live_reading", "yes"), "live_reading must be true"),
            ("hvac_piping", lambda c: c.__setitem__("live_reading", True), "Pricing Inputs category only"),
        ]
        for cid, edit, needle in cases:
            c = copy.deepcopy(cfg[cid])
            edit(c)
            with self.assertRaises(Exception) as cm:
                config_validation._validate_config(c)
            self.assertIn(needle, str(cm.exception))
        # KEY ABSENT stays valid: each optional key taken out again
        c = copy.deepcopy(cfg[VAV])
        del c["list_spec"]["pricing"]["scope"]["lines_follow"]
        for k in ("need_vavs_whole", "vavs_per_unit"):
            del c["list_spec"]["pricing"]["sheet_shares"]["labels"][k]
        for k in ("double_count_unread", "rate_only_some"):
            del c["list_spec"]["pricing"]["own_row_check"]["lines"][k]
        config_validation._validate_config(c)

    def test_08_R6_the_pricing_inputs_only_texts_change_and_no_value(self):
        a, b, k = _v81(), _v82(), _edits()["pricing_inputs"]
        self.assertEqual([i["item_uid"] for i in a["items"]], [i["item_uid"] for i in b["items"]])
        changed = [x["item_uid"] for x, y in zip(a["items"], b["items"]) if x != y]
        self.assertEqual(sorted(changed), sorted(k))
        self.assertTrue(all(x["rates"] == y["rates"] for x, y in zip(a["items"], b["items"])))
        self.assertEqual(sum("unit" in v for v in k.values()), 8)
        self.assertEqual([v["name"] for v in k.values() if "name" in v],
                         [["VAV - refixing (dismantling on its own row)", "VAV - refixing when dismantling is priced separately"]])
        texts = [str(i["unit"]) + " " + i["attributes"]["remarks"] for i in b["items"] if i["kind"].endswith("_pricing_input")]
        self.assertEqual(len(texts), 78)
        self.assertEqual([t for t in texts if re.search(r"\d{4}-\d\d-\d\d|\bowner\b|\btoday\b|\(0\.\d+ = \d+%\)", t)], [])

    def test_09_the_electrical_file_is_untouched(self):
        with open(os.path.join(DATA, "rate_master_electrical_all_v72.json"), "rb") as f:
            self.assertEqual(hashlib.sha256(f.read()).hexdigest()[:8], "80395f68")
        with open(os.path.join(DATA, "rate_master_electrical_all_v72.json"), encoding="utf-8") as f:
            self.assertNotIn("live_reading", f.read())

    def test_10_R13_a_harness_never_holds_an_AI_key(self):
        nk = _load("no_key", "scripts", "_instruments")
        from nirmaan_stack.api.boq.wizard import ai_settings
        real = ai_settings.get_boq_ai_api_key
        with nk.no_key() as where:
            self.assertIn("nirmaan_stack.api.boq.wizard.ai_settings", where)
            for name in where:
                with self.assertRaises(nk.NoKeyInAHarness):
                    sys.modules[name].get_boq_ai_api_key()
        self.assertIs(ai_settings.get_boq_ai_api_key, real)   # restored after the block
        # no instrument returns a dummy key
        d, bad = os.path.join(APP, "scripts"), []
        for root, _, files in os.walk(d):
            for n in files:
                if n.endswith(".py"):
                    with open(os.path.join(root, n), encoding="utf-8") as f:
                        if re.search(r"get_boq_ai_api_key[\"']?\s*,\s*(?:lambda[^:]*:\s*[\"']|return_value\s*=\s*[\"'])", f.read()):
                            bad.append(n)
        self.assertEqual(bad, [])

    # ---- the undo the older "live / newest == an older file" tests read through (PIN K2-C C2, K2-E; ANSWER 29, 37) ----
    def _v82_file(self):
        with open(os.path.join(DATA, "rate_master_hvac_all_v82.json"), encoding="utf-8") as f:
            return json.load(f)

    def test_11_undo_support_reads_only_the_edits_file_and_gives_v81_back(self):
        with open(os.path.join(FIX, "vav2c1Edits.json"), "rb") as f:
            self.assertEqual(hashlib.sha256(f.read()).hexdigest()[:8], "0b4aa1f9")   # the reviewed file
        v81, v82 = _v81(), self._v82_file()
        back = U.asset_as_v81(v82)
        self.assertEqual(json.dumps(back["category_configs"], sort_keys=True), json.dumps(v81["category_configs"], sort_keys=True))
        self.assertEqual(json.dumps(back["items"], sort_keys=True), json.dumps(v81["items"], sort_keys=True))
        self.assertEqual(U.as_v81(v81["category_configs"][0]), v81["category_configs"][0])   # v81 itself untouched
        # it opens ONE file: the edits fixture
        src = open(os.path.join(HERE, "vav2c1_undo_support.py"), encoding="utf-8").read()
        self.assertEqual(re.findall(r"open\(([^,)]+)", src), ["_FIX"])
        self.assertEqual(len(re.findall(r"\.json", src.split('"""')[2])), 1)

    def test_12_PLANTED_undeclared_changes_go_red_one_of_each_kind(self):
        v81 = _v81()
        def differs(asset):
            """what an older-file comparison through the undo would show: the names of everything not equal to v81"""
            try:
                b = U.asset_as_v81(asset)
            except AssertionError as e:
                return ["REFUSED %s" % str(e)[:40]]
            out, ia, ib = [], {i["item_uid"]: i for i in v81["items"]}, {i["item_uid"]: i for i in b["items"]}
            out += ["removed " + u for u in ia if u not in ib] + ["added " + u for u in ib if u not in ia]
            out += ["item " + u for u in ia if u in ib and json.dumps(ia[u], sort_keys=True) != json.dumps(ib[u], sort_keys=True)]
            ca = {c["category_id"]: c for c in v81["category_configs"]}
            return out + ["config " + c["category_id"] for c in b["category_configs"] if json.dumps(c, sort_keys=True) != json.dumps(ca[c["category_id"]], sort_keys=True)]
        ducting = lambda a: next(c for c in a["category_configs"] if c["category_id"] == "hvac_ducting")
        item = lambda a, kind: next(i for i in a["items"] if i["kind"] == kind)
        self.assertEqual(differs(self._v82_file()), [])
        a = self._v82_file(); it = item(a, "hvac_duct_item"); k = next(iter(it["rates"])); it["rates"][k] += 1                            # a rate
        self.assertEqual(differs(a), ["item " + it["item_uid"]])
        a = self._v82_file(); it = item(a, "hvac_vav_item"); it["rates"]["supply_markup"] += 0.01                                     # a markup
        self.assertEqual(differs(a), ["item " + it["item_uid"]])
        a = self._v82_file(); a["items"].append(dict(copy.deepcopy(a["items"][0]), item_uid="planted"))                              # an item added
        self.assertEqual(differs(a), ["added planted"])
        a = self._v82_file(); gone = a["items"].pop(5)["item_uid"]                                                                  # an item removed
        self.assertEqual(differs(a), ["removed " + gone])
        a = self._v82_file(); ducting(a)["category_display"] = "Ducting (changed)"                                                   # a key outside the edits
        self.assertEqual(differs(a), ["config hvac_ducting"])
        a = self._v82_file(); ducting(a)["planted_key"] = 1
        self.assertEqual(differs(a), ["config hvac_ducting"])
        a = self._v82_file(); ducting(a)["list_spec"]["pricing"]["planted_text"] = "a text in no edit"                                # a text not in the edits
        self.assertEqual(differs(a), ["config hvac_ducting"])
        e = next(x for x in _edits()["configs"] if x["c"] == "hvac_ducting" and isinstance(x["to"], str) and isinstance(x["from"], str))
        for bad in (e["to"] + "!", e["from"]):                                                                                        # a v82 text altered / half reverted
            a = self._v82_file(); c = ducting(a); node = c
            for p in e["p"][:-1]:
                node = node[p]
            node[e["p"][-1]] = bad
            self.assertTrue(differs(a)[0].startswith("REFUSED"), bad)
        # an edit whose 'before' is not what v81 holds is refused by the same rule as the mint
        with self.assertRaises(SystemExit):
            MINT.apply_config({"category_id": "hvac_ducting", "p": "v81"}, [{"c": "hvac_ducting", "p": ["p"], "from": "other", "to": "x"}])

    def test_13_no_product_module_imports_the_undo_support(self):
        app = os.path.join(APP, "nirmaan_stack")
        bad = []
        for root, _, files in os.walk(app):
            for n in files:
                if n.endswith(".py") and not n.startswith("test_") and n != "vav2c1_undo_support.py":
                    with open(os.path.join(root, n), encoding="utf-8") as f:
                        if "vav2c1_undo_support" in f.read():
                            bad.append(n)
        self.assertEqual(bad, [])


if __name__ == "__main__":
    unittest.main()
