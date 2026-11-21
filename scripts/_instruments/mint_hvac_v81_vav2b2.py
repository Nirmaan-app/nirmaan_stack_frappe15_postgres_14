"""VAV-2b2 (2026-11-21, desktop) -- MINT HVAC v81 = v80 + ONLY the VAV-2b2 keys (prompt B10).

  items          ONE value changed: the Pricing Input "VAV - combination warning share" (vav_combination_warning_share) 0.5 -> 0.25 and
                 its remarks name the ruling (owner 2026-11-21 10:25 "2 lower it to 25%"). No item added or deleted.
  hvac_vav_box   `calculator_only` gone (owner 2026-11-19 02:55 "optiom a": the switch is "removed in VAV-2b"); the reading questions
                 (B1); the VAV-2b2 pricing keys (B2 - B9) and their Derivation lines.
Every other config byte-identical. Keys from ONE file, frontend/.../__fixtures__/vav2b2Keys.json (vav2b2Keys.harness `withV81Keys` /
`withV81Items` apply the same file; pinned equal by the vav2b2 MINT PARITY test).

Runs IN THE CONTAINER under the bench's python. Phases: build (v80 file -> the candidate; NO database write), load, verify.
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
from mint_hvac_v79_vav2b1 import APP, DATA, VAV, _canon, _connect, _dump, _sha16, load, verify  # noqa: E402  (the same load / verify)

V80 = os.path.join(DATA, "rate_master_hvac_all_v80.json")
V81 = os.path.join(DATA, "rate_master_hvac_all_v81.json")
KEYS = os.path.join(APP, "frontend/src/pages/boq-wizard/rate-helper/__fixtures__/vav2b2Keys.json")


def vav_config(prev, K):
    """v81's transformation of hvac_vav_box -- the same as vav2b2Keys.harness.ts `withV81Keys` (pinned equal by test). Idempotent on v81."""
    c = copy.deepcopy(prev)
    k = K["vav"]
    for key in k.get("drop_top_keys") or []:
        c.pop(key, None)
    ls = c["list_spec"]
    ids = [d["id"] for d in ls["attribute_definitions"]]
    for d in k.get("list_defs_add") or []:
        if d["id"] not in ids:
            ls["attribute_definitions"].append(copy.deepcopy(d))
    for did, tail in (k.get("list_def_notes_append") or {}).items():
        d = [x for x in ls["attribute_definitions"] if x["id"] == did]
        assert len(d) == 1, did
        if not d[0].get("note", "").endswith(tail):
            d[0]["note"] = d[0].get("note", "") + tail
    for sid, note in (k.get("section_family_notes") or {}).items():
        s = [x for x in ls.get("sections") or [] if x.get("id") == sid]
        assert len(s) == 1, sid
        s[0]["family_note"] = note
    pr = ls["pricing"]
    for key, val in (k.get("pricing_set") or {}).items():
        pr[key] = copy.deepcopy(val)
    for path, val in (k.get("pricing_merge") or {}).items():
        node = pr
        parts = path.split(".")
        for p in parts[:-1]:
            node = node[p]
        node[parts[-1]] = copy.deepcopy(val)
    for label, words in (k.get("separate_not_words_add") or {}).items():
        e = [x for x in pr["sheet_shares"]["separate"]["extras"] if x["label"] == label]
        assert len(e) == 1, label
        if words not in (e[0].get("not_words") or ""):
            e[0]["not_words"] = e[0]["not_words"] + "|" + words if e[0].get("not_words") else words
    for key, fields in (k.get("whole_set") or {}).items():
        w = [x for x in pr["sheet_shares"].get("whole") or [] if x.get("key") == key]
        assert len(w) == 1, key
        w[0].update(copy.deepcopy(fields))
    rs = pr.setdefault("derivation_reasons", [])
    for r in k.get("derivation_reasons_replace") or []:
        hit = [i for i, x in enumerate(rs) if x.get("title") == r["from"]]
        if hit:
            rs[hit[0]] = {"title": r["title"], "why": r["why"]}
    titles = {r.get("title") for r in rs}
    for r in k.get("derivation_reasons_new") or []:
        if r["title"] not in titles:
            rs.append(copy.deepcopy(r))
    return c


def with_items(prev_items, K):
    """v81's items: v80's, with each declared Pricing Input's factor (and remarks) changed. Nothing added or deleted."""
    out = copy.deepcopy(prev_items)
    for pid, ch in (K.get("pricing_inputs") or {}).items():
        hit = [i for i in out if str(i.get("kind", "")).endswith("_pricing_input") and (i.get("attributes") or {}).get("item") == pid]
        assert len(hit) == 1, pid
        it = hit[0]
        if it["rates"]["factor"] == ch["from"]:
            it["rates"]["factor"] = ch["to"]
        assert it["rates"]["factor"] == ch["to"], (pid, it["rates"])
        tail = ch.get("remarks_append")
        if tail and not it["attributes"].get("remarks", "").endswith(tail):
            it["attributes"]["remarks"] = it["attributes"].get("remarks", "") + tail
    return out


def requests(stored, cfgs, extraction):
    """Every item-list category's model question (ITEMS_SPEC) as JSON text, keyed by category -- the stub proof's unit."""
    return {c["category_id"]: json.dumps(extraction.build_items_spec(cfgs[(c["discipline"], c["category_id"])], cfgs, c["discipline"]),
                                         sort_keys=True, ensure_ascii=False)
            for c in stored if c.get("list_spec")}


def build(out):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import config_validation, extraction
    from nirmaan_stack.services.boq_rate_master.loader import _validate_items, _validate_one_config
    raw = open(V80, "rb").read()
    prev = json.loads(raw.decode("utf-8"))
    if _dump(prev).encode("utf-8") != raw:
        raise SystemExit("re-dumping v80 does not reproduce its bytes")
    K = json.load(open(KEYS, encoding="utf-8"))
    final = copy.deepcopy(prev)
    idx = {c["category_id"]: n for n, c in enumerate(prev["category_configs"])}
    final["category_configs"][idx[VAV]] = vav_config(prev["category_configs"][idx[VAV]], K)
    final["items"] = with_items(prev["items"], K)

    # BYTE-IDENTITY: every item unchanged and in order but the declared Pricing Input(s); every config but hvac_vav_box unchanged
    changed = [a["item_uid"] for a, b in zip(prev["items"], final["items"]) if _canon(a) != _canon(b)]
    assert len(prev["items"]) == len(final["items"]) and [a["item_uid"] for a in prev["items"]] == [b["item_uid"] for b in final["items"]]
    assert len(changed) == len(K["pricing_inputs"]), changed
    print("items changed:", changed)
    for x, y in zip(prev["category_configs"], final["category_configs"]):
        assert x["category_id"] == y["category_id"]
        assert (_canon(x) == _canon(y)) == (x["category_id"] != VAV), x["category_id"]
    assert list(final.keys()) == list(prev.keys())
    assert "calculator_only" not in final["category_configs"][idx[VAV]]

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
    print("eligible configs v80:", eligible_base, "| v81:", eligible)
    assert eligible == sorted(eligible_base + [VAV]), (eligible, eligible_base)

    # STUB PROOF (P1 b): every item-list category's model question byte-identical v80 vs v81 but hvac_vav_box's own
    r_base, r_new = requests(stored_base, cfgs_base, extraction), requests(stored, cfgs, extraction)
    same = sorted(k for k in r_base if r_base[k] == r_new.get(k))
    diff = sorted(k for k in r_base if r_base[k] != r_new.get(k))
    print("STUB PROOF: item-list requests v80 vs v81 -- identical:", same, "| differing:", diff)
    for k in sorted(r_new):
        print("   request sha16 %-20s v80 %s v81 %s" % (k, hashlib.sha256(r_base[k].encode()).hexdigest()[:16],
                                                     hashlib.sha256(r_new[k].encode()).hexdigest()[:16]))
    assert diff == [VAV], diff

    text = _dump(final)
    tokens = sorted({t for t in re.findall(r"v\d+", text.replace(json.dumps(final.get("source_workbook") or "", ensure_ascii=False), '""'))})
    if tokens:
        raise SystemExit("the asset text carries version-like tokens %r (h07)" % tokens)
    open(out, "w", encoding="utf-8", newline="").write(text)
    print("candidate written:", out, "| items", len(final["items"]), "| configs", len(final["category_configs"]),
          "| sha256", hashlib.sha256(text.encode("utf-8")).hexdigest())
    print("per-config sha16 v81:", {c["category_id"]: _sha16(c) for c in final["category_configs"]})
    print("per-config sha16 v80:", {c["category_id"]: _sha16(c) for c in prev["category_configs"]})
    frappe.destroy()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("phase", choices=["build", "load", "verify"])
    ap.add_argument("--candidate", default=V81)
    a = ap.parse_args()
    if a.phase == "build":
        build(a.candidate)
    elif a.phase == "load":
        load(a.candidate)
    else:
        verify(a.candidate)
