"""DU-3 K2 (2026-11-16, run on the laptop - machine override CH-DU3-6) -- MINT HVAC v75 = v74 + THE ONE FIX SLICE FROM THE DU-2 REVIEW.

What changes (owner rulings 2026-11-16 14:15-16:38 + QR-1 answers 18:06, relay CH-DU3-3):
  items          + 1 hvac_pricing_input "Ducting - insulation coverage threshold" = 0.9 (R1, owner 16:38 "make this 90% thershold a
                   pricing input"); every v74 item byte-identical
  hvac_ducting   sheet_insulation -> the R1 / R2 shape (threshold_input, plain_heading_words, never_words, surface_words, preamble_chars,
                   length_units, lines covered / double_count / ratio / threshold_missing); the G-3 keys acoustic_words,
                   doubtful_heading_words, mode, high, low and the lines dropped / added / unpriced / missing_doubtful RETIRED;
                 rule_lines: DR7 states R2 (which rows count), G3 -> R1 (the 90% rule naming its Pricing Input);
                 derivation_reasons: the sheet-insulation reasons quote R1 / R2
                 (+ the K1b / K1c config data: see the RULES block below)
Every other config byte-identical to v74; second_opinion stays FALSE.

Runs IN THE CONTAINER under the bench's python. Phases: build (v74 -> the candidate; NO database write), load, verify.
Usage (container, from frappe-bench): env/bin/python -I <this> <phase> [--candidate P]
"""
import argparse, copy, hashlib, json, os, re

APP = "/workspace/development/frappe-bench/apps/nirmaan_stack"
DATA = os.path.join(APP, "nirmaan_stack/services/boq_rate_master/data")
V74 = os.path.join(DATA, "rate_master_hvac_all_v74.json")
V75 = os.path.join(DATA, "rate_master_hvac_all_v75.json")
DUCT, MISC, VALVE = "hvac_ducting", "hvac_misc", "hvac_valve_package"
THRESHOLD_ID = "ducting_insulation_coverage_threshold"

# = frontend/src/pages/boq-wizard/rate-helper/du3Insulation.harness.ts SI_V75 = test_config_validation_du3.SI_V75 (pinned by the v75 tests)
SI_V75 = {
    "category": "hvac_insulation",
    "section": "insulation",
    "duct_words": "\\bducts?\\b|ducting|ductwork",
    "insulation_words": "insulat|lining",
    "plain_heading_words": "^\\W*(?:[a-z0-9]{1,3}[.)]\\s*)?(?:thermal\\s+|acoustic\\s+)?insulation(?:\\s+works?)?\\W*$",
    "never_words": "\\bpipes?\\b|piping|\\bAHUs?\\b|air\\s*handling|plant\\s*room|machine\\s*room|equipment|chillers?\\b|refrigerant|copper",
    "surface_words": "under\\s*-?\\s*deck|\\broofs?\\b|\\bwalls?\\b|ceiling|\\bslabs?\\b|\\bfloors?\\b|partition|terrace",
    "preamble_chars": 120,
    "area_units": ["sqm", "sq.m", "sq m", "sq.mt", "sqmt", "sq.mtr", "sq mtr", "sqmtr", "sqmtrs", "sq.mtrs", "sq. m", "sq.m.", "m2", "m²",
                   "sq.mt.", "sqm.", "smt", "sq. mtr", "sqft", "sq.ft", "sq ft", "sft", "SM", "Sq mt", "Sqm/Ro"],
    "length_units": ["m", "mt", "mts", "mtr", "mtrs", "rmt", "rmtr", "rm", "r.m", "running metre", "running meter", "metre", "meter",
                     "metres", "meters", "lm", "rft"],
    "threshold_input": THRESHOLD_ID,
    "lines": {
        "covered": "Insulation is priced separately in {rows} - not included in this row.",
        "double_count": "Possible double counting - insulation is also priced separately in {rows}. Check before quoting.",
        "ratio": "(The separate rows cover about {pct}% of the insulated duct quantity on this sheet: {ins} of {area} sq.m; threshold {threshold}%.)",
        "threshold_missing": "(The Pricing Input 'Ducting - insulation coverage threshold' is not set - set it in Pricing Inputs.)",
    },
}
R1_WHY = ("\"where there s seprate duct insulation rows, if insulation qty is more tan 90% of insulated duct qty, then dont include th "
          "insulation price inthe duct row ... when insualtion qty<90% ... include the insulation cost in the duct rows and give a note\" "
          "(owner 2026-11-16 16:31, confirmed 16:33 \"yes agree with all 3\"); the threshold a Pricing Input (owner 16:38)")
R2_WHY = ("an insulation row counts when its words or a heading name duct, or it sits under a plain 'Insulation' heading, unless its words / "
          "headings name pipes, AHU / plant / equipment (owner Case 11 \"option B\", 2026-11-16 16:37); running metres = pipe, building "
          "surfaces never count (owner QR-1 Q1 / Q3, 18:06)")
RULE_LINES = {
    "DR7": {"rule": "DR7", "title": "Which rows count as the sheet's own duct-insulation rows",
            "detail": "an insulation row whose own words or a heading above it name duct, or that sits under a plain 'Insulation' heading; "
                      "never a row in running metres (pipe insulation), nor one whose own words or nearer heading name pipes, AHU / plant room / "
                      "equipment, or a building surface (under deck, roof, wall, ceiling, floor) named by the row or by an insulation heading; "
                      "a long scope preamble is not read as naming equipment"},
    "G3": {"rule": "R1", "title": "The 90% rule: the separate rows' quantity against the sheet's insulated duct quantity",
           "detail": "at or above the Pricing Input 'Ducting - insulation coverage threshold' (90% today; exactly at = covered) -> no insulation "
                     "line, the note names the rows; below it, or a quantity missing on either side -> the insulation line is priced with a "
                     "possible-double-counting note naming the rows; no separate rows -> priced as usual; no row is left for a person"},
}


# ---- K1b config data (owner rulings 2026-11-16 14:15-15:44 + QR-1 18:06) ----
GAUGE_LINES_NEW = {
    "bare_number": "BoQ says {said} -> {gauge}G (a bare number in the gauge field is the gauge)",
    "labour_any_gauge": "Labour row: the duct's installation does not vary by gauge, so the duct type decides",
    "own_row": "This row's own words say \"{said}\" -> {gauge}G (the answer lists several gauges; this row's band)",
}
PAIR_NOTE = {DUCT: "Installation not priced in this row - this sheet quotes the installation of this duct on its own {rows}",
             VALVE: "Installation not priced in this row - this sheet quotes the installation of this valve on its own {rows}"}
R5_UNITS = ["sm", "sq mt", "sqm/ro"]
R7_WHEN_WORDS = [
    {"unit_class": cls, "words": ["rectangular/round", "rectangular/ round", "rectangular / round", "rect/round", "round/rectangular",
                                  "round / rectangular", "rectangular and round", "rectangular & round"],
     "family": "Rectangular (GI)", "rule": "BoQ says rectangular/round - priced as rectangular (unit sq.m)"} for cls in ("area",)
] + [
    {"unit_class": cls, "words": ["rectangular"], "family": "Rectangular (GI)"} for cls in ("area", "length")
] + [
    {"unit_class": cls, "words": ["round", "spiral", "oval", "circular", "elliptical"], "family": "Spiral / Oval (GI)",
     "rule": "BoQ says round / spiral / oval with no duct type - priced as Spiral / Oval (owner 2026-11-16 15:00 / QR-5 (a))"} for cls in ("area", "length")
]
PAINT_ROW = {"words": r"paint\s*finish|enamel\s*paint|painting\s+of\s+(?:the\s+)?ducts?|synthetic\s+enamel",
             "section": "misc", "family": "Paint", "tolerance": 0.2,
             "line": "Reads as painting of the ducts in {rows} - priced as Paint",
             "miss_line": "Reads as painting of ducts, but {why} - price this row by hand"}
# ---- K1c config data (owner Case 2 15:17, Case 3 15:18, Case 4 15:19, Case 5 15:20, Case 6 15:21, Case 12 16:38) ----
DUCT_FAMS = ["Rectangular (GI)", "Spiral / Oval (GI)", "PIR (Pre Insulated Duct)", "Fire Rated (MS)"]
K1C_TEXT_NOTES = [
    {"families": ["Fire Rated (MS)"], "from_text": "own_and_headings",
     "pattern": r"^(?=.*fire\s*rat)(?=.*(?:\bGI\b|galvani[sz]|zinc\s*coat))",
     "line": "GI fire-rated duct - priced as our Fire Rated duct item", "rule": "R8-C2",
     "rule_line": "A GI duct the BoQ calls fire rated is priced as our Fire Rated duct item, with a note"},
    {"families": list(DUCT_FAMS), "from_text": "headings", "pattern": r"alumini?um",
     "line": "heading says Aluminium - check the material before quoting", "rule": "R8-C3",
     "rule_line": "A heading naming aluminium over a row of another material carries a check-the-material note"},
]
SS_REFUSE = [
    {"from": "stainless steel", "refuse": "Reads as butterfly valves (stainless steel), not a duct - re-file this row",
     "rule": "DR11 stainless steel rows are butterfly valves (owner 2026-11-13 20:57)", "unless": r"\bduct"},
    {"from": "stainless steel", "refuse": "Stainless-steel duct is not on our sheet - price this row by hand",
     "rule": "Case 12 a stainless-steel duct row is priced by hand (owner 2026-11-16 16:38)"},
]
ROW_REFUSALS = [{"pattern": r"double[\s-]*skin|sandwich\s+type|sandwich\s+(?:duct|panel)", "line": "double-skin duct - not on our sheet, price by hand",
                 "rule_line": "A double-skin duct row (inner + outer skin, or a sandwich with PUF) is not priced"}]
W_REASONS = [
    {"title": "^A duct type the catalogue does not stock refuses by name",
     "why": "aluminium and stainless steel are not on our sheet (owner DR11, 2026-11-13 20:57); stainless steel: a duct / ducting row -> 'price this row by hand', any other -> the butterfly-valve re-file note (owner Case 12 \"option C\", 2026-11-16 16:38)"},
    {"title": "^A row that names no material takes the kind its row implies",
     "why": "shape not stated -> rectangular (owner DR8, 2026-11-13 21:03); a lone round / spiral / oval word -> Spiral / Oval (owner 15:00 \"fix\", QR-5 (a)); 'rectangular/round' per sq.m -> rectangular (owner Case 7, 15:24 \"price as rectangular as the unit is sqm\"); 'rectangular and (flat) oval' -> the higher (oval) basis: the owner's Case 6 removal ruling (\"option B\", 15:21) applied to every row - 0 non-removal rows today (DU-3 C1, measured); open for the owner to confirm"},
]
PARTIAL_INSULATION = {
    "pattern": r"(?<kind>acoustic|thermal)\b[^|]{0,160}?\b(?<span>(?:first|initial)\s+\d+(?:\.\d+)?\s*(?:m|mtr|mtrs|meters?|metres?|rmt)\b(?:\s+from\s+(?:the\s+)?[A-Za-z]+)?)",
    "line": "{kind} insulation asked only for the {span} - add by hand"}
C6_WHEN_WORDS = [
    {"unit_class": cls, "words": ["rectangular and flat oval", "rectangular & flat oval", "rectangular and oval", "rectangular & oval"],
     "family": "Spiral / Oval (GI)", "rule": "removal of mixed shapes - priced at the higher (oval) rate"} for cls in ("area", "length")
]
TWO_INSULATIONS = {"section": "insulation", "keep_words": r"thermal", "second_words": r"acc?oustic",
                   "line": "second insulation (acoustic {t} mm) - add by hand"}
K1C_REASONS = [
    {"title": "^A duct row naming two insulations", "why": "two insulations on one row: the duct + the whole-duct insulation priced, the second by hand (owner QR-2 Q1 \"1b\", 2026-11-16 21:19)"},
    {"title": "^A GI duct the BoQ calls fire rated", "why": "GI fire-rated duct priced as the Fire Rated duct item, note changed (owner Case 2 \"ok option A\", 2026-11-16 15:17)"},
    {"title": "^A heading naming aluminium", "why": "the row's own material wins over the heading, with an amber note (owner Case 3 \"option A\", 2026-11-16 15:18)"},
    {"title": "^A double-skin duct row", "why": "a double-skin duct is left unpriced with a note (owner Case 5 \"option A\", 2026-11-16 15:20)"},
    {"title": "^Extra insulation asked only on part of the duct length", "why": "extra insulation asked only on part of the length is not added (owner Case 4 \"option A\", 2026-11-16 15:19)"},
]

K1B_RULE_LINES = [
    {"rule": "R-GAUGE-FORMS", "title": "A gauge written any way reads as that gauge, on the panel and the calculator",
     "detail": "'24G', '24 g', '24   G', '24 gauge', '24 guage', '24 gage', '24 gause', '24 SWG', 'G24', '24-G', 'Guage: 24'; a bare whole number 16-30 in the gauge field is that gauge (never mm); a bare decimal below 3 (0.63, 1.0) is mm -> the standard-thickness table; a value typed in the calculator reads the same way, only a picked sheet mm is read as that number"},
    {"rule": "R-OWN-BAND", "title": "Several gauges in the answer but the row's own words name one of them -> that gauge",
     "detail": "the answer copied the whole heading's band list; the row's own single gauge decides ('22 G up to 751 to 1500mm' -> 22G)"},
    {"rule": "R-LABOUR-GAUGE", "title": "A labour row needs no gauge: the duct type decides its installation",
     "detail": "a 'labour charges' row is the duct's installation only, the same for every gauge of a type; its insulation is priced by Insulation's own rows, not here"},
    {"rule": "R-REVERSE-PAIR", "title": "A supply row whose installation the sheet quotes on its own row is priced supply only",
     "detail": "its own words start 'Supply of' (or the sheet heading repeated, then 'Supply of'); the same kind of duct quoted installation only on the sheet -> supply only, the note naming every such row and why"},
]
K1B_REASONS = [
    {"rule": "R-GAUGE-FORMS", "why": "\"typing 24 should be matched with 24G\" (owner 14:15); \"when someone enters a 18/20/22/ etc kind of number in duct thickness...it must be gauge only\" (owner 14:46, 2026-11-16)"},
    {"rule": "R-OWN-BAND", "why": "the band misread on BOQ-26-00336 r16 (22G read 20G): \"fix\" (owner 2026-11-16 15:00)"},
    {"rule": "R-LABOUR-GAUGE", "why": "\"Labour Charges for GI Duct Erections\" = installation only, no gauge needed: \"fix\" (owner 2026-11-16 15:00)"},
    {"rule": "R-REVERSE-PAIR", "why": "\"ok option A. but always have niotes which clearly mention the details of why installation was not priced in\" (owner Case 1, 2026-11-16 15:16)"},
    {"title": "^A row whose own words name painting", "why": "\"reviewed boq 380, row 25 is painting of ducts. confirmed.\" (owner 15:44); only where the context is the same as BoQ 380 (owner QR-1 Q5, 18:06)"},
]


def _uid(key, taken):
    for n in range(100):
        u = "rmi-" + hashlib.sha256(("DU-3 %s %d" % (key, n)).encode()).hexdigest()[:12]
        if u not in taken:
            taken.add(u)
            return u
    raise SystemExit("no free item_uid for %s" % key)


def threshold_item(taken):
    return {"kind": "hvac_pricing_input", "brand": None, "unit": "share of the insulated duct quantity (0.9 = 90%)",
            "attributes": {"item": THRESHOLD_ID, "name": "Ducting - insulation coverage threshold",
                           "remarks": "A Ducting row read insulated on a sheet that also quotes duct insulation on its own rows: when those rows' "
                                      "quantity is at least this share of the sheet's insulated duct quantity, the duct row prices no insulation line "
                                      "(the note names the rows); below it, the line is priced with a possible-double-counting note (owner DU-3 R1, "
                                      "2026-11-16 16:31 / 16:33 / 16:38).",
                           "shared_by": "ducting"},
            "rates": {"factor": 0.9}, "source": {"sheet": "Pricing Inputs", "row": 0}, "item_uid": _uid("pricing input " + THRESHOLD_ID, taken)}


def ducting_config(prev):
    c = copy.deepcopy(prev)
    pr = c["list_spec"]["pricing"]
    pr["sheet_insulation"] = copy.deepcopy(SI_V75)
    seen = set()
    for n, r in enumerate(pr["rule_lines"]):
        if r["rule"] in RULE_LINES:
            seen.add(r["rule"]); pr["rule_lines"][n] = copy.deepcopy(RULE_LINES[r["rule"]])
    assert seen == set(RULE_LINES), seen
    rs = pr["derivation_reasons"]
    for r in rs:
        if r.get("title") == "^On a sheet that quotes duct insulation on its own rows":
            r["why"] = R1_WHY; seen.add("title")
        if r.get("rule") == "DR7":
            r["why"] = R2_WHY; seen.add("dr7")
        if r.get("rule") == "G3":
            r["rule"] = "R1"; r["why"] = R1_WHY; seen.add("g3")
    assert {"title", "dr7", "g3"} <= seen, seen
    # K1b: R4 / R6 / R7 gauge lines; R3 pair note; R5 units; R7 shape words; Case 8 paint row; the code rules' lines + reasons
    g = pr["numbers"]["thickness_mm"]["gauge"]["lines"]
    for k, v in GAUGE_LINES_NEW.items():
        assert k not in g; g[k] = v
    pr["scope"]["supply_row"]["pair_note"] = PAIR_NOTE[DUCT]
    for u in R5_UNITS:
        assert u not in [x.lower() for x in pr["unit_classes"]["area"]]; pr["unit_classes"]["area"].append(u)
    assert "when_words" not in pr["family_when_none"]
    pr["family_when_none"]["when_words"] = copy.deepcopy(R7_WHEN_WORDS)
    pr["paint_row"] = copy.deepcopy(PAINT_ROW)
    pr["rule_lines"] += copy.deepcopy(K1B_RULE_LINES)
    pr["derivation_reasons"] = [copy.deepcopy(r) for r in K1B_REASONS if "title" in r] + pr["derivation_reasons"] + [copy.deepcopy(r) for r in K1B_REASONS if "rule" in r]
    # K1c: Case 2 / 3 notes; Case 12 refuse unless; Case 5 row refusals; Case 4 part-length insulation; Case 6 mixed shapes (before "rectangular")
    pr["text_notes"] += copy.deepcopy(K1C_TEXT_NOTES)
    rf = pr["family_text"]["refuse"]
    k = [n for n, r in enumerate(rf) if r["from"] == "stainless steel"]
    assert len(k) == 1, k
    pr["family_text"]["refuse"] = rf[:k[0]] + copy.deepcopy(SS_REFUSE) + rf[k[0] + 1:]
    pr["row_refusals"] = copy.deepcopy(ROW_REFUSALS)
    pr["partial_insulation"] = copy.deepcopy(PARTIAL_INSULATION)
    pr["two_insulations"] = copy.deepcopy(TWO_INSULATIONS)
    ww = pr["family_when_none"]["when_words"]
    at = next(n for n, w in enumerate(ww) if w["words"] == ["rectangular"])
    pr["family_when_none"]["when_words"] = ww[:at] + copy.deepcopy(C6_WHEN_WORDS) + ww[at:]
    pr["derivation_reasons"] = copy.deepcopy(K1C_REASONS) + pr["derivation_reasons"]
    # CH-DU3-13 W1 / W5: the two titles' reasons say every ruling behind them (first, so they win)
    pr["derivation_reasons"] = copy.deepcopy(W_REASONS) + [r for r in pr["derivation_reasons"] if r.get("title") not in {w["title"] for w in W_REASONS}]
    # W6: the DR14 line says the Case 6 rule and its note
    for r in pr["rule_lines"]:
        if r["rule"] == "DR14":
            r["detail"] += ("; a removal row naming several duct shapes takes the higher shape's installation basis (oval / spiral 280 -> removal 140), "
                            "note 'removal of mixed shapes - priced at the higher (oval) rate' (owner Case 6, 2026-11-16 15:21)")
    assert c["list_spec"].get("second_opinion") is False
    return c


def valve_config(prev):
    """R3 (QR-1 Q7 (a), owner 18:06): ONLY the scope's pair_note -- the Valve Package's pair-rule rows name their installation row"""
    c = copy.deepcopy(prev)
    sr = c["list_spec"]["pricing"]["scope"]["supply_row"]
    assert "pair_note" not in sr
    sr["pair_note"] = PAIR_NOTE[VALVE]
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


CHANGED = (DUCT, VALVE)


def build(out):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import config_validation, extraction
    from nirmaan_stack.services.boq_rate_master.loader import _validate_items, _validate_one_config
    raw = open(V74, "rb").read()
    prev = json.loads(raw.decode("utf-8"))
    if _dump(prev).encode("utf-8") != raw:
        raise SystemExit("re-dumping v74 does not reproduce its bytes -- the series convention is not what this mint writes")
    taken = {i["item_uid"] for i in prev["items"]}
    own = {"rmi-" + hashlib.sha256(("DU-3 pricing input %s %d" % (THRESHOLD_ID, n)).encode()).hexdigest()[:12] for n in range(100)}
    taken |= {(r["item_uid"] or "").strip() for r in frappe.get_all("BoQ Rate Master Item", filters={"discipline": "HVAC"}, fields=["item_uid"])} - own
    final = copy.deepcopy(prev)
    final["items"].append(threshold_item(taken))
    idx = {c["category_id"]: n for n, c in enumerate(prev["category_configs"])}
    for cid in CHANGED:
        final["category_configs"][idx[cid]] = CONFIG_FN[cid](prev["category_configs"][idx[cid]])
    assert _canon(prev["items"]) == _canon(final["items"][:len(prev["items"])]), "a v74 item moved"
    assert len(final["items"]) == len(prev["items"]) + 1
    for x, y in zip(prev["category_configs"], final["category_configs"]):
        assert x["category_id"] == y["category_id"]
        if x["category_id"] not in CHANGED:
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

    # STUB PROOF: the model's question for every category but those this slice names is byte-identical
    def requests(st, cf):
        return {c["category_id"]: json.dumps(extraction.build_items_spec(cf[("HVAC", c["category_id"])], cf, "HVAC"), sort_keys=True)
                for c in st if c.get("list_spec")}
    r_base, r_new = requests(stored_base, cfgs_base), requests(stored, cfgs)
    diff = sorted(k for k in set(r_base) | set(r_new) if r_base.get(k) != r_new.get(k))
    print("STUB PROOF: item-list requests v74 vs v75 -- identical:", sorted(k for k in r_base if r_base[k] == r_new.get(k)), "| differing:", diff)
    assert set(diff) <= set(REQUEST_MAY_CHANGE), diff
    print("eligible configs v75 = v74:", eligible)

    text = _dump(final)
    tokens = sorted({t for t in re.findall(r"v\d+", text.replace(json.dumps(final.get("source_workbook") or "", ensure_ascii=False), '""'))})
    if tokens:
        raise SystemExit("the asset text carries version-like tokens %r (h07)" % tokens)
    open(out, "w", encoding="utf-8", newline="").write(text)
    print("candidate written:", out, "| items", len(final["items"]), "| configs", len(final["category_configs"]),
          "| sha256", hashlib.sha256(text.encode("utf-8")).hexdigest(), "| new item uid", final["items"][-1]["item_uid"],
          "| per-config sha16", {c["category_id"]: hashlib.sha256(_canon(c).encode()).hexdigest()[:16] for c in final["category_configs"] if c["category_id"] in CHANGED})
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


CONFIG_FN = {DUCT: ducting_config, VALVE: valve_config}
# the model's question may change only for these (filled as K1b / K1c config data lands; K1's sheet_insulation is not asked)
REQUEST_MAY_CHANGE = ()

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("phase", choices=["build", "load", "verify"])
    ap.add_argument("--candidate", default=V75)
    a = ap.parse_args()
    if a.phase == "build":
        build(a.candidate)
    elif a.phase == "load":
        load(a.candidate)
    else:
        verify(a.candidate)
