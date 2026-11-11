"""VRF-7 (2026-11-10) -- MINT HVAC v63 = v62 + THE VRF-6 REVIEW'S FIXES (owner rulings 2026-11-10 01:30-01:53): A STATED DISCHARGE
WINS, HEAT-PUMP WORDINGS, ARMOURED ONLY WHEN STATED, A LENGTH PER ITEM, THE CONTROL-WIRING KEYWORD RULE DROPPED (THE MODEL DECIDES
SCOPE), STEP-UP NOTES, THE OWN-ROW CHECK FOR EVERY EXTRA WHEREVER STATED, NOTES THAT QUOTE THE BOQ, A STATED MODULE SETUP, AN
OPTIONAL REMOTE, FRESH AIR BEATS CSU, AN INDIVIDUAL CONTROLLER, THE STARTER-PANEL AND WIRED-REMOTE NOTES.

The v62 shape (`mint_hvac_v62_vrf6.py`), built on v62. ONLY `hvac_vrf`'s `list_spec` changes (`attribute_definitions` and
`pricing.extras`); every item and every other config is byte-identical to v62 (asserted). No Pricing Input and no item changes.

  1. `list_spec.attribute_definitions`: 53 -> 68 questions -- `extra_length_as_written` out; in: the armoured Yes / No per cable
     (power / comm), a length per item (power / comm / copper), the BoQ words per include (copper, insulation, power, comm,
     frame, gas, drain pump, remote, refnet, MCCB), the stated module setup; notes added to `item`, `cooling`, `discharge`,
     `includes_comm` (A4: fault sentences are not scope; every level of the chain counts), `includes_remote` (B10 / C13),
     `includes_copper` / `includes_insulation` (C12).
  2. `list_spec.pricing.extras`: `prepare` (+ discharge_words, heat_words, armour_words, implied_includes, stated_setup; a
     fresh-air family rule first and the Ductable rule's `unless`), `safeguard` (+ own_row_always, words_suffix and the quoting
     lines; `control_wiring` DROPPED), the accessories (MCB / ELCB `step_up_note`, MCB `note_words`, the remote's
     `choice.conflict`), `from_model` (+ armoured, length_by_item; `length` dropped), `lines` (+ length_default, armour_note,
     armoured_value).
  3. `list_spec.second_opinion` stays FALSE (owner 2026-11-09 18:52, the standing rule).

Every VRF-7 key and question change is read from the ONE fixture the frontend tests share
(`frontend/src/pages/pricing/__fixtures__/vrf7Model.json`); test_vrf_v63 proves the asset equals it.

Runs IN THE CONTAINER under the bench's python. Four phases, in this order:
  export   the HVAC asset exported FROM THE DATABASE, proved = v62 by content. NO database write.
  build    v62 (the committed file; its re-dump must reproduce its bytes) -> the candidate. NO database write.
  load     pre-load HVAC snapshot, then `loader.load_rate_master(path=<candidate>, replace=True)`.
  verify   live HVAC == the candidate BY CONTENT; Electrical's hashes printed.

Usage (container, from frappe-bench): env/bin/python -I <this> <phase> [--export P] [--candidate P]
"""
import argparse, copy, hashlib, json, os, re

APP = "/workspace/development/frappe-bench/apps/nirmaan_stack"
DATA = os.path.join(APP, "nirmaan_stack/services/boq_rate_master/data")
V62 = os.path.join(DATA, "rate_master_hvac_all_v62.json")
V63 = os.path.join(DATA, "rate_master_hvac_all_v63.json")
FIXTURE = os.path.join(APP, "frontend/src/pages/pricing/__fixtures__/vrf7Model.json")

CATEGORY_ID = "hvac_vrf"
FIXTURE_KEYS = {"prepare_add", "family_words_prepend", "family_words_unless", "safeguard_add", "safeguard_drop", "accessories_patch",
                "from_model_add", "from_model_drop", "lines_add", "question_drop", "question_add", "question_notes_append", "second_opinion"}
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


def vrf7_config(v62_cfg, fx):
    """v62's hvac_vrf + the VRF-7 keys -- the SAME steps, in the same order, as `applyVrf7` in vrf7Model.test.ts."""
    c = copy.deepcopy(v62_cfg)
    p = c["list_spec"]["pricing"]
    x = p["extras"]
    x["prepare"].update(copy.deepcopy(fx["prepare_add"]))
    for fw in x["prepare"]["family_words"]:
        if fw["family"] in fx["family_words_unless"]:
            fw["unless"] = fx["family_words_unless"][fw["family"]]
    x["prepare"]["family_words"] = copy.deepcopy(fx["family_words_prepend"]) + x["prepare"]["family_words"]
    sg = x["safeguard"]
    for k, v in fx["safeguard_add"].items():
        if k == "lines":
            sg["lines"].update(v)
        else:
            sg[k] = copy.deepcopy(v)
    for k in fx["safeguard_drop"]:
        sg.pop(k)
    for a in x["accessories"]:
        pt = fx["accessories_patch"].get(a["id"])
        if not pt:
            continue
        if "step_up_note" in pt:
            a["electrical"]["match"]["step_up_note"] = pt["step_up_note"]
        if "note_words" in pt:
            a["note_words"] = copy.deepcopy(pt["note_words"])
        if "conflict" in pt:
            a["choice"]["conflict"] = copy.deepcopy(pt["conflict"])
    x["from_model"].update(copy.deepcopy(fx["from_model_add"]))
    for k in fx["from_model_drop"]:
        x["from_model"].pop(k)
    x["lines"].update(fx["lines_add"])
    defs = [q for q in c["list_spec"]["attribute_definitions"] if q["id"] not in set(fx["question_drop"])]
    for q in defs:
        if q["id"] in fx["question_notes_append"]:
            q["note"] = q.get("note", "") + fx["question_notes_append"][q["id"]]
    c["list_spec"]["attribute_definitions"] = defs + copy.deepcopy(fx["question_add"])
    c["list_spec"]["second_opinion"] = fx["second_opinion"]
    return c


# ---------------------------------------------------------------------------------------------------------------
def export(path):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import exporter
    payload = exporter.build_asset("HVAC")
    open(path, "w", encoding="utf-8", newline="").write(exporter.serialize_asset(payload))
    prev = json.load(open(V62, encoding="utf-8"))
    e_items = {i["item_uid"]: i for i in payload["items"]}
    v_items = {i["item_uid"]: i for i in prev["items"]}
    missing = sorted(set(v_items) - set(e_items)); extra = sorted(set(e_items) - set(v_items))
    differ = sorted(u for u in set(v_items) & set(e_items) if _canon(v_items[u]) != _canon(e_items[u]))
    e_cfg = {c["category_id"]: c for c in payload["category_configs"]}
    v_cfg = {c["category_id"]: c for c in prev["category_configs"]}
    cdiff = sorted(c for c in set(e_cfg) | set(v_cfg) if _canon(e_cfg.get(c)) != _canon(v_cfg.get(c)))
    print("export written", path, "| items", len(payload["items"]), "| configs", len(payload["category_configs"]))
    print("vs v62 by content: items missing", missing, "| extra", extra, "| differing", differ, "| configs differing", cdiff)
    if missing or extra or differ or cdiff:
        raise SystemExit("the export is not v62 by content -- STOP")
    frappe.destroy()


def build(out):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import config_validation, extraction
    from nirmaan_stack.services.boq_rate_master.loader import _validate_items, _validate_one_config
    raw = open(V62, "rb").read()
    prev = json.loads(raw.decode("utf-8"))
    if _dump(prev).encode("utf-8") != raw:
        raise SystemExit("re-dumping v62 does not reproduce its bytes -- the series convention is not what this mint writes")
    fx = fixture()
    final = copy.deepcopy(prev)
    idx = next(n for n, c in enumerate(prev["category_configs"]) if c["category_id"] == CATEGORY_ID)
    final["category_configs"][idx] = vrf7_config(prev["category_configs"][idx], fx)
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
    assert pchanged == ["extras"], pchanged
    lchanged = sorted(k for k in set(old["list_spec"]) | set(new["list_spec"]) if _canon(old["list_spec"].get(k)) != _canon(new["list_spec"].get(k)))
    assert lchanged == ["attribute_definitions", "pricing"], lchanged
    xo, xn = po["extras"], pn["extras"]
    xchanged = sorted(k for k in set(xo) | set(xn) if _canon(xo.get(k)) != _canon(xn.get(k)))
    assert xchanged == ["accessories", "from_model", "lines", "prepare", "safeguard"], xchanged
    assert "control_wiring" not in xn["safeguard"] and "length" not in xn["from_model"]
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
    stored62 = [dict(c, discipline=prev["discipline"]) for c in prev["category_configs"]]
    cfgs62 = {(prev["discipline"], c["category_id"]): c for c in stored62}
    eligible62 = sorted(c["category_id"] for c in stored62 if extraction.config_is_eligible(c, cfgs62))
    assert eligible == eligible62 and CATEGORY_ID in eligible, (eligible, eligible62)
    spec = extraction.build_items_spec(vrf, cfgs, "HVAC")
    want = [q["id"] for q in vrf["list_spec"]["attribute_definitions"]]
    assert [a["id"] for a in spec["attribute_definitions"]] == want and len(want) == QUESTIONS, len(want)
    assert spec.get("second_opinion") is False
    spec62 = extraction.build_items_spec(cfgs62[("HVAC", CATEGORY_ID)], cfgs62, "HVAC")
    print("hvac_vrf ITEMS_SPEC chars: v62", len(json.dumps(spec62, ensure_ascii=False)), "-> v63", len(json.dumps(spec, ensure_ascii=False)),
          "| questions", len(spec62["attribute_definitions"]), "->", len(spec["attribute_definitions"]))

    def requests(st, cf):
        return {c["category_id"]: json.dumps(extraction.build_items_spec(cf[("HVAC", c["category_id"])], cf, "HVAC"), sort_keys=True)
                for c in st if c.get("list_spec") and c["category_id"] != CATEGORY_ID}
    r62, r63 = requests(stored62, cfgs62), requests(stored, cfgs)
    diff = sorted(k for k in set(r62) | set(r63) if r62.get(k) != r63.get(k))
    print("STUB PROOF: item-list requests v62 vs v63 (hvac_vrf aside) -- identical:", sorted(k for k in r62 if r62[k] == r63.get(k)), "| differing:", diff)
    assert diff == [], diff
    print("eligible configs v63 = v62:", eligible)
    readers = sorted(c["category_id"] for c in stored if c["category_id"] != CATEGORY_ID and any(k in ((c.get("list_spec") or {}).get("pricing") or {}) for k in ("extras", "working_standby")))
    assert readers == [], readers
    assert set(config_validation.extras_input_ids(vrf)) == set(config_validation.extras_input_ids(cfgs62[("HVAC", CATEGORY_ID)])), "the Pricing Inputs read moved"
    print("Pricing Inputs read by hvac_vrf: unchanged from v62")

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
    ap.add_argument("--export", default="/tmp/vrf7/v63_export.json")
    ap.add_argument("--candidate", default=V63)
    a = ap.parse_args()
    if a.phase == "export":
        export(a.export)
    elif a.phase == "build":
        build(a.candidate)
    elif a.phase == "load":
        load(a.candidate)
    else:
        verify(a.candidate)
