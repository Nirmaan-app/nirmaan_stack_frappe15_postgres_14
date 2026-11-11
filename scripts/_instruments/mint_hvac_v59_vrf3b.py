"""VRF-3b (2026-11-05) -- MINT HVAC v59 = v58 WITH THE EXTRAS A VRF UNIT'S PRICE INCLUDES AND THEIR PRICING INPUTS.

The v58 shape (`mint_hvac_v58_vrf3a.py`), built on v58. ONLY two things change; every other item and every other config is
byte-identical to v58 (asserted). `calculator_only` stays (owner Q1 A: removed at VRF-4).

  1. `hvac_vrf` (owner O-5 / O-6 / B / SHEETS 2026-11-03; 2026-11-05 11:30-14:56, boards 12-15):
       `list_spec.pricing.extras` -- copper (Piping), insulation (Insulation) and power / communication cable (Electrical,
       read only) as own lines per Nos under each indoor / outdoor unit, banded on the unit's capacity after conversion,
       from the Pricing Inputs; the calculator's include switches; the board's words.
       `impact_examples` -- six worked examples (VRF-5 .. VRF-10) so each new input's panel shows "now -> becomes"; each
       carries `includes` (the four switches) and names the inputs it shows on.
       `notes` -- one sentence appended.
  2. The HVAC Pricing Inputs: 29 NEW single-factor items (one per table cell: 5 pipe bands x supply / return / insulation,
     5 power bands + the communication cable x cores / size, 2 lengths), each `item_uid` minted through
     `csv_importer.mint_item_uid` (the ONE mint). No existing item changes. The hvac_pricing_inputs config is unchanged.

The extras block, the examples and the 29 inputs are read from the ONE fixture the frontend tests share
(`frontend/src/pages/pricing/__fixtures__/vrf3bExtras.json`); test_vrf_v59 proves the asset equals it.

Runs IN THE CONTAINER under the bench's python. Four phases, in this order:
  export   the HVAC asset exported FROM THE DATABASE, proved = v58 by content. NO database write.
  build    v58 (the committed file; its re-dump must reproduce its bytes) -> the candidate. NO database write.
  load     pre-load HVAC snapshot, then `loader.load_rate_master(path=<candidate>, replace=True)`.
  verify   live HVAC == the candidate BY CONTENT; Electrical's hashes printed.

Usage (container, from frappe-bench): env/bin/python -I <this> <phase> [--export P] [--candidate P]
"""
import argparse, copy, hashlib, json, os, re

APP = "/workspace/development/frappe-bench/apps/nirmaan_stack"
DATA = os.path.join(APP, "nirmaan_stack/services/boq_rate_master/data")
V58 = os.path.join(DATA, "rate_master_hvac_all_v58.json")
V59 = os.path.join(DATA, "rate_master_hvac_all_v59.json")
FIXTURE = os.path.join(APP, "frontend/src/pages/pricing/__fixtures__/vrf3bExtras.json")

CATEGORY_ID = "hvac_vrf"
INPUT_KIND = "hvac_pricing_input"
CHANGED_KEYS = ["impact_examples", "list_spec", "notes"]
CHANGED_PRICING_KEYS = ["extras"]
NOTE = (" VRF-3b (owner, 2026-11-05): a unit's price can include its copper (Piping), insulation (Insulation) and power / "
        "communication cable (Electrical, read only), each its own line per Nos under each indoor / outdoor unit, sized "
        "from the Pricing Inputs by the unit's capacity, removable, held when a size is missing; Lot is offered in the "
        "calculator's Row unit. calculator_only stays until VRF-4.")


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
    assert set(fx) >= {"extras", "inputs", "examples"}, sorted(fx)
    assert len(fx["inputs"]) == 29 and all(set(i["rates"]) == {"factor"} and i["kind"] == INPUT_KIND for i in fx["inputs"])
    return fx


def vrf3b_config(v58_cfg, fx):
    c = copy.deepcopy(v58_cfg)
    c["notes"] = c["notes"] + NOTE
    c["list_spec"]["pricing"]["extras"] = copy.deepcopy(fx["extras"])
    c["impact_examples"] = list(c["impact_examples"]) + copy.deepcopy(fx["examples"])
    return c


# ---------------------------------------------------------------------------------------------------------------
def export(path):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import exporter
    payload = exporter.build_asset("HVAC")
    open(path, "w", encoding="utf-8", newline="").write(exporter.serialize_asset(payload))
    v58 = json.load(open(V58, encoding="utf-8"))
    e_items = {i["item_uid"]: i for i in payload["items"]}
    v_items = {i["item_uid"]: i for i in v58["items"]}
    missing = sorted(set(v_items) - set(e_items)); extra = sorted(set(e_items) - set(v_items))
    differ = sorted(u for u in set(v_items) & set(e_items) if _canon(v_items[u]) != _canon(e_items[u]))
    e_cfg = {c["category_id"]: c for c in payload["category_configs"]}
    v_cfg = {c["category_id"]: c for c in v58["category_configs"]}
    cdiff = sorted(c for c in set(e_cfg) | set(v_cfg) if _canon(e_cfg.get(c)) != _canon(v_cfg.get(c)))
    print("export written", path, "| items", len(payload["items"]), "| configs", len(payload["category_configs"]))
    print("vs v58 by content: items missing", missing, "| extra", extra, "| differing", differ, "| configs differing", cdiff)
    if missing or extra or differ or cdiff:
        raise SystemExit("the export is not v58 by content -- STOP")
    frappe.destroy()


def build(out):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import config_validation, csv_importer, extraction
    from nirmaan_stack.services.boq_rate_master.loader import _validate_items, _validate_one_config
    raw = open(V58, "rb").read()
    v58 = json.loads(raw.decode("utf-8"))
    if _dump(v58).encode("utf-8") != raw:
        raise SystemExit("re-dumping v58 does not reproduce its bytes -- the series convention is not what this mint writes")
    fx = fixture()

    final = copy.deepcopy(v58)
    idx = next(n for n, c in enumerate(v58["category_configs"]) if c["category_id"] == CATEGORY_ID)
    final["category_configs"][idx] = vrf3b_config(v58["category_configs"][idx], fx)
    # the 29 inputs, each through the ONE mint; no existing input id is reused
    existing_ids = {i["attributes"].get("item") for i in v58["items"] if i["kind"] == INPUT_KIND}
    taken = {i["item_uid"] for i in v58["items"]}
    for it in fx["inputs"]:
        assert it["attributes"]["item"] not in existing_ids, it["attributes"]["item"]
        uid = csv_importer.mint_item_uid("HVAC", taken)
        final["items"].append(dict(copy.deepcopy(it), source={"sheet": "Pricing Inputs", "row": 0}, item_uid=uid))
    final["items"].sort(key=lambda i: i["item_uid"])
    # ONLY the hvac_vrf config and 29 new items: every v58 item byte-identical, every other config byte-identical
    by_uid = {i["item_uid"]: i for i in final["items"]}
    for i in v58["items"]:
        assert _canon(by_uid[i["item_uid"]]) == _canon(i), i["item_uid"]
    new_items = [i for i in final["items"] if i["item_uid"] not in {x["item_uid"] for x in v58["items"]}]
    assert len(new_items) == 29 and all(i["kind"] == INPUT_KIND for i in new_items)
    for n, (a, b) in enumerate(zip(v58["category_configs"], final["category_configs"])):
        assert a["category_id"] == b["category_id"]
        if n != idx:
            assert _canon(a) == _canon(b), a["category_id"]
    old, new = v58["category_configs"][idx], final["category_configs"][idx]
    changed = sorted(k for k in set(old) | set(new) if _canon(old.get(k)) != _canon(new.get(k)))
    assert changed == CHANGED_KEYS, changed
    po, pn = old["list_spec"]["pricing"], new["list_spec"]["pricing"]
    pchanged = sorted(k for k in set(po) | set(pn) if _canon(po.get(k)) != _canon(pn.get(k)))
    assert pchanged == CHANGED_PRICING_KEYS, pchanged
    assert _canon({k: v for k, v in old["list_spec"].items() if k != "pricing"}) == _canon({k: v for k, v in new["list_spec"].items() if k != "pricing"})
    assert new["impact_examples"][:len(old["impact_examples"])] == old["impact_examples"]
    assert new.get("calculator_only") is True
    assert list(final.keys()) == list(v58.keys())

    _validate_items(final["items"])
    stored = [dict(c, discipline=final["discipline"]) for c in final["category_configs"]]
    for n, c in enumerate(stored):
        _validate_one_config(c, "category_configs[%d]" % n)
        config_validation._validate_config(c)
    problems = config_validation.delegated_section_problems(stored, final["items"]) + config_validation.extras_problems(stored, final["items"])
    if problems:
        raise SystemExit("cross-category check refuses: %r" % problems)
    ids = config_validation.extras_input_ids(stored[idx])
    assert sorted(ids) == sorted(i["attributes"]["item"] for i in new_items), "the extras read exactly the 29 new inputs"
    cfgs = {(final["discipline"], c["category_id"]): c for c in stored}
    vrf = cfgs[("HVAC", CATEGORY_ID)]
    if not extraction.has_runnable_pricing_rules(vrf):
        raise SystemExit("hvac_vrf's rules do not run")
    if extraction.config_is_eligible(vrf, cfgs):
        raise SystemExit("hvac_vrf would be ELIGIBLE for extraction -- calculator_only must keep it out (Q1 A)")
    eligible = sorted(c["category_id"] for c in stored if extraction.config_is_eligible(c, cfgs))
    stored58 = [dict(c, discipline=v58["discipline"]) for c in v58["category_configs"]]
    cfgs58 = {(v58["discipline"], c["category_id"]): c for c in stored58}
    eligible58 = sorted(c["category_id"] for c in stored58 if extraction.config_is_eligible(c, cfgs58))
    assert eligible == eligible58, (eligible, eligible58)

    def requests(st, cf):
        return {c["category_id"]: json.dumps(extraction.build_items_spec(cf[("HVAC", c["category_id"])], cf, "HVAC"), sort_keys=True)
                for c in st if c.get("list_spec") and c["category_id"] != CATEGORY_ID}
    r58, r59 = requests(stored58, cfgs58), requests(stored, cfgs)
    diff = sorted(k for k in set(r58) | set(r59) if r58.get(k) != r59.get(k))
    print("STUB PROOF: item-list requests v58 vs v59 (hvac_vrf aside, never sent) -- identical:", sorted(k for k in r58 if r58[k] == r59.get(k)), "| differing:", diff)
    assert diff == [], diff
    print("eligible configs v58 = v59:", eligible)
    readers = sorted(c["category_id"] for c in stored if c["category_id"] != CATEGORY_ID and "extras" in ((c.get("list_spec") or {}).get("pricing") or {}))
    print("other configs declaring extras:", readers)
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
            nin = {u: L[u] for u in L if L[u]["kind"] != INPUT_KIND}
            out[disc]["non_input_items"] = [len(nin), hashlib.sha256("".join(u + _canon(nin[u]) for u in sorted(nin)).encode()).hexdigest()[:16]]
            out[disc]["inputs"] = sum(1 for u in L if L[u]["kind"] == INPUT_KIND)
            out[disc]["vrf_calculator_only"] = LC.get(CATEGORY_ID, {}).get("calculator_only")
    print(json.dumps(out, indent=1, sort_keys=True))
    frappe.destroy()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("phase", choices=["export", "build", "load", "verify"])
    ap.add_argument("--export", default="/tmp/vrf3b/v59_export.json")
    ap.add_argument("--candidate", default=V59)
    a = ap.parse_args()
    if a.phase == "export":
        export(a.export)
    elif a.phase == "build":
        build(a.candidate)
    elif a.phase == "load":
        load(a.candidate)
    else:
        verify(a.candidate)
