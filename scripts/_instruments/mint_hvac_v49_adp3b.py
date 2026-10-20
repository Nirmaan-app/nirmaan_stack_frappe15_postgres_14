"""ADP-3b (owner B1; D1-D4, 2026-10-20 22:25 "ok to all") -- HVAC v49.

Runs IN THE CONTAINER under the bench's python. Four phases, each explicit, in this order:

  export   the HVAC asset exported FROM THE DATABASE (`exporter.build_asset`); proves it equals v48 by content (items by
           uid, configs by id). NO database write.
  build    this slice's edits on that fresh export -- exactly those `frontend/.../adp3b.harness.ts` makes (the asset
           commit's test pins the two equal): B1 `face_w_mm` / `face_h_mm` become typed face boxes filled from the size as
           written (`typed_only`, `length_from: size_mm`, `face_side`, a label), their ids unchanged so every need,
           conversion, SKU match and pipeline that reads them is unchanged; D4 the depth axis retired (its number reader,
           its match attribute, its panel control and its never-shown panel note); the combined box's "width x height" note
           worded per box. NO catalogue item changes. The series file convention (items in global `item_uid` order,
           configs in v48's order, v48's top-level keys), validated offline (the config validator + the cross-category
           check), and the STUB PROOF: every item-list category's extraction request is identical on v48 and v49 (the
           model's question does not change -- that is ADP-5's). Writes the candidate. NO database write.
  load     pre-load HVAC snapshot, then `loader.load_rate_master(path=<candidate>, replace=True)`.
  verify   live HVAC == the candidate BY CONTENT; Electrical untouched (its own content hashes printed).

Usage (container, from frappe-bench): env/bin/python <this> <phase> [--candidate PATH] [--export PATH]
"""
import argparse, copy, hashlib, json, os

DATA = "/workspace/development/frappe-bench/apps/nirmaan_stack/nirmaan_stack/services/boq_rate_master/data"
V48 = os.path.join(DATA, "rate_master_hvac_all_v48.json")
FACE_NUMBERS = {
    "face_w_mm": {"from": ["face_w_mm"], "name": "width", "unit": "mm", "typed_only": True, "length_from": "size_mm",
                  "face_side": "width", "label": "Width (mm)"},
    "face_h_mm": {"from": ["face_h_mm"], "name": "height", "unit": "mm", "typed_only": True, "length_from": "size_mm",
                  "face_side": "height", "label": "Height (mm)"},
}
PANEL_NOTES = {
    "face_w_mm": [{"text": "Type the width the BoQ states, in mm."}],
    "face_h_mm": [{"text": "Type the height the BoQ states, in mm."}],
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
    v48 = json.load(open(V48, encoding="utf-8"))
    e_items = {i["item_uid"]: i for i in payload["items"]}
    v_items = {i["item_uid"]: i for i in v48["items"]}
    missing = sorted(set(v_items) - set(e_items)); extra = sorted(set(e_items) - set(v_items))
    differ = sorted(u for u in set(v_items) & set(e_items) if _canon(v_items[u]) != _canon(e_items[u]))
    e_cfg = {c["category_id"]: c for c in payload["category_configs"]}
    v_cfg = {c["category_id"]: c for c in v48["category_configs"]}
    cdiff = sorted(c for c in set(e_cfg) | set(v_cfg) if _canon(e_cfg.get(c)) != _canon(v_cfg.get(c)))
    print("export written", path, "| items", len(payload["items"]), "| configs", len(payload["category_configs"]))
    print("vs v48 by content: items missing", missing, "| extra", extra, "| differing", differ, "| configs differing", cdiff)
    if missing or extra or differ or cdiff:
        raise SystemExit("the export is not v48 by content -- STOP")
    frappe.destroy()


# ---------------------------------------------------------------------------------------------------------------
def apply_adp3b(payload):
    """The ADP-3b config edits, exactly those of `adp3b.harness.ts` (the asset commit's test pins the two equal)."""
    p = copy.deepcopy(payload)
    pr = next(c for c in p["category_configs"] if c["category_id"] == "hvac_adp")["list_spec"]["pricing"]
    # B1 -- the face's sides in their own typed boxes, filled from the size as written
    assert pr["numbers"]["face_w_mm"].get("component") == 1 and pr["numbers"]["face_h_mm"].get("component") == 2, "v48 face readers changed"
    pr["numbers"] = dict(pr["numbers"], **copy.deepcopy(FACE_NUMBERS))
    # D4 -- the depth axis retired: its reader, its match attribute, its panel control, its never-shown note
    del pr["numbers"]["depth_mm"]
    pr["match_attrs"] = [a for a in pr["match_attrs"] if a != "depth_mm"]
    pr["panel_controls"] = {k: v for k, v in pr["panel_controls"].items() if k != "depth_mm"}
    pr["panel_notes"] = dict(pr["panel_notes"], **copy.deepcopy(PANEL_NOTES))
    return p


def build(export_path, out):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import config_validation, extraction
    exported = json.load(open(export_path, encoding="utf-8"))
    v48 = json.load(open(V48, encoding="utf-8"))
    payload = apply_adp3b(exported)
    # the series file convention: items in global uid order, configs in v48's order, v48's top-level keys and their order
    payload["items"].sort(key=lambda i: i["item_uid"])
    order = [c["category_id"] for c in v48["category_configs"]]
    payload["category_configs"].sort(key=lambda c: order.index(c["category_id"]))
    final = {k: (payload[k] if k in payload else copy.deepcopy(v48[k])) for k in v48}
    final["intentional_removals"] = copy.deepcopy(v48["intentional_removals"])
    # offline validation
    stored = [dict(c, discipline=final["discipline"]) for c in final["category_configs"]]
    for c in stored:
        config_validation._validate_config(c)
    problems = config_validation.delegated_section_problems(stored, final["items"])
    if problems:
        raise SystemExit("cross-category check refuses: %r" % problems)
    # items: v49 carries v48's catalogue unchanged, by content
    a = {i["item_uid"]: _canon(i) for i in v48["items"]}; b = {i["item_uid"]: _canon(i) for i in final["items"]}
    assert a == b, "items differ from v48"

    # the STUB PROOF -- every item-list category's extraction request, rebuilt from v48 and from v49
    def requests(p):
        st = [dict(c, discipline=p["discipline"]) for c in p["category_configs"]]
        cfgs = {(p["discipline"], c["category_id"]): c for c in st}
        return {c["category_id"]: json.dumps(extraction.build_items_spec(cfgs[(p["discipline"], c["category_id"])], cfgs, p["discipline"]), sort_keys=True)
                for c in st if c.get("list_spec")}
    r48, r49 = requests(v48), requests(final)
    diff = sorted(k for k in set(r48) | set(r49) if r48.get(k) != r49.get(k))
    print("STUB PROOF: item-list requests v48 vs v49 -- identical:", sorted(k for k in r48 if r48[k] == r49.get(k)), "| differing:", diff)
    assert diff == [], diff
    cd = sorted(c["category_id"] for c, d in zip(v48["category_configs"], final["category_configs"]) if _canon(c) != _canon(d))
    print("configs changed vs v48:", cd)
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
    ap.add_argument("--export", default="/tmp/adp3b/v49_export.json")
    ap.add_argument("--candidate", default=os.path.join(DATA, "rate_master_hvac_all_v49.json"))
    a = ap.parse_args()
    if a.phase == "export":
        export(a.export)
    elif a.phase == "build":
        build(a.export, a.candidate)
    elif a.phase == "load":
        load(a.candidate)
    else:
        verify(a.candidate)
