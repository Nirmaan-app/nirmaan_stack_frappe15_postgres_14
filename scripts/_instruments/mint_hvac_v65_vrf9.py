"""VRF-9 (2026-11-11) -- MINT HVAC v65 = v64 + THE VRF-8 REVIEW'S FIXES (S1-S7), THE OWNER'S RULINGS R1-R4 (2026-11-11 00:36-00:43)
AND ANSWER 2 / 3 (S8-S10, 00:59-01:15): SEVERAL UNIT TYPES ONLY WHEN THE ROW NAMES NONE (+ THE CALCULATOR'S TYPED CASE), THE SCOPE
NOTE ALWAYS, INSTALLATION AT ANY LEVEL, EXACT QUOTES WITH THEIR ROWS, THE FEEDER NOTE PER MODULE, THE TFA CAPACITY, THE PER-HP
CALCULATOR REFUSAL, FIRST CHARGE = GAS, BMS CABLES ARE NOT THE COMM CABLE, CIVIL SUPPORTS ARE NOT THE MS FRAME, THE FAN COIL REFUSAL,
A SET THE BoQ DEFINES = 1 REFNET, GAS CHARGING ALWAYS SUPPLY + INSTALLATION, THE GAS / FRAME ITEM WHERE NONE WAS READ.

The v64 shape (`mint_hvac_v64_vrf8.py`), built on v64. ONLY `hvac_vrf`'s `list_spec` changes (`attribute_definitions` notes and
`pricing.extras` / `pricing.per_set` / `pricing.lot_units`); every item and every other config is byte-identical to v64 (asserted).
No Pricing Input and no item changes; the 68 questions and their `required` / `allow_none` flags are v64's.

  1. `list_spec.attribute_definitions`: notes appended (guidance) to includes_gas (R1), includes_comm (R2), includes_frame (R3),
     scope (S4), capacity (S7), item (S9 / S10), set_contents_as_written (S8). Every extra question stays REQUIRED.
  2. `list_spec.pricing.extras`: `prepare` (unit_words Hi-Wall += "wall mounted type"; several_types.typed; feeder_length.every_module;
     + family_refusals, not_includes, tfa_capacity, row_family; one implied include: a first / factory charge = the gas; the
     supports include's not_words += civil / pedestal / foundation / plinth), `scope` (+ always_note, any_level, always_both),
     `safeguard` (+ exact_quotes), the accessories (MCB note_words words + its line with {where}; the remote's conflict lines with
     {first_where}); `pricing.per_set.counted.defined`; `pricing.lot_units.calculator_refuses`.
  3. `list_spec.second_opinion` stays FALSE (owner 2026-11-09 18:52, the standing rule).

Every VRF-9 key and note is read from the ONE fixture the frontend tests share
(`frontend/src/pages/pricing/__fixtures__/vrf9Model.json`); test_vrf_v65 proves the asset equals it.

Runs IN THE CONTAINER under the bench's python. Four phases, in this order:
  export   the HVAC asset exported FROM THE DATABASE, proved = v64 by content. NO database write.
  build    v64 (the committed file; its re-dump must reproduce its bytes) -> the candidate. NO database write.
  load     pre-load HVAC snapshot, then `loader.load_rate_master(path=<candidate>, replace=True)`.
  verify   live HVAC == the candidate BY CONTENT; Electrical's hashes printed.

Usage (container, from frappe-bench): env/bin/python -I <this> <phase> [--export P] [--candidate P]
"""
import argparse, copy, hashlib, json, os, re

APP = "/workspace/development/frappe-bench/apps/nirmaan_stack"
DATA = os.path.join(APP, "nirmaan_stack/services/boq_rate_master/data")
V64 = os.path.join(DATA, "rate_master_hvac_all_v64.json")
V65 = os.path.join(DATA, "rate_master_hvac_all_v65.json")
FIXTURE = os.path.join(APP, "frontend/src/pages/pricing/__fixtures__/vrf9Model.json")

CATEGORY_ID = "hvac_vrf"
FIXTURE_KEYS = {"prepare_patch", "prepare_add", "implied_includes_add", "implied_not_words_append", "scope_add", "safeguard_add",
                "accessories_patch", "per_set_counted_add", "pricing_patch", "question_notes_append", "second_opinion"}
QUESTIONS = 68


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
    assert fx["second_opinion"] is False
    return fx


def vrf9_config(v64_cfg, fx):
    """v64's hvac_vrf + the VRF-9 keys -- the SAME steps, in the same order, as `applyVrf9` (calculatorPanelParity.harness)."""
    c = copy.deepcopy(v64_cfg)
    p = c["list_spec"]["pricing"]
    x = p["extras"]
    for k, v in fx["prepare_patch"].items():
        x["prepare"][k] = dict(x["prepare"].get(k) or {}, **copy.deepcopy(v))
    x["prepare"].update(copy.deepcopy(fx["prepare_add"]))
    ii = list(x["prepare"].get("implied_includes") or []) + copy.deepcopy(fx["implied_includes_add"])
    app = fx["implied_not_words_append"]
    x["prepare"]["implied_includes"] = [dict(i, not_words=i["not_words"] + app[i["question"]])
                                        if i["question"] in app and isinstance(i.get("not_words"), str) else i for i in ii]
    x["scope"].update(copy.deepcopy(fx["scope_add"]))
    x["safeguard"].update(copy.deepcopy(fx["safeguard_add"]))
    for a in x["accessories"]:
        pt = fx["accessories_patch"].get(a["id"])
        if not pt:
            continue
        if ("note_words_line" in pt or "note_words_words" in pt) and a.get("note_words"):
            nw = dict(a["note_words"])
            if "note_words_words" in pt:
                nw["words"] = pt["note_words_words"]
            if "note_words_line" in pt:
                nw["line"] = pt["note_words_line"]
            a["note_words"] = nw
        if (a.get("choice") or {}).get("conflict") and ("conflict_line" in pt or "conflict_both_line" in pt):
            cf = dict(a["choice"]["conflict"])
            if "conflict_line" in pt:
                cf["line"] = pt["conflict_line"]
            if "conflict_both_line" in pt:
                cf["both_line"] = pt["conflict_both_line"]
            a["choice"]["conflict"] = cf
    if (p.get("per_set") or {}).get("counted"):
        p["per_set"]["counted"].update(copy.deepcopy(fx["per_set_counted_add"]))
    for k, v in (fx.get("pricing_patch") or {}).items():
        p[k] = dict(p.get(k) or {}, **copy.deepcopy(v))
    ap = fx["question_notes_append"]
    c["list_spec"]["attribute_definitions"] = [dict(q, note=q.get("note", "") + ap[q["id"]]) if q["id"] in ap else dict(q)
                                               for q in c["list_spec"]["attribute_definitions"]]
    c["list_spec"]["second_opinion"] = fx["second_opinion"]
    return c


# ---------------------------------------------------------------------------------------------------------------
def export(path):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import exporter
    payload = exporter.build_asset("HVAC")
    open(path, "w", encoding="utf-8", newline="").write(exporter.serialize_asset(payload))
    prev = json.load(open(V64, encoding="utf-8"))
    e_items = {i["item_uid"]: i for i in payload["items"]}
    v_items = {i["item_uid"]: i for i in prev["items"]}
    missing = sorted(set(v_items) - set(e_items)); extra = sorted(set(e_items) - set(v_items))
    differ = sorted(u for u in set(v_items) & set(e_items) if _canon(v_items[u]) != _canon(e_items[u]))
    e_cfg = {c["category_id"]: c for c in payload["category_configs"]}
    v_cfg = {c["category_id"]: c for c in prev["category_configs"]}
    cdiff = sorted(c for c in set(e_cfg) | set(v_cfg) if _canon(e_cfg.get(c)) != _canon(v_cfg.get(c)))
    print("export written", path, "| items", len(payload["items"]), "| configs", len(payload["category_configs"]))
    print("vs v64 by content: items missing", missing, "| extra", extra, "| differing", differ, "| configs differing", cdiff)
    if missing or extra or differ or cdiff:
        raise SystemExit("the export is not v64 by content -- STOP")
    frappe.destroy()


def build(out):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import config_validation, extraction
    from nirmaan_stack.services.boq_rate_master.loader import _validate_items, _validate_one_config
    raw = open(V64, "rb").read()
    prev = json.loads(raw.decode("utf-8"))
    if _dump(prev).encode("utf-8") != raw:
        raise SystemExit("re-dumping v64 does not reproduce its bytes -- the series convention is not what this mint writes")
    fx = fixture()
    final = copy.deepcopy(prev)
    idx = next(n for n, c in enumerate(prev["category_configs"]) if c["category_id"] == CATEGORY_ID)
    final["category_configs"][idx] = vrf9_config(prev["category_configs"][idx], fx)
    # ONLY the hvac_vrf config: every item byte-identical and in order, every other config byte-identical
    assert _canon(final["items"]) == _canon(prev["items"])
    for n, (a, b) in enumerate(zip(prev["category_configs"], final["category_configs"])):
        assert a["category_id"] == b["category_id"]
        if n != idx:
            assert _canon(a) == _canon(b), a["category_id"]
    old, new = prev["category_configs"][idx], final["category_configs"][idx]
    changed = sorted(k for k in set(old) | set(new) if _canon(old.get(k)) != _canon(new.get(k)))
    assert changed == ["list_spec"], changed
    po, pn = old["list_spec"]["pricing"], new["list_spec"]["pricing"]
    pchanged = sorted(k for k in set(po) | set(pn) if _canon(po.get(k)) != _canon(pn.get(k)))
    assert pchanged == sorted(["extras", "per_set"] + list(fx.get("pricing_patch") or {})), pchanged
    lchanged = sorted(k for k in set(old["list_spec"]) | set(new["list_spec"]) if _canon(old["list_spec"].get(k)) != _canon(new["list_spec"].get(k)))
    assert lchanged == ["attribute_definitions", "pricing"], lchanged
    xo, xn = po["extras"], pn["extras"]
    xchanged = sorted(k for k in set(xo) | set(xn) if _canon(xo.get(k)) != _canon(xn.get(k)))
    assert xchanged == ["accessories", "prepare", "safeguard", "scope"], xchanged
    assert [q["id"] for q in new["list_spec"]["attribute_definitions"]] == [q["id"] for q in old["list_spec"]["attribute_definitions"]]
    flags = lambda c: [(q["id"], q.get("required"), q.get("allow_none")) for q in c["list_spec"]["attribute_definitions"]]
    assert flags(new) == flags(old), "a question's flags moved"
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
    stored_base = [dict(c, discipline=prev["discipline"]) for c in prev["category_configs"]]
    cfgs_base = {(prev["discipline"], c["category_id"]): c for c in stored_base}
    eligible_base = sorted(c["category_id"] for c in stored_base if extraction.config_is_eligible(c, cfgs_base))
    assert eligible == eligible_base and CATEGORY_ID in eligible, (eligible, eligible_base)
    spec = extraction.build_items_spec(vrf, cfgs, "HVAC")
    want = [q["id"] for q in vrf["list_spec"]["attribute_definitions"]]
    assert [a["id"] for a in spec["attribute_definitions"]] == want and len(want) == QUESTIONS, len(want)
    assert spec.get("second_opinion") is False
    spec_base = extraction.build_items_spec(cfgs_base[("HVAC", CATEGORY_ID)], cfgs_base, "HVAC")
    print("hvac_vrf ITEMS_SPEC chars: v64", len(json.dumps(spec_base, ensure_ascii=False)), "-> v65", len(json.dumps(spec, ensure_ascii=False)),
          "| questions", len(spec_base["attribute_definitions"]), "->", len(spec["attribute_definitions"]))

    def requests(st, cf):
        return {c["category_id"]: json.dumps(extraction.build_items_spec(cf[("HVAC", c["category_id"])], cf, "HVAC"), sort_keys=True)
                for c in st if c.get("list_spec") and c["category_id"] != CATEGORY_ID}
    r_base, r_new = requests(stored_base, cfgs_base), requests(stored, cfgs)
    diff = sorted(k for k in set(r_base) | set(r_new) if r_base.get(k) != r_new.get(k))
    print("STUB PROOF: item-list requests v64 vs v65 (hvac_vrf aside) -- identical:", sorted(k for k in r_base if r_base[k] == r_new.get(k)), "| differing:", diff)
    assert diff == [], diff
    print("eligible configs v65 = v64:", eligible)
    readers = sorted(c["category_id"] for c in stored if c["category_id"] != CATEGORY_ID and any(k in ((c.get("list_spec") or {}).get("pricing") or {}) for k in ("extras", "working_standby")))
    assert readers == [], readers
    assert set(config_validation.extras_input_ids(vrf)) == set(config_validation.extras_input_ids(cfgs_base[("HVAC", CATEGORY_ID)])), "the Pricing Inputs read moved"
    print("Pricing Inputs read by hvac_vrf: unchanged from v64")

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
            out[disc]["vrf_second_opinion"] = (LC.get(CATEGORY_ID, {}).get("list_spec") or {}).get("second_opinion")
            out[disc]["vrf_questions"] = len((LC.get(CATEGORY_ID, {}).get("list_spec") or {}).get("attribute_definitions") or [])
    print(json.dumps(out, indent=1, sort_keys=True))
    frappe.destroy()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("phase", choices=["export", "build", "load", "verify"])
    ap.add_argument("--export", default="/tmp/vrf9/v65_export.json")
    ap.add_argument("--candidate", default=V65)
    a = ap.parse_args()
    if a.phase == "export":
        export(a.export)
    elif a.phase == "build":
        build(a.candidate)
    elif a.phase == "load":
        load(a.candidate)
    else:
        verify(a.candidate)
