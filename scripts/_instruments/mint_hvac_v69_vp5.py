"""VP-5 (2026-11-15, run on the laptop) -- MINT HVAC v69 = v68 + THE VP-4 ALL-ROWS REVIEW RULINGS' CONFIG CHANGES (owner 2026-11-14
22:08-22:40, E1-E11; QR-1 "a a a"), on the Valve Package and the borrow-only Misc configs ONLY. Every item and every other config is
byte-identical to v68 (asserted).

What changes (each a plain instruction the model reads in the question notes):
  hvac_valve_package  valve_type note    + E1 (a "with and without strainer" heading over size-only rows: the valve alone), E2 (a
                                           swing check NRV: NRV / Check Valve, the words copied, never Flanged / Dual Plate), E7 (a
                                           balancing valve with integrated P/T test points is one item), E8 (an on-off pressure
                                           independent valve is a PIBCV, the words copied), E9 (an air vent named only in the heading
                                           over a row describing a ball valve is not an item)
                      valve_type_as_written note + E10 (copy "with out valve")
                      scope note         + E11 (installation / refixing of items the row does not supply = Installation only; "lifting,
                                           shifting, positioning" in a scope list is not)
  hvac_misc           item note          + E3 (a differential pressure gauge = Pressure Gauge, the words copied), E4 (a thermometer with
                                           necessary isolation valves = one thermometer item, no valve item), E6 (a pressure gauge
                                           provision = Test Plug / Thermowell)
                      + the SCOPE question (E11: Misc items get the scope reading valves have - the valve scope definition's shape,
                        same values, same note incl. E11); matching never reads it (a family's `needs` list does not name it)
The refix words the pricer reads (E11 (ii)) live in code (`pricingSheetHelper.ts` VP5_SCOPE). `second_opinion` stays FALSE on both.

Runs IN THE CONTAINER under the bench's python. Phases: build (v68 -> the candidate; NO database write), load (pre-load HVAC
snapshot, then loader.load_rate_master(path=<candidate>, replace=True)), verify (live HVAC == the candidate BY CONTENT).
Usage (container, from frappe-bench): env/bin/python -I <this> <phase> [--candidate P]
"""
import argparse, copy, hashlib, json, os, re

APP = "/workspace/development/frappe-bench/apps/nirmaan_stack"
DATA = os.path.join(APP, "nirmaan_stack/services/boq_rate_master/data")
V68 = os.path.join(DATA, "rate_master_hvac_all_v68.json")
V69 = os.path.join(DATA, "rate_master_hvac_all_v69.json")
VALVE, MISC = "hvac_valve_package", "hvac_misc"

GUIDANCE = {
    "valve_type": (
        " Under a heading saying 'with and without strainer' over rows that state only a size, return the valve alone (no Strainer"
        " item): the BoQ does not say how many have one. A 'swing check' NRV is an NRV / Check Valve: copy 'swing check' in"
        " valve_type_as_written and leave nrv_type 'None' (swing check is neither Flanged nor Dual Plate). A balancing valve with"
        " INTEGRATED P/T test points is one Balancing Valve item (the test points are part of it); list test plugs only when the BoQ"
        " counts separate test points. A '2 way pressure independent on-off' valve is a PIBCV; copy 'on-off' in"
        " valve_type_as_written. An air vent named only in the heading, over a row whose own words describe only a ball valve, is not"
        " an item: return the ball valve alone."
    ),
    "valve_type_as_written": " When the row says 'with out valve', copy those words.",
    "scope": (
        " Installation (installing, fixing, refixing) of items the row does not supply is Installation only - also refixing,"
        " reinstalling, shifting or relocating EXISTING or OLD valves. 'Lifting, shifting, positioning at site' in a list of what the"
        " price includes is not installation only."
    ),
}
MISC_GUIDANCE = {
    "item": (
        " A differential pressure gauge is a Pressure Gauge; copy 'differential' in item_as_written. A thermometer 'with (necessary)"
        " isolation valves' is ONE Temperature Gauge / Thermometer item; return no valve item for its isolation valves. A pressure"
        " gauge 'provision' (sockets, ball valves, siphon to fix a gauge later) is a Test Plug / Thermowell; the gauge itself is not"
        " part of it."
    ),
}
SCOPE_ID = "scope"


def _connect():
    os.chdir("/workspace/development/frappe-bench/sites")
    import frappe
    frappe.init(site="localhost"); frappe.connect()
    return frappe


def _canon(o):
    return json.dumps(o, sort_keys=True, separators=(",", ":"), default=str)


def _dump(p):
    return json.dumps(p, indent=1, ensure_ascii=False) + "\n"


def _def(cfg, did):
    d = [x for x in cfg["list_spec"]["attribute_definitions"] if x["id"] == did]
    assert len(d) == 1, (cfg["category_id"], did, len(d))
    return d[0]


def valve_config(prev):
    c = copy.deepcopy(prev)
    for did, add in GUIDANCE.items():
        d = _def(c, did)
        assert add.strip() not in d.get("note", ""), did
        d["note"] = d.get("note", "").rstrip() + add
    assert c["list_spec"].get("second_opinion") is False
    return c


def misc_config(prev, valve_new):
    """v68's Misc + E3 / E4 / E6 guidance + the scope question: the valve's (v69) scope definition, byte for byte -- the same shape,
    values and note (E11 incl.), placed last."""
    c = copy.deepcopy(prev)
    for did, add in MISC_GUIDANCE.items():
        d = _def(c, did)
        assert add.strip() not in d.get("note", ""), did
        d["note"] = d.get("note", "").rstrip() + add
    defs = c["list_spec"]["attribute_definitions"]
    assert not [x for x in defs if x["id"] == SCOPE_ID], "Misc already has a scope question"
    defs.append(copy.deepcopy(_def(valve_new, SCOPE_ID)))
    for fam, spec in (c["list_spec"].get("families") or {}).items():
        assert SCOPE_ID not in (spec.get("needs") or []), fam
    assert c["list_spec"].get("second_opinion") is False
    return c


# ---------------------------------------------------------------------------------------------------------------
def build(out):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import config_validation, extraction
    from nirmaan_stack.services.boq_rate_master.loader import _validate_items, _validate_one_config
    raw = open(V68, "rb").read()
    prev = json.loads(raw.decode("utf-8"))
    if _dump(prev).encode("utf-8") != raw:
        raise SystemExit("re-dumping v68 does not reproduce its bytes -- the series convention is not what this mint writes")
    final = copy.deepcopy(prev)
    idx = {c["category_id"]: n for n, c in enumerate(prev["category_configs"])}
    final["category_configs"][idx[VALVE]] = valve_config(prev["category_configs"][idx[VALVE]])
    final["category_configs"][idx[MISC]] = misc_config(prev["category_configs"][idx[MISC]], final["category_configs"][idx[VALVE]])
    # every item byte-identical; every config byte-identical but the two
    assert _canon(prev["items"]) == _canon(final["items"]), "an item moved"
    for x, y in zip(prev["category_configs"], final["category_configs"]):
        assert x["category_id"] == y["category_id"]
        if x["category_id"] not in (VALVE, MISC):
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
    valve, misc = cfgs[("HVAC", VALVE)], cfgs[("HVAC", MISC)]
    if not extraction.has_runnable_pricing_rules(valve) or not extraction.config_is_eligible(valve, cfgs):
        raise SystemExit("hvac_valve_package is not runnable / eligible")
    if extraction.config_is_eligible(misc, cfgs):
        raise SystemExit("hvac_misc must stay BORROW-ONLY (not eligible on its own)")
    stored_base = [dict(c, discipline=prev["discipline"]) for c in prev["category_configs"]]
    cfgs_base = {(prev["discipline"], c["category_id"]): c for c in stored_base}
    eligible = sorted(c["category_id"] for c in stored if extraction.config_is_eligible(c, cfgs))
    eligible_base = sorted(c["category_id"] for c in stored_base if extraction.config_is_eligible(c, cfgs_base))
    assert eligible == eligible_base, (eligible, eligible_base)
    spec = extraction.build_items_spec(valve, cfgs, "HVAC")
    assert spec.get("second_opinion") is False

    def requests(st, cf):
        return {c["category_id"]: json.dumps(extraction.build_items_spec(cf[("HVAC", c["category_id"])], cf, "HVAC"), sort_keys=True)
                for c in st if c.get("list_spec") and c["category_id"] not in (VALVE, MISC)}
    r_base, r_new = requests(stored_base, cfgs_base), requests(stored, cfgs)
    diff = sorted(k for k in set(r_base) | set(r_new) if r_base.get(k) != r_new.get(k))
    print("STUB PROOF: item-list requests v68 vs v69 (valve / misc aside) -- identical:", sorted(k for k in r_base if r_base[k] == r_new.get(k)), "| differing:", diff)
    assert diff == [], diff
    vb = json.dumps(extraction.build_items_spec(cfgs_base[("HVAC", VALVE)], cfgs_base, "HVAC"), ensure_ascii=False)
    vn = json.dumps(spec, ensure_ascii=False)
    print("hvac_valve_package ITEMS_SPEC chars v68", len(vb), "-> v69", len(vn), "(+%d)" % (len(vn) - len(vb)))
    for k in GUIDANCE:
        assert json.dumps(GUIDANCE[k].strip(), ensure_ascii=False)[1:-1] in vn, ("guidance not in the question", k)
    for k in MISC_GUIDANCE:
        assert json.dumps(MISC_GUIDANCE[k].strip(), ensure_ascii=False)[1:-1] in vn, ("misc guidance not in the question", k)
    print("eligible configs v69 = v68:", eligible)

    text = _dump(final)
    tokens = sorted({t for t in re.findall(r"v\d+", text.replace(json.dumps(final.get("source_workbook") or "", ensure_ascii=False), '""'))})
    if tokens:
        raise SystemExit("the asset text carries version-like tokens %r (h07)" % tokens)
    open(out, "w", encoding="utf-8", newline="").write(text)
    print("candidate written:", out, "| items", len(final["items"]), "| configs", len(final["category_configs"]),
          "| sha256", hashlib.sha256(text.encode("utf-8")).hexdigest(),
          "| per-config sha16", {c["category_id"]: hashlib.sha256(_canon(c).encode()).hexdigest()[:16] for c in final["category_configs"] if c["category_id"] in (VALVE, MISC)})
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
            out[disc]["second_opinion"] = {c: ((LC[c].get("list_spec") or {}).get("second_opinion")) for c in (VALVE, MISC) if c in LC}
    print(json.dumps(out, indent=1, sort_keys=True))
    frappe.destroy()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("phase", choices=["build", "load", "verify"])
    ap.add_argument("--candidate", default=V69)
    a = ap.parse_args()
    if a.phase == "build":
        build(a.candidate)
    elif a.phase == "load":
        load(a.candidate)
    else:
        verify(a.candidate)
