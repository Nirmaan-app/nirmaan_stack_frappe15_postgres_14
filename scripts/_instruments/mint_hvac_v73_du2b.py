"""DU-2 K2b (2026-11-16, run on the laptop) -- MINT HVAC v73 = v72 + THE DECLARED DERIVATION LINES FOR THE K1b CODE RULES (owner's
standing rule 2026-11-15 13:30-13:41: every rule a category prices by is on its Derivation tab before it deploys). DISPLAY ONLY: nothing
here is read by pricing or by the model's question (asserted: every items spec byte-identical to v72). Every item and every other config
byte-identical to v72; second_opinion stays FALSE.

What changes in hvac_ducting:
  rule_lines          + R-PIR   a PIR row with no gauge read takes the row's own "NN mm thick" words (owner R-DOUBT "PIR ducts", 23:57)
                      + R-LABOUR a "labour charges" row is the duct's installation only (owner QR-1 Q1 (a), 2026-11-16 01:27)
                      ~ DR7 detail: a duct word in ANY heading above a separate insulation row counts (owner QR-4 Q1 (a), DECIDED-WHILE-ASLEEP)
  derivation_reasons  + one reason per new line

Runs IN THE CONTAINER under the bench's python. Phases: build (v72 -> the candidate; NO database write), load, verify.
Usage (container, from frappe-bench): env/bin/python -I <this> <phase> [--candidate P]
"""
import argparse, copy, hashlib, json, os, re

APP = "/workspace/development/frappe-bench/apps/nirmaan_stack"
DATA = os.path.join(APP, "nirmaan_stack/services/boq_rate_master/data")
V72 = os.path.join(DATA, "rate_master_hvac_all_v72.json")
V73 = os.path.join(DATA, "rate_master_hvac_all_v73.json")
DUCT, MISC, VALVE = "hvac_ducting", "hvac_misc", "hvac_valve_package"
RULE_PIR = {"rule": "R-PIR", "title": "A PIR duct row with no gauge read takes the panel thickness from its own words",
            "detail": "'20mm thick PIR Panels' -> PIR 20 mm, with a line saying the thickness came from the row's own words; no thickness words -> priced by hand"}
RULE_LABOUR = {"rule": "R-LABOUR", "title": "A 'labour charges' duct row read installation only is priced as the duct's installation only",
               "detail": "no supply; the installation x (1 + 'Ducting - installation-only uplift', 0% today); note: insulation installation is priced by Insulation's own rows"}
DR7_DETAIL_ADD = "; a separate insulation row counts when its own words or ANY heading above it name duct ('Insulation' under 'Duct insulation works')"
REASONS_FIRST = [
    {"rule": "R-PIR", "why": "\"20mm thick PIR Panels\" -> \"PIR ducts\" = PIR duct 20 mm (owner R-DOUBT, 2026-11-15 23:57)"},
    {"rule": "R-LABOUR", "why": "\"Labour Charges for GI Duct Erections ...\" -> \"installation of duct\" (owner 23:57; QR-1 Q1 (a), 2026-11-16 01:27)"},
]


def ducting_config(prev):
    c = copy.deepcopy(prev)
    pr = c["list_spec"]["pricing"]
    rl = pr["rule_lines"]
    dr7 = [r for r in rl if r["rule"] == "DR7"]
    assert len(dr7) == 1
    dr7[0]["detail"] = dr7[0]["detail"] + DR7_DETAIL_ADD
    rl.append(copy.deepcopy(RULE_PIR))
    rl.append(copy.deepcopy(RULE_LABOUR))
    pr["derivation_reasons"] = copy.deepcopy(REASONS_FIRST) + pr["derivation_reasons"]
    assert c["list_spec"].get("second_opinion") is False
    return c


def _connect():
    os.chdir("/workspace/development/frappe-bench/sites")
    import frappe
    frappe.init(site="localhost"); frappe.connect()
    return frappe


def _canon(o):
    return json.dumps(o, sort_keys=True, separators=(",", ":"), default=str)


def _dump(p):
    return json.dumps(p, indent=1, ensure_ascii=False) + "\n"


def build(out):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import config_validation, extraction
    from nirmaan_stack.services.boq_rate_master.loader import _validate_items, _validate_one_config
    raw = open(V72, "rb").read()
    prev = json.loads(raw.decode("utf-8"))
    if _dump(prev).encode("utf-8") != raw:
        raise SystemExit("re-dumping v72 does not reproduce its bytes -- the series convention is not what this mint writes")
    final = copy.deepcopy(prev)
    idx = {c["category_id"]: n for n, c in enumerate(prev["category_configs"])}
    final["category_configs"][idx[DUCT]] = ducting_config(prev["category_configs"][idx[DUCT]])
    assert _canon(prev["items"]) == _canon(final["items"]), "an item moved"
    for x, y in zip(prev["category_configs"], final["category_configs"]):
        assert x["category_id"] == y["category_id"]
        if x["category_id"] != DUCT:
            assert _canon(x) == _canon(y), x["category_id"]
        else:
            assert _canon(x) != _canon(y), x["category_id"]
    assert list(final.keys()) == list(prev.keys())

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
    stored_base = [dict(c, discipline=prev["discipline"]) for c in prev["category_configs"]]
    cfgs_base = {(prev["discipline"], c["category_id"]): c for c in stored_base}
    eligible = sorted(c["category_id"] for c in stored if extraction.config_is_eligible(c, cfgs))
    eligible_base = sorted(c["category_id"] for c in stored_base if extraction.config_is_eligible(c, cfgs_base))
    assert eligible == eligible_base, (eligible, eligible_base)

    # STUB PROOF: the model's question is byte-identical for EVERY category (the new keys are display only)
    def requests(st, cf):
        return {c["category_id"]: json.dumps(extraction.build_items_spec(cf[("HVAC", c["category_id"])], cf, "HVAC"), sort_keys=True)
                for c in st if c.get("list_spec")}
    r_base, r_new = requests(stored_base, cfgs_base), requests(stored, cfgs)
    diff = sorted(k for k in set(r_base) | set(r_new) if r_base.get(k) != r_new.get(k))
    print("STUB PROOF: item-list requests v72 vs v73 -- identical:", sorted(k for k in r_base if r_base[k] == r_new.get(k)), "| differing:", diff)
    assert diff == [], diff
    print("eligible configs v73 = v72:", eligible)

    text = _dump(final)
    tokens = sorted({t for t in re.findall(r"v\d+", text.replace(json.dumps(final.get("source_workbook") or "", ensure_ascii=False), '""'))})
    if tokens:
        raise SystemExit("the asset text carries version-like tokens %r (h07)" % tokens)
    open(out, "w", encoding="utf-8", newline="").write(text)
    print("candidate written:", out, "| items", len(final["items"]), "| configs", len(final["category_configs"]),
          "| sha256", hashlib.sha256(text.encode("utf-8")).hexdigest(),
          "| per-config sha16", {c["category_id"]: hashlib.sha256(_canon(c).encode()).hexdigest()[:16] for c in final["category_configs"] if c["category_id"] == DUCT})
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
                     "per_config": {c: hashlib.sha256(_canon(LC[c]).encode()).hexdigest()[:16] for c in sorted(LC)}}
        if disc == "HVAC":
            A = {r["item_uid"]: {"kind": r["kind"], "brand": r.get("brand") or None, "unit": r.get("unit") or None, "attributes": r["attributes"], "rates": r["rates"]} for r in asset["items"]}
            AC = {c["category_id"]: c for c in asset["category_configs"]}
            out[disc]["items_differing"] = sorted(u for u in set(L) | set(A) if _canon(L.get(u)) != _canon(A.get(u)))
            out[disc]["configs_differing"] = sorted(c for c in set(LC) | set(AC) if _canon(LC.get(c)) != _canon(AC.get(c)))
            out[disc]["second_opinion"] = {c: ((LC[c].get("list_spec") or {}).get("second_opinion")) for c in (VALVE, MISC, DUCT) if c in LC}
    print(json.dumps(out, indent=1, sort_keys=True))
    frappe.destroy()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("phase", choices=["build", "load", "verify"])
    ap.add_argument("--candidate", default=V73)
    a = ap.parse_args()
    if a.phase == "build":
        build(a.candidate)
    elif a.phase == "load":
        load(a.candidate)
    else:
        verify(a.candidate)
