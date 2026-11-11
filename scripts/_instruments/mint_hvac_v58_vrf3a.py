"""VRF-3a (2026-11-04) -- MINT HVAC v58 = v57 WITH THE OUTDOOR SPLIT, THE STATED SPLIT, SET / REFNET / LOT.

The v57 shape (`mint_hvac_v57_vrf2b.py`), built on v57. ONLY the `hvac_vrf` config changes; every item and every other
config is byte-identical to v57 (asserted). `calculator_only` stays (owner Q1 A: removed at VRF-4). The changes, all in
`list_spec.pricing` (plus the config's `notes`):

  1. R-SPLIT (b) / R-SPLIT-RULE / D-1 / D-8 (owner 2026-11-01 11:59 / 12:02 / 15:03): `compose` on the capacity ladder with
     `above_only` (never below the total), `cost_key` cost_supply (the cheapest of the equal splits), `max_layers` 6 and a
     `tolerance` of the largest outdoor size on the sheet (so the fewest-units split is always in reach); `split` on the
     Outdoor Unit only -- the helper's split into separate lines (DUCTABLE "no splitting": every other family refuses).
  2. R-SPLIT (a) / SHAPE Q2 / D-2 / D-3: `split.stated` (a split the row writes = one line per module) and
     `split.conditions` (the condition words quoted in an amber note).
  3. SET (owner 17:00 / 17:37 / 17:39 / 18:49): "Set" / "Sets" join the count class; `per_set` (the bar, "Pieces in one Set
     of this row") with `counted` for the refnet (expected = (ODU - 1) + (IDU - 1), +-10% or +-1, rounded up with a note).
  4. LOT (owner "Refuse + review list"): `lot_units` -- Lot, LS, Job, per HP, "complete system" refuse with the red bar.
     The unit refusal names Set ("per Nos, per Set or per Kg").

Runs IN THE CONTAINER under the bench's python. Four phases, in this order:
  export   the HVAC asset exported FROM THE DATABASE, proved = v57 by content. NO database write.
  build    v57 (the committed file; its re-dump must reproduce its bytes) -> the candidate. NO database write.
  load     pre-load HVAC snapshot, then `loader.load_rate_master(path=<candidate>, replace=True)`.
  verify   live HVAC == the candidate BY CONTENT; Electrical's hashes printed.

Usage (container, from frappe-bench): env/bin/python <this> <phase> [--export P] [--candidate P]
"""
import argparse, copy, hashlib, json, os, re

DATA = "/workspace/development/frappe-bench/apps/nirmaan_stack/nirmaan_stack/services/boq_rate_master/data"
V57 = os.path.join(DATA, "rate_master_hvac_all_v57.json")
V58 = os.path.join(DATA, "rate_master_hvac_all_v58.json")

CATEGORY_ID = "hvac_vrf"
VRF_KIND = "hvac_vrf_item"
SPLIT_FAMILIES = ["Outdoor Unit"]
MAX_LAYERS = 6
CONDITIONS = {
    "words": [
        r"at least\s+\d+(?:\.\d+)?\s*(?:hp|tr)\s*each",
        r"single\s+module",
        r"single\s+odu",
        r"(?:module selection\s+)?as per site conditions?",
    ],
    "line": "The row says \"{said}\": the helper split it by the team rule anyway (fewest units, then the cheapest) - check this is what the row asks for.",
}
SET_UNITS = ["Set", "Sets"]
PER_SET = {
    "units": list(SET_UNITS),
    "qty_label": "Pieces in one Set of this row",
    "bar": {"title": "PRICED PER SET - CHECK WHAT ONE SET HOLDS.",
            "line": "The BoQ prices this row per Set. The helper took one Set = 1 {item} (team rule: 1 Set = 1 piece). If the Set holds more, change \"Pieces in one Set\" below."},
    "counted": {
        "families": ["Refnet/Y-Joint"],
        "covers": {"id": "set_covers", "label": "This row covers *", "note": "Which refnets the row buys: both sides of the system, or one side only.",
                   "options": [{"value": "Whole system (indoor + outdoor)", "sides": ["outdoor", "indoor"]},
                               {"value": "Outdoor side only", "sides": ["outdoor"]},
                               {"value": "Indoor side only", "sides": ["indoor"]}]},
        "counts": [{"side": "outdoor", "id": "set_odu", "label": "Outdoor units in this system *", "word": "outdoor", "note": "Outdoor refnets = outdoor units - 1."},
                   {"side": "indoor", "id": "set_idu", "label": "Indoor units in this system *", "word": "indoor", "note": "Indoor refnets = indoor units - 1."}],
        "tolerance": {"share": 0.1, "min": 1},
        "bar": "REFNETS PRICED PER SET - CHECK THE COUNT.",
        "lines": {
            "formula": "Refnets expected: {parts} = {E}",
            "match": "The BoQ quantity ({q}) is within +-{W} of the {E} refnets expected: 1 piece in one Set.",
            "below": "The BoQ quantity ({q}) is below the {E} refnets expected: {p} pieces in one Set ({q} Sets x {p} = {E}).",
            "rounded": "ROUNDED UP to {p} pieces in one Set. {q} Sets x {p} = {n} pieces, {k} more than the {E} expected - check.",
            "misfit": "The BoQ quantity ({q}) does not fit the {E} refnets expected - not priced: type the pieces in one Set.",
            "counts_missing": "Not priced: say what the row covers and how many outdoor and indoor units the system has - or type the pieces in one Set.",
            "qty_missing": "Not priced: type the BoQ quantity of this row - or type the pieces in one Set.",
            "typed": "You typed {p} pieces in one Set.",
        },
    },
}
LOT_UNITS = {
    "units": ["Lot", "complete system", "LS", "Job", "per HP"],
    "bar": "PRICED PER LOT - NOT PRICED. PRICE THIS ROW BY HAND.",
    "line": "Unit \"{unit}\" is not a VRF unit: VRF is priced per Nos, per Set or per Kg. What a Lot holds is read at VRF-4. Price this row by hand.",
}
UNIT_REFUSAL = "unit '{unit}' is not a VRF unit - VRF is priced per Nos, per Set or per Kg - price this row by hand"
CHANGED_KEYS = ["list_spec", "notes"]
CHANGED_PRICING_KEYS = ["compose", "lot_units", "per_set", "split", "unit_classes", "unit_refusal"]


def _connect():
    os.chdir("/workspace/development/frappe-bench/sites")
    import frappe
    frappe.init(site="localhost"); frappe.connect()
    return frappe


def _canon(o):
    return json.dumps(o, sort_keys=True, separators=(",", ":"), default=str)


def _dump(p):
    return json.dumps(p, indent=1, ensure_ascii=False) + "\n"


def largest_outdoor(items):
    """The largest Outdoor Unit size on the sheet, any brand / variant (the compose tolerance: the fewest-units split of
    any total is at most one largest unit above it, so it is always in reach)."""
    caps = [i["attributes"]["capacity"] for i in items
            if i["kind"] == VRF_KIND and i["attributes"].get("item") in SPLIT_FAMILIES and isinstance(i["attributes"].get("capacity"), (int, float))]
    return max(caps)


def vrf3a_config(v57_cfg, items):
    """v57's hvac_vrf config + the VRF-3a keys. Definitions, kinds, pipelines and calculator_only untouched."""
    c = copy.deepcopy(v57_cfg)
    c["notes"] = (c["notes"] + " VRF-3a (owner, 2026-11-04): an Outdoor Unit above the largest size of its brand and variant is "
                  "split by the helper into separate lines (the fewest units, adding up exactly, else the smallest total above, "
                  "then the cheapest; each line the row's brand and variant; an edit never re-splits); a split the row writes "
                  "is one line per module (a module above the largest refuses); a condition the row states is quoted; an "
                  "airflow range is one airflow; 'Set' prices one piece per Set with a bar (a refnet's pieces come from the "
                  "system's unit counts); Lot, LS, Job, per HP and 'complete system' refuse with a bar. calculator_only stays "
                  "until VRF-4.")
    pr = c["list_spec"]["pricing"]
    pr["compose"] = {"attr": "capacity", "tolerance": largest_outdoor(items), "max_layers": MAX_LAYERS, "cost_key": "cost_supply", "above_only": True}
    pr["split"] = {"families": list(SPLIT_FAMILIES), "stated": True, "conditions": copy.deepcopy(CONDITIONS)}
    pr["unit_classes"]["count"] = list(pr["unit_classes"]["count"]) + list(SET_UNITS)
    pr["per_set"] = copy.deepcopy(PER_SET)
    pr["lot_units"] = copy.deepcopy(LOT_UNITS)
    pr["unit_refusal"] = UNIT_REFUSAL
    return c


# ---------------------------------------------------------------------------------------------------------------
def export(path):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import exporter
    payload = exporter.build_asset("HVAC")
    open(path, "w", encoding="utf-8", newline="").write(exporter.serialize_asset(payload))
    v57 = json.load(open(V57, encoding="utf-8"))
    e_items = {i["item_uid"]: i for i in payload["items"]}
    v_items = {i["item_uid"]: i for i in v57["items"]}
    missing = sorted(set(v_items) - set(e_items)); extra = sorted(set(e_items) - set(v_items))
    differ = sorted(u for u in set(v_items) & set(e_items) if _canon(v_items[u]) != _canon(e_items[u]))
    e_cfg = {c["category_id"]: c for c in payload["category_configs"]}
    v_cfg = {c["category_id"]: c for c in v57["category_configs"]}
    cdiff = sorted(c for c in set(e_cfg) | set(v_cfg) if _canon(e_cfg.get(c)) != _canon(v_cfg.get(c)))
    print("export written", path, "| items", len(payload["items"]), "| configs", len(payload["category_configs"]))
    print("vs v57 by content: items missing", missing, "| extra", extra, "| differing", differ, "| configs differing", cdiff)
    if missing or extra or differ or cdiff:
        raise SystemExit("the export is not v57 by content -- STOP")
    frappe.destroy()


def build(out):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import config_validation, extraction
    from nirmaan_stack.services.boq_rate_master.loader import _validate_items, _validate_one_config
    raw = open(V57, "rb").read()
    v57 = json.loads(raw.decode("utf-8"))
    if _dump(v57).encode("utf-8") != raw:
        raise SystemExit("re-dumping v57 does not reproduce its bytes -- the series convention is not what this mint writes")

    final = copy.deepcopy(v57)
    idx = next(n for n, c in enumerate(v57["category_configs"]) if c["category_id"] == CATEGORY_ID)
    final["category_configs"][idx] = vrf3a_config(v57["category_configs"][idx], v57["items"])
    # ONLY the hvac_vrf config: every item and every other config byte-identical, in v57's order, v57's top-level keys
    assert [_canon(i) for i in final["items"]] == [_canon(i) for i in v57["items"]]
    for n, (a, b) in enumerate(zip(v57["category_configs"], final["category_configs"])):
        assert a["category_id"] == b["category_id"]
        if n != idx:
            assert _canon(a) == _canon(b), a["category_id"]
    old, new = v57["category_configs"][idx], final["category_configs"][idx]
    changed = sorted(k for k in set(old) | set(new) if _canon(old.get(k)) != _canon(new.get(k)))
    assert changed == CHANGED_KEYS, changed
    po, pn = old["list_spec"]["pricing"], new["list_spec"]["pricing"]
    pchanged = sorted(k for k in set(po) | set(pn) if _canon(po.get(k)) != _canon(pn.get(k)))
    assert pchanged == CHANGED_PRICING_KEYS, pchanged
    lso = {k: v for k, v in old["list_spec"].items() if k != "pricing"}
    lsn = {k: v for k, v in new["list_spec"].items() if k != "pricing"}
    assert _canon(lso) == _canon(lsn), "list_spec outside pricing changed"
    assert new.get("calculator_only") is True
    assert list(final.keys()) == list(v57.keys())
    print("compose:", json.dumps(pn["compose"]), "| largest outdoor size on the sheet:", largest_outdoor(v57["items"]))

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
    stored57 = [dict(c, discipline=v57["discipline"]) for c in v57["category_configs"]]
    cfgs57 = {(v57["discipline"], c["category_id"]): c for c in stored57}
    eligible57 = sorted(c["category_id"] for c in stored57 if extraction.config_is_eligible(c, cfgs57))
    assert eligible == eligible57, (eligible, eligible57)

    def requests(st, cf):
        return {c["category_id"]: json.dumps(extraction.build_items_spec(cf[("HVAC", c["category_id"])], cf, "HVAC"), sort_keys=True)
                for c in st if c.get("list_spec") and c["category_id"] != CATEGORY_ID}
    r57, r58 = requests(stored57, cfgs57), requests(stored, cfgs)
    diff = sorted(k for k in set(r57) | set(r58) if r57.get(k) != r58.get(k))
    print("STUB PROOF: item-list requests v57 vs v58 (hvac_vrf aside, never sent) -- identical:", sorted(k for k in r57 if r57[k] == r58.get(k)), "| differing:", diff)
    assert diff == [], diff
    print("eligible configs v57 = v58:", eligible)
    # the new keys live on hvac_vrf only
    readers = sorted(c["category_id"] for c in stored if c["category_id"] != CATEGORY_ID
                     and any(k in ((c.get("list_spec") or {}).get("pricing") or {}) for k in ("split", "per_set", "lot_units")))
    print("other configs declaring split / per_set / lot_units:", readers)
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
    ap.add_argument("--export", default="/tmp/vrf3a/v58_export.json")
    ap.add_argument("--candidate", default=V58)
    a = ap.parse_args()
    if a.phase == "export":
        export(a.export)
    elif a.phase == "build":
        build(a.candidate)
    elif a.phase == "load":
        load(a.candidate)
    else:
        verify(a.candidate)
