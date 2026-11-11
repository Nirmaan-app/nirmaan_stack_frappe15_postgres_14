"""VRF-4 (2026-11-06) -- MINT HVAC v60 = v59 WITH VRF SWITCHED ON: THE MODEL'S QUESTIONS, THE SECOND OPINION, AND THE KEYS
THE PRICER READS THE MODEL'S ANSWERS THROUGH.

The v59 shape (`mint_hvac_v59_vrf3b.py`), built on v59. ONLY `hvac_vrf` changes; every item and every other config is
byte-identical to v59 (asserted). The changes, all owner-ruled:

  1. `calculator_only` REMOVED (owner Q1 A, 2026-11-03: "removed at VRF-4"; D-10 "VRF goes live on BoQ rows at VRF-4").
  2. `list_spec.attribute_definitions` = the VRF-4 questions (2026-11-06 q1 "ok": four per-item includes; q3 "yes": a stated
     split copied whole on one item; q4 "ok": capacity_label removed; VRF-R4 R3): item (note reworded, D-4), brand,
     brand_as_written, cooling, discharge, compressor, way, remote_type (note extended), capacity (note extended),
     includes_copper / _insulation / _power / _comm, extra_copper_size / _insulation_thickness / _cable_spec / _length
     _as_written, working_standby_as_written, set_contents_as_written, set_covers.
  3. `list_spec.second_opinion` TRUE (q5: "on for testing. that is why we buulyt it in foirst place." + "q5 yes both runs").
     It must be switched OFF before any deploy (an open item of the slice).
  4. `list_spec.pricing`: `extras.from_model` (the per-item includes and the copied words) + `extras.lines.boq_note` (O-5)
     + `extras.cable.conductor_attr` / `armour_attr` (Electrical's own attribute ids, no longer in code) + the reworded
     `extras.lines.typed_note` ("closest" is gone from the pricer, BORROWED "option a"); `defaults.brand.unlisted.from_attr`
     (R-BRAND (a) on a BoQ row); `per_set.counted.from_sheet` (q2 "ok"); `working_standby` (R-WS, D-5 "option D", D-9).
  5. `notes`: one sentence appended.

Every VRF-4 key and the questions are read from the ONE fixture the frontend tests share
(`frontend/src/pages/pricing/__fixtures__/vrf4Model.json`); test_vrf_v60 proves the asset equals it.

Runs IN THE CONTAINER under the bench's python. Four phases, in this order:
  export   the HVAC asset exported FROM THE DATABASE, proved = v59 by content. NO database write.
  build    v59 (the committed file; its re-dump must reproduce its bytes) -> the candidate. NO database write.
  load     pre-load HVAC snapshot, then `loader.load_rate_master(path=<candidate>, replace=True)`.
  verify   live HVAC == the candidate BY CONTENT; Electrical's hashes printed.

Usage (container, from frappe-bench): env/bin/python -I <this> <phase> [--export P] [--candidate P]
"""
import argparse, copy, hashlib, json, os, re

APP = "/workspace/development/frappe-bench/apps/nirmaan_stack"
DATA = os.path.join(APP, "nirmaan_stack/services/boq_rate_master/data")
V59 = os.path.join(DATA, "rate_master_hvac_all_v59.json")
V60 = os.path.join(DATA, "rate_master_hvac_all_v60.json")
FIXTURE = os.path.join(APP, "frontend/src/pages/pricing/__fixtures__/vrf4Model.json")

CATEGORY_ID = "hvac_vrf"
INPUT_KIND = "hvac_pricing_input"
CHANGED_KEYS = ["calculator_only", "list_spec", "notes"]
CHANGED_PRICING_KEYS = ["defaults", "extras", "per_set", "working_standby"]
TYPED_NOTE = "You typed {typed} -> {used} mm."
NOTE = (" VRF-4 (owner, 2026-11-06): VRF is live on BoQ rows (calculator_only removed). The model is asked per item whether the "
        "unit's price includes copper, insulation, power and communication cable, and copies the sizes, brand, working + standby "
        "words and refnet coverage as written; each borrowed field is priced by its own sheet's rules; refnet unit counts are "
        "added up from the sheet; a working + standby row prices one unit under a red bar. second_opinion is ON for testing and "
        "must be switched off before deploy.")


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
    need = {"extras_from_model", "extras_words", "brand_from_attr", "counted_from_sheet", "working_standby", "questions"}
    assert set(fx) - {"_about"} == need, sorted(fx)
    ids = [q["id"] for q in fx["questions"]]
    assert "capacity_label" not in ids and len(ids) == len(set(ids)) == 20, ids
    return fx


def vrf4_config(v59_cfg, fx):
    c = copy.deepcopy(v59_cfg)
    del c["calculator_only"]
    c["notes"] = c["notes"] + NOTE
    ls = c["list_spec"]
    ls["attribute_definitions"] = copy.deepcopy(fx["questions"])
    ls["second_opinion"] = True
    pr = ls["pricing"]
    pr["extras"]["from_model"] = copy.deepcopy(fx["extras_from_model"])
    pr["extras"]["lines"]["boq_note"] = fx["extras_words"]["boq_note"]
    pr["extras"]["lines"]["typed_note"] = TYPED_NOTE
    pr["extras"]["cable"]["conductor_attr"] = "material"
    pr["extras"]["cable"]["armour_attr"] = "insulation"
    pr["defaults"]["brand"]["unlisted"]["from_attr"] = fx["brand_from_attr"]
    pr["per_set"]["counted"]["from_sheet"] = copy.deepcopy(fx["counted_from_sheet"])
    pr["working_standby"] = copy.deepcopy(fx["working_standby"])
    return c


# ---------------------------------------------------------------------------------------------------------------
def export(path):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import exporter
    payload = exporter.build_asset("HVAC")
    open(path, "w", encoding="utf-8", newline="").write(exporter.serialize_asset(payload))
    v58 = json.load(open(V59, encoding="utf-8"))
    e_items = {i["item_uid"]: i for i in payload["items"]}
    v_items = {i["item_uid"]: i for i in v58["items"]}
    missing = sorted(set(v_items) - set(e_items)); extra = sorted(set(e_items) - set(v_items))
    differ = sorted(u for u in set(v_items) & set(e_items) if _canon(v_items[u]) != _canon(e_items[u]))
    e_cfg = {c["category_id"]: c for c in payload["category_configs"]}
    v_cfg = {c["category_id"]: c for c in v58["category_configs"]}
    cdiff = sorted(c for c in set(e_cfg) | set(v_cfg) if _canon(e_cfg.get(c)) != _canon(v_cfg.get(c)))
    print("export written", path, "| items", len(payload["items"]), "| configs", len(payload["category_configs"]))
    print("vs v59 by content: items missing", missing, "| extra", extra, "| differing", differ, "| configs differing", cdiff)
    if missing or extra or differ or cdiff:
        raise SystemExit("the export is not v59 by content -- STOP")
    frappe.destroy()


def build(out):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import config_validation, extraction
    from nirmaan_stack.services.boq_rate_master.loader import _validate_items, _validate_one_config
    raw = open(V59, "rb").read()
    v59 = json.loads(raw.decode("utf-8"))
    if _dump(v59).encode("utf-8") != raw:
        raise SystemExit("re-dumping v59 does not reproduce its bytes -- the series convention is not what this mint writes")
    fx = fixture()
    final = copy.deepcopy(v59)
    idx = next(n for n, c in enumerate(v59["category_configs"]) if c["category_id"] == CATEGORY_ID)
    final["category_configs"][idx] = vrf4_config(v59["category_configs"][idx], fx)
    # the removed switch is DECLARED (the 12d-2 precedent: v29 declared "cfgkey:hvac_insulation:calculator_only"), so the mint
    # gate reads it as intended, never as a lost atom
    final["intentional_removals"] = list(v59.get("intentional_removals") or []) + ["cfgkey:hvac_vrf:calculator_only"]
    # ONLY the hvac_vrf config: every item byte-identical, every other config byte-identical
    assert _canon(final["items"]) == _canon(v59["items"])
    for n, (a, b) in enumerate(zip(v59["category_configs"], final["category_configs"])):
        assert a["category_id"] == b["category_id"]
        if n != idx:
            assert _canon(a) == _canon(b), a["category_id"]
    old, new = v59["category_configs"][idx], final["category_configs"][idx]
    changed = sorted(k for k in set(old) | set(new) if _canon(old.get(k)) != _canon(new.get(k)))
    assert changed == CHANGED_KEYS, changed
    po, pn = old["list_spec"]["pricing"], new["list_spec"]["pricing"]
    pchanged = sorted(k for k in set(po) | set(pn) if _canon(po.get(k)) != _canon(pn.get(k)))
    assert pchanged == CHANGED_PRICING_KEYS, pchanged
    lchanged = sorted(k for k in set(old["list_spec"]) | set(new["list_spec"]) if _canon(old["list_spec"].get(k)) != _canon(new["list_spec"].get(k)))
    assert lchanged == ["attribute_definitions", "pricing", "second_opinion"], lchanged
    assert "calculator_only" not in new and old.get("calculator_only") is True
    assert list(final.keys()) == list(v59.keys())
    v58 = v59  # the names below are the v59 template's: "v58" is the previous version here

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
    if not extraction.has_runnable_pricing_rules(vrf):
        raise SystemExit("hvac_vrf's rules do not run")
    if not extraction.config_is_eligible(vrf, cfgs):
        raise SystemExit("hvac_vrf is NOT eligible for extraction -- the switch-off did not take (D-10)")
    eligible = sorted(c["category_id"] for c in stored if extraction.config_is_eligible(c, cfgs))
    stored58 = [dict(c, discipline=v58["discipline"]) for c in v58["category_configs"]]
    cfgs58 = {(v58["discipline"], c["category_id"]): c for c in stored58}
    eligible58 = sorted(c["category_id"] for c in stored58 if extraction.config_is_eligible(c, cfgs58))
    # the switch-off is in the CODE too (EX's clause removed in the same change), so v59's VRF config -- its key now read by
    # nothing -- reads eligible as well: the eligible set is v59's under this code, and it holds hvac_vrf
    assert eligible == eligible58 and CATEGORY_ID in eligible, (eligible, eligible58)
    spec = extraction.build_items_spec(vrf, cfgs, "HVAC")
    assert [a["id"] for a in spec["attribute_definitions"]] == [q["id"] for q in fx["questions"]], spec.get("attribute_definitions")
    assert spec.get("second_opinion") is True
    print("hvac_vrf ITEMS_SPEC chars:", len(json.dumps(spec, ensure_ascii=False)), "| questions", len(spec["attribute_definitions"]))

    def requests(st, cf):
        return {c["category_id"]: json.dumps(extraction.build_items_spec(cf[("HVAC", c["category_id"])], cf, "HVAC"), sort_keys=True)
                for c in st if c.get("list_spec") and c["category_id"] != CATEGORY_ID}
    r58, r59 = requests(stored58, cfgs58), requests(stored, cfgs)
    diff = sorted(k for k in set(r58) | set(r59) if r58.get(k) != r59.get(k))
    print("STUB PROOF: item-list requests v59 vs v60 (hvac_vrf aside, never sent) -- identical:", sorted(k for k in r58 if r58[k] == r59.get(k)), "| differing:", diff)
    assert diff == [], diff
    print("eligible configs v60 = v59 + hvac_vrf:", eligible)
    readers = sorted(c["category_id"] for c in stored if c["category_id"] != CATEGORY_ID and any(k in ((c.get("list_spec") or {}).get("pricing") or {}) for k in ("extras", "working_standby")))
    print("other configs declaring extras / working_standby:", readers)
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
            out[disc]["vrf_second_opinion"] = (LC.get(CATEGORY_ID, {}).get("list_spec") or {}).get("second_opinion")
    print(json.dumps(out, indent=1, sort_keys=True))
    frappe.destroy()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("phase", choices=["export", "build", "load", "verify"])
    ap.add_argument("--export", default="/tmp/vrf4/v60_export.json")
    ap.add_argument("--candidate", default=V60)
    a = ap.parse_args()
    if a.phase == "export":
        export(a.export)
    elif a.phase == "build":
        build(a.candidate)
    elif a.phase == "load":
        load(a.candidate)
    else:
        verify(a.candidate)
