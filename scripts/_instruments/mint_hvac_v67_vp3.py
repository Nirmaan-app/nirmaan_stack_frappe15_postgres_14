"""VP-3 (2026-11-13) -- MINT HVAC v67 = v66 + THE VP-2 REVIEW RULINGS' CONFIG CHANGES (owner 2026-11-13 17:26-17:47), on the Valve
Package and the borrow-only Misc configs ONLY. Every item and every other config is byte-identical to v66 (asserted).

What changes (each a plain instruction the model reads in the question notes, or a note / wording key the pricer reads):
  hvac_valve_package  valve_type note    + D1 (a PIBCV's thermostat / controller / actuator / actuator panel is part of the PIBCV),
                                           D4 (a gauge's tied ball / gate valve is part of the gauge), D5 (air vent + ball valve: the
                                           one size is the ball valve's), D7b (BV / Bal valve <= 40 mm = ball valve), D7c (valve with
                                           strainer = two items; a Set spelling its contents = each item; a kit = each item listed)
                      valve_type_as_written note + D7c (a kit: each item's own words)
                      size_mm note       + D5 ("15mm\"" = 15 mm)
                      nrv_type note      + D2 (a stated type wins: "wafer type dual plate ... with companion flanges" = Dual Plate)
                      actuation / operation notes + D7a ("4-20 mA", "analog", "proportional" = Modulating)
                      scope note         + D3 ("portable" / "handed over" = Supply only; "Supply of" / "Supply and provisioning" =
                                           Supply + installation, the same way on every row)
                      pricing.text_notes the insulation entry also reads "insulaion" (C1); + the air vent's one-price line (C2)
                      pricing.lot_units.bar_by_unit  Rmt / Mtr -> "PRICED PER METRE - NOT A VALVE UNIT ..." (C4)
  hvac_misc           item note          + D4 (a ball / gate / needle valve tied to the gauge is part of it)
                      pricing.text_notes + the insulation line on every Misc family (C1)
                      pricing.unit_classes.count + Set / Sets (C5: a Set row's named instrument is priced per Set, never "not
                                           stocked per Set")
`second_opinion` stays FALSE on both (owner 2026-11-09 18:52).

Runs IN THE CONTAINER under the bench's python. Phases: build (v66 -> the candidate; NO database write), load (pre-load HVAC
snapshot, then loader.load_rate_master(path=<candidate>, replace=True)), verify (live HVAC == the candidate BY CONTENT).
Usage (container, from frappe-bench): env/bin/python -I <this> <phase> [--candidate P]
"""
import argparse, copy, hashlib, json, os, re

APP = "/workspace/development/frappe-bench/apps/nirmaan_stack"
DATA = os.path.join(APP, "nirmaan_stack/services/boq_rate_master/data")
V66 = os.path.join(DATA, "rate_master_hvac_all_v66.json")
V67 = os.path.join(DATA, "rate_master_hvac_all_v67.json")
VALVE, MISC = "hvac_valve_package", "hvac_misc"

GUIDANCE = {
    "valve_type": (
        " A thermostat, controller, remote controller, actuator or actuator panel named WITH a PIBCV (pressure independent control"
        " valve) is PART of the PIBCV item - our PIBCV item already includes its thermostat and actuator: return the one PIBCV item"
        " and no second item for them. This is only for a PIBCV: a thermostat named with any other valve (a 2-way valve) is still"
        " its own item. A ball, gate or needle valve the row ties to a pressure gauge ('for isolation', 'of suitable size', 'cost"
        " included in this item', 'with syphon') is part of the gauge: return the gauge alone, in the misc section, and no valve"
        " item; a valve the row prices as its own item with its own size stays a separate valve. An automatic air vent with a ball"
        " valve: the row's one size is the BALL VALVE's size - put it on the ball valve (the air vent has one price for any size)."
        " An abbreviated 'BV' or 'Bal valve' is a Ball Valve when its size is 40 mm or below; above 40 mm take the type from the"
        " heading. A valve 'with strainer', or with an integral / built-in strainer, is TWO items: the valve and a Strainer of the"
        " same size. A Set whose heading spells out what one Set holds (e.g. one ball valve with strainer and one without) is each"
        " of those items, one item each. A kit or package naming several parts: return each part as its own item, so only a part"
        " we do not stock is 'none of these'."
    ),
    "valve_type_as_written": " For a kit or package, copy each part's own words on its own item, never the whole package on one item.",
    "size_mm": " A size written in mm with a stray inch mark after it ('15mm\"') is that many mm (15 mm), never inches.",
    "nrv_type": (
        " A type stated in the row or in a heading describing this valve is read and wins: 'wafer type dual plate check valve(s)"
        " ... with companion flanges' is Dual Plate."
    ),
    "actuation": (
        " Clear modulating-control wording counts as Modulating even without the word: '4-20 mA', 'analog' / 'analogue' (signal,"
        " output, control), 'proportional'."
    ),
    "operation": (
        " Clear modulating-control wording counts as Modulating even without the word: '4-20 mA', 'analog' / 'analogue' (signal,"
        " output, control), 'proportional'."
    ),
    "scope": (
        " 'portable' or 'handed over' means Supply only. 'Supply of ...' and 'Supply and provisioning / providing ...' are Supply +"
        " installation (installation is included unless the BoQ says supply only or quotes installation on its own row) - answer"
        " the same way on every row with the same wording."
    ),
}
MISC_GUIDANCE = {
    "item": (
        " A ball, gate or needle valve the row ties to the gauge ('for isolation', 'of suitable size', 'cost included in this item',"
        " 'with syphon') is part of the gauge too: one Pressure Gauge item."
    ),
}
INSUL_OLD, INSUL_NEW = "insulat", "insula(?:t|i)"
AAV_NOTE = {
    "families": ["Automatic Air Vent"],
    "from_text": "own_and_headings",
    "pattern": ".",
    "line": "One price for an automatic air vent of any size - the sheet has a single air-vent price (owner C2)",
    "rule": "C2",
}
METRE_BAR = "PRICED PER METRE - NOT A VALVE UNIT. PRICE THIS ROW BY HAND."
MISC_INSUL_NOTE = {
    "families": ["Temperature Gauge / Thermometer", "Pressure Gauge", "Rubber Bellows / Expansion Joint", "Test Plug / Thermowell"],
    "from_text": "own_and_headings",
    "pattern": "insula(?:t|i)",
    "line": "The BoQ asks for insulation. Insulation is not on our sheets and is not in this price - add it by hand if it is needed (owner C1)",
    "rule": "C1",
}
MISC_SET = ["Set", "Sets"]


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


def valve_config(v66):
    c = copy.deepcopy(v66)
    for did, add in GUIDANCE.items():
        d = _def(c, did)
        assert add.strip() not in d.get("note", ""), did
        d["note"] = d.get("note", "").rstrip() + add
    p = c["list_spec"]["pricing"]
    ins = [t for t in p["text_notes"] if t.get("pattern") == INSUL_OLD]
    assert len(ins) == 1, len(ins)
    ins[0]["pattern"] = INSUL_NEW
    assert not any("Automatic Air Vent" in t["families"] and t.get("rule") == "C2" for t in p["text_notes"])
    p["text_notes"].append(copy.deepcopy(AAV_NOTE))
    lot = p["lot_units"]
    assert "bar_by_unit" not in lot and {"Rmt", "Mtr"} <= set(lot["units"]), lot
    lot["bar_by_unit"] = {"Rmt": METRE_BAR, "Mtr": METRE_BAR}
    assert c["list_spec"].get("second_opinion") is False
    return c


def misc_config(v66):
    c = copy.deepcopy(v66)
    for did, add in MISC_GUIDANCE.items():
        d = _def(c, did)
        d["note"] = d.get("note", "").rstrip() + add
    p = c["list_spec"]["pricing"]
    p["text_notes"] = list(p.get("text_notes") or []) + [copy.deepcopy(MISC_INSUL_NOTE)]
    cnt = p["unit_classes"]["count"]
    assert not set(MISC_SET) & set(cnt), cnt
    p["unit_classes"]["count"] = cnt + MISC_SET
    assert c["list_spec"].get("second_opinion") is False
    return c


# ---------------------------------------------------------------------------------------------------------------
def build(out):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import config_validation, extraction
    from nirmaan_stack.services.boq_rate_master.loader import _validate_items, _validate_one_config
    raw = open(V66, "rb").read()
    prev = json.loads(raw.decode("utf-8"))
    if _dump(prev).encode("utf-8") != raw:
        raise SystemExit("re-dumping v66 does not reproduce its bytes -- the series convention is not what this mint writes")
    final = copy.deepcopy(prev)
    idx = {c["category_id"]: n for n, c in enumerate(prev["category_configs"])}
    final["category_configs"][idx[VALVE]] = valve_config(prev["category_configs"][idx[VALVE]])
    final["category_configs"][idx[MISC]] = misc_config(prev["category_configs"][idx[MISC]])
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
    print("STUB PROOF: item-list requests v66 vs v67 (valve / misc aside) -- identical:", sorted(k for k in r_base if r_base[k] == r_new.get(k)), "| differing:", diff)
    assert diff == [], diff
    vb = json.dumps(extraction.build_items_spec(cfgs_base[("HVAC", VALVE)], cfgs_base, "HVAC"), ensure_ascii=False)
    vn = json.dumps(spec, ensure_ascii=False)
    print("hvac_valve_package ITEMS_SPEC chars v66", len(vb), "-> v67", len(vn), "(+%d)" % (len(vn) - len(vb)))
    for k in GUIDANCE:
        assert json.dumps(GUIDANCE[k].strip(), ensure_ascii=False)[1:-1] in vn, ("guidance not in the question", k)
    assert json.dumps(MISC_GUIDANCE["item"].strip(), ensure_ascii=False)[1:-1] in vn, "misc guidance not in the question"
    print("eligible configs v67 = v66:", eligible)

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
    ap.add_argument("--candidate", default=V67)
    a = ap.parse_args()
    if a.phase == "build":
        build(a.candidate)
    elif a.phase == "load":
        load(a.candidate)
    else:
        verify(a.candidate)
