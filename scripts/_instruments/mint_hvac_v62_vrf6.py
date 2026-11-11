"""VRF-6 (2026-11-09) -- MINT HVAC v62 = v61 + THE VRF-5 REVIEW'S FIXES AND THE TEAM'S RULES: THE REMOTE'S TYPE, EVERY UNADDED EXTRA
SAID, THE OWN-ROW CHECK BY CATEGORY, SPLITS (WRITTEN "x 2NOS", A TOO-LARGE MODULE SPLIT, A CHEAPER PAIR BEFORE THE NEXT SIZE UP),
CABLE FACTS PER ITEM, ACCESSORIES FOLLOW THE UNIT'S MAKE, THE FRAME / STAND ITEM, GAS KG = HP, MCB + ELCB BY THE HP SCHEDULE, AND
THE OWNER'S READING RULES.

The v61 shape (`mint_hvac_v61_vrf5.py`), built on v61. ONLY `hvac_vrf` changes among the configs; the items change by exactly:
9 retired `hvac_pricing_input` rows out (the Kg frame / Kg gas / MCCB band defaults the team rule replaces), 14 new
`hvac_pricing_input` rows in, and ONE new `hvac_misc_item` ("MS frame / stand for ODU", Nos, BCS 4,000 / 0, supply markup 40%);
every other item and every other config is byte-identical to v61 (asserted). All owner-ruled (2026-11-08 / 09):

  1. `list_spec.attribute_definitions`: the same 53 questions; the `item` choices gain "MS frame / stand for ODU"; the notes of
     `item` (Q-pre 7 / 4, the frame per Nos, '6 .3 TR', drain-pump cabling), `remote_type` (asked for every unit that includes a
     remote; Q-pre 1), `way` (whenever a cassette's way is stated anywhere in the chain; 600 x 600 = compact), `includes_gas`
     (Q2: full / first / initial charge = Yes), `includes_mccb` (Q-pre 12: breakers / protection = Yes), `includes_power`
     (drain-pump cabling is not the power cable).
  2. `list_spec.pricing.extras`: `accessories` (frame per module on its own Nos item; gas kg = HP; MCB 4-pole + ELCB 300 mA
     4-pole found in Electrical's db_switchgear by attributes, rated by the 12-row HP schedule, next stocked rating up; the remote
     F1 precedence; F12 the unit's make; Q1 built-in drain pump), `from_model.accessory_includes`, `safeguard` (F4 category first,
     F3 lines, Q-pre 11 control wiring, Q7 note wins, Q-pre 13), `scope` (Q5 conflict, installation-only vs a supply row),
     `lines` (F11), `prepare` (Q6, Q-pre 4 / 5 / 7, the per-Nos frame, '6 .3TR'), `two_capacities`.
  3. `list_spec.pricing.split` (F8 / Q4): `stated_times`, `split_over_top`, `pair_first`, `many_line`.
  4. `list_spec.pricing.families`: "MS frame / stand for ODU" (the Misc pipelines, per Nos).
  5. `impact_examples`: VRF-11..16 (the retired inputs') replaced by twelve, one per schedule row; `notes`: one sentence.
  6. `list_spec.second_opinion` FALSE (owner 2026-11-09 18:52: the standing rule, every category, testing included).

Every VRF-6 key, question change and input is read from the ONE fixture the frontend tests share
(`frontend/src/pages/pricing/__fixtures__/vrf6Model.json`); test_vrf_v62 proves the asset equals it.

Runs IN THE CONTAINER under the bench's python. Four phases, in this order:
  export   the HVAC asset exported FROM THE DATABASE, proved = v61 by content. NO database write.
  build    v61 (the committed file; its re-dump must reproduce its bytes) -> the candidate. NO database write.
  load     pre-load HVAC snapshot, then `loader.load_rate_master(path=<candidate>, replace=True)`.
  verify   live HVAC == the candidate BY CONTENT; Electrical's hashes printed.

Usage (container, from frappe-bench): env/bin/python -I <this> <phase> [--export P] [--candidate P]
"""
import argparse, copy, hashlib, json, os, re

APP = "/workspace/development/frappe-bench/apps/nirmaan_stack"
DATA = os.path.join(APP, "nirmaan_stack/services/boq_rate_master/data")
V61 = os.path.join(DATA, "rate_master_hvac_all_v61.json")
V62 = os.path.join(DATA, "rate_master_hvac_all_v62.json")
FIXTURE = os.path.join(APP, "frontend/src/pages/pricing/__fixtures__/vrf6Model.json")

CATEGORY_ID = "hvac_vrf"
INPUT_KIND = "hvac_pricing_input"
MISC_KIND = "hvac_misc_item"
CHANGED_KEYS = ["impact_examples", "list_spec", "notes"]
CHANGED_PRICING_KEYS = ["extras", "families", "split"]
FIXTURE_KEYS = {"accessories", "accessory_includes", "safeguard_add", "own_row_add", "own_row_drop", "scope_add", "split_add", "lines_add",
                "prepare", "two_capacities", "families_add", "inputs", "retire_inputs", "new_items", "question_changes",
                "impact_examples_drop", "impact_examples_add", "notes_add", "second_opinion"}


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
    assert len(fx["inputs"]) == 14 and len(fx["retire_inputs"]) == 9 and len(fx["new_items"]) == 1
    return fx


def input_item(p):
    """One Pricing Input row, the v61 shape (single `factor`; `shared_by` vrf; item_uid from the id, stable across mints)."""
    return {"kind": INPUT_KIND, "brand": None, "unit": p["unit"],
            "attributes": {"item": p["item"], "name": p["name"], "remarks": p["remarks"], "shared_by": "vrf"},
            "rates": {"factor": float(p["factor"])}, "source": {"sheet": "Pricing Inputs", "row": 0},
            "item_uid": "rmi-" + hashlib.sha256(("vrf6|" + p["item"]).encode()).hexdigest()[:12]}


def misc_item(n):
    """The new Misc item, the v61 Misc shape (`source` the Misc sheet; item_uid from its name, stable across mints)."""
    return {"kind": n["kind"], "brand": None, "unit": n["unit"], "attributes": copy.deepcopy(n["attributes"]),
            "rates": {k: float(v) for k, v in n["rates"].items()}, "source": {"sheet": "Misc", "row": 0},
            "item_uid": "rmi-" + hashlib.sha256(("vrf6|" + n["attributes"]["item"]).encode()).hexdigest()[:12]}


def vrf6_config(v61_cfg, fx):
    c = copy.deepcopy(v61_cfg)
    p = c["list_spec"]["pricing"]
    x = p["extras"]
    x["accessories"] = copy.deepcopy(fx["accessories"])
    x["from_model"]["accessory_includes"] = copy.deepcopy(fx["accessory_includes"])
    sg = x["safeguard"]
    for k, v in fx["safeguard_add"].items():
        if k == "lines":
            sg["lines"].update(v)
        else:
            sg[k] = copy.deepcopy(v)
    for k in fx["own_row_drop"]:
        sg["own_row"].pop(k, None)
    for k, v in fx["own_row_add"].items():
        sg["own_row"].setdefault(k, {"words": []}).update(copy.deepcopy(v))
    x["scope"].update(copy.deepcopy(fx["scope_add"]))
    p["split"].update(copy.deepcopy(fx["split_add"]))
    x["lines"].update(fx["lines_add"])
    x["prepare"] = copy.deepcopy(fx["prepare"])
    x["two_capacities"] = copy.deepcopy(fx["two_capacities"])
    p["families"].update(copy.deepcopy(fx["families_add"]))
    qs = {q["id"]: q for q in c["list_spec"]["attribute_definitions"]}
    for qid, ch in fx["question_changes"].items():
        q = qs[qid]
        if "values_before_none" in ch:
            vals = [v for v in q["values"] if v != "none of these"]
            q["values"] = vals + [v for v in ch["values_before_none"] if v not in vals] + (["none of these"] if "none of these" in q["values"] else [])
        if "note" in ch:
            q["note"] = ch["note"]
        if "note_add" in ch:
            q["note"] = q.get("note", "") + ch["note_add"]
    c["notes"] = c["notes"] + fx["notes_add"]
    c["list_spec"]["second_opinion"] = fx["second_opinion"]
    drop = set(fx["impact_examples_drop"])
    c["impact_examples"] = [e for e in c["impact_examples"] if e.get("id") not in drop] + copy.deepcopy(fx["impact_examples_add"])
    return c


# ---------------------------------------------------------------------------------------------------------------
def export(path):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import exporter
    payload = exporter.build_asset("HVAC")
    open(path, "w", encoding="utf-8", newline="").write(exporter.serialize_asset(payload))
    prev = json.load(open(V61, encoding="utf-8"))
    e_items = {i["item_uid"]: i for i in payload["items"]}
    v_items = {i["item_uid"]: i for i in prev["items"]}
    missing = sorted(set(v_items) - set(e_items)); extra = sorted(set(e_items) - set(v_items))
    differ = sorted(u for u in set(v_items) & set(e_items) if _canon(v_items[u]) != _canon(e_items[u]))
    e_cfg = {c["category_id"]: c for c in payload["category_configs"]}
    v_cfg = {c["category_id"]: c for c in prev["category_configs"]}
    cdiff = sorted(c for c in set(e_cfg) | set(v_cfg) if _canon(e_cfg.get(c)) != _canon(v_cfg.get(c)))
    print("export written", path, "| items", len(payload["items"]), "| configs", len(payload["category_configs"]))
    print("vs v61 by content: items missing", missing, "| extra", extra, "| differing", differ, "| configs differing", cdiff)
    if missing or extra or differ or cdiff:
        raise SystemExit("the export is not v61 by content -- STOP")
    frappe.destroy()


def build(out):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import config_validation, extraction
    from nirmaan_stack.services.boq_rate_master.loader import _validate_items, _validate_one_config
    raw = open(V61, "rb").read()
    prev = json.loads(raw.decode("utf-8"))
    if _dump(prev).encode("utf-8") != raw:
        raise SystemExit("re-dumping v61 does not reproduce its bytes -- the series convention is not what this mint writes")
    fx = fixture()
    final = copy.deepcopy(prev)
    idx = next(n for n, c in enumerate(prev["category_configs"]) if c["category_id"] == CATEGORY_ID)
    final["category_configs"][idx] = vrf6_config(prev["category_configs"][idx], fx)
    retire = set(fx["retire_inputs"])
    have_inputs = {(i.get("attributes") or {}).get("item") for i in prev["items"] if i.get("kind") == INPUT_KIND}
    assert retire <= have_inputs, sorted(retire - have_inputs)
    kept = [i for i in prev["items"] if not (i.get("kind") == INPUT_KIND and (i.get("attributes") or {}).get("item") in retire)]
    assert len(prev["items"]) - len(kept) == 9
    new_inputs = [input_item(p) for p in fx["inputs"]]
    new_misc = [misc_item(n) for n in fx["new_items"]]
    assert not ({p["item"] for p in fx["inputs"]} & have_inputs), "an input id already exists"
    have_misc = {(i.get("attributes") or {}).get("item") for i in prev["items"] if i.get("kind") == MISC_KIND}
    assert not ({n["attributes"]["item"] for n in fx["new_items"]} & have_misc), "the Misc item already exists"
    assert not ({i["item_uid"] for i in new_inputs + new_misc} & {i["item_uid"] for i in prev["items"]})
    final["items"] = kept + new_inputs + new_misc
    # ONLY the hvac_vrf config + the declared items: every kept item byte-identical and in order, every other config byte-identical
    assert _canon(final["items"][: len(kept)]) == _canon(kept)
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
    assert lchanged == ["attribute_definitions", "pricing", "second_opinion"], lchanged
    assert [q["id"] for q in old["list_spec"]["attribute_definitions"]] == [q["id"] for q in new["list_spec"]["attribute_definitions"]]
    assert new["list_spec"].get("second_opinion") is False
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
    stored61 = [dict(c, discipline=prev["discipline"]) for c in prev["category_configs"]]
    cfgs61 = {(prev["discipline"], c["category_id"]): c for c in stored61}
    eligible61 = sorted(c["category_id"] for c in stored61 if extraction.config_is_eligible(c, cfgs61))
    assert eligible == eligible61 and CATEGORY_ID in eligible, (eligible, eligible61)
    spec = extraction.build_items_spec(vrf, cfgs, "HVAC")
    want = [q["id"] for q in vrf["list_spec"]["attribute_definitions"]]
    assert [a["id"] for a in spec["attribute_definitions"]] == want and len(want) == 53, len(want)
    assert spec.get("second_opinion") is False
    print("hvac_vrf ITEMS_SPEC chars:", len(json.dumps(spec, ensure_ascii=False)), "| questions", len(spec["attribute_definitions"]))

    def requests(st, cf):
        return {c["category_id"]: json.dumps(extraction.build_items_spec(cf[("HVAC", c["category_id"])], cf, "HVAC"), sort_keys=True)
                for c in st if c.get("list_spec") and c["category_id"] != CATEGORY_ID}
    r61, r62 = requests(stored61, cfgs61), requests(stored, cfgs)
    diff = sorted(k for k in set(r61) | set(r62) if r61.get(k) != r62.get(k))
    print("STUB PROOF: item-list requests v61 vs v62 (hvac_vrf aside) -- identical:", sorted(k for k in r61 if r61[k] == r62.get(k)), "| differing:", diff)
    assert diff == [], diff
    print("eligible configs v62 = v61:", eligible)
    readers = sorted(c["category_id"] for c in stored if c["category_id"] != CATEGORY_ID and any(k in ((c.get("list_spec") or {}).get("pricing") or {}) for k in ("extras", "working_standby")))
    assert readers == [], readers
    used = set(config_validation.extras_input_ids(vrf))
    assert {p["item"] for p in fx["inputs"]} <= used, sorted({p["item"] for p in fx["inputs"]} - used)
    assert not (retire & used), sorted(retire & used)
    print("the 14 new inputs are all read by hvac_vrf; none of the 9 retired is:", sorted(p["item"] for p in fx["inputs"]))

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
            nin = {u: L[u] for u in L if L[u]["kind"] not in (INPUT_KIND,) and not (L[u]["kind"] == MISC_KIND and L[u]["unit"] == "Nos" and (L[u]["attributes"] or {}).get("item") == "MS frame / stand for ODU")}
            out[disc]["non_input_items_less_new"] = [len(nin), hashlib.sha256("".join(u + _canon(nin[u]) for u in sorted(nin)).encode()).hexdigest()[:16]]
            out[disc]["inputs"] = sum(1 for u in L if L[u]["kind"] == INPUT_KIND)
            out[disc]["vrf_second_opinion"] = (LC.get(CATEGORY_ID, {}).get("list_spec") or {}).get("second_opinion")
    print(json.dumps(out, indent=1, sort_keys=True))
    frappe.destroy()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("phase", choices=["export", "build", "load", "verify"])
    ap.add_argument("--export", default="/tmp/vrf6/v62_export.json")
    ap.add_argument("--candidate", default=V62)
    a = ap.parse_args()
    if a.phase == "export":
        export(a.export)
    elif a.phase == "build":
        build(a.candidate)
    elif a.phase == "load":
        load(a.candidate)
    else:
        verify(a.candidate)
