"""DU-2 K2c (2026-11-16, run on the laptop) -- MINT HVAC v74 = v73 + THE DERIVATION WORDING chat-Claude's read returned (CH-DU2-5
W1 / W5 / W6 / W7; the owner's standing gate: WRONG WORDING = 0 before deploy). DISPLAY ONLY: nothing here is read by the model's question
(asserted: every items spec byte-identical to v73); Misc's unit refusal is a sentence the panel shows, its rule unchanged.

What changes:
  hvac_ducting  derivation_reasons: the re-file lines' reasons follow their new titles (W1); "That kind's rule for that unit" gets its
                own reason (W5); the sheet-insulation line gets the DR7 / G-3 reason, not the live-link one (W7)
  hvac_misc     unit_refusal names every unit Misc prices (Nos, sq.m, sq.ft or CFM) (W6)
Every item and every other config byte-identical to v73; second_opinion stays FALSE.

Runs IN THE CONTAINER under the bench's python. Phases: build (v73 -> the candidate; NO database write), load, verify.
Usage (container, from frappe-bench): env/bin/python -I <this> <phase> [--candidate P]
"""
import argparse, copy, hashlib, json, os, re

APP = "/workspace/development/frappe-bench/apps/nirmaan_stack"
DATA = os.path.join(APP, "nirmaan_stack/services/boq_rate_master/data")
V73 = os.path.join(DATA, "rate_master_hvac_all_v73.json")
V74 = os.path.join(DATA, "rate_master_hvac_all_v74.json")
DUCT, MISC, VALVE = "hvac_ducting", "hvac_misc", "hvac_valve_package"
REASON_SWAP = {
    "^A row whose words name .* refuses$": "^A row the model reads as not a duct, whose words name",
    "^A row read as none of the kinds": "^Any other row the model reads as not a duct",
}
UNIT_RULE_WHY = ("each unit has its own rule: per sq.m from the sheet; per sq.ft = per sq.m x 0.0929; per metre by the diameter (round)"
                 " or the sides (rectangular / oval) (owner, 2026-11-13 20:06; G-5 2026-11-15)")
SHEET_INS_REASON = {"title": "^On a sheet that quotes duct insulation on its own rows",
                    "why": "\"if there is seprate row for duct insulationthen insulation should not be priced witthe duct row\" (owner DR7, 2026-11-13 21:06); the quantity check beside it (owner G-3, 2026-11-15 13:15-13:18)"}
MISC_UNIT_REFUSAL = "unit '{unit}' is not a Misc unit - these Misc items are priced per Nos, sq.m, sq.ft or CFM - price this row by hand"


def ducting_config(prev):
    c = copy.deepcopy(prev)
    pr = c["list_spec"]["pricing"]
    rs = pr["derivation_reasons"]
    seen = set()
    for r in rs:
        if r.get("title") in REASON_SWAP:
            seen.add(r["title"]); r["title"] = REASON_SWAP[r["title"]]
        if r.get("title") == "^That kind's rule for that unit":
            r["why"] = UNIT_RULE_WHY; seen.add("unit")
    assert seen == set(REASON_SWAP) | {"unit"}, seen
    pr["derivation_reasons"] = [copy.deepcopy(SHEET_INS_REASON)] + rs
    assert c["list_spec"].get("second_opinion") is False
    return c


def misc_config(prev):
    c = copy.deepcopy(prev)
    pr = c["list_spec"]["pricing"]
    assert pr["unit_refusal"].startswith("unit '{unit}' is not a Misc unit")
    pr["unit_refusal"] = MISC_UNIT_REFUSAL
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
    raw = open(V73, "rb").read()
    prev = json.loads(raw.decode("utf-8"))
    if _dump(prev).encode("utf-8") != raw:
        raise SystemExit("re-dumping v73 does not reproduce its bytes -- the series convention is not what this mint writes")
    final = copy.deepcopy(prev)
    idx = {c["category_id"]: n for n, c in enumerate(prev["category_configs"])}
    final["category_configs"][idx[DUCT]] = ducting_config(prev["category_configs"][idx[DUCT]])
    final["category_configs"][idx[MISC]] = misc_config(prev["category_configs"][idx[MISC]])
    assert _canon(prev["items"]) == _canon(final["items"]), "an item moved"
    for x, y in zip(prev["category_configs"], final["category_configs"]):
        assert x["category_id"] == y["category_id"]
        if x["category_id"] not in (DUCT, MISC):
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
    print("STUB PROOF: item-list requests v73 vs v74 -- identical:", sorted(k for k in r_base if r_base[k] == r_new.get(k)), "| differing:", diff)
    assert diff == [], diff
    print("eligible configs v74 = v73:", eligible)

    text = _dump(final)
    tokens = sorted({t for t in re.findall(r"v\d+", text.replace(json.dumps(final.get("source_workbook") or "", ensure_ascii=False), '""'))})
    if tokens:
        raise SystemExit("the asset text carries version-like tokens %r (h07)" % tokens)
    open(out, "w", encoding="utf-8", newline="").write(text)
    print("candidate written:", out, "| items", len(final["items"]), "| configs", len(final["category_configs"]),
          "| sha256", hashlib.sha256(text.encode("utf-8")).hexdigest(),
          "| per-config sha16", {c["category_id"]: hashlib.sha256(_canon(c).encode()).hexdigest()[:16] for c in final["category_configs"] if c["category_id"] in (DUCT, MISC)})
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
    ap.add_argument("--candidate", default=V74)
    a = ap.parse_args()
    if a.phase == "build":
        build(a.candidate)
    elif a.phase == "load":
        load(a.candidate)
    else:
        verify(a.candidate)
