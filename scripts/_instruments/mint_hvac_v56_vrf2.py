"""VRF-2a (2026-11-03) -- MINT HVAC v56 = v55 LESS THE TWO BLUE STAR DUCTABLES + VRF PRICES IN THE CALCULATOR.

The v47 shape (`mint_hvac_v47_adp1.py`, the only HVAC mint that retired items), built on v55. Exactly two changes:

  1. R-RETIRE (owner 2026-11-03 12:15 / 12:23): "remove the 18Tr and 22 Tr ductable units from blue star from the
     catalog. these do not come as standard"; "leave these unpriced. no splitting" -- rmi-8eb521699247 (VFM-216A,
     18.0TR, VRF sheet row 106) and rmi-8ee7b38ab8fc (VFM-264A, 22.0TR, row 105) are left out of the asset; the
     loader's replace retires them (active = 0, the row kept). No asset key records an item retirement and the mint
     gate has no item atoms, so the reason travels in the commit body, the plan entry and boq-rate-master.md (v47's
     precedent). A ductable above 8 TR then refuses: "capacity N is above the largest size on the sheet (8)".
  2. The `hvac_vrf` config gains its PRICING: `calculator_only: true` (owner 2026-11-03 Q1 A -- temporary, removed at
     VRF-4: the calculator prices VRF, every BoQ row keeps the coming-soon text and Suggest admits no VRF row),
     `matching_mode` "item_list" and a `list_spec` whose pricing block prices the 13 VRF families (kind
     hvac_vrf_item; the four shared Misc items stay unpriced until VRF-2c):
       * brand default Blue Star, amber, "no brand stated - priced as Blue Star" (R-BRAND (a)); a stated sheet brand
         prices as that brand; the brand stays a dropdown;
       * the team defaults (2026-11-02), each amber (a default removes the "*"): Cool Only, Top discharge, Standard
         compressor, FOUR-WAY cassette; remote unstated -> Wired (R-SMALL);
       * the central controller is Blue Star only: Daikin -> Blue Star with its own line (value_map, R-SMALL);
       * refnet: one flat price per brand (no capacity);
       * indoor type not stated -> refuses ("none of these" is a person's call) with the item dropdown;
       * capacity in the family's own unit (HP outdoor, TR indoor / kit): the stated size, else the next size up;
         below the smallest -> the smallest; above the largest refuses (R-RETIRE: no ductable above 8 TR);
       * VRF's own unit table: count only, "Nos" first; Nos/Ro counts as Nos (QR-2 A: no note line in 2a, the note is a
         required VRF-2c item); kg / kgs are LEFT OUT until VRF-2c brings the two Kg Misc items (QR-3 A); Set / Sets /
         Lot / per HP are in no class, so they refuse until VRF-3;
       * supply = cost_supply x (1 + supply_markup) -> round up; install = boq_install -> round up (R-INSTALL
         "follow the sheet", R-ROUND "round up at pricing").
     The SKU figures are v55's, untouched.

Every other config and every other item is byte-identical to v55 (asserted). The stub proof: every OTHER item-list
category's extraction request is identical on v55 and v56; hvac_vrf is NOT eligible (calculator_only) although its
rules run, so the eligible set equals v55's.

Runs IN THE CONTAINER under the bench's python. Four phases, in this order:
  export   the HVAC asset exported FROM THE DATABASE, proved = v55 by content. NO database write.
  build    v55 (the committed file; its re-dump must reproduce its bytes) -> the candidate + a price table (every
           VRF SKU's expected supply / install, rounded up, from the stored rates). NO database write.
  load     pre-load HVAC snapshot, then `loader.load_rate_master(path=<candidate>, replace=True)`.
  verify   live HVAC == the candidate BY CONTENT; the two retired uids active 0; Electrical's hashes printed.

Usage (container, from frappe-bench): env/bin/python <this> <phase> [--export P] [--candidate P] [--prices P]
"""
import argparse, copy, hashlib, json, math, os, re

DATA = "/workspace/development/frappe-bench/apps/nirmaan_stack/nirmaan_stack/services/boq_rate_master/data"
V55 = os.path.join(DATA, "rate_master_hvac_all_v55.json")
V56 = os.path.join(DATA, "rate_master_hvac_all_v56.json")

CATEGORY_ID = "hvac_vrf"
VRF_KIND = "hvac_vrf_item"
# R-RETIRE: uid -> (model, capacity_label, VRF sheet row) as v55 stores them (asserted before they leave)
RETIRED = {"rmi-8eb521699247": ("VFM-216A", "18.0TR", 106), "rmi-8ee7b38ab8fc": ("VFM-264A", "22.0TR", 105)}
RETIRE_REASON = ("owner R-RETIRE, 2026-11-03 12:15 / 12:23: 'remove the 18Tr and 22 Tr ductable units from blue star "
                 "from the catalog. these do not come as standard'; 'leave these unpriced. no splitting'")

VRF_FAMILIES = ["Outdoor Unit", "Hi-Wall", "Cassette", "Floor-cum-Ceiling Mounted", "Verticool", "Concealed Split",
                "Ductable", "Packaged Unit", "Single Skin Treated Fresh Air", "Refnet/Y-Joint", "AHU Expansion Kit",
                "Remote Controller", "Touch Screen Central Controller"]
# the families sold by size (capacity in the family's own unit: HP outdoor, TR indoor / kit)
SIZED = {"Outdoor Unit", "Hi-Wall", "Cassette", "Floor-cum-Ceiling Mounted", "Verticool", "Concealed Split", "Ductable",
         "Packaged Unit", "Single Skin Treated Fresh Air", "AHU Expansion Kit"}
# the facts each family needs before it can price (the field table, VRF-R2 R10)
NEEDS = {"Outdoor Unit": ["brand", "cooling", "discharge", "compressor"], "Cassette": ["brand", "way"],
         "Remote Controller": ["brand", "remote_type"]}
NONE_OF_THESE = "none of these"

# VRF's OWN unit table (owner Q4 + the brief's B2; VRF-R2 R8). "Nos" first so the panel reads "How many in one Nos".
# "Nos/Ro" counts as Nos (owner QR-2 A, 2026-11-03 15:14: no note line in 2a; the note is a required VRF-2c item).
# Set / Sets / Lot / per HP are in NO class: they refuse until VRF-3. kg / kgs are LEFT OUT (owner QR-3 A, 15:14): no VRF
# family is stocked per kg in 2a, and a second class makes the Derivation tab's unit-rule line read "per metre and per
# square metre"; VRF-2c adds them with the two Kg Misc items and the two-class wording.
COUNT = ["Nos", "nos", "no", "no's", "nos.", "no.", "no.s", "number", "each", "ea", "pcs", "unit", "Nos/Ro"]
UNIT_REFUSAL = "unit '{unit}' is not a VRF unit - VRF is priced per Nos (Set, Lot and per HP wait for VRF-3) - price this row by hand"


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
    """Excel ROUNDUP(x, 0) for a positive figure, robust to float noise (1.2 x 364100 = 436919.99999...)."""
    return float(math.ceil(round(x, 6)))


# ---------------------------------------------------------------------------------------------------------------
def _pipelines():
    sup = {"output": ["supply"], "steps": [
        {"step": "match_master_row", "params": {"kind": VRF_KIND}, "explain": "match the VRF SKU (brand, family, the stated facts, the size)"},
        {"step": "component", "name": "unit", "target": "cost_supply", "formula": "base", "explain": "the SKU's supply cost"},
        {"step": "sum_components", "result": "bcs_supply", "explain": "BCS supply"},
        {"step": "scale", "target": "bcs_supply", "result": "supply", "params": {"m_from_ctx": "supply_markup"}, "formula": "base*(1+m)",
         "explain": "BCS supply x (1 + the SKU's supply markup)"},
        {"step": "roundup", "target": "supply", "params": {"digits": 0}, "explain": "ROUNDUP(supply, 0) (R-ROUND)"}]}
    ins = {"output": ["install"], "steps": [
        {"step": "match_master_row", "params": {"kind": VRF_KIND}, "explain": "match the VRF SKU (brand, family, the stated facts, the size)"},
        {"step": "component", "name": "install", "target": "boq_install", "formula": "base", "explain": "the SKU's BOQ installation, as the sheet gives it (R-INSTALL)"},
        {"step": "sum_components", "result": "install", "explain": "install"},
        {"step": "roundup", "target": "install", "params": {"digits": 0}, "explain": "ROUNDUP(install, 0) (R-ROUND)"}]}
    return {"supply": sup, "install": ins}


def _ldef(defs, i, **kw):
    d = copy.deepcopy(defs[i])
    for k in ("panel", "selector"):   # top-level-only keys; a list_spec definition refuses them
        d.pop(k, None)
    d.update(kw)
    return d


def vrf_priced_config(v55_cfg):
    """v55's hvac_vrf config + the VRF-2a pricing. Top-level definitions, kinds and pipelines ({}) untouched."""
    c = copy.deepcopy(v55_cfg)
    defs = {d["id"]: d for d in c["attribute_definitions"]}
    c["calculator_only"] = True
    c["matching_mode"] = "item_list"
    c["notes"] = (c["notes"] + " VRF-2a (owner, 2026-11-03): the VRF families PRICE IN THE CALCULATOR -- the list_spec "
                  "pricing block below -- while `calculator_only` (owner Q1 A, temporary, removed at VRF-4) keeps every VRF "
                  "BoQ row on the coming-soon text and every VRF row out of Suggest. The Blue Star ductables VFM-216A "
                  "(18 TR) and VFM-264A (22 TR) are retired (R-RETIRE): a ductable above 8 TR refuses. The four Misc "
                  "items stay unpriced until VRF-2c.")
    choice = ["brand", "cooling", "discharge", "compressor", "way", "remote_type"]
    families = {}
    for f in VRF_FAMILIES:
        families[f] = {"needs": NEEDS.get(f, ["brand"]),
                       "units": {"count": {"needs": ["capacity"] if f in SIZED else [], "pipelines": _pipelines()}}}
    c["list_spec"] = {
        "family_attribute_id": "item",
        "second_opinion": False,
        "attribute_definitions": (
            [_ldef(defs, "item", allow_none=True, values=VRF_FAMILIES + [NONE_OF_THESE],
                   note="The VRF family this item is: one of the listed families. An indoor unit whose type the row does "
                        "not state is 'None' (it is priced by a person, with the item picked from the list); anything "
                        "else is 'none of these'.")]
            + [_ldef(defs, a, allow_none=True) for a in choice]
            + [{"id": "capacity", "type": "text", "label": "Capacity",
                "note": "The capacity AS WRITTEN for this item, with its unit (16 HP, 1.5 TR). The outdoor units are sold "
                        "in HP and the indoor units and AHU kits in TR."},
               # the ladder names each size by the sheet's own words ("16HP", "1.5TR"): `label_attr` must be an item
               # attribute of the list (the validator's rule); no family needs it, so it is never a field
               _ldef(defs, "capacity_label")]),
        "pricing": {
            "kind": VRF_KIND,
            "unit_class_attr": "unit_class",
            "unit_classes": {"count": list(COUNT)},
            "unit_words": {"count": "Nos"},
            "unit_refusal": UNIT_REFUSAL,
            "no_sku_families": [NONE_OF_THESE],
            "numbers": {"capacity": {"from": ["capacity"], "name": "capacity"}},
            "ladders": ["capacity"],
            "match_attrs": choice + ["capacity"],
            "choice_attrs": list(choice),
            "size_match": {"dp": [2, 1], "below_smallest": "smallest"},
            "label_attr": "capacity_label",
            "defaults": {
                "brand": {"value": "Blue Star", "rule": "no brand stated - priced as Blue Star", "absent_as_none": True},
                "cooling": {"by_family": {"Outdoor Unit": "Cool Only"}, "absent_as_none": True,
                            "rule": "cooling not stated - priced as Cool Only (team default: heat pump only when the BoQ mentions it)"},
                "discharge": {"by_family": {"Outdoor Unit": "Top"}, "absent_as_none": True,
                              "rule": "discharge not stated - priced as Top discharge (team default)"},
                "compressor": {"by_family": {"Outdoor Unit": "Standard"}, "absent_as_none": True,
                               "rule": "compressor not stated - priced as Standard (team default)"},
                "way": {"by_family": {"Cassette": "FOUR-WAY"}, "absent_as_none": True,
                        "rule": "cassette way not stated - priced as 4-way (team default)"},
                "remote_type": {"by_family": {"Remote Controller": "Wired"}, "absent_as_none": True,
                                "rule": "remote type not stated - priced as Wired (R-SMALL)"}},
            "value_map": [{"attr": "brand", "families": ["Touch Screen Central Controller"], "from": "Daikin", "to": "Blue Star",
                           "rule": "the central controller is Blue Star only on the sheet - a Daikin pick is priced as Blue Star (R-SMALL)",
                           "display": "Blue Star"}],
            "panel_controls": {"item": "dropdown", "brand": "dropdown", "cooling": "dropdown", "discharge": "dropdown",
                               "compressor": "dropdown", "way": "dropdown", "remote_type": "dropdown", "capacity": "dropdown_or_other"},
            "families": families}}
    return c


def expected_prices(items):
    """Every VRF SKU's figures as the sheet gives them: BOQ SUPPLY = ROUNDUP(cost x (1 + markup), 0), BOQ install."""
    out = {}
    for it in items:
        if it["kind"] != VRF_KIND:
            continue
        r = it["rates"]
        out[it["item_uid"]] = {"brand": it["brand"], "family": it["attributes"]["item"], "model": it["attributes"].get("model"),
                               "capacity_label": it["attributes"].get("capacity_label"), "row": it["source"]["row"],
                               "supply": _roundup(r["cost_supply"] * (1 + r["supply_markup"])),
                               "install": _roundup(r["boq_install"])}
    return out


# ---------------------------------------------------------------------------------------------------------------
def export(path):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import exporter
    payload = exporter.build_asset("HVAC")
    open(path, "w", encoding="utf-8", newline="").write(exporter.serialize_asset(payload))
    v55 = json.load(open(V55, encoding="utf-8"))
    e_items = {i["item_uid"]: i for i in payload["items"]}
    v_items = {i["item_uid"]: i for i in v55["items"]}
    missing = sorted(set(v_items) - set(e_items)); extra = sorted(set(e_items) - set(v_items))
    differ = sorted(u for u in set(v_items) & set(e_items) if _canon(v_items[u]) != _canon(e_items[u]))
    e_cfg = {c["category_id"]: c for c in payload["category_configs"]}
    v_cfg = {c["category_id"]: c for c in v55["category_configs"]}
    cdiff = sorted(c for c in set(e_cfg) | set(v_cfg) if _canon(e_cfg.get(c)) != _canon(v_cfg.get(c)))
    print("export written", path, "| items", len(payload["items"]), "| configs", len(payload["category_configs"]))
    print("vs v55 by content: items missing", missing, "| extra", extra, "| differing", differ, "| configs differing", cdiff)
    if missing or extra or differ or cdiff:
        raise SystemExit("the export is not v55 by content -- STOP")
    frappe.destroy()


def build(out, prices):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import config_validation, extraction
    from nirmaan_stack.services.boq_rate_master.loader import _validate_items, _validate_one_config
    raw = open(V55, "rb").read()
    v55 = json.loads(raw.decode("utf-8"))
    if _dump(v55).encode("utf-8") != raw:
        raise SystemExit("re-dumping v55 does not reproduce its bytes -- the series convention is not what this mint writes")
    # R-RETIRE: the two uids are exactly the two Blue Star ductables named in the ruling
    by_uid = {i["item_uid"]: i for i in v55["items"]}
    for uid, (model, label, row) in RETIRED.items():
        it = by_uid.get(uid)
        got = it and (it["kind"], it["brand"], it["attributes"].get("item"), it["attributes"].get("model"),
                      it["attributes"].get("capacity_label"), it["source"].get("row"))
        if got != (VRF_KIND, "Blue Star", "Ductable", model, label, row):
            raise SystemExit("%s is not the ruled ductable (%r) -- STOP" % (uid, got))

    final = copy.deepcopy(v55)
    final["items"] = [i for i in v55["items"] if i["item_uid"] not in RETIRED]
    idx = next(n for n, c in enumerate(v55["category_configs"]) if c["category_id"] == CATEGORY_ID)
    final["category_configs"][idx] = vrf_priced_config(v55["category_configs"][idx])
    # ONLY those two changes: every other item and config byte-identical, in v55's order, with v55's top-level keys
    assert [_canon(i) for i in final["items"]] == [_canon(i) for i in v55["items"] if i["item_uid"] not in RETIRED]
    assert len(final["items"]) == len(v55["items"]) - 2
    for n, (a, b) in enumerate(zip(v55["category_configs"], final["category_configs"])):
        assert a["category_id"] == b["category_id"]
        if n != idx:
            assert _canon(a) == _canon(b), a["category_id"]
    old, new = v55["category_configs"][idx], final["category_configs"][idx]
    changed = sorted(k for k in set(old) | set(new) if _canon(old.get(k)) != _canon(new.get(k)))
    assert changed == ["calculator_only", "list_spec", "matching_mode", "notes"], changed
    assert list(final.keys()) == list(v55.keys())

    # offline validation: the loader's own validators, the config validator on every config, the section check
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
        raise SystemExit("hvac_vrf's rules do not run -- the calculator would price nothing")
    if extraction.config_is_eligible(vrf, cfgs):
        raise SystemExit("hvac_vrf would be ELIGIBLE for extraction -- calculator_only must keep it out (Q1 A)")
    # the side door: no config delegates a section to the calculator-only category
    doors = sorted(c["category_id"] for c in stored for s in ((c.get("list_spec") or {}).get("sections") or [])
                   if isinstance(s, dict) and s.get("category_id") == CATEGORY_ID)
    if doors:
        raise SystemExit("a section delegates to hvac_vrf: %r" % doors)
    eligible = sorted(c["category_id"] for c in stored if extraction.config_is_eligible(c, cfgs))
    stored55 = [dict(c, discipline=v55["discipline"]) for c in v55["category_configs"]]
    cfgs55 = {(v55["discipline"], c["category_id"]): c for c in stored55}
    eligible55 = sorted(c["category_id"] for c in stored55 if extraction.config_is_eligible(c, cfgs55))
    assert eligible == eligible55, (eligible, eligible55)

    # the STUB PROOF -- every OTHER item-list category's extraction request, from v55 and from v56
    def requests(st, cf):
        return {c["category_id"]: json.dumps(extraction.build_items_spec(cf[("HVAC", c["category_id"])], cf, "HVAC"), sort_keys=True)
                for c in st if c.get("list_spec") and c["category_id"] != CATEGORY_ID}
    r55, r56 = requests(stored55, cfgs55), requests(stored, cfgs)
    diff = sorted(k for k in set(r55) | set(r56) if r55.get(k) != r56.get(k))
    print("STUB PROOF: item-list requests v55 vs v56 (hvac_vrf aside, never sent) -- identical:", sorted(k for k in r55 if r55[k] == r56.get(k)), "| differing:", diff)
    assert diff == [], diff
    print("eligible configs v55 = v56:", eligible)

    text = _dump(final)
    tokens = sorted({t for t in re.findall(r"v\d+", text.replace(json.dumps(final.get("source_workbook") or "", ensure_ascii=False), '""'))})
    if tokens:
        raise SystemExit("the asset text carries version-like tokens %r (h07)" % tokens)
    open(out, "w", encoding="utf-8", newline="").write(text)
    table = expected_prices(final["items"])
    json.dump({"retired": {u: list(v) for u, v in RETIRED.items()}, "reason": RETIRE_REASON, "prices": table},
              open(prices, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    kinds = {}
    for i in final["items"]:
        kinds[i["kind"]] = kinds.get(i["kind"], 0) + 1
    print("candidate written:", out, "| items", len(final["items"]), kinds, "| configs", len(final["category_configs"]),
          "| sha256", hashlib.sha256(text.encode("utf-8")).hexdigest())
    print("price table written:", prices, "| VRF SKUs", len(table))
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
    from nirmaan_stack.services.boq_rate_master import exporter
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
            nv = {u: L[u] for u in L if L[u]["kind"] != VRF_KIND}
            ncfg = {c: LC[c] for c in LC if c != CATEGORY_ID}
            out[disc]["non_vrf_items"] = [len(nv), hashlib.sha256("".join(u + _canon(nv[u]) for u in sorted(nv)).encode()).hexdigest()[:16]]
            out[disc]["non_vrf_configs"] = [len(ncfg), hashlib.sha256("".join(c + _canon(ncfg[c]) for c in sorted(ncfg)).encode()).hexdigest()[:16]]
            out[disc]["vrf_items_active"] = sum(1 for u in L if L[u]["kind"] == VRF_KIND)
    for uid in RETIRED:
        rows = frappe.db.sql('select name, active from "tabBoQ Rate Master Item" where item_uid=%s', (uid,), as_dict=True)
        out.setdefault("retired", {})[uid] = {"rows": len(rows), "active": sum(1 for r in rows if r["active"])}
    exp = exporter.build_asset("HVAC")
    out["retired_in_active_export"] = sorted(i["item_uid"] for i in exp["items"] if i["item_uid"] in RETIRED)
    print(json.dumps(out, indent=1, sort_keys=True))
    frappe.destroy()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("phase", choices=["export", "build", "load", "verify"])
    ap.add_argument("--export", default="/tmp/vrf2a/v56_export.json")
    ap.add_argument("--candidate", default=V56)
    ap.add_argument("--prices", default="/tmp/vrf2a/v56_prices.json")
    a = ap.parse_args()
    if a.phase == "export":
        export(a.export)
    elif a.phase == "build":
        build(a.candidate, a.prices)
    elif a.phase == "load":
        load(a.candidate)
    else:
        verify(a.candidate)
