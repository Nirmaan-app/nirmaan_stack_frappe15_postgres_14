"""ADP-2 (owner rulings H5 damper by air stream, H7 plenum fields + three-way rule, B3 neck "Other...") -- HVAC v48.

Runs IN THE CONTAINER under the bench's python. Four phases, each explicit, in this order:

  export   the HVAC asset exported FROM THE DATABASE (`exporter.build_asset`); proves it equals v47 by content (items by
           uid, configs by id). NO database write.
  build    this slice's edits on that fresh export -- exactly those `frontend/.../adp2.harness.ts` makes (the asset
           commit's test pins the two equal): H5 `derive_when_none` on the six damper families (supply -> with; return /
           exhaust / fresh -> without; replaces R13), H7 the four typed plenum boxes and the area conversion before the
           length + width + height one, B3 the neck control `dropdown_or_other`. NO catalogue item changes. The series
           file convention (items in global `item_uid` order, configs in v47's order, v47's top-level keys), validated
           offline (the config validator + the cross-category check), and the STUB PROOF: every item-list category's
           extraction request is identical on v47 and v48 (the model's question does not change -- that is ADP-5's).
           Writes the candidate. NO database write.
  load     pre-load HVAC snapshot, then `loader.load_rate_master(path=<candidate>, replace=True)`.
  verify   live HVAC == the candidate BY CONTENT; Electrical untouched (its own content hashes printed).

Usage (container, from frappe-bench): env/bin/python <this> <phase> [--candidate PATH] [--export PATH]
"""
import argparse, copy, hashlib, json, os

DATA = "/workspace/development/frappe-bench/apps/nirmaan_stack/nirmaan_stack/services/boq_rate_master/data"
V47 = os.path.join(DATA, "rate_master_hvac_all_v47.json")
DAMPER_FAMILIES = ["curved grille", "floor grille", "linear grille", "round diffuser", "slot diffuser", "square diffuser"]
PLENUM_NUMBERS = {
    "plenum_area_sqm": {"from": ["plenum_area_sqm"], "name": "area", "unit": "sqm", "range": "max", "typed_only": True,
                        "length_from": "area_band", "label": "Area (sq.m)"},
    "plenum_length_mm": {"from": ["plenum_length_mm"], "name": "length", "unit": "mm", "typed_only": True,
                         "length_from": "size_mm", "box_side": "length", "label": "Length (mm)"},
    "plenum_width_mm": {"from": ["plenum_width_mm"], "name": "width", "unit": "mm", "typed_only": True,
                        "length_from": "size_mm", "box_side": "width", "label": "Width (mm)"},
    "plenum_height_mm": {"from": ["plenum_height_mm"], "name": "height", "unit": "mm", "typed_only": True,
                         "length_from": "size_mm", "box_side": "height", "label": "Height (mm)"},
}


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
def export(path):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import exporter
    payload = exporter.build_asset("HVAC")
    open(path, "w", encoding="utf-8", newline="").write(exporter.serialize_asset(payload))
    v47 = json.load(open(V47, encoding="utf-8"))
    e_items = {i["item_uid"]: i for i in payload["items"]}
    v_items = {i["item_uid"]: i for i in v47["items"]}
    missing = sorted(set(v_items) - set(e_items)); extra = sorted(set(e_items) - set(v_items))
    differ = sorted(u for u in set(v_items) & set(e_items) if _canon(v_items[u]) != _canon(e_items[u]))
    e_cfg = {c["category_id"]: c for c in payload["category_configs"]}
    v_cfg = {c["category_id"]: c for c in v47["category_configs"]}
    cdiff = sorted(c for c in set(e_cfg) | set(v_cfg) if _canon(e_cfg.get(c)) != _canon(v_cfg.get(c)))
    print("export written", path, "| items", len(payload["items"]), "| configs", len(payload["category_configs"]))
    print("vs v47 by content: items missing", missing, "| extra", extra, "| differing", differ, "| configs differing", cdiff)
    if missing or extra or differ or cdiff:
        raise SystemExit("the export is not v47 by content -- STOP")
    frappe.destroy()


# ---------------------------------------------------------------------------------------------------------------
def _match():
    return {"step": "match_master_row", "params": {"kind": "hvac_adp_item"}, "explain": "match the ADP SKU (family, unit class and the stated attributes)"}


def _markup(leg):
    return [{"step": "scale", "target": "cost_%s" % leg, "result": leg, "params": {"m_from_ctx": "%s_markup" % leg}, "formula": "base*(1+m)",
             "explain": "%s: cost x (1 + the SKU's %s markup) (R15)" % (leg, leg)},
            {"step": "roundup", "target": leg, "params": {"digits": 0}, "explain": "ROUNDUP(%s, 0) (R15)" % leg}]


def apply_adp2(payload):
    """The ADP-2 config edits, exactly those of `adp2.harness.ts` (the asset commit's test pins the two equal)."""
    p = copy.deepcopy(payload)
    pr = next(c for c in p["category_configs"] if c["category_id"] == "hvac_adp")["list_spec"]["pricing"]
    # H5 -- R13 (linear grille, supply -> with) widens to every damper family; the other three streams say "without"
    pr["derive_when_none"] = [{"attr": "damper", "families": list(DAMPER_FAMILIES), "when": {"attr": "air", "equals": air},
                               "then": "with" if air == "supply" else "without",
                               "rule": "%s air, damper not mentioned -> %s damper" % (air, "with" if air == "supply" else "without")}
                              for air in ("supply", "return", "exhaust", "fresh")]
    # H7 -- four separate boxes; area first, else length + width + height (ADP-1's formula, unchanged), else refuse
    pr["numbers"] = dict(pr["numbers"], **copy.deepcopy(PLENUM_NUMBERS))
    pr["match_attrs"] = pr["match_attrs"] + list(PLENUM_NUMBERS)
    pr["panel_controls"] = dict(pr["panel_controls"], **{k: "text" for k in PLENUM_NUMBERS})
    fam = pr["families"]["mixing box / LP plenum"]
    mb = fam["convert"]["count"][0]
    assert mb["needs"] == ["face_w_mm", "face_h_mm", "depth_mm"], mb["needs"]
    mb["needs"] = ["plenum_length_mm", "plenum_width_mm", "plenum_height_mm"]
    for leg in ("supply", "install"):
        sc = next(s for s in mb["pipelines"][leg]["steps"] if s.get("step") == "scale" and (s.get("params") or {}).get("w_from_attr"))
        sc["params"] = dict(sc["params"], w_from_attr="plenum_length_mm", h_from_attr="plenum_width_mm", d_from_attr="plenum_height_mm")
    area = {
        "to": "area", "needs": ["plenum_area_sqm"],
        "rule": "H7 per-number mixing box / LP plenum with an area: the area x the per-sq.m rate, supply and install (no adder)",
        "show_numbers": True, "name_missing": True,
        "pipelines": {leg: {"output": [leg], "steps": [_match(),
            {"step": "scale", "target": "cost_%s" % leg, "result": "cost_%s" % leg, "params": {"a_from_attr": "plenum_area_sqm"}, "formula": "base*a",
             "explain": "per-sq.m %s cost x the area (H7)" % leg}] + _markup(leg)} for leg in ("supply", "install")},
    }
    fam["convert"]["count"] = [area, mb]
    # B3 -- the neck dropdown offers "Other..."
    pr["panel_controls"] = dict(pr["panel_controls"], neck_mm="dropdown_or_other")
    return p


def build(export_path, out):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import config_validation, extraction
    exported = json.load(open(export_path, encoding="utf-8"))
    v47 = json.load(open(V47, encoding="utf-8"))
    payload = apply_adp2(exported)
    # the series file convention: items in global uid order, configs in v47's order, v47's top-level keys and their order
    payload["items"].sort(key=lambda i: i["item_uid"])
    order = [c["category_id"] for c in v47["category_configs"]]
    payload["category_configs"].sort(key=lambda c: order.index(c["category_id"]))
    final = {k: (payload[k] if k in payload else copy.deepcopy(v47[k])) for k in v47}
    final["intentional_removals"] = copy.deepcopy(v47["intentional_removals"])
    # offline validation
    stored = [dict(c, discipline=final["discipline"]) for c in final["category_configs"]]
    for c in stored:
        config_validation._validate_config(c)
    problems = config_validation.delegated_section_problems(stored, final["items"])
    if problems:
        raise SystemExit("cross-category check refuses: %r" % problems)
    # items: v48 carries v47's catalogue unchanged, by content
    a = {i["item_uid"]: _canon(i) for i in v47["items"]}; b = {i["item_uid"]: _canon(i) for i in final["items"]}
    assert a == b, "items differ from v47"

    # the STUB PROOF -- every item-list category's extraction request, rebuilt from v47 and from v48
    def requests(p):
        st = [dict(c, discipline=p["discipline"]) for c in p["category_configs"]]
        cfgs = {(p["discipline"], c["category_id"]): c for c in st}
        return {c["category_id"]: json.dumps(extraction.build_items_spec(cfgs[(p["discipline"], c["category_id"])], cfgs, p["discipline"]), sort_keys=True)
                for c in st if c.get("list_spec")}
    r47, r48 = requests(v47), requests(final)
    diff = sorted(k for k in set(r47) | set(r48) if r47.get(k) != r48.get(k))
    print("STUB PROOF: item-list requests v47 vs v48 -- identical:", sorted(k for k in r47 if r47[k] == r48.get(k)), "| differing:", diff)
    assert diff == [], diff
    cd = sorted(c["category_id"] for c, d in zip(v47["category_configs"], final["category_configs"]) if _canon(c) != _canon(d))
    print("configs changed vs v47:", cd)
    assert cd == ["hvac_adp"], cd
    open(out, "w", encoding="utf-8", newline="").write(_dump(final) + "\n")
    print("candidate written:", out, "| items", len(final["items"]), "| configs", len(final["category_configs"]))
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
    print(json.dumps(out, indent=1, sort_keys=True))
    frappe.destroy()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("phase", choices=["export", "build", "load", "verify"])
    ap.add_argument("--export", default="/tmp/adp2/v48_export.json")
    ap.add_argument("--candidate", default=os.path.join(DATA, "rate_master_hvac_all_v48.json"))
    a = ap.parse_args()
    if a.phase == "export":
        export(a.export)
    elif a.phase == "build":
        build(a.export, a.candidate)
    elif a.phase == "load":
        load(a.candidate)
    else:
        verify(a.candidate)
