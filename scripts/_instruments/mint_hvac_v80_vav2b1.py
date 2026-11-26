"""VAV-2b1 (2026-11-21, desktop) -- MINT HVAC v80 = v79 + ONLY what the owner's full-rate add needs.

Owner 2026-11-21 01:07 "i think we should be able to add a full bcakner using that. we will need it for seperate rows i think"; 01:09 "yes
for both"; 01:16 the share only on rows that price VAV boxes; 01:21 "b" (the share buttons stay; a user share on another row warns).
chat-Claude's calls 01:10 / 01:23: a new number (v79 as loaded 23:48:53 is never re-minted), hvac_sensors may change ONLY by the Duct
Static Pressure Sensor family and its choice value, and (c2) a user-only family is never asked of the model.
  items          NONE changed (853 = v79's)
  hvac_vav_box   list_spec.pricing.user_addable (BACnet over IP controller -> share bacnet; Duct Static Pressure Sensor -> share dp; each
                 with its double-count line); withdrawn_families + "Duct Static Pressure Sensor"; the sensors section's families + "Duct
                 Static Pressure Sensor"; sheet_shares.lines.not_box_row; derivation_reasons + the full-rate line's reason
  hvac_sensors   + the family "Duct Static Pressure Sensor" (CO2 Sensor's pipeline: the Sensors SKU's own BCS x (1 + markup)) and that value
                 in its family choice list (before "none of these")
Every other config byte-identical. Keys from ONE file, frontend/.../__fixtures__/vav2b1KeysV80.json (vav2b1Keys.harness `withV80Keys` /
`withV80Sensors` apply the same file; pinned equal by vav2b1V80's MINT PARITY test).

Runs IN THE CONTAINER under the bench's python. Phases: build (v79 file -> the candidate; NO database write), load, verify.
Usage (container, from frappe-bench): env/bin/python -I <this> build|load|verify [--candidate P]
"""
import argparse, copy, hashlib, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mint_hvac_v79_vav2b1 import APP, DATA, VAV, _canon, _connect, _dump, _sha16, load, verify  # noqa: E402  (the same load / verify)

V79 = os.path.join(DATA, "rate_master_hvac_all_v79.json")
V80 = os.path.join(DATA, "rate_master_hvac_all_v80.json")
KEYS = os.path.join(APP, "frontend/src/pages/boq-wizard/rate-helper/__fixtures__/vav2b1KeysV80.json")
SENS = "hvac_sensors"


def _add_families(c, add):
    fam = c["list_spec"]["pricing"]["families"]
    for f, d in add.items():
        assert f not in fam, f
        fam[f] = copy.deepcopy(fam[d["copy_of"]])


def _add_value(c, add):
    fid = c["list_spec"]["family_attribute_id"]
    d = [x for x in c["list_spec"]["attribute_definitions"] if x["id"] == fid][0]
    assert add["value"] not in d["values"], add["value"]
    at = d["values"].index(add["before"]) if add["before"] in d["values"] else len(d["values"])
    d["values"].insert(at, add["value"])


def vav_config(prev, K):
    """v80's transformation of hvac_vav_box -- the same as vav2b1Keys.harness.ts `withV80Keys` (pinned equal by test)."""
    c = copy.deepcopy(prev)
    assert c.get("calculator_only") is True
    pr = c["list_spec"]["pricing"]
    k = K["vav"]
    _add_families(c, k.get("families_add") or {})
    if k.get("vav_item_values_add"):
        _add_value(c, k["vav_item_values_add"])
    for f in k["withdrawn_add"]:
        assert f not in pr["withdrawn_families"], f
        pr["withdrawn_families"].append(f)
    sec = [s for s in c["list_spec"]["sections"] if s.get("id") == "sensors"][0]
    for f in k["sensors_section_families_add"]:
        assert f not in sec["families"], f
        sec["families"].append(f)
    assert "user_addable" not in pr
    pr["user_addable"] = copy.deepcopy(k["user_addable"])
    for key, line in (k.get("sheet_shares_lines_add") or {}).items():
        assert key not in pr["sheet_shares"]["lines"], key
        pr["sheet_shares"]["lines"][key] = line
    if k.get("sheet_shares_whole"):
        assert "whole" not in pr["sheet_shares"]
        pr["sheet_shares"]["whole"] = copy.deepcopy(k["sheet_shares_whole"])
    for label, words in (k.get("separate_not_words_add") or {}).items():
        e = [x for x in pr["sheet_shares"]["separate"]["extras"] if x["label"] == label]
        assert len(e) == 1, label
        e[0]["not_words"] = e[0]["not_words"] + "|" + words if e[0].get("not_words") else words
    titles = {r.get("title") for r in pr["derivation_reasons"]}
    for r in k["derivation_reasons_new"]:
        assert r["title"] not in titles, r["title"]
        pr["derivation_reasons"].append(copy.deepcopy(r))
    return c


def sensors_config(prev, K):
    """v80's transformation of hvac_sensors -- the same as vav2b1Keys.harness.ts `withV80Sensors`."""
    c = copy.deepcopy(prev)
    _add_families(c, K["sensors"]["families_add"])
    _add_value(c, K["sensors"]["sensor_values_add"])
    return c


def build(out):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import config_validation, extraction
    from nirmaan_stack.services.boq_rate_master.loader import _validate_items, _validate_one_config
    raw = open(V79, "rb").read()
    prev = json.loads(raw.decode("utf-8"))
    if _dump(prev).encode("utf-8") != raw:
        raise SystemExit("re-dumping v79 does not reproduce its bytes")
    K = json.load(open(KEYS, encoding="utf-8"))
    final = copy.deepcopy(prev)
    idx = {c["category_id"]: n for n, c in enumerate(prev["category_configs"])}
    final["category_configs"][idx[VAV]] = vav_config(prev["category_configs"][idx[VAV]], K)
    final["category_configs"][idx[SENS]] = sensors_config(prev["category_configs"][idx[SENS]], K)

    # BYTE-IDENTITY: every item unchanged and in order; every config but hvac_vav_box and hvac_sensors unchanged
    assert _canon(prev["items"]) == _canon(final["items"]), "an item moved"
    for x, y in zip(prev["category_configs"], final["category_configs"]):
        assert x["category_id"] == y["category_id"]
        assert (_canon(x) == _canon(y)) == (x["category_id"] not in (VAV, SENS)), x["category_id"]
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
    print("eligible configs v79:", eligible_base, "| v80:", eligible)
    assert eligible == eligible_base and VAV not in eligible and SENS not in eligible, (eligible, eligible_base)

    # STUB PROOF (c2): the model's question byte-identical v79 vs v80 for VAV and every category but hvac_sensors; hvac_sensors' own question
    # differs ONLY by the new choice value (it is never sent: not eligible, and its one borrower, VAV, keeps the user-only family out)
    def requests(st, cf):
        return {c["category_id"]: json.dumps(extraction.build_items_spec(cf[("HVAC", c["category_id"])], cf, "HVAC"), sort_keys=True)
                for c in st if c.get("list_spec")}
    r_base, r_new = requests(stored_base, cfgs_base), requests(stored, cfgs)
    same = sorted(k for k in r_base if r_base[k] == r_new.get(k))
    diff = sorted(k for k in r_base if r_base[k] != r_new.get(k))
    print("STUB PROOF: item-list requests v79 vs v80 -- identical:", same, "| differing:", diff)
    assert diff in ([], [SENS]), diff
    if diff:
        a, b = json.loads(r_base[SENS]), json.loads(r_new[SENS])
        for d in b["attribute_definitions"]:
            if d["id"] == b["family_attribute_id"]:
                d["values"] = [v for v in d["values"] if v != K["sensors"]["sensor_values_add"]["value"]]
        assert _canon(a) == _canon(b), "hvac_sensors' question differs by more than the new value"
        print("hvac_sensors' own question differs ONLY by the value", K["sensors"]["sensor_values_add"]["value"], "(never sent)")
    borrowers = sorted(c["category_id"] for c in stored if any(isinstance(s, dict) and s.get("category_id") == SENS
                                                              for s in ((c.get("list_spec") or {}).get("sections") or [])))
    print("borrowers of hvac_sensors:", borrowers)

    text = _dump(final)
    tokens = sorted({t for t in re.findall(r"v\d+", text.replace(json.dumps(final.get("source_workbook") or "", ensure_ascii=False), '""'))})
    if tokens:
        raise SystemExit("the asset text carries version-like tokens %r (h07)" % tokens)
    open(out, "w", encoding="utf-8", newline="").write(text)
    print("candidate written:", out, "| items", len(final["items"]), "| configs", len(final["category_configs"]),
          "| sha256", hashlib.sha256(text.encode("utf-8")).hexdigest())
    print("per-config sha16 v80:", {c["category_id"]: _sha16(c) for c in final["category_configs"]})
    print("per-config sha16 v79:", {c["category_id"]: _sha16(c) for c in prev["category_configs"]})
    frappe.destroy()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("phase", choices=["build", "load", "verify"])
    ap.add_argument("--candidate", default=V80)
    a = ap.parse_args()
    if a.phase == "build":
        build(a.candidate)
    elif a.phase == "load":
        load(a.candidate)
    else:
        verify(a.candidate)
