"""VAV-2a2 (2026-11-19 / 20, desktop) -- MINT HVAC v78 = v77 + THE VAV-2a2 KEYS ON hvac_vav_box.

What changes (owner rulings, VAV_Rulings_Capture_2026-11-18.md; VAV-2a2 prompt R1-R13):
  hvac_vav_box   list_spec.attribute_definitions + airflow_cfm, inlet_size (text; before cfm_range)
                 list_spec.pricing + band_from (B1 / B2 / B3: the band from the maximum airflow, else the inlet table; the edge in the
                   LOWER band, owner QR-E (a) 2026-11-20 00:10), source_tags (B4 "from BoQ" on shape), defaults.shape (B4 / R4 the amber
                   Rectangular), panel_notes + panel_controls (the two typed boxes)
                 list_spec.pricing.own_row_check + serves (B8; QR-C2 (a), owner 2026-11-20 00:34: the BACnet over IP controller only)
                 list_spec.pricing.derivation_reasons: the B7 quantity reason moved BEFORE VAV-1's borrowed-section reasons and their
                   two patterns narrowed (B5: lines "The misc item / sensor section's quantity per vav item ..." now show it); the new
                   reasons appended (R10); the own-row reason gains the B8 ruling
                 calculator_only STAYS true (VAV rows stay "coming soon"; VAV-2b removes it)
  hvac_valve_package  R7 (QR-V (a), owner 2026-11-20 00:10): the two scope supply-row notes lose " (owner VR9)" (those exact strings) and
                 the Derivation tab gains the E13 line ("Thermowell with valve" -> the thermowell; the code net is in pricingSheetHelper)
Every item and every other config byte-identical. The keys are read from ONE file, frontend/.../__fixtures__/vav2a2Keys.json (the
vav2a2* tests apply the same file to a scratch copy, vav2a2.harness `withV78Keys`).

Runs IN THE CONTAINER under the bench's python. Phases: build (v77 file -> the candidate; NO database write), load, verify.
Usage (container, from frappe-bench): env/bin/python -I <this> build|load|verify [--candidate P]
"""
import argparse, copy, hashlib, json, os, re

APP = "/workspace/development/frappe-bench/apps/nirmaan_stack"
DATA = os.path.join(APP, "nirmaan_stack/services/boq_rate_master/data")
V77 = os.path.join(DATA, "rate_master_hvac_all_v77.json")
V78 = os.path.join(DATA, "rate_master_hvac_all_v78.json")
KEYS = os.path.join(APP, "frontend/src/pages/boq-wizard/rate-helper/__fixtures__/vav2a2Keys.json")
VAV = "hvac_vav_box"
EDGE_PLACEHOLDER = "EDGE_REASON"


def _connect():
    os.chdir("/workspace/development/frappe-bench/sites")
    import frappe
    frappe.init(site="localhost"); frappe.connect()
    return frappe


def _canon(o):
    return json.dumps(o, sort_keys=True, separators=(",", ":"), default=str)


def _dump(p):
    return json.dumps(p, indent=1, ensure_ascii=False) + "\n"


def _sha16(o):
    return hashlib.sha256(_canon(o).encode()).hexdigest()[:16]


def vav_config(prev, K):
    """The v78 transformation of hvac_vav_box -- the same as vav2a2.harness.ts `withV78Keys` (pinned equal by test)."""
    c = copy.deepcopy(prev)
    assert c.get("calculator_only") is True, "v77 VAV must carry calculator_only (VAV-2b removes it)"
    ls = c["list_spec"]
    defs = ls["attribute_definitions"]
    have = {d["id"] for d in defs}
    for d in K["attribute_definitions"]:
        assert d["id"] not in have, d["id"]
    at = [n for n, d in enumerate(defs) if d["id"] == K["attribute_definitions_before"]]
    assert len(at) == 1, "the band definition must exist once"
    defs[at[0]:at[0]] = copy.deepcopy(K["attribute_definitions"])
    pr = ls["pricing"]
    for k in ("band_from", "source_tags", "defaults", "panel_notes"):
        assert k not in pr, k
    pr["band_from"] = copy.deepcopy(K["pricing"]["band_from"])
    assert pr["band_from"]["edge"] == "lower", "QR-E (a), owner 2026-11-20 00:10: the edge belongs to the lower band"
    pr["source_tags"] = copy.deepcopy(K["pricing"]["source_tags"])
    pr["defaults"] = copy.deepcopy(K["pricing"]["defaults"])
    pr["panel_notes"] = copy.deepcopy(K["pricing"]["panel_notes"])
    for k, v in K["pricing"]["panel_controls_add"].items():
        assert k not in pr["panel_controls"], k
        pr["panel_controls"][k] = v
    oc = pr["own_row_check"]
    assert "serves" not in oc
    oc["serves"] = copy.deepcopy(K["own_row_check_serves"])   # B8, QR-C2 (a) 2026-11-20 00:34: the BACnet over IP controller only
    reasons = pr["derivation_reasons"]
    R = K["derivation_reasons"]
    mv = [n for n, r in enumerate(reasons) if r.get("title") == R["move_first"]]
    bf = [n for n, r in enumerate(reasons) if r.get("title") == R["before"]]
    assert len(mv) == 1 and len(bf) == 1 and mv[0] > bf[0], "B5: the quantity reason must sit after the misc-section reason in v77"
    moved = reasons.pop(mv[0])
    reasons.insert(bf[0], moved)
    # B5, not by order alone (chat-Claude's review 2026-11-19 23:45): VAV-1's two broad patterns no longer reach the quantity lines
    for old_t, new_t in R["narrow"].items():
        hit = [r for r in reasons if r.get("title") == old_t]
        assert len(hit) == 1, old_t
        hit[0]["title"] = new_t
    titles = {r.get("title") for r in reasons}
    for r in R["new"]:
        assert r["title"] not in titles, r["title"]
        reasons.append(copy.deepcopy(r))
    for title, add in R["append_why"].items():
        own = [r for r in reasons if r.get("title") == title]
        assert len(own) == 1, title
        own[0]["why"] = own[0]["why"] + add
    assert EDGE_PLACEHOLDER not in _canon(c)
    return c


VALVE = "hvac_valve_package"


def valve_config(prev, K):
    """R7 (QR-V (a), owner 2026-11-20 00:10): the Valve Package config's two scope notes lose their "(owner VR9)" tag -- those exact
    strings, nothing else of their text -- and the Derivation tab gains the E13 line ("Thermowell with valve" -> the thermowell, the code
    rule in pricingSheetHelper `valveReviewNets`). Every other byte of the config unchanged (asserted)."""
    c = copy.deepcopy(prev)
    V = K["valve"]
    for path, tag in V["strip"].items():
        keys = path.split(".")
        o = c
        for k in keys[:-1]:
            o = o[k]
        assert o[keys[-1]].count(tag) == 1, path
        o[keys[-1]] = o[keys[-1]].replace(tag, "")
    rl = c["list_spec"]["pricing"]["rule_lines"]
    assert not any(r.get("rule") == V["rule_line"]["rule"] for r in rl)
    rl.append(copy.deepcopy(V["rule_line"]))
    # nothing else moved: undo the declared changes and compare with v77
    back = copy.deepcopy(c)
    back["list_spec"]["pricing"]["rule_lines"] = back["list_spec"]["pricing"]["rule_lines"][:-1]
    for path, tag in V["strip"].items():
        keys = path.split(".")
        o, p = back, prev
        for k in keys[:-1]:
            o, p = o[k], p[k]
        o[keys[-1]] = p[keys[-1]]
    assert _canon(back) == _canon(prev), "the Valve config moved beyond the declared R7 strings and the E13 line"
    return c


def build(out):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import config_validation, extraction
    from nirmaan_stack.services.boq_rate_master.loader import _validate_items, _validate_one_config
    raw = open(V77, "rb").read()
    prev = json.loads(raw.decode("utf-8"))
    if _dump(prev).encode("utf-8") != raw:
        raise SystemExit("re-dumping v77 does not reproduce its bytes -- the series convention is not what this mint writes")
    K = json.load(open(KEYS, encoding="utf-8"))
    final = copy.deepcopy(prev)
    idx = {c["category_id"]: n for n, c in enumerate(prev["category_configs"])}
    final["category_configs"][idx[VAV]] = vav_config(prev["category_configs"][idx[VAV]], K)
    final["category_configs"][idx[VALVE]] = valve_config(prev["category_configs"][idx[VALVE]], K)

    # BYTE-IDENTITY: every v77 item unchanged, in order, none added; every v77 config but hvac_vav_box and hvac_valve_package unchanged
    assert _canon(prev["items"]) == _canon(final["items"]), "a v77 item moved"
    assert len(final["category_configs"]) == len(prev["category_configs"])
    for x, y in zip(prev["category_configs"], final["category_configs"]):
        assert x["category_id"] == y["category_id"]
        assert (_canon(x) == _canon(y)) == (x["category_id"] not in (VAV, VALVE)), x["category_id"]
    assert list(final.keys()) == list(prev.keys())

    _validate_items(final["items"])
    stored = [dict(c, discipline=final["discipline"]) for c in final["category_configs"]]
    for n, c in enumerate(stored):
        try:
            _validate_one_config(c, "category_configs[%d]" % n)
            config_validation._validate_config(c)
        except Exception as e:
            raise SystemExit("config %s refused: %s" % (c["category_id"], e))
    problems = (config_validation.delegated_section_problems(stored, final["items"]) + config_validation.extras_problems(stored, final["items"])
                + config_validation.scope_problems(stored, final["items"]))
    if problems:
        raise SystemExit("cross-category check refuses: %r" % problems)
    cfgs = {(final["discipline"], c["category_id"]): c for c in stored}
    stored_base = [dict(c, discipline=prev["discipline"]) for c in prev["category_configs"]]
    cfgs_base = {(prev["discipline"], c["category_id"]): c for c in stored_base}
    eligible = sorted(c["category_id"] for c in stored if extraction.config_is_eligible(c, cfgs))
    eligible_base = sorted(c["category_id"] for c in stored_base if extraction.config_is_eligible(c, cfgs_base))
    print("eligible configs v77:", eligible_base, "| v78:", eligible)
    assert eligible == eligible_base and VAV not in eligible, (eligible, eligible_base)

    # STUB PROOF: the model's question for every category byte-identical v77 vs v78 except VAV's (VAV is not asked at all: calculator_only)
    def requests(st, cf):
        return {c["category_id"]: json.dumps(extraction.build_items_spec(cf[("HVAC", c["category_id"])], cf, "HVAC"), sort_keys=True)
                for c in st if c.get("list_spec")}
    r_base, r_new = requests(stored_base, cfgs_base), requests(stored, cfgs)
    same = sorted(k for k in r_base if r_base[k] == r_new.get(k))
    diff = sorted(k for k in r_base if r_base[k] != r_new.get(k))
    print("STUB PROOF: item-list requests v77 vs v78 -- identical:", same, "| differing:", diff)
    # the Valve change is a Derivation line and two scope-note texts: neither reaches the model's question (asserted here)
    assert not [k for k in diff if k != VAV], diff

    text = _dump(final)
    tokens = sorted({t for t in re.findall(r"v\d+", text.replace(json.dumps(final.get("source_workbook") or "", ensure_ascii=False), '""'))})
    if tokens:
        raise SystemExit("the asset text carries version-like tokens %r (h07)" % tokens)
    open(out, "w", encoding="utf-8", newline="").write(text)
    print("candidate written:", out, "| items", len(final["items"]), "| configs", len(final["category_configs"]),
          "| sha256", hashlib.sha256(text.encode("utf-8")).hexdigest())
    print("per-config sha16 v78:", {c["category_id"]: _sha16(c) for c in final["category_configs"]})
    print("per-config sha16 v77:", {c["category_id"]: _sha16(c) for c in prev["category_configs"]})
    frappe.destroy()


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
        out[disc] = {"items": len(L), "configs": len(LC), "sha_items": h_i, "sha_configs": h_c,
                     "per_config": {c: _sha16(LC[c]) for c in sorted(LC)}}
        if disc == "HVAC":
            A = {r["item_uid"]: {"kind": r["kind"], "brand": r.get("brand") or None, "unit": r.get("unit") or None, "attributes": r["attributes"], "rates": r["rates"]} for r in asset["items"]}
            AC = {c["category_id"]: c for c in asset["category_configs"]}
            out[disc]["items_missing"] = sorted(set(A) - set(L))
            out[disc]["items_extra"] = sorted(set(L) - set(A))
            out[disc]["items_differing"] = sorted(u for u in set(L) & set(A) if _canon(L[u]) != _canon(A[u]))
            out[disc]["configs_differing"] = sorted(c for c in set(LC) | set(AC) if _canon(LC.get(c)) != _canon(AC.get(c)))
            out[disc]["second_opinion"] = {c: ((LC[c].get("list_spec") or {}).get("second_opinion")) for c in sorted(LC) if LC[c].get("list_spec")}
            out[disc]["vav_calculator_only"] = (LC.get(VAV) or {}).get("calculator_only")
    print(json.dumps(out, indent=1, sort_keys=True))
    frappe.destroy()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("phase", choices=["build", "load", "verify"])
    ap.add_argument("--candidate", default=V78)
    a = ap.parse_args()
    if a.phase == "build":
        build(a.candidate)
    elif a.phase == "load":
        load(a.candidate)
    else:
        verify(a.candidate)
