"""ADP-1 (owner rulings 2026-10-19: H3 slot diffusers, H4 plenums / mixing boxes, A4 Pricing Inputs, F1) -- HVAC v47.

Runs IN THE CONTAINER under the bench's python. Five phases, each explicit, in this order (owner Q1, 15:50):

  deactivate  the two per-number plenum SKUs (H4: "we can remove the 2 rows from catalg which are given in nos")
              through the PRODUCT'S OWN per-SKU path, `api.boq.rate_master.deactivate_rate_master_item`, as an
              admin -- deactivate, never delete (the row is retained, active = 0); the endpoint refuses a row that
              is the base of a derived cell, and a refusal STOPS here.
  export      the HVAC asset exported FROM THE DATABASE after the deactivation (`exporter.build_asset`); proves it
              equals v46 by content less exactly those two items. NO database write.
  build       this slice's edits on that fresh export (the same edits `frontend/.../adp1.harness.ts` makes; the
              asset commit pins the two equal), three Pricing Input items minted through `csv_importer.mint_item_uid`
              (the ONE mint), the series file convention (items in global `item_uid` order, configs in v46's order,
              `intentional_removals` carried), validated offline (the config validator + the cross-category check),
              and the STUB PROOF: every item-list category's extraction request is identical on v46 and v47 (no model
              question changes). Writes the candidate. NO database write.
  load        pre-load HVAC snapshot, then `loader.load_rate_master(path=<candidate>, replace=True)`.
  verify      live HVAC == the candidate BY CONTENT (items by uid, configs by id); the two SKUs active = 0 and absent
              from the active export; Electrical untouched (its own content hashes printed).

The mint gate (`scripts/mint_completeness_check.py`) has no item atoms, so it cannot see the two SKUs leave; the
H4 reason travels in the commit body, the plan entry and boq-rate-master.md.

Usage (container, from frappe-bench): env/bin/python <this> <phase> [--candidate PATH] [--export PATH]
"""
import argparse, copy, hashlib, json, os, sys

DATA = "/workspace/development/frappe-bench/apps/nirmaan_stack/nirmaan_stack/services/boq_rate_master/data"
V46 = os.path.join(DATA, "rate_master_hvac_all_v46.json")
RETIRED = ["rmi-4184735331c3", "rmi-a23b43d34447"]
H4_REASON = ("owner H4, 2026-10-19 14:34: 'low pressure plenum or mixing box should be priced as 2*(LB+BH+LH)/10^6Xper sqm "
             "rate + 150. so we can remove the 2 rows from catalg which are given in nos and use this logic to price all "
             "low pressure plenums/ mixing box'")
INPUTS = [
    ("mixing_box_supply_adder", "Mixing box supply adder", "amount", 150.0, "Rs per number",
     "Added to a per-number mixing box / LP plenum's SUPPLY cost, before the round-up and the supply markup; never to install. Read by ADP's per-number mixing box rule."),
    ("crosstalk_assumed_depth_mm", "Cross-talk assumed depth", "factor", 300.0, "mm",
     "The depth a per-number cross-talk is assumed to have: 2 x (W + H) x this / 10^6 sq.m of the per-sq.m rate. Read by ADP's per-number cross-talk rule."),
    ("flexible_duct_length_m", "Flexible duct length per piece", "factor", 2.5, "m per piece",
     "The standard length of one piece of flexible duct: a per-number row is the per-metre rate x this. Read by ADP's per-number flexible duct rule."),
]


def _connect():
    os.chdir("/workspace/development/frappe-bench/sites")
    import frappe
    frappe.init(site="localhost"); frappe.connect()
    return frappe


def _canon(o):
    return json.dumps(o, sort_keys=True, separators=(",", ":"), default=str)


def _dump(p):
    return json.dumps(p, indent=1, ensure_ascii=False)


# ---------------------------------------------------------------------------------------------------------------
def deactivate():
    frappe = _connect()
    frappe.set_user("Administrator")
    from nirmaan_stack.api.boq import rate_master
    for uid in RETIRED:
        rows = frappe.db.sql('select name, active, kind, unit, attributes from "tabBoQ Rate Master Item" where item_uid=%s and discipline=%s order by creation',
                             (uid, "HVAC"), as_dict=True)
        live = [r for r in rows if r["active"]]
        print(uid, "rows", len(rows), "active", [r["name"] for r in live])
        if len(live) != 1:
            raise SystemExit("%s: expected exactly one active row, found %d -- STOP" % (uid, len(live)))
        out = rate_master.deactivate_rate_master_item(name=live[0]["name"])
        after = frappe.db.get_value("BoQ Rate Master Item", live[0]["name"], "active")
        print("  deactivate_rate_master_item ->", out, "| active now", after)
        if after != 0:
            raise SystemExit("not deactivated -- STOP")
    frappe.destroy()


# ---------------------------------------------------------------------------------------------------------------
def export(path):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import exporter
    payload = exporter.build_asset("HVAC")
    text = exporter.serialize_asset(payload)
    open(path, "w", encoding="utf-8", newline="").write(text)
    v46 = json.load(open(V46, encoding="utf-8"))
    e_items = {i["item_uid"]: i for i in payload["items"]}
    v_items = {i["item_uid"]: i for i in v46["items"]}
    missing = sorted(set(v_items) - set(e_items)); extra = sorted(set(e_items) - set(v_items))
    differ = sorted(u for u in set(v_items) & set(e_items) if _canon(v_items[u]) != _canon(e_items[u]))
    e_cfg = {c["category_id"]: c for c in payload["category_configs"]}
    v_cfg = {c["category_id"]: c for c in v46["category_configs"]}
    cdiff = sorted(c for c in set(e_cfg) | set(v_cfg) if _canon(e_cfg.get(c)) != _canon(v_cfg.get(c)))
    print("export written", path, "| items", len(payload["items"]), "| configs", len(payload["category_configs"]))
    print("vs v46 by content: items missing", missing, "| extra", extra, "| differing", differ, "| configs differing", cdiff)
    print("top-level keys export", sorted(payload), "| v46", sorted(v46))
    if missing != sorted(RETIRED) or extra or differ or cdiff:
        raise SystemExit("the export is not v46 less exactly the two SKUs -- STOP")
    frappe.destroy()


# ---------------------------------------------------------------------------------------------------------------
def _match():
    return {"step": "match_master_row", "params": {"kind": "hvac_adp_item"}, "explain": "match the ADP SKU (family, unit class and the stated attributes)"}


def _markup(leg):
    return [{"step": "scale", "target": "cost_%s" % leg, "result": leg, "params": {"m_from_ctx": "%s_markup" % leg}, "formula": "base*(1+m)",
             "explain": "%s: cost x (1 + the SKU's %s markup) (R15)" % (leg, leg)},
            {"step": "roundup", "target": leg, "params": {"digits": 0}, "explain": "ROUNDUP(%s, 0) (R15)" % leg}]


def _input(item, column, result):
    return {"step": "rate_ref", "ref": {"kind": "hvac_pricing_input", "item": item}, "target": column, "result": result,
            "explain": "pricing input: %s (%s)" % (item, column)}


def apply_adp1(payload):
    """The ADP-1 config edits, exactly those of `adp1.harness.ts` (the asset commit's test pins the two equal)."""
    p = copy.deepcopy(payload)
    adp = next(c for c in p["category_configs"] if c["category_id"] == "hvac_adp")
    ins = next(c for c in p["category_configs"] if c["category_id"] == "hvac_insulation")
    pr = adp["list_spec"]["pricing"]
    # H3
    pr["numbers"]["piece_length_m"] = {"from": ["piece_length_m"], "name": "piece length", "unit": "m", "typed_only": True,
                                       "length_from": "size_mm", "label": "Piece length (m)"}
    pr["numbers"]["slot_count"] = dict(pr["numbers"]["slot_count"], not_stocked="No SKU for a {value}-slot diffuser - price this row by hand")
    pr["match_attrs"] = pr["match_attrs"] + ["piece_length_m"]
    pr["panel_controls"] = dict(pr["panel_controls"], piece_length_m="text")
    pr["number_defaults"] = {"piece_length_m": {"value": 1, "families": ["slot diffuser"],
                                                "rule": "no piece length stated - priced at 1 m (owner H3, 2026-10-19)"}}
    pr["refuse_on_unit_class"] = [{"unit_class": "area", "families": ["slot diffuser"], "attr": "damper", "value_contains": "without",
                                   "refuse": "No SKU for a slot diffuser per sq.m without damper - price this row by hand",
                                   "rule": "H3 (b) per sq.m the slots do not matter and only the with-damper SKU is stocked (owner 2026-10-19)"}]
    pr["families"]["slot diffuser"]["convert"]["count"] = [{
        "to": "length", "needs": ["slot_count", "piece_length_m"],
        "rule": "H3 per-number slot diffuser: the per-metre rate (slots and damper) x the piece length in metres",
        "show_numbers": True, "name_missing": True,
        "pipelines": {leg: {"output": [leg], "steps": [_match(),
            {"step": "scale", "target": "cost_%s" % leg, "result": "cost_%s" % leg, "params": {"l_from_attr": "piece_length_m"}, "formula": "base*l",
             "explain": "per-metre %s cost x the piece length in metres (H3)" % leg}] + _markup(leg)} for leg in ("supply", "install")},
    }]
    # H4
    mb = pr["families"]["mixing box / LP plenum"]["convert"]["count"][0]
    mb["rule"] = ("H4 per-number mixing box / LP plenum: per-sq.m cost x 2 x (L x B + B x H + L x H) / 10^6 sq.m, + the mixing-box "
                  "supply adder on supply only, rounded up, then the markup")
    mb["show_numbers"] = True
    mb["name_missing"] = True
    # A4 -- the mixing box's 150
    steps = mb["pipelines"]["supply"]["steps"]
    sc = next(s for s in steps if s.get("step") == "scale" and s.get("result") == "cost_supply")
    assert sc["formula"] == "base*2*(w*h+h*d+w*d)/1000000+150", sc
    sc["formula"] = "base*2*(w*h+h*d+w*d)/1000000+mba"
    sc["params"] = dict(sc["params"], mba_from_ctx="mba")
    sc["explain"] = "per-sq.m supply cost x 2 x (W x H + H x D + W x D) / 10^6 sq.m + the mixing-box supply adder (S7, H4)"
    mb["pipelines"]["supply"]["steps"] = [_input("mixing_box_supply_adder", "amount", "mba")] + steps
    # A4 -- the cross-talk depth
    for leg in ("supply", "install"):
        pl = pr["families"]["cross-talk"]["units"]["count"]["pipelines"][leg]
        sc = next(s for s in pl["steps"] if s.get("step") == "scale" and (s.get("params") or {}).get("depth") == 300)
        params = {k: v for k, v in sc["params"].items() if k != "depth"}
        params["depth_from_ctx"] = "ctd"
        sc["params"] = params
        sc["explain"] = "sheet formula: 2 x (W + H) x the cross-talk assumed depth / 10^6 sq.m x the base per-sq.m %s cost (R20)" % leg
        pl["steps"] = [_input("crosstalk_assumed_depth_mm", "factor", "ctd")] + pl["steps"]
    # A4 -- the flexible duct's metres per piece
    fd = pr["families"]["flexible duct"]["convert"]["count"][0]
    fd["rule"] = "per piece: per-metre rate x the flexible duct length per piece (R-M-c)"
    for pid in list(fd["pipelines"]):
        pl = fd["pipelines"][pid]
        sc = next(s for s in pl["steps"] if s.get("step") == "scale" and (s.get("params") or {}).get("standard_length_m") == 2.5)
        sc["params"] = {"standard_length_m_from_ctx": "fdl"}
        sc["explain"] = sc["explain"].replace("2.5 m standard length", "the flexible duct length per piece")
        pl["steps"] = [_input("flexible_duct_length_m", "factor", "fdl")] + pl["steps"]
        if isinstance(pl.get("note"), str):
            pl["note"] = pl["note"].replace("The length is declared HERE, in config", "The length is a Pricing Input (ADP-1, owner A4)")
    # F1
    ins["list_spec"]["pricing"]["numbers"]["pipe_size_mm"] = dict(ins["list_spec"]["pricing"]["numbers"]["pipe_size_mm"], bare_above_largest="refuse")
    return p


def build(export_path, out):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import config_validation, csv_importer, extraction
    exported = json.load(open(export_path, encoding="utf-8"))
    v46 = json.load(open(V46, encoding="utf-8"))
    payload = apply_adp1(exported)
    # A4: the three inputs, each through the ONE mint
    taken = {i["item_uid"] for i in payload["items"]}
    for item, name, column, value, unit, remarks in INPUTS:
        uid = csv_importer.mint_item_uid("HVAC")
        assert uid not in taken
        taken.add(uid)
        payload["items"].append({"kind": "hvac_pricing_input", "brand": None, "unit": unit,
                                 "attributes": {"item": item, "name": name, "remarks": remarks, "shared_by": "adp"},
                                 "rates": {column: value}, "source": {"sheet": "Pricing Inputs", "row": 0}, "item_uid": uid})
    # the series file convention: items in global uid order, configs in v46's order, v46's top-level keys and their order
    payload["items"].sort(key=lambda i: i["item_uid"])
    order = [c["category_id"] for c in v46["category_configs"]]
    payload["category_configs"].sort(key=lambda c: order.index(c["category_id"]))
    final = {k: (payload[k] if k in payload else copy.deepcopy(v46[k])) for k in v46}
    final["intentional_removals"] = copy.deepcopy(v46["intentional_removals"])
    # offline validation
    stored = [dict(c, discipline=final["discipline"]) for c in final["category_configs"]]
    for c in stored:
        config_validation._validate_config(c)
    problems = config_validation.delegated_section_problems(stored, final["items"])
    if problems:
        raise SystemExit("cross-category check refuses: %r" % problems)

    # the STUB PROOF -- every item-list category's extraction request, rebuilt from v46 and from v47
    def requests(p):
        st = [dict(c, discipline=p["discipline"]) for c in p["category_configs"]]
        cfgs = {(p["discipline"], c["category_id"]): c for c in st}
        return {c["category_id"]: json.dumps(extraction.build_items_spec(cfgs[(p["discipline"], c["category_id"])], cfgs, p["discipline"]), sort_keys=True)
                for c in st if c.get("list_spec")}
    r46, r47 = requests(v46), requests(final)
    diff = sorted(k for k in set(r46) | set(r47) if r46.get(k) != r47.get(k))
    print("STUB PROOF: item-list requests v46 vs v47 -- identical:", sorted(k for k in r46 if r46[k] == r47.get(k)), "| differing:", diff)
    assert diff == [], diff
    text = _dump(final) + "\n"
    open(out, "w", encoding="utf-8", newline="").write(text)
    print("candidate written:", out, "| items", len(final["items"]), "| configs", len(final["category_configs"]),
          "| inputs minted", [i["item_uid"] for i in final["items"] if i["kind"] == "hvac_pricing_input" and i["attributes"]["item"] in [x[0] for x in INPUTS]])
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
    print("LOAD SUMMARY:", json.dumps(s, default=str)[:900])
    frappe.destroy()


def verify(candidate):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import exporter
    asset = json.load(open(candidate, encoding="utf-8"))
    out = {}
    for disc in ("HVAC", "Electrical"):
        J = lambda v: json.loads(v) if isinstance(v, str) else v
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
    for uid in RETIRED:
        rows = frappe.db.sql('select name, active from "tabBoQ Rate Master Item" where item_uid=%s', (uid,), as_dict=True)
        out.setdefault("retired", {})[uid] = {"rows": len(rows), "active": sum(1 for r in rows if r["active"])}
    exp = exporter.build_asset("HVAC")
    out["retired_in_active_export"] = sorted(i["item_uid"] for i in exp["items"] if i["item_uid"] in RETIRED)
    print(json.dumps(out, indent=1, sort_keys=True))
    frappe.destroy()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("phase", choices=["deactivate", "export", "build", "load", "verify"])
    ap.add_argument("--export", default="/tmp/adp1/v47_export_after_deactivate.json")
    ap.add_argument("--candidate", default=os.path.join(DATA, "rate_master_hvac_all_v47.json"))
    a = ap.parse_args()
    if a.phase == "deactivate":
        deactivate()
    elif a.phase == "export":
        export(a.export)
    elif a.phase == "build":
        build(a.export, a.candidate)
    elif a.phase == "load":
        load(a.candidate)
    else:
        verify(a.candidate)
