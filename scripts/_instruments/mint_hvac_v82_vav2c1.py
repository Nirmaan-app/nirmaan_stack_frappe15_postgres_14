"""VAV-2c1 (2026-11-22, desktop) -- MINT HVAC v82 = v81 + ONLY the edits of ONE file, frontend/.../__fixtures__/vav2c1Edits.json (prompt B9).

  items     the Pricing Inputs' texts (unit, remarks) and ONE rename -- no value, no id, no other item; nothing added or deleted.
  configs   texts at their key paths (the reworded VAV sentences, the internal labels off every pricer-facing text), and the few declared
            keys: the scope's `lines_follow`, `sheet_shares.labels.need_vavs_whole` / `.vavs_per_unit`, the BACnet block's
            `count_without_vavs` gone, the HVAC Pricing Inputs' `live_reading`.
Every edit names what it replaces and is refused when v81 does not hold it. vav2c1.harness.ts applies the same file to scratch copies (pinned
equal by the MINT PARITY test). Every category's model request is proved byte-identical v81 vs v82, hvac_vav_box included.

Runs IN THE CONTAINER under the bench's python. Phases: build (v81 file -> the candidate; NO database write), load, verify.
Usage (container, from frappe-bench): env/bin/python -I <this> build|load|verify [--candidate P]
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

V81 = os.path.join(DATA, "rate_master_hvac_all_v81.json")
V82 = os.path.join(DATA, "rate_master_hvac_all_v82.json")
EDITS = os.path.join(APP, "frontend/src/pages/boq-wizard/rate-helper/__fixtures__/vav2c1Edits.json")


def apply_config(cfg, edits):
    """One config with its edits applied (each at its key path; `from` null = a new key, `to` null = the key goes). Pure."""
    c = copy.deepcopy(cfg)
    for e in edits:
        node = c
        for p in e["p"][:-1]:
            node = node[p]
        last = e["p"][-1]
        have = node[last] if (isinstance(node, list) or last in node) else None
        if have != e["from"]:
            raise SystemExit("edit %s %r: the file holds %r, not %r" % (e["c"], e["p"], have, e["from"]))
        if e["to"] is None:
            del node[last]
        else:
            node[last] = copy.deepcopy(e["to"])
    return c


def apply_items(items, texts):
    """The items with each declared Pricing Input's unit / remarks / name changed. Pure; nothing added or deleted, no value touched."""
    out = copy.deepcopy(items)
    by = {i["item_uid"]: i for i in out}
    for uid, ch in texts.items():
        it = by[uid]
        assert it["kind"].endswith("_pricing_input") and it["attributes"]["item"] == ch["item"], uid
        for f in ("unit", "remarks", "name"):
            if f not in ch:
                continue
            holder = it if f == "unit" else it["attributes"]
            assert holder[f] == ch[f][0], (uid, f, holder[f])
            holder[f] = ch[f][1]
    return out


def build(out):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import config_validation, extraction
    from nirmaan_stack.services.boq_rate_master.loader import _validate_items, _validate_one_config
    raw = open(V81, "rb").read()
    prev = json.loads(raw.decode("utf-8"))
    if _dump(prev).encode("utf-8") != raw:
        raise SystemExit("re-dumping v81 does not reproduce its bytes")
    K = json.load(open(EDITS, encoding="utf-8"))
    final = copy.deepcopy(prev)
    by_cat = {}
    for e in K["configs"]:
        by_cat.setdefault(e["c"], []).append(e)
    known = {c["category_id"] for c in prev["category_configs"]}
    assert set(by_cat) <= known, set(by_cat) - known
    final["category_configs"] = [apply_config(c, by_cat.get(c["category_id"], [])) for c in prev["category_configs"]]
    final["items"] = apply_items(prev["items"], K["pricing_inputs"])

    # ITEM BY ITEM: same uids in order; changed = exactly the declared Pricing Inputs, and only their unit / remarks / name
    assert [a["item_uid"] for a in prev["items"]] == [b["item_uid"] for b in final["items"]]
    changed = [a["item_uid"] for a, b in zip(prev["items"], final["items"]) if _canon(a) != _canon(b)]
    assert sorted(changed) == sorted(K["pricing_inputs"]), set(changed) ^ set(K["pricing_inputs"])
    for a, b in zip(prev["items"], final["items"]):
        x, y = copy.deepcopy(a), copy.deepcopy(b)
        for z in (x, y):
            z.pop("unit", None)
            z["attributes"].pop("remarks", None)
            if a["item_uid"] in changed:
                z["attributes"].pop("name", None)
        assert _canon(x) == _canon(y), a["item_uid"]
        assert _canon(a["rates"]) == _canon(b["rates"]) and (a["unit"] == b["unit"] or a["item_uid"] in changed)
    print("items %d; changed %d (Pricing Input texts only); rates changed 0" % (len(final["items"]), len(changed)))
    # KEY BY KEY: undoing every edit gives v81's config back, byte for byte
    for a, b in zip(prev["category_configs"], final["category_configs"]):
        back = apply_config(b, [dict(e, **{"from": e["to"], "to": e["from"]}) for e in by_cat.get(a["category_id"], [])])
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
    print("eligible configs (v81 = the new file):", eligible)

    # T5: EVERY item-list category's model request byte-identical, hvac_vav_box included
    r_base, r_new = requests(stored_base, cfgs_base, extraction), requests(stored, cfgs, extraction)
    diff = sorted(k for k in set(r_base) | set(r_new) if r_base.get(k) != r_new.get(k))
    for k in sorted(r_new):
        print("   request sha16 %-20s before %s after %s" % (k, hashlib.sha256(r_base[k].encode()).hexdigest()[:16],
                                                        hashlib.sha256(r_new[k].encode()).hexdigest()[:16]))
    assert not diff, diff
    print("MODEL REQUESTS: %d item-list categories, 0 differ" % len(r_new))

    text = _dump(final)
    tokens = sorted({t for t in re.findall(r"v\d+", text.replace(json.dumps(final.get("source_workbook") or "", ensure_ascii=False), '""'))})
    if tokens:
        raise SystemExit("the asset text carries version-like tokens %r (h07)" % tokens)
    open(out, "w", encoding="utf-8", newline="").write(text)
    print("candidate written:", out, "| items", len(final["items"]), "| configs", len(final["category_configs"]),
          "| sha256", hashlib.sha256(text.encode("utf-8")).hexdigest())
    print("per-config sha16 v82:", {c["category_id"]: _sha16(c) for c in final["category_configs"]})
    frappe.destroy()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("phase", choices=["build", "load", "verify"])
    ap.add_argument("--candidate", default=V82)
    a = ap.parse_args()
    if a.phase == "build":
        build(a.candidate)
    elif a.phase == "load":
        load(a.candidate)
    else:
        verify(a.candidate)
