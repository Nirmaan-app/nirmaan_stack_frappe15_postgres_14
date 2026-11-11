"""VRF-5 (2026-11-06) -- MINT HVAC v61 = v60 + THE VRF-4 REVIEW'S FIXES: ACCESSORIES AS THE UNIT'S OWN LINES (+ THE OWN-ROW
SAFEGUARD), THE CABLE-WORDS DEFAULT, SIDE BELOW THE SMALLEST TOP UNIT, THE SEVERAL-MAKES RULE, SUPPLY-ONLY / INSTALLATION-ONLY
WITH ITS UPLIFT, THE PER-HP BAR TITLE, AND THE 13 PRICING INPUTS THEY READ.

The v60 shape (`mint_hvac_v60_vrf4.py`), built on v60. ONLY `hvac_vrf` changes among the configs, and the ONLY items added are
13 `hvac_pricing_input` rows; every other item and every other config is byte-identical to v60 (asserted). All owner-ruled:

  1. `list_spec.attribute_definitions` = v60's 20 questions + 33 (R1 r2 / ANSWER 4 (i)): per accessory (MS frame, gas charge,
     drain pump, remote, refnet, MCCB) its Yes / No; for EVERY extra (the four + the six) WHERE it is stated (Row / Heading /
     Note) and its wording (Price / Scope); per accessory its quantity as written; the row's scope (R4). The `item` question's
     note gains R1 ("answered on the unit, never a separate item unless the row is that item"), R3 (BACnet / BMS compatible
     central controller = Touch Screen), "a ducted indoor unit = Ductable", "a heading's inclusion applies to every unit row".
  2. `list_spec.pricing.extras`: `accessories` (R1, ANSWER 4 / 6: frame / gas / MCCB per outdoor unit by band, drain pump /
     remote / refnet per indoor unit; MCCB borrowed from Electrical's db_switchgear, 40A FP / 40A FP / 63A FP, an isolator as
     the default MCCB), `safeguard` (R1 SAFEGUARD; ANSWER 9: same sheet, HVAC categories), `folded`, `scope` (R4-R8, the 50%
     uplift input), `from_model.accessory_includes` / `scope`, and the F2 / accessory words in `lines`.
  3. `list_spec.pricing.defaults`: `discharge.below_smallest` (R2 "yes") and `brand.unlisted.several_rule` (R5, ANSWER 4 "2 ok").
  4. `list_spec.pricing.lot_units`: `bar_by_unit` ("per HP" -> "PRICED PER HP ..."), and the line without "read at VRF-4".
  5. Items: the 13 Pricing Inputs (ANSWER 4 / 5 / 6: "use these recommendations for now....also these should be part of
     pricing inputs"): VRF - installation-only uplift 0.5; MCCB 40 / 40 / 63 A; MS frame 30 / 45 / 60 Kg; gas 3 / 5 / 8 Kg;
     drain pump / remote / refnet 1 per indoor unit.
  6. `impact_examples`: 10 worked examples (two per new input) for the Pricing Inputs panels; `notes`: one sentence appended. `second_opinion` stays TRUE (open item: switch off before deploy).

Every VRF-5 key, question and input is read from the ONE fixture the frontend tests share
(`frontend/src/pages/pricing/__fixtures__/vrf5Model.json`); test_vrf_v61 proves the asset equals it.

Runs IN THE CONTAINER under the bench's python. Four phases, in this order:
  export   the HVAC asset exported FROM THE DATABASE, proved = v60 by content. NO database write.
  build    v60 (the committed file; its re-dump must reproduce its bytes) -> the candidate. NO database write.
  load     pre-load HVAC snapshot, then `loader.load_rate_master(path=<candidate>, replace=True)`.
  verify   live HVAC == the candidate BY CONTENT; Electrical's hashes printed.

Usage (container, from frappe-bench): env/bin/python -I <this> <phase> [--export P] [--candidate P]
"""
import argparse, copy, hashlib, json, os, re

APP = "/workspace/development/frappe-bench/apps/nirmaan_stack"
DATA = os.path.join(APP, "nirmaan_stack/services/boq_rate_master/data")
V60 = os.path.join(DATA, "rate_master_hvac_all_v60.json")
V61 = os.path.join(DATA, "rate_master_hvac_all_v61.json")
FIXTURE = os.path.join(APP, "frontend/src/pages/pricing/__fixtures__/vrf5Model.json")

CATEGORY_ID = "hvac_vrf"
INPUT_KIND = "hvac_pricing_input"
CHANGED_KEYS = ["impact_examples", "list_spec", "notes"]
CHANGED_PRICING_KEYS = ["defaults", "extras", "lot_units"]
NOTE = (" VRF-5 (owner, 2026-11-06): an accessory the BoQ says a unit's price includes (MS frame, gas charge, drain pump, remote, "
        "refnet, MCCB / isolator) is priced as the unit's own line -- the quantity from the BoQ, else the Pricing Inputs default -- "
        "and never blocks the unit; an inclusion only a heading or note states is added unless the same sheet quotes it on its own "
        "row, with a review note; a cable named without a size takes the default; an outdoor unit below the smallest Top unit "
        "defaults to Side; several makes -> Blue Star if stated, else the first stocked; supply only / installation only "
        "(the installation-only uplift is a Pricing Input). second_opinion stays ON for testing and must be switched off before deploy.")


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
    need = {"accessories", "safeguard", "folded", "scope", "extras_words", "defaults_add", "from_model_add", "questions_add",
            "item_note_add", "inputs", "impact_examples_add", "wording"}
    assert set(fx) - {"_about"} == need, sorted(fx)
    ids = [q["id"] for q in fx["questions_add"]]
    assert len(ids) == len(set(ids)) == 33, ids
    assert len(fx["inputs"]) == 13
    return fx


def input_item(p):
    """One Pricing Input row, the v60 shape (single `factor`; `shared_by` vrf; item_uid from the id, stable across mints)."""
    return {"kind": INPUT_KIND, "brand": None, "unit": p["unit"],
            "attributes": {"item": p["item"], "name": p["name"], "remarks": p["remarks"], "shared_by": "vrf"},
            "rates": {"factor": p["factor"]}, "source": {"sheet": "Pricing Inputs", "row": 0},
            "item_uid": "rmi-" + hashlib.sha256(("vrf5|" + p["item"]).encode()).hexdigest()[:12]}


def vrf5_config(v60_cfg, fx):
    c = copy.deepcopy(v60_cfg)
    c["notes"] = c["notes"] + NOTE
    c["impact_examples"] = copy.deepcopy(c["impact_examples"]) + copy.deepcopy(fx["impact_examples_add"])
    ls = c["list_spec"]
    qs = copy.deepcopy(ls["attribute_definitions"])
    item_q = next(q for q in qs if q["id"] == "item")
    item_q["note"] = item_q["note"] + fx["item_note_add"]
    ls["attribute_definitions"] = qs + copy.deepcopy(fx["questions_add"])
    pr = ls["pricing"]
    ex = pr["extras"]
    ex["accessories"] = copy.deepcopy(fx["accessories"])
    ex["safeguard"] = copy.deepcopy(fx["safeguard"])
    ex["folded"] = copy.deepcopy(fx["folded"])
    ex["scope"] = copy.deepcopy(fx["scope"])
    ex["lines"].update(copy.deepcopy(fx["extras_words"]))
    ex["from_model"].update(copy.deepcopy(fx["from_model_add"]))
    pr["defaults"]["discharge"].update(copy.deepcopy(fx["defaults_add"]["discharge"]))
    pr["defaults"]["brand"]["unlisted"].update(copy.deepcopy(fx["defaults_add"]["brand"]))
    pr["lot_units"]["bar_by_unit"] = copy.deepcopy(fx["wording"]["lot_bar_by_unit"])
    pr["lot_units"]["line"] = fx["wording"]["lot_line"]
    return c


# ---------------------------------------------------------------------------------------------------------------
def export(path):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import exporter
    payload = exporter.build_asset("HVAC")
    open(path, "w", encoding="utf-8", newline="").write(exporter.serialize_asset(payload))
    prev = json.load(open(V60, encoding="utf-8"))
    e_items = {i["item_uid"]: i for i in payload["items"]}
    v_items = {i["item_uid"]: i for i in prev["items"]}
    missing = sorted(set(v_items) - set(e_items)); extra = sorted(set(e_items) - set(v_items))
    differ = sorted(u for u in set(v_items) & set(e_items) if _canon(v_items[u]) != _canon(e_items[u]))
    e_cfg = {c["category_id"]: c for c in payload["category_configs"]}
    v_cfg = {c["category_id"]: c for c in prev["category_configs"]}
    cdiff = sorted(c for c in set(e_cfg) | set(v_cfg) if _canon(e_cfg.get(c)) != _canon(v_cfg.get(c)))
    print("export written", path, "| items", len(payload["items"]), "| configs", len(payload["category_configs"]))
    print("vs v60 by content: items missing", missing, "| extra", extra, "| differing", differ, "| configs differing", cdiff)
    if missing or extra or differ or cdiff:
        raise SystemExit("the export is not v60 by content -- STOP")
    frappe.destroy()


def build(out):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import config_validation, extraction
    from nirmaan_stack.services.boq_rate_master.loader import _validate_items, _validate_one_config
    raw = open(V60, "rb").read()
    prev = json.loads(raw.decode("utf-8"))
    if _dump(prev).encode("utf-8") != raw:
        raise SystemExit("re-dumping v60 does not reproduce its bytes -- the series convention is not what this mint writes")
    fx = fixture()
    final = copy.deepcopy(prev)
    idx = next(n for n, c in enumerate(prev["category_configs"]) if c["category_id"] == CATEGORY_ID)
    final["category_configs"][idx] = vrf5_config(prev["category_configs"][idx], fx)
    new_items = [input_item(p) for p in fx["inputs"]]
    have = {(i.get("attributes") or {}).get("item") for i in prev["items"]}
    assert not ({p["item"] for p in fx["inputs"]} & have), "an input id already exists"
    assert not ({i["item_uid"] for i in new_items} & {i["item_uid"] for i in prev["items"]})
    final["items"] = prev["items"] + new_items
    # ONLY the hvac_vrf config + the 13 inputs: every other item byte-identical, every other config byte-identical
    assert _canon(final["items"][: len(prev["items"])]) == _canon(prev["items"])
    for n, (a, b) in enumerate(zip(prev["category_configs"], final["category_configs"])):
        assert a["category_id"] == b["category_id"]
        if n != idx:
            assert _canon(a) == _canon(b), a["category_id"]
    old, new = prev["category_configs"][idx], final["category_configs"][idx]
    changed = sorted(k for k in set(old) | set(new) if _canon(old.get(k)) != _canon(new.get(k)))
    assert changed == CHANGED_KEYS, changed
    po, pn = old["list_spec"]["pricing"], new["list_spec"]["pricing"]
    pchanged = sorted(k for k in set(po) | set(pn) if _canon(po.get(k)) != _canon(pn.get(k)))
    assert pchanged == CHANGED_PRICING_KEYS, pchanged
    lchanged = sorted(k for k in set(old["list_spec"]) | set(new["list_spec"]) if _canon(old["list_spec"].get(k)) != _canon(new["list_spec"].get(k)))
    assert lchanged == ["attribute_definitions", "pricing"], lchanged
    assert new["list_spec"].get("second_opinion") is True
    assert list(final.keys()) == list(prev.keys())

    _validate_items(final["items"])
    stored = [dict(c, discipline=final["discipline"]) for c in final["category_configs"]]
    for n, c in enumerate(stored):
        _validate_one_config(c, "category_configs[%d]" % n)
        config_validation._validate_config(c)
    problems = config_validation.delegated_section_problems(stored, final["items"]) + config_validation.extras_problems(stored, final["items"])
    if problems:
        raise SystemExit("cross-category check refuses: %r" % problems)
    cfgs = {(final["discipline"], c["category_id"]): c for c in stored}
    vrf = cfgs[("HVAC", CATEGORY_ID)]
    if not extraction.has_runnable_pricing_rules(vrf) or not extraction.config_is_eligible(vrf, cfgs):
        raise SystemExit("hvac_vrf is not runnable / eligible")
    eligible = sorted(c["category_id"] for c in stored if extraction.config_is_eligible(c, cfgs))
    stored60 = [dict(c, discipline=prev["discipline"]) for c in prev["category_configs"]]
    cfgs60 = {(prev["discipline"], c["category_id"]): c for c in stored60}
    eligible60 = sorted(c["category_id"] for c in stored60 if extraction.config_is_eligible(c, cfgs60))
    assert eligible == eligible60 and CATEGORY_ID in eligible, (eligible, eligible60)
    spec = extraction.build_items_spec(vrf, cfgs, "HVAC")
    want = [q["id"] for q in vrf["list_spec"]["attribute_definitions"]]
    assert [a["id"] for a in spec["attribute_definitions"]] == want and len(want) == 53, len(want)
    assert spec.get("second_opinion") is True
    print("hvac_vrf ITEMS_SPEC chars:", len(json.dumps(spec, ensure_ascii=False)), "| questions", len(spec["attribute_definitions"]))

    def requests(st, cf):
        return {c["category_id"]: json.dumps(extraction.build_items_spec(cf[("HVAC", c["category_id"])], cf, "HVAC"), sort_keys=True)
                for c in st if c.get("list_spec") and c["category_id"] != CATEGORY_ID}
    r60, r61 = requests(stored60, cfgs60), requests(stored, cfgs)
    diff = sorted(k for k in set(r60) | set(r61) if r60.get(k) != r61.get(k))
    print("STUB PROOF: item-list requests v60 vs v61 (hvac_vrf aside, never sent) -- identical:", sorted(k for k in r60 if r60[k] == r61.get(k)), "| differing:", diff)
    assert diff == [], diff
    print("eligible configs v61 = v60:", eligible)
    readers = sorted(c["category_id"] for c in stored if c["category_id"] != CATEGORY_ID and any(k in ((c.get("list_spec") or {}).get("pricing") or {}) for k in ("extras", "working_standby")))
    assert readers == [], readers
    used = set(config_validation.extras_input_ids(vrf))
    assert {p["item"] for p in fx["inputs"]} <= used, sorted({p["item"] for p in fx["inputs"]} - used)
    print("the 13 new inputs are all read by hvac_vrf (extras_input_ids):", sorted(p["item"] for p in fx["inputs"]))

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
            out[disc]["vrf_second_opinion"] = (LC.get(CATEGORY_ID, {}).get("list_spec") or {}).get("second_opinion")
    print(json.dumps(out, indent=1, sort_keys=True))
    frappe.destroy()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("phase", choices=["export", "build", "load", "verify"])
    ap.add_argument("--export", default="/tmp/vrf5/v61_export.json")
    ap.add_argument("--candidate", default=V61)
    a = ap.parse_args()
    if a.phase == "export":
        export(a.export)
    elif a.phase == "build":
        build(a.candidate)
    elif a.phase == "load":
        load(a.candidate)
    else:
        verify(a.candidate)
