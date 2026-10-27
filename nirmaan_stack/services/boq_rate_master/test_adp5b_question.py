"""ADP-5b (owner R1 / R2 / R5-note, 2026-10-22 10:49 "ok with 1 to3 and 5 to 8"; STOP 1 option 1, 2026-10-23) -- HVAC v52,
the model's QUESTION and nothing else. v52 is v51 with exactly three changes, all model-facing:

  R1  ADP gains a text answer `item_as_written` ("Item as written", asked last) and `list_spec.pricing.no_sku_named_by`
      naming it -- the Insulation mechanism (12d-1b T5), so a "none of these" refusal names the thing the row buys.
      The pricing never reads it (the validator's own rule); the panel side is pinned in `adp5b.test.ts`.
  R2  the Insulation `cladding` note: a cladding a heading names "where required" / "if required" / "as required" /
      "as directed" still applies to every row under it; only a condition naming WHERE the item is limits it.
  R5  the ADP `damper` note's default sentence says "without (curved grille: with)" -- the ADP-5a default, in words.

Piping asks Insulation's questions as its delegated section (12e-3a, owner D-2 "no second copy"), so R2 also changes the
Piping question -- ONLY inside that section (owner, STOP 1 option 1). Every other category's question is unchanged.

Pure: reads the committed assets and calls the extraction's own `build_items_spec` (no database, no model). Run:
bench --site localhost run-tests --module nirmaan_stack.services.boq_rate_master.test_adp5b_question
"""
import copy
import hashlib
import json
import os
import unittest

from nirmaan_stack.services.boq_rate_master import config_validation, extraction

DATA = os.path.join(os.path.dirname(__file__), "data")
ADP, INS, PIP = "hvac_adp", "hvac_insulation", "hvac_piping"
R1_DEF = {"id": "item_as_written", "label": "Item as written", "type": "text",
          "note": "When the family is 'none of these', the item the row buys, in the BoQ's own words (one continuous piece, the "
                  "shortest that names it: 'Hit & Miss Damper', 'Bird Screens with GI wire mesh'). Leave it out for every other family."}
R2_OLD = ("A cladding a heading names only on a condition (for pipes exposed to sun or atmosphere) applies only to a row "
          "that meets that condition.")
R2_NEW = ("A cladding a heading names with 'where required', 'if required', 'as required' or 'as directed' still applies to "
          "every row under that heading: answer it. Only a condition that names WHERE the item is (pipes exposed to sun or "
          "atmosphere, outdoor, exposed areas) limits the cladding to rows that meet that condition.")
R5_OLD = "Owner default (R1) when 'None': without."
R5_NEW = "Owner default (R1) when 'None': without (curved grille: with)."
# the items-spec shas, json.dumps(spec, sort_keys=True), as `extraction._group_context` builds them (measured 2026-10-23)
SHA_V51 = {ADP: "dcbe3a2e9ca165d683d4d42a5f872105d4ed33ed3833b2f2c066e0cbb14667e4",
           INS: "c335f2b885daacd30fb2e32176f05cb3e24ceea6c0ae48c0a666b5a611d57cb6",
           PIP: "757f2ba451743d6f7b2fd0c93d0d0d4e84bca40d06e54bcf0d5319d0d8ba05ae"}
SHA_V52 = {ADP: "2d9cd352bb52e1d2602892d957c7b7c0f88262a8f441ac7d6e0bc0c08dd2f078",
           INS: "5dd6268fe8b3a0db3af34380ec1de4aff1e0a65662ab0fb1901255cd11755cbb",
           PIP: "f5524dd1d39198bed005e48a5864748678dc0f638c25a08615a01f309ea08c70"}


def _asset(n):
    with open(os.path.join(DATA, "rate_master_hvac_all_v%d.json" % n), encoding="utf-8") as f:
        return json.load(f)


def _cfg(payload, cid):
    return next(c for c in payload["category_configs"] if c["category_id"] == cid)


def _def(cfg, did):
    return next(d for d in cfg["list_spec"]["attribute_definitions"] if d["id"] == did)


def _specs(payload):
    st = [dict(c, discipline=payload["discipline"]) for c in payload["category_configs"]]
    cfgs = {(payload["discipline"], c["category_id"]): c for c in st}
    return {c["category_id"]: extraction.build_items_spec(cfgs[(payload["discipline"], c["category_id"])], cfgs, payload["discipline"])
            for c in st if c.get("list_spec")}


def _sha(o):
    return hashlib.sha256(json.dumps(o, sort_keys=True).encode()).hexdigest()


class TestAdp5bQuestion(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.v51, cls.v52 = _asset(51), _asset(52)
        cls.s51, cls.s52 = _specs(cls.v51), _specs(cls.v52)

    def test_01_v52_validates(self):
        stored = [dict(c, discipline=self.v52["discipline"]) for c in self.v52["category_configs"]]
        for c in stored:
            config_validation._validate_config(c)
        self.assertEqual(config_validation.delegated_section_problems(stored, self.v52["items"]), [])

    def test_02_r1_item_as_written_on_adp(self):
        adp = _cfg(self.v52, ADP)
        defs = adp["list_spec"]["attribute_definitions"]
        self.assertEqual(defs[-1], R1_DEF)                                   # asked last, exactly as ruled
        self.assertEqual(adp["list_spec"]["pricing"]["no_sku_named_by"], "item_as_written")
        pr = adp["list_spec"]["pricing"]
        read = set(pr["match_attrs"]) | {s for n in pr["numbers"].values() for s in n.get("from") or []} | {adp["list_spec"]["family_attribute_id"]}
        self.assertNotIn("item_as_written", read)                            # the pricing never reads it
        self.assertNotIn("item_as_written", pr["panel_controls"])            # and no panel box shows it
        # negative: v51 had neither, and the Insulation precedent is untouched
        self.assertNotIn("item_as_written", [d["id"] for d in _cfg(self.v51, ADP)["list_spec"]["attribute_definitions"]])
        self.assertNotIn("no_sku_named_by", _cfg(self.v51, ADP)["list_spec"]["pricing"])
        self.assertEqual(_cfg(self.v52, INS)["list_spec"]["pricing"]["no_sku_named_by"], "material_as_written")

    def test_03_r1_refused_in_any_other_form(self):
        for bad, words in ((lambda c: _def(c, "item_as_written").update(type="choice", values=["a"]), "must be a text definition"),
                           (lambda c: c["list_spec"]["pricing"].update(no_sku_named_by="family"), "is read by the pricing"),
                           (lambda c: c["list_spec"]["pricing"].update(no_sku_named_by="item_written"), "not an item attribute")):
            c = dict(copy.deepcopy(_cfg(self.v52, ADP)), discipline="HVAC")
            bad(c)
            with self.assertRaises(Exception) as cm:
                config_validation._validate_config(c)
            self.assertIn(words, str(cm.exception))

    def test_04_r5_damper_note_text(self):
        n51, n52 = _def(_cfg(self.v51, ADP), "damper")["note"], _def(_cfg(self.v52, ADP), "damper")["note"]
        self.assertTrue(n52.startswith(R5_NEW))
        self.assertNotIn(R5_OLD, n52)
        self.assertEqual(n51.replace(R5_OLD, R5_NEW), n52)                   # nothing else in the note moved

    def test_05_r2_cladding_note_text(self):
        n51, n52 = _def(_cfg(self.v51, INS), "cladding")["note"], _def(_cfg(self.v52, INS), "cladding")["note"]
        self.assertEqual((n52.count(R2_NEW), n52.count(R2_OLD)), (1, 0))
        self.assertEqual(n51.replace(R2_OLD, R2_NEW), n52)

    def test_06_only_adp_and_insulation_configs_change(self):
        a = {c["category_id"]: c for c in self.v51["category_configs"]}
        b = {c["category_id"]: c for c in self.v52["category_configs"]}
        self.assertEqual(sorted(k for k in a if a[k] != b[k]), [ADP, INS])
        self.assertEqual(self.v51["items"], self.v52["items"])
        self.assertEqual({k: v for k, v in self.v51.items() if k not in ("category_configs",)},
                         {k: v for k, v in self.v52.items() if k not in ("category_configs",)})
        # each changed config differs by EXACTLY the ruled lines
        ea = copy.deepcopy(a[ADP]); ea["list_spec"]["attribute_definitions"].append(dict(R1_DEF))
        ea["list_spec"]["pricing"]["no_sku_named_by"] = "item_as_written"
        _def(ea, "damper")["note"] = _def(ea, "damper")["note"].replace(R5_OLD, R5_NEW)
        self.assertEqual(ea, b[ADP])
        ei = copy.deepcopy(a[INS]); _def(ei, "cladding")["note"] = _def(ei, "cladding")["note"].replace(R2_OLD, R2_NEW)
        self.assertEqual(ei, b[INS])

    def test_07_the_question_shas(self):
        self.assertEqual({k: _sha(self.s51[k]) for k in SHA_V51}, SHA_V51)
        self.assertEqual({k: _sha(self.s52[k]) for k in SHA_V52}, SHA_V52)
        self.assertEqual(sorted(self.s52), sorted(self.s51))
        self.assertEqual(sorted(k for k in self.s51 if _sha(self.s51[k]) != _sha(self.s52[k])), [ADP, INS, PIP])

    def test_08_piping_changes_only_inside_its_insulation_section(self):
        p51, p52 = self.s51[PIP], self.s52[PIP]
        self.assertEqual({k: v for k, v in p51.items() if k != "sections"}, {k: v for k, v in p52.items() if k != "sections"})
        self.assertEqual([{k: v for k, v in s.items() if k != "items_spec"} for s in p51["sections"]],
                         [{k: v for k, v in s.items() if k != "items_spec"} for s in p52["sections"]])
        self.assertEqual([s["items_spec"] for s in p52["sections"]], [self.s52[INS]])
        self.assertEqual([s["items_spec"] for s in p51["sections"]], [self.s51[INS]])

    def test_09_the_items_spec_carries_r1_and_the_notes(self):
        adp = self.s52[ADP]["attribute_definitions"]
        self.assertEqual(adp[-1], {"id": "item_as_written", "label": "Item as written", "type": "text", "note": R1_DEF["note"]})
        self.assertTrue(next(d for d in adp if d["id"] == "damper")["note"].startswith(R5_NEW))
        self.assertIn(R2_NEW, next(d for d in self.s52[INS]["attribute_definitions"] if d["id"] == "cladding")["note"])
        self.assertNotIn("no_sku_named_by", json.dumps(self.s52))           # a pricing key is never sent to the model


if __name__ == "__main__":
    unittest.main()
