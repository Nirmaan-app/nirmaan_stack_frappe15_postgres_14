"""DU-2 K2 (2026-11-16, run on the laptop) -- MINT HVAC v72 = v71 + ONLY THE DUCTING CONFIG CHANGES for the owner's 23:57 row rulings
(R-DUCT, R-PAINT, R-REMOVAL, R-DOUBT, R-NOTE-ORDER; 2026-11-16 00:06 "only if the user classified it as duct"), the DU-1 cert finding a
(owner 2026-11-15 23:29) and the P0 defect (the borrowed Misc question carried the Valve Package's note). Every item and every other
config is byte-identical to v71 (asserted); second_opinion stays FALSE.

What changes in hvac_ducting (nothing else):
  duct_type note         the ITEM of the row decides; words naming what the duct connects to / what it is for / what else is supplied
                         are extras; the doubtful-row readings (18G "& plenum", duct for a return-air plenum, PIR panels, ducts with
                         acoustic lining, a removal that also removes insulation / silencers); a paint / coating / balancing-only row ->
                         its Misc item only
  scope note             + "labour charges" for duct erection is Installation only (QR-1 Q1)
  text_notes             + a third DR10 note: plenum boxes / attenuators / silencers / flexible duct named in a duct row (Q6, QR-1 Q2 (a))
  no_sku_refusals        + valve -> Valve Package, copper / refrigerant pipe -> Piping, VRF / AC units -> VRF (first, before the
                         insulation words)
  no_sku_refuse_default  the re-file sentence for any other non-duct (R-NOTE-ORDER)
  family_alias_needs     "Round (GI) - per metre" reads its gauge and diameter only (finding a)
  sections[misc]         + family_note: the Ducting Misc question (Paint / Fire Retardant / Air Balancing), not the Valve Package's
  rule_lines             + R-NOTE-ORDER; DR3's detail names SWG and the misspelling "gause" (R-TYPO)
  derivation_reasons     + one reason per new line

Runs IN THE CONTAINER under the bench's python. Phases: build (v71 -> the candidate; NO database write), load, verify (as v71's).
Usage (container, from frappe-bench): env/bin/python -I <this> <phase> [--candidate P]
"""
import argparse, copy, hashlib, json, os, re

APP = "/workspace/development/frappe-bench/apps/nirmaan_stack"
DATA = os.path.join(APP, "nirmaan_stack/services/boq_rate_master/data")
V71 = os.path.join(DATA, "rate_master_hvac_all_v71.json")
V72 = os.path.join(DATA, "rate_master_hvac_all_v72.json")
DUCT, MISC, VALVE = "hvac_ducting", "hvac_misc", "hvac_valve_package"
DUCT_FAMS = ["Rectangular (GI)", "Spiral / Oval (GI)", "PIR (Pre Insulated Duct)", "Fire Rated (MS)"]

DUCT_TYPE_NOTE = (
    "Which duct THIS row buys: Rectangular (GI); Spiral / Oval (GI) (spiral, flat oval, elliptical, and round / circular ducts priced per"
    " sq.m); Round (GI) - per metre (a round / circular duct the row prices per metre with its diameter); PIR (Pre Insulated Duct)"
    " (pre-insulated / PIR panel ducts); Fire Rated (MS) (MS / black steel / fire-rated / kitchen exhaust ducts). Answer from the row, or a"
    " heading that describes this row's duct. 'None' when the row names a duct but no shape. THE ITEM OF THE ROW DECIDES: when the row buys"
    " a duct, answer the duct even where its words also name what the duct connects to, what it is for, or what else is supplied with it"
    " (dampers, plenums, plenum boxes, grilles / diffusers, attenuators / silencers, flexible duct, butterfly dampers, access doors) -"
    " those are extras, not the item. A gauge 'for ducts above 2250 mm and plenum' is a duct of that gauge; a 'duct for return air"
    " plenum' is a duct; 'PIR panels' are PIR ducts; 'sheet metal ducts with acoustic lining' are ducts (Insulated Yes, the lining as their"
    " insulation item); a removal of existing ducts that also removes their insulation or silencers is a duct row. 'none of these' only when"
    " the item itself is not a duct (a damper, plenum box, grille, diffuser, silencer, flexible duct, canvas, turning vanes, a VRF / AC"
    " unit, a valve, a sensor or thermostat, a copper / refrigerant pipe, insulation on its own) - copy what it is in duct_type_as_written."
    " A row that pays ONLY for painting, a fire-retardant coating or air balancing of ducts returns NO main item - only its Misc item.")
SCOPE_ADD = " 'Labour charges' for duct erection / installation (no material) is Installation only."
TEXT_NOTE_3 = {"families": DUCT_FAMS, "from_text": "own_and_headings",
               "pattern": r"plenum|attenuator|silencer|flexible|flex\s*duct|cross\s*talk",
               "line": "Also names plenum boxes / attenuators / silencers / flexible duct - each priced in its own row, not in this price",
               "rule": "DR10",
               "rule_line": "A duct row naming plenum boxes, attenuators, silencers or flexible duct carries a note that they are not in this price"}
REFUSALS_FIRST = [
    {"words": ["valve"], "refuse": "Reads as a valve, not a duct - re-file this row under Valve Package"},
    {"words": ["copper", "hard drawn", "refrigerant pipe", "refrigerant piping"],
     "refuse": "Reads as a copper / refrigerant pipe, not a duct - re-file this row under Piping"},
    {"words": ["outdoor unit", "indoor unit", "cassette", "vrv", "vrf", "hi wall", "high wall", "ductable unit"],
     "refuse": "Reads as a VRF / AC unit, not a duct - re-file this row under VRF"},
]
REFUSE_DEFAULT = "Reads as '{named}', not a duct - re-file this row under its own category"
ALIAS_NEEDS = {"Round (GI) - per metre": ["thickness_mm", "dia_mm"]}
MISC_FAMILY_NOTE = (
    "Which Misc item THIS row buys for the ducts: Paint (painting of ducts - primer, enamel, spray or roller paint in a shade); Fire"
    " Retardant Spray Paint (a fire-retardant / fire-resistant / intumescent coating on ducts); Air Balancing (testing, adjusting and"
    " balancing of the air system). Answer 'none of these' for anything else and copy its words into 'Item as written'. On a row that"
    " buys a duct, return no Misc item: painting, coating or balancing a duct row names are noted there, not priced (they are priced on"
    " their own rows).")
RULE_NOTE_ORDER = {"rule": "R-NOTE-ORDER", "title": "A row read as not a duct refuses with its re-file sentence before any unit check",
                   "detail": "a VRF unit, a valve, a thermostat or a copper pipe filed Ducting says which category to re-file it under, never 'unit not priceable'"}
DR3_DETAIL_ADD = "; gauge words: G, SWG (18 SWG = 18G), gauge, and the misspellings guage / gause ('24 gause' = 24G)"
REASONS_FIRST = [
    {"rule": "R-NOTE-ORDER", "why": "non-ducts filed Ducting stay unpriced, but the note must be the re-file note, not 'unit not priceable' (owner, 2026-11-15 23:57)"},
    {"title": "^A duct row naming plenum boxes",
     "why": "\"are these classified as ducts by users, then it needs to be priced correctly\" - a duct row naming extras is priced as a duct, the extras noted (owner R-DUCT, 2026-11-15 23:57)"},
    {"title": "reads only its", "why": "a round duct shows no Width / Height boxes (owner, DU-1 cert finding a, 2026-11-15 23:29 \"fix in DU 2\")"},
    {"title": "^A row read as none of the kinds", "why": "non-ducts filed Ducting are left unpriced with a re-file note (owner R-NOTE-ORDER, 2026-11-15 23:57)"},
]


def ducting_config(prev):
    c = copy.deepcopy(prev)
    ls = c["list_spec"]; pr = ls["pricing"]
    defs = {d["id"]: d for d in ls["attribute_definitions"]}
    defs["duct_type"]["note"] = DUCT_TYPE_NOTE
    assert defs["scope"]["note"].endswith(".")
    defs["scope"]["note"] = defs["scope"]["note"] + SCOPE_ADD
    assert len(pr["text_notes"]) == 2
    pr["text_notes"].append(copy.deepcopy(TEXT_NOTE_3))
    pr["no_sku_refusals"] = copy.deepcopy(REFUSALS_FIRST) + pr["no_sku_refusals"]
    # the new keys, placed after the keys they extend (the dump keeps insertion order)
    np = {}
    for k, v in pr.items():
        np[k] = v
        if k == "family_alias_offered":
            np["family_alias_needs"] = copy.deepcopy(ALIAS_NEEDS)
        if k == "no_sku_refusals":
            np["no_sku_refuse_default"] = REFUSE_DEFAULT
    assert "family_alias_needs" in np and "no_sku_refuse_default" in np
    rl = np["rule_lines"]
    dr3 = [r for r in rl if r["rule"] == "DR3"]
    assert len(dr3) == 1
    dr3[0]["detail"] = dr3[0]["detail"] + DR3_DETAIL_ADD
    rl.append(copy.deepcopy(RULE_NOTE_ORDER))
    np["derivation_reasons"] = copy.deepcopy(REASONS_FIRST) + np["derivation_reasons"]
    ls["pricing"] = np
    misc = [s for s in ls["sections"] if s.get("id") == "misc"]
    assert len(misc) == 1 and misc[0].get("category_id") == MISC
    misc[0]["family_note"] = MISC_FAMILY_NOTE
    assert ls.get("second_opinion") is False
    return c


def _connect():
    os.chdir("/workspace/development/frappe-bench/sites")
    import frappe
    frappe.init(site="localhost"); frappe.connect()
    return frappe


def _canon(o):
    return json.dumps(o, sort_keys=True, separators=(",", ":"), default=str)


def _dump(p):
    return json.dumps(p, indent=1, ensure_ascii=False) + "\n"


def build(out):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import config_validation, extraction
    from nirmaan_stack.services.boq_rate_master.loader import _validate_items, _validate_one_config
    raw = open(V71, "rb").read()
    prev = json.loads(raw.decode("utf-8"))
    if _dump(prev).encode("utf-8") != raw:
        raise SystemExit("re-dumping v71 does not reproduce its bytes -- the series convention is not what this mint writes")
    final = copy.deepcopy(prev)
    idx = {c["category_id"]: n for n, c in enumerate(prev["category_configs"])}
    final["category_configs"][idx[DUCT]] = ducting_config(prev["category_configs"][idx[DUCT]])
    assert _canon(prev["items"]) == _canon(final["items"]), "an item moved"
    for x, y in zip(prev["category_configs"], final["category_configs"]):
        assert x["category_id"] == y["category_id"]
        if x["category_id"] != DUCT:
            assert _canon(x) == _canon(y), x["category_id"]
        else:
            assert _canon(x) != _canon(y), x["category_id"]
    assert list(final.keys()) == list(prev.keys())

    _validate_items(final["items"])
    stored = [dict(c, discipline=final["discipline"]) for c in final["category_configs"]]
    for n, c in enumerate(stored):
        _validate_one_config(c, "category_configs[%d]" % n)
        config_validation._validate_config(c)
    problems = (config_validation.delegated_section_problems(stored, final["items"]) + config_validation.extras_problems(stored, final["items"])
                + config_validation.scope_problems(stored, final["items"]))
    if problems:
        raise SystemExit("cross-category check refuses: %r" % problems)
    cfgs = {(final["discipline"], c["category_id"]): c for c in stored}
    stored_base = [dict(c, discipline=prev["discipline"]) for c in prev["category_configs"]]
    cfgs_base = {(prev["discipline"], c["category_id"]): c for c in stored_base}
    eligible = sorted(c["category_id"] for c in stored if extraction.config_is_eligible(c, cfgs))
    eligible_base = sorted(c["category_id"] for c in stored_base if extraction.config_is_eligible(c, cfgs_base))
    assert eligible == eligible_base, (eligible, eligible_base)

    # STUB PROOF: the model's question is byte-identical for EVERY category but Ducting (its own question changes, nothing else)
    def requests(st, cf):
        return {c["category_id"]: json.dumps(extraction.build_items_spec(cf[("HVAC", c["category_id"])], cf, "HVAC"), sort_keys=True)
                for c in st if c.get("list_spec")}
    r_base, r_new = requests(stored_base, cfgs_base), requests(stored, cfgs)
    diff = sorted(k for k in set(r_base) | set(r_new) if r_base.get(k) != r_new.get(k))
    print("STUB PROOF: item-list requests v71 vs v72 -- identical:", sorted(k for k in r_base if r_base[k] == r_new.get(k)), "| differing:", diff)
    assert diff == [DUCT], diff
    print("eligible configs v72 = v71:", eligible)

    text = _dump(final)
    tokens = sorted({t for t in re.findall(r"v\d+", text.replace(json.dumps(final.get("source_workbook") or "", ensure_ascii=False), '""'))})
    if tokens:
        raise SystemExit("the asset text carries version-like tokens %r (h07)" % tokens)
    open(out, "w", encoding="utf-8", newline="").write(text)
    print("candidate written:", out, "| items", len(final["items"]), "| configs", len(final["category_configs"]),
          "| sha256", hashlib.sha256(text.encode("utf-8")).hexdigest(),
          "| per-config sha16", {c["category_id"]: hashlib.sha256(_canon(c).encode()).hexdigest()[:16] for c in final["category_configs"] if c["category_id"] == DUCT})
    frappe.destroy()


def load(candidate):
    frappe = _connect()
    frappe.set_user("Administrator")
    from nirmaan_stack.services.boq_rate_master import exporter, loader
    payload = exporter.build_asset("HVAC")
    snap = exporter.write_snapshot("HVAC", exporter.serialize_asset(payload), payload)
    frappe.db.commit()
    print("PRE-LOAD SNAPSHOT", snap, "| items", len(payload["items"]), "| configs", len(payload["category_configs"]))
    s = loader.load_rate_master(path=candidate, replace=True)
    frappe.db.commit()
    print("LOAD SUMMARY:", json.dumps(s, default=str)[:1500])
    frappe.destroy()


def verify(candidate):
    frappe = _connect()
    asset = json.load(open(candidate, encoding="utf-8"))
    out = {}
    J = lambda v: json.loads(v) if isinstance(v, str) else v
    for disc in ("HVAC", "Electrical"):
        li = frappe.db.sql('select item_uid, kind, brand, unit, attributes, rates from "tabBoQ Rate Master Item" where active=1 and discipline=%s', (disc,), as_dict=True)
        lc = frappe.db.sql('select category_id, config from "tabBoQ Rate Category Config" where active=1 and discipline=%s', (disc,), as_dict=True)
        L = {r["item_uid"]: {"kind": r["kind"], "brand": r["brand"] or None, "unit": r["unit"] or None, "attributes": J(r["attributes"]), "rates": J(r["rates"])} for r in li}
        LC = {r["category_id"]: J(r["config"]) for r in lc}
        h_i = hashlib.sha256("".join(u + _canon(L[u]) for u in sorted(L)).encode()).hexdigest()[:16]
        h_c = hashlib.sha256("".join(c + _canon(LC[c]) for c in sorted(LC)).encode()).hexdigest()[:16]
        out[disc] = {"items": len(L), "configs": len(LC), "sha_items": h_i, "sha_configs": h_c,
                     "per_config": {c: hashlib.sha256(_canon(LC[c]).encode()).hexdigest()[:16] for c in sorted(LC)}}
        if disc == "HVAC":
            A = {r["item_uid"]: {"kind": r["kind"], "brand": r.get("brand") or None, "unit": r.get("unit") or None, "attributes": r["attributes"], "rates": r["rates"]} for r in asset["items"]}
            AC = {c["category_id"]: c for c in asset["category_configs"]}
            out[disc]["items_differing"] = sorted(u for u in set(L) | set(A) if _canon(L.get(u)) != _canon(A.get(u)))
            out[disc]["configs_differing"] = sorted(c for c in set(LC) | set(AC) if _canon(LC.get(c)) != _canon(AC.get(c)))
            out[disc]["second_opinion"] = {c: ((LC[c].get("list_spec") or {}).get("second_opinion")) for c in (VALVE, MISC, DUCT) if c in LC}
    print(json.dumps(out, indent=1, sort_keys=True))
    frappe.destroy()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("phase", choices=["build", "load", "verify"])
    ap.add_argument("--candidate", default=V72)
    a = ap.parse_args()
    if a.phase == "build":
        build(a.candidate)
    elif a.phase == "load":
        load(a.candidate)
    else:
        verify(a.candidate)
