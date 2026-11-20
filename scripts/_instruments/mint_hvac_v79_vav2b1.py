"""VAV-2b1 (2026-11-20, desktop) -- MINT HVAC v79 = v78 + THE VAV-2b1 ITEMS AND hvac_vav_box KEYS.

What changes (owner rulings, VAV_Rulings_Capture_2026-11-18.md 20 Nov 14:10 - 19:51; VAV-2b1 prompt R1 - R16, B8):
  items          + "DDC Panel/ Controller" (VAV Box sheet, BCS 25,000 + 5,000, 0.4 / 0.6; R9, owner 15:23 / 15:24)
                 + "Duct Static Pressure Sensor" (Sensors sheet row 11, Greystone / Honeywell, BCS 7,650 + 500, 0.4 / 0.8; R8 14:35 --
                   it was NOT an item before)
                 + three Pricing Inputs: VAVs per BACnet controller 32, per DP sensor 30, per DDC panel 200 (R9, 15:23 "yes")
                 each inserted after the last item of its kind; NO item deleted or changed (the Differential Pressure Switch stays)
  hvac_vav_box   list_spec.pricing + sheet_shares (R1 / R3 / R5 - R8 / R10), withdrawn_families (R2 / R8), combination_warning.heading
                 (R11), band_from.lower_limit (R12), own_row_check.serves.also (R13); derivation_reasons: line 19's reason replaced
                 (R7), the new reasons appended (each with the owner's words)
                 calculator_only STAYS true (VAV rows stay "coming soon"; VAV-2b2 removes it)
Every other item and every other config byte-identical (the Sensors borrow-only config included: the DP sensor share reads the new
item directly, so no offered kind changes). The keys are read from ONE file, frontend/.../__fixtures__/vav2b1Keys.json (the vav2b1*
tests apply the same file to a scratch copy, vav2b1Keys.harness `withV79Keys`).

Runs IN THE CONTAINER under the bench's python. Phases: build (v78 file -> the candidate; NO database write), load, verify.
Usage (container, from frappe-bench): env/bin/python -I <this> build|load|verify [--candidate P]
"""
import argparse, copy, hashlib, json, os, re

APP = "/workspace/development/frappe-bench/apps/nirmaan_stack"
DATA = os.path.join(APP, "nirmaan_stack/services/boq_rate_master/data")
V78 = os.path.join(DATA, "rate_master_hvac_all_v78.json")
V79 = os.path.join(DATA, "rate_master_hvac_all_v79.json")
KEYS = os.path.join(APP, "frontend/src/pages/boq-wizard/rate-helper/__fixtures__/vav2b1Keys.json")
VAV = "hvac_vav_box"


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
    """The next file's transformation of hvac_vav_box -- the same as vav2b1Keys.harness.ts `withV79Keys` (pinned equal by test)."""
    c = copy.deepcopy(prev)
    assert c.get("calculator_only") is True, "v78 VAV must carry calculator_only (VAV-2b2 removes it)"
    pr = c["list_spec"]["pricing"]
    P = K["pricing"]
    for k in ("sheet_shares", "withdrawn_families"):
        assert k not in pr, k
    pr["withdrawn_families"] = copy.deepcopy(P["withdrawn_families"])
    assert "also" not in pr["own_row_check"]["serves"]
    pr["own_row_check"]["serves"]["also"] = copy.deepcopy(P["own_row_check_serves_also"])
    assert "heading" not in pr["combination_warning"]
    pr["combination_warning"]["heading"] = P["combination_warning_heading"]
    assert "lower_limit" not in pr["band_from"]
    pr["band_from"]["lower_limit"] = copy.deepcopy(P["band_from_lower_limit"])
    pr["sheet_shares"] = copy.deepcopy(P["sheet_shares"])
    assert pr["sheet_shares"]["count"]["blank"] == "skip", "QR-N (b), owner 2026-11-20 19:46: blank / 0 counts 0; nothing only when all are"
    reasons = pr["derivation_reasons"]
    for old, new in K["derivation_reasons"]["replace"].items():
        hit = [n for n, r in enumerate(reasons) if r.get("title") == old]
        assert len(hit) == 1, old
        reasons[hit[0]] = copy.deepcopy(new)
    titles = {r.get("title") for r in reasons}
    for r in K["derivation_reasons"]["new"]:
        assert r["title"] not in titles, r["title"]
        reasons.append(copy.deepcopy(r))
    return c


def with_items(prev_items, K):
    """The v78 items with the new ones, each inserted after the last item of its kind; every v78 item unchanged and in order."""
    items = copy.deepcopy(prev_items)
    uids = {it["item_uid"] for it in items}
    for new in K["items"]:
        assert new["item_uid"] not in uids, new["item_uid"]
        same = [n for n, it in enumerate(items) if it["kind"] == new["kind"]]
        assert same, new["kind"]
        items.insert(same[-1] + 1, copy.deepcopy(new))
        uids.add(new["item_uid"])
    return items


def build(out):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import config_validation, extraction
    from nirmaan_stack.services.boq_rate_master.loader import _validate_items, _validate_one_config
    raw = open(V78, "rb").read()
    prev = json.loads(raw.decode("utf-8"))
    if _dump(prev).encode("utf-8") != raw:
        raise SystemExit("re-dumping v78 does not reproduce its bytes -- the series convention is not what this mint writes")
    K = json.load(open(KEYS, encoding="utf-8"))
    final = copy.deepcopy(prev)
    idx = {c["category_id"]: n for n, c in enumerate(prev["category_configs"])}
    final["category_configs"][idx[VAV]] = vav_config(prev["category_configs"][idx[VAV]], K)
    final["items"] = with_items(prev["items"], K)

    # BYTE-IDENTITY: every v78 item unchanged and in order (the five new ones taken out); every config but hvac_vav_box unchanged
    new_uids = {it["item_uid"] for it in K["items"]}
    assert _canon(prev["items"]) == _canon([it for it in final["items"] if it["item_uid"] not in new_uids]), "a v78 item moved"
    assert len(final["items"]) == len(prev["items"]) + len(K["items"])
    assert len(final["category_configs"]) == len(prev["category_configs"])
    for x, y in zip(prev["category_configs"], final["category_configs"]):
        assert x["category_id"] == y["category_id"]
        assert (_canon(x) == _canon(y)) == (x["category_id"] != VAV), x["category_id"]
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
    print("eligible configs v78:", eligible_base, "| v79:", eligible)
    assert eligible == eligible_base and VAV not in eligible, (eligible, eligible_base)

    # STUB PROOF: the model's question for EVERY category byte-identical v78 vs v79, VAV's included (no model request changes here)
    def requests(st, cf):
        return {c["category_id"]: json.dumps(extraction.build_items_spec(cf[("HVAC", c["category_id"])], cf, "HVAC"), sort_keys=True)
                for c in st if c.get("list_spec")}
    r_base, r_new = requests(stored_base, cfgs_base), requests(stored, cfgs)
    same = sorted(k for k in r_base if r_base[k] == r_new.get(k))
    diff = sorted(k for k in r_base if r_base[k] != r_new.get(k))
    print("STUB PROOF: item-list requests v78 vs v79 -- identical:", same, "| differing:", diff)
    assert not diff, diff

    text = _dump(final)
    tokens = sorted({t for t in re.findall(r"v\d+", text.replace(json.dumps(final.get("source_workbook") or "", ensure_ascii=False), '""'))})
    if tokens:
        raise SystemExit("the asset text carries version-like tokens %r (h07)" % tokens)
    open(out, "w", encoding="utf-8", newline="").write(text)
    print("candidate written:", out, "| items", len(final["items"]), "| configs", len(final["category_configs"]),
          "| sha256", hashlib.sha256(text.encode("utf-8")).hexdigest())
    print("per-config sha16 v79:", {c["category_id"]: _sha16(c) for c in final["category_configs"]})
    print("per-config sha16 v78:", {c["category_id"]: _sha16(c) for c in prev["category_configs"]})
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
    ap.add_argument("--candidate", default=V79)
    a = ap.parse_args()
    if a.phase == "build":
        build(a.candidate)
    elif a.phase == "load":
        load(a.candidate)
    else:
        verify(a.candidate)
