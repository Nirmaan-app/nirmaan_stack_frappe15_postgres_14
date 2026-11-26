"""VAV-FIX (2026-11-25, desktop; the final fix slice of the VAV Box build) -- MINT HVAC v88 = v87 + ONLY the edits of ONE file,
frontend/.../__fixtures__/vavfixEdits.json (5 edits, all on VAV Box):
  S1 (owner 2026-11-20 17:53 "a"; 2026-11-25 00:37) `defaults.<attr>.boq_rows_only` on shape / integrator_included / vav_type -- the ruled
     defaults apply to BoQ rows only; the Calculator starts blank (frontend itemListPricing.boqRowsOnlyDefaultsOff);
  S3 the no-unit bar's one sentence (`pricing.blank_unit_bar.line`);
  S4 rules page line 52 without its internal label (`pricing.derivation_reasons[50].why`).

  items     NONE changed: every item byte-identical to v87 (no rate, markup, name or text of any item moves).
  configs   VAV Box only. Every other config byte-identical.
Every edit names what it replaces and is refused when v87 does not hold it (a new key: `from` null). vavfixEdits.harness.ts applies the same file.
REQUESTS: NO model request moves -- every item-list request and every group context is byte-identical v87 vs v88 (asserted; hashes printed).

Runs IN THE CONTAINER under the bench's python. Phases: build (v87 file -> the candidate; NO database write), load, verify.
The candidate path is REQUIRED (no default into the repo tree).
Usage (container, from frappe-bench): env/bin/python -I <this> build|load|verify --candidate P
"""
import argparse
import copy
import hashlib
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mint_hvac_v79_vav2b1 import APP, DATA, _canon, _connect, _dump, _sha16, load, verify  # noqa: E402  (the same load / verify)
from mint_hvac_v81_vav2b2 import requests  # noqa: E402
from mint_hvac_v82_vav2c1 import apply_config  # noqa: E402  (the same edit semantics)

V87 = os.path.join(DATA, "rate_master_hvac_all_v87.json")  # the base of v88
EDITS = os.path.join(APP, "frontend/src/pages/boq-wizard/rate-helper/__fixtures__/vavfixEdits.json")


def _contexts(stored, cfgs, extraction):
    return {c["category_id"]: json.dumps(extraction._group_context(cfgs, c["discipline"], c["category_id"]), sort_keys=True, default=str,
                                         ensure_ascii=False) for c in stored}


def build(out):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import config_validation, extraction
    from nirmaan_stack.services.boq_rate_master.loader import _validate_items, _validate_one_config
    raw = open(V87, "rb").read()
    prev = json.loads(raw.decode("utf-8"))
    if _dump(prev).encode("utf-8") != raw:
        raise SystemExit("re-dumping v87 does not reproduce its bytes")
    K = json.load(open(EDITS, encoding="utf-8"))
    assert K["pricing_inputs"] == {}, "v88 changes no item"
    final = copy.deepcopy(prev)
    by_cat = {}
    for e in K["configs"]:
        by_cat.setdefault(e["c"], []).append(e)
    known = {c["category_id"] for c in prev["category_configs"]}
    assert set(by_cat) <= known, set(by_cat) - known
    final["category_configs"] = [apply_config(c, by_cat.get(c["category_id"], [])) for c in prev["category_configs"]]

    # ITEM BY ITEM: every item byte-identical, in order
    assert _canon(prev["items"]) == _canon(final["items"])
    print("items %d; changed 0; rates changed 0" % len(final["items"]))
    # KEY BY KEY: undoing every edit gives v87's config back, byte for byte; a config with no edit is unchanged
    for a, b in zip(prev["category_configs"], final["category_configs"]):
        back = apply_config(b, [dict(e, **{"from": e["to"], "to": e["from"]}) for e in reversed(by_cat.get(a["category_id"], []))])
        assert _canon(back) == _canon(a), a["category_id"]
        assert (_canon(a) == _canon(b)) == (a["category_id"] not in by_cat), a["category_id"]
    print("configs changed:", {c: len(v) for c, v in sorted(by_cat.items())}, "| unchanged:", sorted(known - set(by_cat)))
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
    assert eligible == sorted(c["category_id"] for c in stored_base if extraction.config_is_eligible(c, cfgs_base)), eligible
    print("eligible configs (v87 = the new file):", eligible)

    # T7: NO model request moves -- every item-list request and every category's whole group context byte-identical v87 -> v88
    r_base, r_new = requests(stored_base, cfgs_base, extraction), requests(stored, cfgs, extraction)
    for k in sorted(r_new):
        print("   request sha16 %-20s before %s after %s" % (k, hashlib.sha256(r_base[k].encode()).hexdigest()[:16],
                                                        hashlib.sha256(r_new[k].encode()).hexdigest()[:16]))
    diff = sorted(k for k in set(r_base) | set(r_new) if r_base.get(k) != r_new.get(k))
    assert diff == [], diff
    g_base, g_new = _contexts(stored_base, cfgs_base, extraction), _contexts(stored, cfgs, extraction)
    gdiff = sorted(k for k in set(g_base) | set(g_new) if g_base.get(k) != g_new.get(k))
    assert gdiff == [], gdiff
    for k in gdiff:
        print("   group context sha16 %-20s before %s after %s" % (k, hashlib.sha256(g_base[k].encode()).hexdigest()[:16], hashlib.sha256(g_new[k].encode()).hexdigest()[:16]))
    print("MODEL REQUESTS: %d item-list requests and %d group contexts; changed %r (request) and %r (context), v87 -> v88" % (len(r_new), len(g_new), diff, gdiff))

    text = _dump(final)
    tokens = sorted({t for t in re.findall(r"v\d+", text.replace(json.dumps(final.get("source_workbook") or "", ensure_ascii=False), '""'))})
    if tokens:
        raise SystemExit("the asset text carries version-like tokens %r (h07)" % tokens)
    open(out, "w", encoding="utf-8", newline="").write(text)
    print("candidate written:", out, "| items", len(final["items"]), "| configs", len(final["category_configs"]),
          "| sha256", hashlib.sha256(text.encode("utf-8")).hexdigest())
    print("per-config sha16 v88:", {c["category_id"]: _sha16(c) for c in final["category_configs"]})
    frappe.destroy()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("phase", choices=["build", "load", "verify"])
    ap.add_argument("--candidate", required=True)
    a = ap.parse_args()
    if a.phase == "build":
        build(a.candidate)
    elif a.phase == "load":
        load(a.candidate)
    else:
        verify(a.candidate)
