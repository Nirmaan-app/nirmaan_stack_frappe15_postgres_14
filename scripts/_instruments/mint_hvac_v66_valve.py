"""VP-1 (2026-11-13) -- MINT HVAC v66 = v65 + THE VALVE PACKAGE (124 SKUs from the owner's ruled valve sheet, the scope pick,
N2 / N4, G4 / G7) + THE BORROW-ONLY MISC CATEGORY (12 SKUs, G5 / G12) + THE 'Valve - installation-only uplift' PRICING INPUT
(50%, owner QR-2 Q1 (a)) + THE PIPING N5 NOTE ENTRY (`sheet_heading_notes`, display only).

Every addition is read from the ONE fixture the frontend tests share (`frontend/src/pages/pricing/__fixtures__/valveModel.json`);
test_valve_v66 proves the asset equals it. Every v65 item and every v65 config is byte-identical, except `hvac_piping`, whose
`list_spec.pricing` gains `sheet_heading_notes` and nothing else (asserted). VRF's uplift input is already named
'VRF - installation-only uplift' in v65 (VP-1 P0): nothing of VRF changes. `second_opinion` is FALSE on both new configs
(owner 2026-11-09 18:52, the standing rule).

Runs IN THE CONTAINER under the bench's python. Four phases, in this order:
  export   the HVAC asset exported FROM THE DATABASE, proved = v65 by content. NO database write.
  build    v65 (the committed file; its re-dump must reproduce its bytes) -> the candidate. NO database write.
  load     pre-load HVAC snapshot, then `loader.load_rate_master(path=<candidate>, replace=True)`.
  verify   live HVAC == the candidate BY CONTENT; Electrical's hashes printed.

Usage (container, from frappe-bench): env/bin/python -I <this> <phase> [--export P] [--candidate P]
"""
import argparse, copy, hashlib, json, os, re

APP = "/workspace/development/frappe-bench/apps/nirmaan_stack"
DATA = os.path.join(APP, "nirmaan_stack/services/boq_rate_master/data")
V65 = os.path.join(DATA, "rate_master_hvac_all_v65.json")
V66 = os.path.join(DATA, "rate_master_hvac_all_v66.json")
FIXTURE = os.path.join(APP, "frontend/src/pages/pricing/__fixtures__/valveModel.json")

VALVE, MISC, PIPING = "hvac_valve_package", "hvac_misc", "hvac_piping"
FIXTURE_KEYS = {"valve_config", "misc_config", "valve_items", "misc_items", "pricing_input", "piping_sheet_heading_notes"}
ITEM_KEYS = ["kind", "brand", "unit", "attributes", "rates", "source", "item_uid"]


def _connect():
    os.chdir("/workspace/development/frappe-bench/sites")
    import frappe
    frappe.init(site="localhost"); frappe.connect()
    return frappe


def _canon(o):
    return json.dumps(o, sort_keys=True, separators=(",", ":"), default=str)


def _dump(p):
    return json.dumps(p, indent=1, ensure_ascii=False) + "\n"


def fixture():
    fx = json.load(open(FIXTURE, encoding="utf-8"))
    assert set(fx) - {"_about"} == FIXTURE_KEYS, sorted(set(fx) ^ FIXTURE_KEYS)
    assert len(fx["valve_items"]) == 124 and len(fx["misc_items"]) == 12, (len(fx["valve_items"]), len(fx["misc_items"]))
    for c in (fx["valve_config"], fx["misc_config"]):
        assert c["list_spec"].get("second_opinion") is False, c["category_id"]
    return fx


def new_items(fx, taken):
    """The fixture's 137 additions as asset items (`_boq` dropped), each with a uid from THE ONE mint, unique against v65 and every
    HVAC row in the database (`taken`)."""
    from nirmaan_stack.services.boq_rate_master import csv_importer
    out = []
    for it in fx["valve_items"] + fx["misc_items"] + [fx["pricing_input"]]:
        body = {k: copy.deepcopy(it[k]) for k in ITEM_KEYS if k != "item_uid"}
        body["item_uid"] = csv_importer.mint_item_uid("HVAC", taken)
        taken.add(body["item_uid"])
        out.append({k: body[k] for k in ITEM_KEYS})
    return out


def piping_config(v65_cfg, fx):
    c = copy.deepcopy(v65_cfg)
    c["list_spec"]["pricing"]["sheet_heading_notes"] = copy.deepcopy(fx["piping_sheet_heading_notes"])
    return c


# ---------------------------------------------------------------------------------------------------------------
def export(path):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import exporter
    payload = exporter.build_asset("HVAC")
    open(path, "w", encoding="utf-8", newline="").write(exporter.serialize_asset(payload))
    prev = json.load(open(V65, encoding="utf-8"))
    e_items = {i["item_uid"]: i for i in payload["items"]}
    v_items = {i["item_uid"]: i for i in prev["items"]}
    missing = sorted(set(v_items) - set(e_items)); extra = sorted(set(e_items) - set(v_items))
    differ = sorted(u for u in set(v_items) & set(e_items) if _canon(v_items[u]) != _canon(e_items[u]))
    e_cfg = {c["category_id"]: c for c in payload["category_configs"]}
    v_cfg = {c["category_id"]: c for c in prev["category_configs"]}
    cdiff = sorted(c for c in set(e_cfg) | set(v_cfg) if _canon(e_cfg.get(c)) != _canon(v_cfg.get(c)))
    print("export written", path, "| items", len(payload["items"]), "| configs", len(payload["category_configs"]))
    print("vs v65 by content: items missing", missing, "| extra", extra, "| differing", differ, "| configs differing", cdiff)
    if missing or extra or differ or cdiff:
        raise SystemExit("the export is not v65 by content -- STOP")
    frappe.destroy()


def build(out):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import config_validation, extraction
    from nirmaan_stack.services.boq_rate_master.loader import _validate_items, _validate_one_config
    raw = open(V65, "rb").read()
    prev = json.loads(raw.decode("utf-8"))
    if _dump(prev).encode("utf-8") != raw:
        raise SystemExit("re-dumping v65 does not reproduce its bytes -- the series convention is not what this mint writes")
    fx = fixture()
    taken = {i["item_uid"] for i in prev["items"]}
    taken |= {(r["item_uid"] or "").strip() for r in frappe.get_all("BoQ Rate Master Item", filters={"discipline": "HVAC"}, fields=["item_uid"])}
    added = new_items(fx, taken)
    final = copy.deepcopy(prev)
    final["items"] = sorted(prev["items"] + added, key=lambda i: i["item_uid"])
    pidx = next(n for n, c in enumerate(prev["category_configs"]) if c["category_id"] == PIPING)
    final["category_configs"][pidx] = piping_config(prev["category_configs"][pidx], fx)
    final["category_configs"] = final["category_configs"] + [copy.deepcopy(fx["valve_config"]), copy.deepcopy(fx["misc_config"])]
    # every v65 item byte-identical; exactly the 137 additions
    a = {i["item_uid"]: _canon(i) for i in prev["items"]}
    b = {i["item_uid"]: _canon(i) for i in final["items"]}
    assert all(b.get(u) == s for u, s in a.items()), "a v65 item moved"
    assert len(b) == len(a) + 137 and len({i["item_uid"] for i in added}) == 137
    # every v65 config byte-identical but Piping, which gains ONLY pricing.sheet_heading_notes
    for n, (x, y) in enumerate(zip(prev["category_configs"], final["category_configs"])):
        assert x["category_id"] == y["category_id"]
        if n != pidx:
            assert _canon(x) == _canon(y), x["category_id"]
    po, pn = prev["category_configs"][pidx], final["category_configs"][pidx]
    assert sorted(k for k in set(po) | set(pn) if _canon(po.get(k)) != _canon(pn.get(k))) == ["list_spec"]
    assert sorted(k for k in set(po["list_spec"]) | set(pn["list_spec"]) if _canon(po["list_spec"].get(k)) != _canon(pn["list_spec"].get(k))) == ["pricing"]
    pp, pq = po["list_spec"]["pricing"], pn["list_spec"]["pricing"]
    assert sorted(k for k in set(pp) | set(pq) if _canon(pp.get(k)) != _canon(pq.get(k))) == ["sheet_heading_notes"]
    assert [c["category_id"] for c in final["category_configs"]][-2:] == [VALVE, MISC]
    assert list(final.keys()) == list(prev.keys())
    # VRF's uplift input is already named for VRF (VP-1 P0): unchanged
    vrf_in = [i for i in final["items"] if (i.get("attributes") or {}).get("item") == "vrf_install_only_uplift"]
    assert len(vrf_in) == 1 and vrf_in[0]["attributes"]["name"] == "VRF - installation-only uplift"

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
        raise SystemExit("hvac_misc must be BORROW-ONLY (not eligible on its own)")
    eligible = sorted(c["category_id"] for c in stored if extraction.config_is_eligible(c, cfgs))
    stored_base = [dict(c, discipline=prev["discipline"]) for c in prev["category_configs"]]
    cfgs_base = {(prev["discipline"], c["category_id"]): c for c in stored_base}
    eligible_base = sorted(c["category_id"] for c in stored_base if extraction.config_is_eligible(c, cfgs_base))
    assert eligible == sorted(eligible_base + [VALVE]), (eligible, eligible_base)
    spec = extraction.build_items_spec(valve, cfgs, "HVAC")
    assert spec.get("second_opinion") is False
    print("hvac_valve_package ITEMS_SPEC chars", len(json.dumps(spec, ensure_ascii=False)), "| questions", len(spec["attribute_definitions"]),
          "| misc section questions", len(((spec.get("sections") or [{}])[-1].get("items_spec") or {}).get("attribute_definitions") or []) if spec.get("sections") else "-")

    def requests(st, cf):
        return {c["category_id"]: json.dumps(extraction.build_items_spec(cf[("HVAC", c["category_id"])], cf, "HVAC"), sort_keys=True)
                for c in st if c.get("list_spec") and c["category_id"] not in (VALVE, MISC)}
    r_base, r_new = requests(stored_base, cfgs_base), requests(stored, cfgs)
    diff = sorted(k for k in set(r_base) | set(r_new) if r_base.get(k) != r_new.get(k))
    print("STUB PROOF: item-list requests v65 vs v66 (the two new aside) -- identical:", sorted(k for k in r_base if r_base[k] == r_new.get(k)), "| differing:", diff)
    assert diff == [], diff
    print("eligible configs v66 = v65 +", VALVE, ":", eligible)
    print("Pricing Inputs read by hvac_valve_package:", config_validation.extras_input_ids(valve))

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
            kinds = {}
            for v in L.values():
                kinds[v["kind"]] = kinds.get(v["kind"], 0) + 1
            out[disc]["per_kind"] = kinds
            out[disc]["second_opinion"] = {c: ((LC[c].get("list_spec") or {}).get("second_opinion")) for c in (VALVE, MISC) if c in LC}
    print(json.dumps(out, indent=1, sort_keys=True))
    frappe.destroy()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("phase", choices=["export", "build", "load", "verify"])
    ap.add_argument("--export", default="/tmp/vp1/v65_export.json")
    ap.add_argument("--candidate", default=V66)
    a = ap.parse_args()
    if a.phase == "export":
        export(a.export)
    elif a.phase == "build":
        build(a.candidate)
    elif a.phase == "load":
        load(a.candidate)
    else:
        verify(a.candidate)
