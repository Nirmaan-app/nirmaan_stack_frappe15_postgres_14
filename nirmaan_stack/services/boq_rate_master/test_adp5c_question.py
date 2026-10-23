"""ADP-5c (owner rulings 2026-10-23 10:46 / 10:51 / 12:03-12:08; desktop Q1 (b)) -- HVAC v53. v53 is v52 with exactly the
ruled changes:

  ADP question   the family note gains C3 (a row that buys something returns at least one item), C1 / C4 / C5 in
                 ALTERNATIVE NAMES (a spigot damper is 'spigot', a multi-blade louver damper is 'VCD', a Z-piece / Z type
                 baffle / Z baffle / cross talk silencer is 'cross-talk', also under another family's heading) and C6 (a
                 plenum's accessories are part of it); the variant gains "aluminium" (values, values_by_family.VCD, the
                 note's aluminium sentence and D8 (a) "A motorised aluminium VCD is 'motorised'.").
  ADP catalogue  the catalogue variant values gain "aluminium"; ONE new SKU, VCD Aluminium (5,940 / 1,200, the GI
                 Rectangular row's other fields), its attributes read by `spec_reader`.
  ADP pricing    `number_defaults` face_w_mm / face_h_mm 300 for cross-talk; `existing_work` (supply 0, install x 1 / x 2).
  Insulation     C7: a paint or coating is never a cladding (the coating sentence replaced); the text answer
                 `coating_as_written` (asked last), shown read-only (`panel_readonly`) with its `read_notes` line.

Piping asks Insulation's questions as its delegated section, so C7 changes the Piping question ONLY inside that section.
Every other category's question, every other item and every top-level key is unchanged.

Pure: reads the committed assets and calls the extraction's own `build_items_spec` and `spec_reader` (no database, no
model). Run: bench --site localhost run-tests --module nirmaan_stack.services.boq_rate_master.test_adp5c_question
"""
import copy
import hashlib
import json
import os
import unittest

from nirmaan_stack.services.boq_rate_master import config_validation, extraction, spec_reader
from nirmaan_stack.services.boq_rate_master.test_config_validation_adp5c import CROSS_TALK_DEFAULT, EXISTING_WORK

DATA = os.path.join(os.path.dirname(__file__), "data")
ADP, INS, PIP = "hvac_adp", "hvac_insulation", "hvac_piping"
GI_RECT, VCD_AL_UID = "rmi-4f4585c07dd2", "rmi-c1ebcadd4fd5"

C3_OLD = "(owner ruling 6b: no SKU in the catalogue means the row is left blank for the user to decide)."
C3_NEW = (C3_OLD + " A row that buys something returns at least one item: an item outside the list is 'none of these' with "
          "'Item as written' -- never an empty list.")
ALT_OLD = "a tegular or plaque diffuser is 'square diffuser'."
ALT_NEW = ("a tegular or plaque diffuser is 'square diffuser'; a spigot damper is 'spigot' (code prices it as the Butterfly Damper "
           "With Spigot); a multi-blade louver damper is 'VCD'. A Z-piece, a Z type baffle, a Z baffle or a cross talk silencer is "
           "'cross-talk' (owner 2026-10-23), also under a heading that names another family (a Z type baffle under an ACTUATORS "
           "heading is 'cross-talk').")
C6_OLD = "Where an ancestor does describe the row's item as including one, both items are returned."
C6_NEW = (C6_OLD + " A PLENUM'S ACCESSORIES ARE PART OF IT (owner 2026-10-23): where the row's item is a 'double-skin plenum' or a "
          "'mixing box / LP plenum' itself, an access door or any other accessory the row names with it (hangers, cut-outs, "
          "openings) is not a second item -- return the plenum alone; its rate includes them.")
VAR_NOTE_OLD = "Owner defaults (R14) when 'None': VCD GI rectangular, fire damper without sleeve."
VAR_NOTE_NEW = (VAR_NOTE_OLD + " A VCD is 'aluminium' ONLY where the row or its headings say the damper is aluminium (aluminium, "
                "aluminum, Al.) (owner 2026-10-23); a VCD that does not say aluminium is answered as before and takes the default. "
                "A motorised aluminium VCD is 'motorised'.")
C7_OLD = ("A paint or coating with NO glass cloth ('polyshield coating', 'fire retardant coating', 'protective coating') is not a "
          "stocked cladding: leave 'Cladding' out and copy the coating into 'Cladding as written' -- never answer 'Glass Cloth "
          "with paint' for it; where the coating IS sandwiched with or applied over glass cloth, copy the words up to and "
          "including the glass cloth.")
C7_NEW = ("A paint or coating ('polyshield coating', 'fire retardant coating', 'protective coating', a UV coating, a lacquer) is "
          "not a cladding and never changes the price (owner 2026-10-23): where it is the only covering the text names, with no "
          "glass cloth, answer 'None' -- never 'Glass Cloth with paint' -- and leave it out of 'Cladding as written'. A cladding "
          "named beside it (an aluminium sheet, a foil) is answered as that cladding. Where the coating IS sandwiched with or "
          "applied over glass cloth, it is the paint of 'Glass Cloth with paint': copy the words up to and including the glass "
          "cloth into 'Cladding as written'.")
COATING_DEF = {"id": "coating_as_written", "label": "Coating as written", "type": "text",
               "note": ("A paint or coating the row or its heading names that is NOT the paint of 'Glass Cloth with paint' (a UV "
                        "coating, a fire or flame retardant coating, a polyshield or protective coating, a lacquer), in the BoQ's own "
                        "words; leave it out when no such coating is named. Shown on the panel only: the price never reads it. Copy "
                        "the words exactly as the BoQ writes them, as one continuous piece; never shorten, never join pieces with "
                        "'...' or any other mark; if the words are long, copy the shortest continuous piece that holds the value.")}
COATING_LINE = "Coating (as in BoQ): {match}. Coating price is not included - adjust the price if appropriate."
# the items-spec shas, json.dumps(spec, sort_keys=True), as `extraction._group_context` builds them (measured 2026-10-23)
SHA_V52 = {ADP: "2d9cd352bb52e1d2602892d957c7b7c0f88262a8f441ac7d6e0bc0c08dd2f078",
           INS: "5dd6268fe8b3a0db3af34380ec1de4aff1e0a65662ab0fb1901255cd11755cbb",
           PIP: "f5524dd1d39198bed005e48a5864748678dc0f638c25a08615a01f309ea08c70"}
SHA_V53 = {ADP: "72712eb4897526a95b68122ae4dc4286dbb7ea5fe17977b46203633261d36fd1", INS: "66639b0cb8182afe82e03a452074ff10d3b813ca6f956b00212a328042936052", PIP: "ee6848a58d275dd5ebc1ce380e5c9774f6001a7790f81457ac828fe1386e43d4"}


def _asset(n):
    with open(os.path.join(DATA, "rate_master_hvac_all_v%d.json" % n), encoding="utf-8") as f:
        return json.load(f)


def _cfg(payload, cid):
    return next(c for c in payload["category_configs"] if c["category_id"] == cid)


def _def(cfg, did, catalogue=False):
    return next(d for d in (cfg if catalogue else cfg["list_spec"])["attribute_definitions"] if d["id"] == did)


def _specs(payload):
    st = [dict(c, discipline=payload["discipline"]) for c in payload["category_configs"]]
    cfgs = {(payload["discipline"], c["category_id"]): c for c in st}
    return {c["category_id"]: extraction.build_items_spec(cfgs[(payload["discipline"], c["category_id"])], cfgs, payload["discipline"])
            for c in st if c.get("list_spec")}


def _sha(o):
    return hashlib.sha256(json.dumps(o, sort_keys=True).encode()).hexdigest()


def _ruled(v52):
    """v52 with ONLY the ruled edits applied -- the test's own reconstruction, compared with the committed v53."""
    p = copy.deepcopy(v52)
    adp, ins = _cfg(p, ADP), _cfg(p, INS)
    fam = _def(adp, "family")
    fam["note"] = fam["note"].replace(C3_OLD, C3_NEW).replace(ALT_OLD, ALT_NEW).replace(C6_OLD, C6_NEW)
    var = _def(adp, "variant")
    var["values"].append("aluminium"); var["values_by_family"]["VCD"].append("aluminium")
    var["note"] = var["note"].replace(VAR_NOTE_OLD, VAR_NOTE_NEW)
    _def(adp, "variant", catalogue=True)["values"].append("aluminium")
    pr = adp["list_spec"]["pricing"]
    pr["number_defaults"]["face_w_mm"] = dict(CROSS_TALK_DEFAULT)
    pr["number_defaults"]["face_h_mm"] = dict(CROSS_TALK_DEFAULT)
    pr["existing_work"] = copy.deepcopy(EXISTING_WORK)
    cl = _def(ins, "cladding")
    cl["note"] = cl["note"].replace(C7_OLD, C7_NEW)
    ins["list_spec"]["attribute_definitions"].append(dict(COATING_DEF))
    ipr = ins["list_spec"]["pricing"]
    ipr["panel_readonly"] = ipr["panel_readonly"] + ["coating_as_written"]
    ipr["read_notes"] = ipr["read_notes"] + [{"families": list(ipr["families"]), "from_attr": "coating_as_written",
                                              "pattern": "^\\s*(\\S.*?)\\s*$", "line": COATING_LINE}]
    return p


class TestAdp5cQuestion(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.v52, cls.v53 = _asset(52), _asset(53)
        cls.s52, cls.s53 = _specs(cls.v52), _specs(cls.v53)

    def test_01_v53_validates(self):
        stored = [dict(c, discipline=self.v53["discipline"]) for c in self.v53["category_configs"]]
        for c in stored:
            config_validation._validate_config(c)
        self.assertEqual(config_validation.delegated_section_problems(stored, self.v53["items"]), [])

    def test_02_every_ruled_old_text_was_there_once_and_is_replaced(self):
        for cid, did, old, new in ((ADP, "family", C3_OLD, C3_NEW), (ADP, "family", ALT_OLD, ALT_NEW), (ADP, "family", C6_OLD, C6_NEW),
                                   (ADP, "variant", VAR_NOTE_OLD, VAR_NOTE_NEW), (INS, "cladding", C7_OLD, C7_NEW)):
            n52, n53 = _def(_cfg(self.v52, cid), did)["note"], _def(_cfg(self.v53, cid), did)["note"]
            self.assertEqual(n52.count(old), 1, (cid, did, old[:40]))
            self.assertEqual(n53.count(new), 1, (cid, did, new[:40]))
        # NEGATIVE: the coating sentence's old words are gone; the glass-cloth rule (owner 10:51 "stands") is untouched
        ins53 = _def(_cfg(self.v53, INS), "cladding")["note"]
        self.assertNotIn("leave 'Cladding' out and copy the coating", ins53)
        self.assertIn("A paint or coating over glass cloth (two coats of UV paint, a flame-retardant coating sandwiched with glass "
                      "cloth) is 'Glass Cloth with paint'", ins53)
        # NEGATIVE: no canvas-connection clause (owner: do not use candidate b) and no transfer-duct clause (owner 10:25)
        fam53 = _def(_cfg(self.v53, ADP), "family")["note"]
        self.assertNotIn("canvas connection", fam53)
        self.assertNotIn("transfer", fam53)

    def test_03_v53_is_v52_with_exactly_the_ruled_config_edits(self):
        want = _ruled(self.v52)
        a = {c["category_id"]: c for c in self.v52["category_configs"]}
        b = {c["category_id"]: c for c in self.v53["category_configs"]}
        self.assertEqual(sorted(k for k in a if a[k] != b[k]), [ADP, INS])
        for c in want["category_configs"]:
            self.assertEqual(c, b[c["category_id"]], c["category_id"])
        self.assertEqual({k: v for k, v in self.v52.items() if k not in ("category_configs", "items")},
                         {k: v for k, v in self.v53.items() if k not in ("category_configs", "items")})

    def test_04_one_new_sku_vcd_aluminium_every_other_item_unchanged(self):
        i52 = {i["item_uid"]: i for i in self.v52["items"]}
        i53 = {i["item_uid"]: i for i in self.v53["items"]}
        self.assertEqual(sorted(set(i53) - set(i52)), [VCD_AL_UID])
        self.assertEqual(sorted(set(i52) - set(i53)), [])
        self.assertTrue(all(i52[u] == i53[u] for u in i52))
        al, gi = i53[VCD_AL_UID], i52[GI_RECT]
        self.assertEqual(al["rates"], {"supply_markup": 0.45, "install_markup": 0.6, "cost_supply": 5940.0, "cost_install": 1200.0})
        self.assertEqual(al["rates"]["cost_supply"], round(gi["rates"]["cost_supply"] * 1.10, 6))      # seeded +10%, typed
        self.assertEqual({k: v for k, v in al.items() if k not in ("item_uid", "attributes", "rates")},
                         {k: v for k, v in gi.items() if k not in ("item_uid", "attributes", "rates")})
        attrs, reason = spec_reader.attributes_for(ADP, "Volume control Damper (VCD)", "Aluminium", "SQM")
        self.assertIsNone(reason)
        self.assertEqual(al["attributes"], attrs)                                                     # READ, never hand-typed
        self.assertEqual(al["attributes"]["variant"], "aluminium")
        # per sq.m: 5,940 x 1.45 = 8,613 supply; 1,200 x 1.6 = 1,920 install
        self.assertEqual((round(5940 * 1.45), round(1200 * 1.6)), (8613, 1920))

    def test_05_aluminium_in_every_variant_list_and_nowhere_else(self):
        adp = _cfg(self.v53, ADP)
        self.assertEqual(_def(adp, "variant")["values"][-1], "aluminium")
        self.assertEqual(_def(adp, "variant")["values_by_family"]["VCD"], ["GI oval", "motorised", "GI rectangular", "aluminium"])
        self.assertEqual(_def(adp, "variant")["values_by_family"]["fire damper"], _def(_cfg(self.v52, ADP), "variant")["values_by_family"]["fire damper"])
        self.assertEqual(_def(adp, "variant", catalogue=True)["values"][-1], "aluminium")

    def test_06_the_pricing_keys(self):
        pr = _cfg(self.v53, ADP)["list_spec"]["pricing"]
        self.assertEqual(pr["existing_work"], EXISTING_WORK)
        self.assertEqual({k: pr["number_defaults"][k] for k in ("face_w_mm", "face_h_mm")}, {"face_w_mm": CROSS_TALK_DEFAULT, "face_h_mm": CROSS_TALK_DEFAULT})
        self.assertEqual(pr["number_defaults"]["piece_length_m"], _cfg(self.v52, ADP)["list_spec"]["pricing"]["number_defaults"]["piece_length_m"])
        ipr = _cfg(self.v53, INS)["list_spec"]["pricing"]
        self.assertEqual(ipr["panel_readonly"], ["brand", "cladding_as_written", "coating_as_written"])
        self.assertEqual(ipr["read_notes"][-1]["line"], COATING_LINE)
        self.assertEqual(ipr["read_notes"][-1]["families"], list(ipr["families"]))
        # the pricing never reads the coating: not a SKU attribute, not a number source
        read = set(ipr["match_attrs"]) | {s for n in ipr["numbers"].values() for s in n.get("from") or []}
        self.assertNotIn("coating_as_written", read)
        # NEGATIVE: no existing_work on Insulation or Piping (owner 12:08: ADP only for now)
        self.assertNotIn("existing_work", ipr)
        self.assertNotIn("existing_work", _cfg(self.v53, PIP)["list_spec"]["pricing"])

    def test_07_the_question_shas(self):
        self.assertEqual({k: _sha(self.s52[k]) for k in SHA_V52}, SHA_V52)
        self.assertEqual({k: _sha(self.s53[k]) for k in SHA_V53}, SHA_V53)
        self.assertEqual(sorted(self.s53), sorted(self.s52))
        self.assertEqual(sorted(k for k in self.s52 if _sha(self.s52[k]) != _sha(self.s53[k])), [ADP, INS, PIP])

    def test_08_piping_changes_only_inside_its_insulation_section(self):
        p52, p53 = self.s52[PIP], self.s53[PIP]
        self.assertEqual({k: v for k, v in p52.items() if k != "sections"}, {k: v for k, v in p53.items() if k != "sections"})
        self.assertEqual([{k: v for k, v in s.items() if k != "items_spec"} for s in p52["sections"]],
                         [{k: v for k, v in s.items() if k != "items_spec"} for s in p53["sections"]])
        self.assertEqual([s["items_spec"] for s in p53["sections"]], [self.s53[INS]])

    def test_09_the_items_spec_carries_the_texts_and_no_pricing_key(self):
        ins = self.s53[INS]["attribute_definitions"]
        self.assertEqual(ins[-1], {"id": "coating_as_written", "label": "Coating as written", "type": "text", "note": COATING_DEF["note"]})
        self.assertIn(C7_NEW, next(d for d in ins if d["id"] == "cladding")["note"])
        adp = self.s53[ADP]["attribute_definitions"]
        self.assertIn(ALT_NEW, next(d for d in adp if d["id"] == "family")["note"])
        self.assertIn("aluminium", next(d for d in adp if d["id"] == "variant")["values"])
        for k in ("existing_work", "number_defaults", "read_notes", "panel_readonly", "Coating price is not included"):
            self.assertNotIn(k, json.dumps(self.s53))                      # a pricing key is never sent to the model


if __name__ == "__main__":
    unittest.main()
