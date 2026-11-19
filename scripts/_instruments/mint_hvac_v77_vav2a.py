"""VAV-2a (2026-11-19, desktop) -- MINT HVAC v77 = v76 + THE VAV-2a KEYS ON hvac_vav_box AND THE VAV-2a PRICING INPUTS.

What changes (owner rulings, VAV_Rulings_Capture_2026-11-18.md; QR-S (a) / QR-C1 (a) 2026-11-19 13:31):
  hvac_vav_box   list_spec.pricing + own_row_check (B3 / B4 / QR-C1), integrator_cabling (B5), existing_boxes (B6), combination_warning (B9)
                 list_spec.sections misc / sensors + qty_attr "qty_per_box" (B7)
                 list_spec.pricing.derivation_reasons + one reason per new Derivation line; the "That kind's rule for that unit" reason
                 now says 140 per metre is the BCS cost and 196 the quoted rate (owner 2026-11-19 12:35)
                 calculator_only STAYS true (VAV rows stay "coming soon"; VAV-2b removes it)
  items          + 8 hvac_pricing_input (vav_own_row_threshold 0.9, vav_cabling_m_per_box 2, vav_cabling_length_threshold 0.7,
                   vav_existing_dismantle 1.0, vav_existing_dismantle_refix 1.5, vav_existing_refix_with_dismantling 0.5,
                   vav_existing_refix_alone 1.5, vav_combination_warning_share 0.5)
Every other config and EVERY v76 item byte-identical (the Integrator cabling SKU untouched).
The key values are read from ONE file, frontend/.../__fixtures__/vav2aKeys.json (the vav2a* tests read the same file).

Runs IN THE CONTAINER under the bench's python. Phases: build (v76 file -> the candidate; NO database write), load, verify.
Usage (container, from frappe-bench): env/bin/python -I <this> <phase> [--candidate P]
"""
import argparse, copy, hashlib, json, os, re

APP = "/workspace/development/frappe-bench/apps/nirmaan_stack"
DATA = os.path.join(APP, "nirmaan_stack/services/boq_rate_master/data")
V76 = os.path.join(DATA, "rate_master_hvac_all_v76.json")
V77 = os.path.join(DATA, "rate_master_hvac_all_v77.json")
KEYS = os.path.join(APP, "frontend/src/pages/boq-wizard/rate-helper/__fixtures__/vav2aKeys.json")
VAV = "hvac_vav_box"

NEW_REASONS = [
    {"title": "^The (misc item|sensor) section's quantity per vav item is the count the row names",
     "why": "a borrowed item's quantity is the count the row names: a thermostat -> one, \"two if two\" (owner 2026-11-18 22:35); a piece \"on either side\" -> 2 (22:38 \"option A\"); every extra its own item the user can change (23:15 / 23:18)"},
    {"title": "^A row whose extras come to more than a set share",
     "why": "\"all combination rows should have a warning that the user should review it more carefully\" (owner 2026-11-19 12:49); \"option b is ok\" (12:55): warn above a set share of the box rate; \"ok proceed with 50%\" (12:59), a Pricing Input the user can change"},
    {"title": "^A row whose own words are dismantling and refixing",
     "why": "\"dsimatling and refixing 1.5 times\" on the installation rate (owner 2026-11-18 23:49); no extras on such a row (the approved mockup, screen 4, owner 2026-11-19 00:12)"},
    {"title": "^A row whose own words are dismantling of",
     "why": "\"onl;y dismatling same asinstalltion\" (owner 2026-11-18 23:49); no extras on such a row (the approved mockup, screen 4, owner 2026-11-19 00:12)"},
    {"title": "^A row whose own words are refixing",
     "why": "\"only refixing 0.5 times if dismantling seprate row else 1.5\" (owner 2026-11-18 23:49); the separate row must name VAV (VAV-D0 D4); no extras on such a row (mockup screen 4, owner 2026-11-19 00:12)"},
    {"title": "^An extra the sheet charges on its own row",
     "why": "\"if they are charged seprately in any boq row, price not to be added an appropriate note to be given with row refreence..else prices added and declared\" (owner 2026-11-18 23:32); the same sheet, Ducting's way at 90% (QR-3a / QR-4 (a), owner 2026-11-19 00:57); quantities blank or 0 -> the separate row decides (01:23 \"agree on all 3\")"},
    {"title": "^A VAV integrator priced on its own row",
     "why": "a box whose rate includes the integrator takes the \"Integrator Included = Yes\" line (owner item 4, 2026-11-18 22:37); a separate VAV integrator row on the same sheet -> the \"No\" line, presence decides (owner QR-C1 (a), 2026-11-19 13:31)"},
    {"title": "^On a sheet with a VAV integrator anywhere",
     "why": "\"for VAV with integrators we have to check if seprate row for cabling for integrators is there in Boq. if not then we have to include 2 mts of cabling per VAV at 140 per meter supply BCS ... if seprate cabling row is there then cabling price not included. apprpritae note given in both cases\" (owner 2026-11-18 23:14; 23:18 the user can add or remove it); \"VAV must be mentioned in cabling description\" (2026-11-19 01:29); a heading naming VAV counts (01:34 \"yes\"); below 70% the note asks to check the quantity (01:39); 140 is the BCS cost, not the quoted rate (12:35); the rate stays the SKU, the 2 m is a Pricing Input (12:37 / 12:55)"},
]
KIND_RULE_TITLE = "^That kind's rule for that unit"
KIND_RULE_WHY = ("every VAV item has one rate per Nos on the VAV Box sheet; integrator cabling is a per-metre rate counted per box: BCS cost 140 per "
                 "metre, quoted 196 per metre (BCS x 1.4; 392 for 2 m) (owner 2026-11-18 23:14 \"2 mts of cabling per VAV at 140 per meter\"; "
                 "2026-11-19 12:35 \"the 140 per meter is BCSrate and not quoting rate\")")


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


def _uid(key, taken):
    for n in range(100):
        u = "rmi-" + hashlib.sha256(("VAV-2a %s %d" % (key, n)).encode()).hexdigest()[:12]
        if u not in taken:
            taken.add(u)
            return u
    raise SystemExit("no free item_uid for %s" % key)


def own_uids(keys):
    return {"rmi-" + hashlib.sha256(("VAV-2a pricing input %s %d" % (k, n)).encode()).hexdigest()[:12] for k in keys for n in range(100)}


def input_items(K, taken):
    out = []
    for iid, v in K["inputs"].items():
        out.append({"kind": "hvac_pricing_input", "brand": None, "unit": v["unit"],
                    "attributes": {"item": iid, "name": v["name"], "remarks": v["remarks"], "shared_by": "vav"},
                    "rates": {"factor": float(v["factor"])}, "source": {"sheet": "Pricing Inputs", "row": 0},
                    "item_uid": _uid("pricing input " + iid, taken)})
    return out


def vav_config(prev, K):
    c = copy.deepcopy(prev)
    assert c.get("calculator_only") is True, "v76 VAV must carry calculator_only (VAV-2b removes it)"
    pr = c["list_spec"]["pricing"]
    for k, v in K["pricing"].items():
        assert k not in pr, k
        pr[k] = copy.deepcopy(v)
    for s in c["list_spec"]["sections"]:
        for k, v in (K["sections"].get(s["id"]) or {}).items():
            assert k not in s, (s["id"], k)
            s[k] = v
    reasons = pr["derivation_reasons"]
    hit = [r for r in reasons if r["title"] == KIND_RULE_TITLE]
    assert len(hit) == 1, "the kind-rule reason must exist once"
    hit[0]["why"] = KIND_RULE_WHY
    titles = {r["title"] for r in reasons}
    assert not titles & {r["title"] for r in NEW_REASONS}
    reasons += copy.deepcopy(NEW_REASONS)
    return c


def build(out):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import config_validation, extraction
    from nirmaan_stack.services.boq_rate_master.loader import _validate_items, _validate_one_config
    raw = open(V76, "rb").read()
    prev = json.loads(raw.decode("utf-8"))
    if _dump(prev).encode("utf-8") != raw:
        raise SystemExit("re-dumping v76 does not reproduce its bytes -- the series convention is not what this mint writes")
    K = json.load(open(KEYS, encoding="utf-8"))
    taken = {i["item_uid"] for i in prev["items"]}
    taken |= {(r["item_uid"] or "").strip() for r in frappe.get_all("BoQ Rate Master Item", filters={"discipline": "HVAC"}, fields=["item_uid"])} - own_uids(K["inputs"])
    have = {(i.get("attributes") or {}).get("item") for i in prev["items"] if i["kind"] == "hvac_pricing_input"}
    assert not have & set(K["inputs"]), "a VAV-2a input already exists"
    final = copy.deepcopy(prev)
    new_items = input_items(K, taken)
    final["items"] += new_items
    idx = {c["category_id"]: n for n, c in enumerate(prev["category_configs"])}
    final["category_configs"][idx[VAV]] = vav_config(prev["category_configs"][idx[VAV]], K)

    # BYTE-IDENTITY: every v76 item unchanged, in order (the 8 inputs appended); every v76 config but hvac_vav_box unchanged
    assert _canon(prev["items"]) == _canon(final["items"][:len(prev["items"])]), "a v76 item moved"
    assert len(final["items"]) == len(prev["items"]) + len(K["inputs"])
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
    vav_inputs = config_validation.extras_input_ids(next(c for c in stored if c["category_id"] == VAV))
    print("VAV inputs read by its config (extras_input_ids):", vav_inputs)
    assert set(K["inputs"]) <= set(vav_inputs), "a new Pricing Input is not read by the VAV config"
    cfgs = {(final["discipline"], c["category_id"]): c for c in stored}
    stored_base = [dict(c, discipline=prev["discipline"]) for c in prev["category_configs"]]
    cfgs_base = {(prev["discipline"], c["category_id"]): c for c in stored_base}
    eligible = sorted(c["category_id"] for c in stored if extraction.config_is_eligible(c, cfgs))
    eligible_base = sorted(c["category_id"] for c in stored_base if extraction.config_is_eligible(c, cfgs_base))
    print("eligible configs v76:", eligible_base, "| v77:", eligible)
    assert eligible == eligible_base and VAV not in eligible, (eligible, eligible_base)

    # STUB PROOF: the model's question for every category byte-identical v76 vs v77 (VAV is not asked at all: calculator_only)
    def requests(st, cf):
        return {c["category_id"]: json.dumps(extraction.build_items_spec(cf[("HVAC", c["category_id"])], cf, "HVAC"), sort_keys=True)
                for c in st if c.get("list_spec")}
    r_base, r_new = requests(stored_base, cfgs_base), requests(stored, cfgs)
    same = sorted(k for k in r_base if r_base[k] == r_new.get(k))
    diff = sorted(k for k in r_base if r_base[k] != r_new.get(k))
    print("STUB PROOF: item-list requests v76 vs v77 -- identical:", same, "| differing:", diff)
    assert not [k for k in diff if k != VAV], diff

    text = _dump(final)
    tokens = sorted({t for t in re.findall(r"v\d+", text.replace(json.dumps(final.get("source_workbook") or "", ensure_ascii=False), '""'))})
    if tokens:
        raise SystemExit("the asset text carries version-like tokens %r (h07)" % tokens)
    open(out, "w", encoding="utf-8", newline="").write(text)
    print("candidate written:", out, "| items", len(final["items"]), "| configs", len(final["category_configs"]),
          "| sha256", hashlib.sha256(text.encode("utf-8")).hexdigest())
    print("per-config sha16:", {c["category_id"]: _sha16(c) for c in final["category_configs"]})
    print("per-config sha16 v76:", {c["category_id"]: _sha16(c) for c in prev["category_configs"]})
    print("new item uids:", [(i["attributes"]["item"], i["item_uid"]) for i in new_items])
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
    ap.add_argument("--candidate", default=V77)
    a = ap.parse_args()
    if a.phase == "build":
        build(a.candidate)
    elif a.phase == "load":
        load(a.candidate)
    else:
        verify(a.candidate)
