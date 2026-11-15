"""DU-1 PART A (2026-11-15, run on the laptop) -- MINT HVAC v70 = v69 + THE VALVE PACKAGE AND MISC DECLARED DERIVATION LINES (VP-DRV
FIX-1 / FIX-3; owner 2026-11-15 13:30-13:41 "we need to make sutre that the derivatrion screen captures all th erules"). DISPLAY ONLY:
nothing here is read by pricing or by the model's question (asserted: every items spec byte-identical to v69). Every item and every
other config is byte-identical to v69 (asserted).

What changes:
  hvac_valve_package  + `pricing.rule_lines` -- one line per rule written in CODE (VP-3 D1-D7c, VP-4 R1-R4 / W1 / W2 / T1, VP-5 E1-E10),
                        in the owner's words (VP-DRV's proposed wording, checked against the rulings), each naming its rule id
                      + `rule_line` on each of the 4 `text_notes` entries (the tab's own words for the note)
                      ~ the butterfly `read_notes` entry's `rule_line` (VP-DRV R19: + steel lever 25 mm and plain 300 mm; the panel's
                        line is unchanged)
  hvac_misc           + `pricing.rule_lines` (VP-4 T1 on a Misc block) + `rule_line` on each of its 3 `text_notes` entries
`second_opinion` stays FALSE on both.

Runs IN THE CONTAINER under the bench's python. Phases: build (v69 -> the candidate; NO database write), load (pre-load HVAC
snapshot, then loader.load_rate_master(path=<candidate>, replace=True)), verify (live HVAC == the candidate BY CONTENT).
Usage (container, from frappe-bench): env/bin/python -I <this> <phase> [--candidate P]
"""
import argparse, copy, hashlib, json, os, re

APP = "/workspace/development/frappe-bench/apps/nirmaan_stack"
DATA = os.path.join(APP, "nirmaan_stack/services/boq_rate_master/data")
V69 = os.path.join(DATA, "rate_master_hvac_all_v69.json")
V70 = os.path.join(DATA, "rate_master_hvac_all_v70.json")
VALVE, MISC = "hvac_valve_package", "hvac_misc"

_ONCE = "the line sits on the item it changed, whatever made the reading (this rule or the model), and is never written twice"
VALVE_RULE_LINES = [
    ("D1", "A thermostat, controller or actuator listed beside a PIBCV is part of the PIBCV item, not a second item",
     "with the line 'thermostat / actuator included in the PIBCV item'; words naming another valve are never folded in; a 2-way valve 'with thermostat' keeps its refusal; " + _ONCE),
    ("D2", "An NRV the BoQ calls dual plate is priced as the Dual Plate NRV, over the flanged rule",
     "'dual plate' in the item's own words, the row or its nearest heading; " + _ONCE),
    ("D3", "A valve the BoQ calls portable or handed over is priced supply only, quoting those words",
     "installation 0; 'Supply of' and 'Supply and provisioning' alone stay supply + installation"),
    ("D4", "A small valve with no size of its own that the BoQ ties to a pressure gauge is part of the gauge",
     "a ball, gate or needle valve the row ties to the gauge ('for isolation', 'of suitable size', 'cost ... included', 'with syphon'); a valve with its own size stays its own item; " + _ONCE),
    ("D5", "An air vent's size belongs to the ball valve beside it, and '25mm\"' reads 25 mm",
     "the air vent has one price for any size, so a size read on it moves to a sizeless ball valve on the same row; a stray inch mark after 'mm' is dropped; below 15 mm -> 15 by the ladder"),
    ("D7b", "'BV' or 'Bal valve' at 40 mm and below is read as a Ball Valve",
     "in amber, switchable; never 'ball valve' or 'balancing'; above 40 mm the model's reading stands"),
    ("D7c", "A valve 'with strainer' adds a Y-strainer of the same size as its own line",
     "an integral or built-in strainer too; a Set naming one valve with and one without a strainer is three lines (valve with, valve without, strainer); a strainer the model already listed is never doubled; below 50 mm -> 50 by the ladder; " + _ONCE),
    ("R1", "A ball valve with no size that the BoQ ties to the strainer's drain is part of the strainer",
     "'ball valve for strainer drain', 'drain valve ... included / part of'; a ball valve with its own size stays its own item; " + _ONCE),
    ("R2", "A valve described as both balancing and modulating is the PIBCV",
     "both words in one valve's own words; the nearest heading counts only for an item already read as a 2-way or balancing valve; never a second PIBCV on a row that has one; " + _ONCE),
    ("R3", "A provision for a thermometer or thermowell is priced as the Misc Test Plug / Thermowell", _ONCE),
    ("R4", "A high-rangeability control valve is a 2-way modulating valve",
     "the sheet stocks 20-32 mm, so above 32 mm the size refuses ('valve size N is above the largest size on the sheet (32)'); a named unstocked item under that heading keeps its own words"),
    ("W1", "A count written before an item ('two', '2 nos', 'pair of') prices that many",
     "never 'two way' or '2-way'; the item's own quantity where its block has one, else that many items; " + _ONCE),
    ("W2", "The size in the row's own words wins over a size in the text appended to it",
     "only a size written in mm or NB counts ('PN 16', 'RS 485' are not sizes); it also fills an item that read none; " + _ONCE),
    ("E1", "Under a heading 'with and without strainer', a row stating only a size prices the valve alone",
     "with the note to add Y-strainers by hand - the BoQ does not say how many have one"),
    ("E2", "A swing check NRV is not on our sheet and is refused by name",
     "'No SKU in the catalogue for swing check NRV - price this row by hand'; never priced as Flanged or Dual Plate"),
    ("E3", "A differential pressure gauge is priced as the ordinary pressure gauge, with a note", ""),
    ("E4", "A thermometer with its (necessary) isolation valves is one thermometer, with a note", "no valve item for its isolation valves"),
    ("E6", "A provision to fix a pressure gauge later is priced as the Test Plug / Thermowell, with a note",
     "sockets, ball valves or a siphon to fix a gauge later; the gauge itself is not included"),
    ("E7", "A balancing valve with integrated P/T test points is the balancing valve alone, with a note", "the test points are part of it"),
    ("E8", "An on-off pressure independent valve is priced as the PIBCV, with a note to check the price", ""),
    ("E9", "An air vent named only in the heading does not add itself to a row that buys only a ball valve",
     "the ball valve alone, no note; an air purge, air release valve or air eliminator in the row's own words is the air vent; '... with (a) ball valve' keeps the heading's air vent with its ball valve"),
    ("E10", "A row saying 'with out valve' is priced supply + installation, with a note to check whether it is installation only", ""),
    ("T1", "An inch size is named by its nominal bore in the note", "'BoQ says 3/4\" -> 20 mm (3/4\" = 20 NB)'"),
]
MISC_RULE_LINES = [("T1", "An inch size is named by its nominal bore in the note", "'BoQ says 1/2\" -> 15 mm (1/2\" = 15 NB)'")]
VALVE_TEXT_NOTE_RULE_LINES = {   # by the entry's own line text (asserted unique)
    "The BoQ names flanges": "A valve row naming flanges carries the note that flanges, nuts, bolts and gaskets are part of fitting the valve",
    "priced as the sheet's Flanged Balancing Valve": "A balancing valve row is priced as the sheet's Flanged Balancing Valve, with a note",
    "The BoQ asks for the valve to be insulated": "A valve the BoQ asks to be insulated carries the note that valve insulation is not in this price",
    "One price for an automatic air vent": "An automatic air vent has one price for any size, with a note",
}
MISC_TEXT_NOTE_RULE_LINES = {
    "The BoQ includes a thermowell": "A thermometer's own thermowell is part of it, with a note",
    "The BoQ includes the gauge's own fittings": "A pressure gauge's own syphon, gauge cock or needle valve are part of it, with a note",
    "The BoQ asks for insulation": "An item the BoQ asks to be insulated carries the note that insulation is not in this price",
}
BUTTERFLY_RULE_LINE = ("A butterfly valve row naming its operator (lever, gear) carries a line: the size decides the sheet's butterfly valve"
                       " (steel lever 25 mm, hand lever 50-150 mm, gear box 200-250 mm, plain 300 mm), the operator is noted, never refused")


def _connect():
    os.chdir("/workspace/development/frappe-bench/sites")
    import frappe
    frappe.init(site="localhost"); frappe.connect()
    return frappe


def _canon(o):
    return json.dumps(o, sort_keys=True, separators=(",", ":"), default=str)


def _dump(p):
    return json.dumps(p, indent=1, ensure_ascii=False) + "\n"


def _rule_lines(rows):
    return [dict({"rule": r, "title": t}, **({"detail": d} if d else {})) for r, t, d in rows]


def _text_note_lines(pr, table):
    for lead, rl in table.items():
        hits = [t for t in pr["text_notes"] if t["line"].startswith(lead)]
        assert len(hits) == 1, (lead, len(hits))
        assert "rule_line" not in hits[0]
        hits[0]["rule_line"] = rl
    assert all("rule_line" in t for t in pr["text_notes"]), "a text_notes entry without its rule_line"


def valve_config(prev):
    c = copy.deepcopy(prev)
    pr = c["list_spec"]["pricing"]
    assert "rule_lines" not in pr
    pr["rule_lines"] = _rule_lines(VALVE_RULE_LINES)
    _text_note_lines(pr, VALVE_TEXT_NOTE_RULE_LINES)
    bf = [r for r in pr["read_notes"] if r.get("families") == ["Butterfly Valve"]]
    assert len(bf) == 1 and bf[0]["rule_line"].startswith("A butterfly valve row naming its operator")
    bf[0]["rule_line"] = BUTTERFLY_RULE_LINE
    assert c["list_spec"].get("second_opinion") is False
    return c


def misc_config(prev):
    c = copy.deepcopy(prev)
    pr = c["list_spec"]["pricing"]
    assert "rule_lines" not in pr
    pr["rule_lines"] = _rule_lines(MISC_RULE_LINES)
    _text_note_lines(pr, MISC_TEXT_NOTE_RULE_LINES)
    assert c["list_spec"].get("second_opinion") is False
    return c


def build(out):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import config_validation, extraction
    from nirmaan_stack.services.boq_rate_master.loader import _validate_items, _validate_one_config
    raw = open(V69, "rb").read()
    prev = json.loads(raw.decode("utf-8"))
    if _dump(prev).encode("utf-8") != raw:
        raise SystemExit("re-dumping v69 does not reproduce its bytes -- the series convention is not what this mint writes")
    final = copy.deepcopy(prev)
    idx = {c["category_id"]: n for n, c in enumerate(prev["category_configs"])}
    final["category_configs"][idx[VALVE]] = valve_config(prev["category_configs"][idx[VALVE]])
    final["category_configs"][idx[MISC]] = misc_config(prev["category_configs"][idx[MISC]])
    assert _canon(prev["items"]) == _canon(final["items"]), "an item moved"
    for x, y in zip(prev["category_configs"], final["category_configs"]):
        assert x["category_id"] == y["category_id"]
        if x["category_id"] not in (VALVE, MISC):
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
    print("STUB PROOF: item-list requests v69 vs v70 -- identical:", sorted(k for k in r_base if r_base[k] == r_new.get(k)), "| differing:", diff)
    assert diff == [], diff
    print("eligible configs v70 = v69:", eligible)

    text = _dump(final)
    tokens = sorted({t for t in re.findall(r"v\d+", text.replace(json.dumps(final.get("source_workbook") or "", ensure_ascii=False), '""'))})
    if tokens:
        raise SystemExit("the asset text carries version-like tokens %r (h07)" % tokens)
    open(out, "w", encoding="utf-8", newline="").write(text)
    print("candidate written:", out, "| items", len(final["items"]), "| configs", len(final["category_configs"]),
          "| sha256", hashlib.sha256(text.encode("utf-8")).hexdigest(),
          "| per-config sha16", {c["category_id"]: hashlib.sha256(_canon(c).encode()).hexdigest()[:16] for c in final["category_configs"] if c["category_id"] in (VALVE, MISC)})
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
            out[disc]["second_opinion"] = {c: ((LC[c].get("list_spec") or {}).get("second_opinion")) for c in (VALVE, MISC) if c in LC}
    print(json.dumps(out, indent=1, sort_keys=True))
    frappe.destroy()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("phase", choices=["build", "load", "verify"])
    ap.add_argument("--candidate", default=V70)
    a = ap.parse_args()
    if a.phase == "build":
        build(a.candidate)
    elif a.phase == "load":
        load(a.candidate)
    else:
        verify(a.candidate)
