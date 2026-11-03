"""VRF-2b (2026-11-03) -- MINT HVAC v57 = v56 WITH THE VRF CAPACITY READER, THE UNIT PICKER, THE MISC FOUR AND THE NOTES.

The v56 shape (`mint_hvac_v56_vrf2.py`), built on v56. ONLY the `hvac_vrf` config changes; every item and every other
config is byte-identical to v56 (asserted). `calculator_only` stays (owner Q1 A: removed at VRF-4). The changes:

  1. R-CONV / R-INPUTS / Q3 / CFM (owner 2026-11-03): the capacity reader gains `units` -- HP / TR / kW read from the
     words after the number (or the unit PICKER beside the typed box), converted to the family's own unit (each SKU's
     `capacity_unit`: HP outdoor, TR indoor) through the two VRF Pricing Inputs (vrf_hp_per_tr 1.25, vrf_kw_per_tr
     3.517, per TR); an airflow (CFM, CMH, m3/h) is not converted and refuses, named; two units -> the family's.
     The size options show their unit (U2 A: "16HP", "1.5TR"), the picker sits beside the typed box (U1 A).
  2. RECON Q2 `extra_kinds` + QR-3 A: the four shared Misc items price in VRF -- Drain Pump and BACnet Integration
     Controller per Nos, Refrigerant Gas Filling (R-410) and MS Angle Base Frame Structure per Kg (a weight class:
     Kg, kg, kgs). Supply = ROUNDUP(cost_supply x (1 + supply_markup)); install = ROUNDUP(cost_install x (1 +
     install_markup)), the gas = its boq_install (the sheet's own Misc formulae). Each figure asserted against the
     brief: 3,500 / 750; 50,000 / 4,500; 1,020 / 350; 140 / 40 -- a difference STOPS the mint.
  3. R-BRAND (a): several brands, or one off the sheet, price as Blue Star with an amber line naming the row's words.
  4. QR-2 A: "Nos/Ro" prices as Nos with the line "unit 'Nos/Ro' read as Nos". QR-1b A: the unit refusal names Kg.
  5. U6 A: `impact_examples` -- two worked examples per VRF input (item-list shape: items + unit + inputs).

Runs IN THE CONTAINER under the bench's python. Four phases, in this order:
  export   the HVAC asset exported FROM THE DATABASE, proved = v56 by content. NO database write.
  build    v56 (the committed file; its re-dump must reproduce its bytes) -> the candidate. NO database write.
  load     pre-load HVAC snapshot, then `loader.load_rate_master(path=<candidate>, replace=True)`.
  verify   live HVAC == the candidate BY CONTENT; Electrical's hashes printed.

Usage (container, from frappe-bench): env/bin/python <this> <phase> [--export P] [--candidate P]
"""
import argparse, copy, hashlib, json, math, os, re

DATA = "/workspace/development/frappe-bench/apps/nirmaan_stack/nirmaan_stack/services/boq_rate_master/data"
V56 = os.path.join(DATA, "rate_master_hvac_all_v56.json")
V57 = os.path.join(DATA, "rate_master_hvac_all_v57.json")

CATEGORY_ID = "hvac_vrf"
VRF_KIND = "hvac_vrf_item"
MISC_KIND = "hvac_misc_item"
NONE_OF_THESE = "none of these"
# family -> (unit class, install rate key, install markup key or None, the brief's supply / install)
MISC = {
    "Drain Pump": ("count", "cost_install", "install_markup", 3500.0, 750.0),
    "BACnet Integration Controller for VRF Units": ("count", "cost_install", "install_markup", 50000.0, 4500.0),
    "Refrigerant Gas Filling (R-410)": ("weight", "boq_install", None, 1020.0, 350.0),
    "MS Angle Base Frame Structure": ("weight", "cost_install", "install_markup", 140.0, 40.0),
}
WEIGHT = ["Kg", "kg", "kgs"]
UNIT_REFUSAL = ("unit '{unit}' is not a VRF unit - VRF is priced per Nos or per Kg (Set, Lot and per HP wait for VRF-3) "
                "- price this row by hand")
UNITS = {
    "unit_attr": "capacity_unit",
    "words": {"HP": ["hp", "h.p.", "h.p"], "TR": ["tr", "t.r.", "t.r", "ton", "tons"], "kW": ["kw", "k.w.", "k.w"]},
    "base": "TR",
    "convert": {"HP": {"input": "vrf_hp_per_tr", "label": "HP per TR"}, "kW": {"input": "vrf_kw_per_tr", "label": "kW per TR"}},
    "refuse_words": ["cfm", "cmh", "m3/h", "m3/hr", "m³/h", "m³/hr"],
    "refuse": "capacity is stated only as an airflow ({said}) - an airflow is not converted to HP / TR - price this row by hand",
}
BRAND_UNLISTED = {"several": "several brands stated ({said}) - priced as Blue Star",
                  "off_sheet": "brand {said} is not on the sheet - priced as Blue Star"}
UNIT_LINES = {"Nos/Ro": "unit 'Nos/Ro' read as Nos"}
IMPACT_EXAMPLES = [
    {"id": "VRF-1", "name": "Outdoor Unit, Blue Star, 16 TR", "inputs": ["vrf_hp_per_tr"], "unit": "Nos",
     "items": [{"item": "Outdoor Unit", "brand": "Blue Star", "capacity": "16 TR"}]},
    {"id": "VRF-2", "name": "Cassette, Blue Star, 4 HP", "inputs": ["vrf_hp_per_tr"], "unit": "Nos",
     "items": [{"item": "Cassette", "brand": "Blue Star", "capacity": "4 HP"}]},
    {"id": "VRF-3", "name": "Hi-Wall, Blue Star, 5 kW", "inputs": ["vrf_kw_per_tr"], "unit": "Nos",
     "items": [{"item": "Hi-Wall", "brand": "Blue Star", "capacity": "5 kW"}]},
    {"id": "VRF-4", "name": "Outdoor Unit, Blue Star, 45 kW", "inputs": ["vrf_kw_per_tr"], "unit": "Nos",
     "items": [{"item": "Outdoor Unit", "brand": "Blue Star", "capacity": "45 kW"}]},
]
CHANGED_KEYS = ["impact_examples", "list_spec", "notes"]


def _connect():
    os.chdir("/workspace/development/frappe-bench/sites")
    import frappe
    frappe.init(site="localhost"); frappe.connect()
    return frappe


def _canon(o):
    return json.dumps(o, sort_keys=True, separators=(",", ":"), default=str)


def _dump(p):
    return json.dumps(p, indent=1, ensure_ascii=False) + "\n"


def _roundup(x):
    """Excel ROUNDUP(x, 0) for a positive figure, robust to float noise."""
    return float(math.ceil(round(x, 6)))


def _pipe(rate_key, markup, out):
    steps = [
        {"step": "match_master_row", "params": {"kind": MISC_KIND}, "explain": "match the Misc SKU (the shared Misc item)"},
        {"step": "component", "name": "unit" if out == "supply" else "install", "target": rate_key, "formula": "base",
         "explain": "the SKU's %s, as the Misc sheet gives it" % ("supply cost" if out == "supply" else rate_key.replace("_", " "))},
        {"step": "sum_components", "result": ("bcs_" + out) if markup else out, "explain": "BCS " + out if markup else out},
    ]
    if markup:
        steps.append({"step": "scale", "target": "bcs_" + out, "result": out, "params": {"m_from_ctx": markup}, "formula": "base*(1+m)",
                      "explain": "BCS %s x (1 + the SKU's %s)" % (out, markup.replace("_", " "))})
    steps.append({"step": "roundup", "target": out, "params": {"digits": 0}, "explain": "ROUNDUP(%s, 0) (R-ROUND)" % out})
    return {"output": [out], "steps": steps}


def vrf2b_config(v56_cfg):
    """v56's hvac_vrf config + the VRF-2b keys. Top-level definitions, kinds, pipelines and calculator_only untouched."""
    c = copy.deepcopy(v56_cfg)
    c["notes"] = (c["notes"] + " VRF-2b (owner, 2026-11-03): a capacity stated in HP, TR or kW is read and converted to "
                  "the family's own unit through the two VRF Pricing Inputs (an airflow refuses, named); the unit picker "
                  "beside the typed box; the size options show their unit; the four Misc items price here (Nos / Kg, "
                  "`extra_kinds`); several or off-sheet brands price as Blue Star, naming the row's words; 'Nos/Ro' reads "
                  "as Nos with a line. calculator_only stays until VRF-4.")
    ls = c["list_spec"]
    item = next(d for d in ls["attribute_definitions"] if d["id"] == "item")
    item["values"] = [v for v in item["values"] if v != NONE_OF_THESE] + list(MISC) + [NONE_OF_THESE]
    pr = ls["pricing"]
    pr["extra_kinds"] = [MISC_KIND]
    pr["unit_classes"]["weight"] = list(WEIGHT)
    pr["unit_words"]["weight"] = "Kg"
    pr["unit_lines"] = dict(UNIT_LINES)
    pr["unit_refusal"] = UNIT_REFUSAL
    pr["numbers"]["capacity"]["units"] = copy.deepcopy(UNITS)
    pr["defaults"]["brand"]["unlisted"] = dict(BRAND_UNLISTED)
    for fam, (cls, ikey, imark, _s, _i) in MISC.items():
        pr["families"][fam] = {"needs": [], "units": {cls: {"pipelines": {
            "supply": _pipe("cost_supply", "supply_markup", "supply"), "install": _pipe(ikey, imark, "install")}}}}
    c["impact_examples"] = copy.deepcopy(IMPACT_EXAMPLES)
    return c


def misc_prices(items):
    """The Misc four's figures from their stored rates, by the sheet's formulae (what the pipelines compute)."""
    out = {}
    for it in items:
        if it["kind"] != MISC_KIND:
            continue
        fam = it["attributes"]["item"]
        cls, ikey, imark, want_s, want_i = MISC[fam]
        r = it["rates"]
        s = _roundup(r["cost_supply"] * (1 + r["supply_markup"]))
        i = _roundup(r[ikey] * (1 + (r[imark] if imark else 0)))
        out[fam] = {"unit": it["unit"], "supply": s, "install": i, "want": [want_s, want_i]}
    return out


# ---------------------------------------------------------------------------------------------------------------
def export(path):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import exporter
    payload = exporter.build_asset("HVAC")
    open(path, "w", encoding="utf-8", newline="").write(exporter.serialize_asset(payload))
    v56 = json.load(open(V56, encoding="utf-8"))
    e_items = {i["item_uid"]: i for i in payload["items"]}
    v_items = {i["item_uid"]: i for i in v56["items"]}
    missing = sorted(set(v_items) - set(e_items)); extra = sorted(set(e_items) - set(v_items))
    differ = sorted(u for u in set(v_items) & set(e_items) if _canon(v_items[u]) != _canon(e_items[u]))
    e_cfg = {c["category_id"]: c for c in payload["category_configs"]}
    v_cfg = {c["category_id"]: c for c in v56["category_configs"]}
    cdiff = sorted(c for c in set(e_cfg) | set(v_cfg) if _canon(e_cfg.get(c)) != _canon(v_cfg.get(c)))
    print("export written", path, "| items", len(payload["items"]), "| configs", len(payload["category_configs"]))
    print("vs v56 by content: items missing", missing, "| extra", extra, "| differing", differ, "| configs differing", cdiff)
    if missing or extra or differ or cdiff:
        raise SystemExit("the export is not v56 by content -- STOP")
    frappe.destroy()


def build(out):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import config_validation, extraction
    from nirmaan_stack.services.boq_rate_master.loader import _validate_items, _validate_one_config
    raw = open(V56, "rb").read()
    v56 = json.loads(raw.decode("utf-8"))
    if _dump(v56).encode("utf-8") != raw:
        raise SystemExit("re-dumping v56 does not reproduce its bytes -- the series convention is not what this mint writes")
    # the Misc four at the brief's figures (a difference = STOP)
    mp = misc_prices(v56["items"])
    print("MISC figures:", json.dumps(mp, sort_keys=True))
    bad = {f: v for f, v in mp.items() if [v["supply"], v["install"]] != v["want"]}
    exp_units = {"count": "Nos", "weight": "Kg"}
    bad.update({f: v for f, v in mp.items() if v["unit"] != exp_units[MISC[f][0]]})
    if sorted(mp) != sorted(MISC) or bad:
        raise SystemExit("the Misc figures / units differ from the brief: %r -- STOP" % (bad or sorted(mp)))

    final = copy.deepcopy(v56)
    idx = next(n for n, c in enumerate(v56["category_configs"]) if c["category_id"] == CATEGORY_ID)
    final["category_configs"][idx] = vrf2b_config(v56["category_configs"][idx])
    # ONLY the hvac_vrf config: every item and every other config byte-identical, in v56's order, v56's top-level keys
    assert [_canon(i) for i in final["items"]] == [_canon(i) for i in v56["items"]]
    for n, (a, b) in enumerate(zip(v56["category_configs"], final["category_configs"])):
        assert a["category_id"] == b["category_id"]
        if n != idx:
            assert _canon(a) == _canon(b), a["category_id"]
    old, new = v56["category_configs"][idx], final["category_configs"][idx]
    changed = sorted(k for k in set(old) | set(new) if _canon(old.get(k)) != _canon(new.get(k)))
    assert changed == CHANGED_KEYS, changed
    assert new.get("calculator_only") is True
    assert list(final.keys()) == list(v56.keys())

    _validate_items(final["items"])
    stored = [dict(c, discipline=final["discipline"]) for c in final["category_configs"]]
    for n, c in enumerate(stored):
        _validate_one_config(c, "category_configs[%d]" % n)
        config_validation._validate_config(c)
    problems = config_validation.delegated_section_problems(stored, final["items"])
    if problems:
        raise SystemExit("cross-category check refuses: %r" % problems)
    cfgs = {(final["discipline"], c["category_id"]): c for c in stored}
    vrf = cfgs[("HVAC", CATEGORY_ID)]
    if not extraction.has_runnable_pricing_rules(vrf):
        raise SystemExit("hvac_vrf's rules do not run")
    if extraction.config_is_eligible(vrf, cfgs):
        raise SystemExit("hvac_vrf would be ELIGIBLE for extraction -- calculator_only must keep it out (Q1 A)")
    doors = sorted(c["category_id"] for c in stored for s in ((c.get("list_spec") or {}).get("sections") or [])
                   if isinstance(s, dict) and s.get("category_id") == CATEGORY_ID)
    if doors:
        raise SystemExit("a section delegates to hvac_vrf: %r" % doors)
    eligible = sorted(c["category_id"] for c in stored if extraction.config_is_eligible(c, cfgs))
    stored56 = [dict(c, discipline=v56["discipline"]) for c in v56["category_configs"]]
    cfgs56 = {(v56["discipline"], c["category_id"]): c for c in stored56}
    eligible56 = sorted(c["category_id"] for c in stored56 if extraction.config_is_eligible(c, cfgs56))
    assert eligible == eligible56, (eligible, eligible56)

    def requests(st, cf):
        return {c["category_id"]: json.dumps(extraction.build_items_spec(cf[("HVAC", c["category_id"])], cf, "HVAC"), sort_keys=True)
                for c in st if c.get("list_spec") and c["category_id"] != CATEGORY_ID}
    r56, r57 = requests(stored56, cfgs56), requests(stored, cfgs)
    diff = sorted(k for k in set(r56) | set(r57) if r56.get(k) != r57.get(k))
    print("STUB PROOF: item-list requests v56 vs v57 (hvac_vrf aside, never sent) -- identical:", sorted(k for k in r56 if r56[k] == r57.get(k)), "| differing:", diff)
    assert diff == [], diff
    print("eligible configs v56 = v57:", eligible)
    # no other config reads the Misc kind (the shared kind moves nowhere else)
    readers = sorted(c["category_id"] for c in stored if MISC_KIND in json.dumps(c) and c["category_id"] != CATEGORY_ID)
    print("other configs naming", MISC_KIND, ":", readers)
    assert readers == [], readers

    text = _dump(final)
    tokens = sorted({t for t in re.findall(r"v\d+", text.replace(json.dumps(final.get("source_workbook") or "", ensure_ascii=False), '""'))})
    if tokens:
        raise SystemExit("the asset text carries version-like tokens %r (h07)" % tokens)
    open(out, "w", encoding="utf-8", newline="").write(text)
    kinds = {}
    for i in final["items"]:
        kinds[i["kind"]] = kinds.get(i["kind"], 0) + 1
    print("candidate written:", out, "| items", len(final["items"]), kinds, "| configs", len(final["category_configs"]),
          "| sha256", hashlib.sha256(text.encode("utf-8")).hexdigest())
    frappe.destroy()


# ---------------------------------------------------------------------------------------------------------------
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
        out[disc] = {"items": len(L), "configs": len(LC), "sha_items": h_i, "sha_configs": h_c}
        if disc == "HVAC":
            A = {r["item_uid"]: {"kind": r["kind"], "brand": r.get("brand") or None, "unit": r.get("unit") or None, "attributes": r["attributes"], "rates": r["rates"]} for r in asset["items"]}
            AC = {c["category_id"]: c for c in asset["category_configs"]}
            out[disc]["items_differing"] = sorted(u for u in set(L) | set(A) if _canon(L.get(u)) != _canon(A.get(u)))
            out[disc]["configs_differing"] = sorted(c for c in set(LC) | set(AC) if _canon(LC.get(c)) != _canon(AC.get(c)))
            ncfg = {c: LC[c] for c in LC if c != CATEGORY_ID}
            out[disc]["non_vrf_configs"] = [len(ncfg), hashlib.sha256("".join(c + _canon(ncfg[c]) for c in sorted(ncfg)).encode()).hexdigest()[:16]]
            out[disc]["vrf_calculator_only"] = LC.get(CATEGORY_ID, {}).get("calculator_only")
    print(json.dumps(out, indent=1, sort_keys=True))
    frappe.destroy()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("phase", choices=["export", "build", "load", "verify"])
    ap.add_argument("--export", default="/tmp/vrf2b/v57_export.json")
    ap.add_argument("--candidate", default=V57)
    a = ap.parse_args()
    if a.phase == "export":
        export(a.export)
    elif a.phase == "build":
        build(a.candidate)
    elif a.phase == "load":
        load(a.candidate)
    else:
        verify(a.candidate)
