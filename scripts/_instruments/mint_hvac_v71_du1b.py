"""DU-1 PART B (2026-11-15, run on the laptop) -- MINT HVAC v71 = v70 + THE DUCTING HELPER (owner rulings DR1-DR18 with DR16 replaced by
DU-D0L O10, QR-1 (a) + (c), the G rulings, G-3, the feature rulings 2026-11-15 14:33, the signed-off mockup 14:47; DU-1 QR-1 Q2 / Q3 /
Q4). What is added; every other config and every other item byte-identical to v70 (asserted):

  hvac_ducting (NEW config)  the 15 SKUs of the owner's Ducting sheet (input Ducting_after_V1_rulings_2026-11-12.xlsx, tab "Ducting items
                             (load)"; brand blank; cosmetic clean-ups only), kind `hvac_duct_item`; round per metre priced from the Spiral /
                             Oval SKU of the gauge x 3.14 x dia + 110 / m (DR1, half-up ROUND step QR-1 (c)); the gauge axis (DR2 / DR3 /
                             DR4 / DR12) with the owner's size table as DATA; the Insulation section priced by Insulation's own live rules
                             (DR5 / DR6; round / per-metre by area); the per-sheet duct-insulation check + the G-3 quantity check (DR7);
                             removal / refixing (DR14, `existing_work` 0.5 / 1.0, both 1.5 - QR-1 Q3 (a)); the Valve installation-only rule
                             as built + the pair rule (O10), its own uplift input wired to the supply-on-its-own-row case (G-4, QR-1 Q2 (a));
                             per-metre rectangular / oval by area (G-5); the Misc section (DR13); Lot / LS bar; declared rule lines with
                             their reasons ("-- why"); the model's questions.
  hvac_misc                  + 3 borrow-only families for the 5 Misc-tab items (QR-1 Q4 (a), owner's unit rule: Paint / Fire Retardant per
                             sq.m, per sq.ft by the direct conversion; Air Balancing per sq.m of duct, per CFM (2 decimals, G-6), per sq.ft
                             of carpet - its OWN sheet item); the Valve Package's Misc section offers its 4 families, unchanged.
  items                      + 15 hvac_duct_item, + 5 hvac_misc_item, + 1 hvac_pricing_input "Ducting - installation-only uplift" = 0.

Runs IN THE CONTAINER under the bench's python. Phases: build (v70 -> the candidate; NO database write), load, verify (as v70's).
Usage (container, from frappe-bench): env/bin/python -I <this> <phase> [--candidate P]
"""
import argparse, copy, hashlib, json, os, re

APP = "/workspace/development/frappe-bench/apps/nirmaan_stack"
DATA = os.path.join(APP, "nirmaan_stack/services/boq_rate_master/data")
V70 = os.path.join(DATA, "rate_master_hvac_all_v70.json")
V71 = os.path.join(DATA, "rate_master_hvac_all_v71.json")
DUCT, MISC, VALVE, INS = "hvac_ducting", "hvac_misc", "hvac_valve_package", "hvac_insulation"
KIND = "hvac_duct_item"
RECT, SPIRAL, ROUND, PIR, MS = "Rectangular (GI)", "Spiral / Oval (GI)", "Round (GI) - per metre", "PIR (Pre Insulated Duct)", "Fire Rated (MS)"
NONE_FAM = "none of these"

# the owner's sheet (tab "Ducting items (load)"): (type, material, gauge, thickness mm, BCS duct, BCS install, sheet row)
SKUS = [
    (RECT, "GI", "26G", 0.5, 580, 185, 2), (RECT, "GI", "24G", 0.6, 660, 185, 3), (RECT, "GI", "22G", 0.8, 820, 185, 4),
    (RECT, "GI", "20G", 1.0, 970, 185, 5), (RECT, "GI", "18G", 1.2, 1170, 185, 6),
    (SPIRAL, "GI", "26G", 0.5, 660, 195, 7), (SPIRAL, "GI", "24G", 0.6, 770, 195, 8), (SPIRAL, "GI", "22G", 0.8, 960, 195, 9),
    (SPIRAL, "GI", "20G", 1.0, 1140, 195, 10), (SPIRAL, "GI", "18G", 1.2, 1250, 195, 11),
    (PIR, "PIR", None, 30.0, 1000, 240, 94), (PIR, "PIR", None, 20.0, 800, 240, 95),
    (MS, "MS", "18G", 1.2, 2310, 350, 96), (MS, "MS", "20G", 1.0, 2160, 350, 97), (MS, "MS", "22G", 0.8, 2060, 350, 98),
]
# the Misc tab (borrow-only; QR-1 Q4 (a)): (item, unit, unit class, supply markup, install markup, BCS supply, BCS install, round digits, sheet row)
MISC_ITEMS = [
    ("Paint", "Sqm", "area", 0.4, 0.4, 140.0, 100.0, 0, 13),
    ("Air Balancing", "CFM", "airflow", 0.0, 0.25, 0.0, 1.0, 2, 14),
    ("Air Balancing", "Sqm", "area", 0.0, 0.25, 0.0, 45.0, 0, 15),
    ("Air Balancing", "Sqft", "carpet_area", 0.0, 0.25, 0.0, 3.25, 0, 16),
    ("Fire Retardant Spray Paint", "Sqm", "area", 0.4, 1.0, 500.0, 150.0, 0, 27),
]
UPLIFT_ID = "ducting_install_only_uplift"

GAUGE_MM = {"30": 0.315, "28": 0.4, "26": 0.5, "24": 0.6, "22": 0.8, "20": 1.0, "18": 1.2, "16": 1.6, "14": 2.0}
STANDARD_MM = [{"from": 0.5, "to": 0.56, "gauge": "26"}, {"from": 0.6, "to": 0.63, "gauge": "24"}, {"from": 0.8, "to": 0.8, "gauge": "22"},
               {"from": 1.0, "to": 1.0, "gauge": "20"}, {"from": 1.2, "to": 1.25, "gauge": "18"}, {"from": 1.6, "to": 1.6, "gauge": "16"}]
RECT_BANDS = [{"max": 750, "gauge": "24"}, {"max": 1500, "gauge": "22"}, {"max": 2250, "gauge": "20"}, {"max": None, "gauge": "18"}]
ROUND_BANDS = [{"max": 600, "gauge": "24"}, {"max": 1200, "gauge": "22"}, {"max": 1500, "gauge": "20"}, {"max": None, "gauge": "18"}]


def _uid(key, taken):
    for n in range(100):
        u = "rmi-" + hashlib.sha256(("DU-1 %s %d" % (key, n)).encode()).hexdigest()[:12]
        if u not in taken:
            taken.add(u)
            return u
    raise SystemExit("no free item_uid for %s" % key)


def duct_items(taken):
    out = []
    for t, m, g, mm, cd, ci, row in SKUS:
        name = "%s %s" % (t, g) if g else "%s %g mm" % (t, mm)
        attrs = {"duct_type": t, "material": m, "thickness_mm": float(mm), "item_name": name}
        if g:
            attrs["gauge"] = g
        out.append({"kind": KIND, "brand": None, "unit": "Sqm", "attributes": attrs,
                    "rates": {"cost_duct": float(cd), "cost_accessories": 110.0, "cost_install": float(ci), "supply_markup": 0.4, "install_markup": 0.4},
                    "source": {"sheet": "Ducting", "row": row}, "item_uid": _uid(name, taken)})
    return out


def misc_items(taken):
    out = []
    for item, unit, _cls, sm, im, cs, ci, _d, row in MISC_ITEMS:
        name = "%s (%s)" % (item, unit) if item == "Air Balancing" else item
        out.append({"kind": "hvac_misc_item", "brand": None, "unit": unit, "attributes": {"group": "Misc", "item": item, "item_name": name},
                    "rates": {"cost_supply": cs, "supply_markup": sm, "cost_install": ci, "install_markup": im},
                    "source": {"sheet": "Misc", "row": row}, "item_uid": _uid("misc " + name, taken)})
    return out


def uplift_item(taken):
    return {"kind": "hvac_pricing_input", "brand": None, "unit": "share of the final install (0.5 = 50%)",
            "attributes": {"item": UPLIFT_ID, "name": "Ducting - installation-only uplift",
                           "remarks": "A Ducting row the BoQ prices as INSTALLATION ONLY whose supply the sheet quotes on its own row: the line's final install x (1 + this), rounded up to the rupee once; no supply. 0 today = the normal installation rate (owner G-4 2026-11-15 '1 ok'; DU-1 QR-1 Q2 (a): removal / refixing factors are not multiplied by it).",
                           "shared_by": "ducting"},
            "rates": {"factor": 0.0}, "source": {"sheet": "Pricing Inputs", "row": 0}, "item_uid": _uid("pricing input " + UPLIFT_ID, taken)}


def _area_pipes(fam_label):
    return {"supply": {"output": ["supply"], "steps": [
                {"step": "match_master_row", "params": {"kind": KIND}, "explain": "match the duct SKU (type and gauge)"},
                {"step": "component", "name": "duct", "target": "cost_duct", "formula": "base", "explain": "BCS duct supply (the sheet)"},
                {"step": "component", "name": "accessories", "target": "cost_accessories", "formula": "base", "explain": "BCS accessories (110 per sq.m)"},
                {"step": "sum_components", "result": "bcs_supply", "explain": "total BCS supply"},
                {"step": "scale", "target": "bcs_supply", "result": "supply", "params": {"m_from_ctx": "supply_markup"}, "formula": "base*(1+m)", "explain": "x (1 + the SKU's supply markup)"},
                {"step": "roundup", "target": "supply", "params": {"digits": -1}, "explain": "ROUNDUP to tens, as the sheet"}]},
            "install": {"output": ["install"], "steps": [
                {"step": "match_master_row", "params": {"kind": KIND}, "explain": "match the duct SKU (type and gauge)"},
                {"step": "scale", "target": "cost_install", "result": "install", "params": {"m_from_ctx": "install_markup"}, "formula": "base*(1+m)", "explain": "BCS installation x (1 + the SKU's install markup)"},
                {"step": "roundup", "target": "install", "params": {"digits": -1}, "explain": "ROUNDUP to tens, as the sheet"}]}}


def _round_pipes():
    """DR1 + QR-1 (c): the Spiral / Oval SKU of the gauge x 3.14 x dia (m), ROUND half up, + 110 per metre; markup; ROUNDUP to tens."""
    return {"supply": {"output": ["supply"], "steps": [
                {"step": "match_master_row", "params": {"kind": KIND}, "explain": "match the Spiral / Oval SKU of the gauge"},
                {"step": "scale", "target": "cost_duct", "result": "duct_m", "params": {"d_from_attr": "dia_mm"}, "formula": "base*3.14*d/1000", "explain": "BCS duct per sq.m x 3.14 x dia (m) = per metre"},
                {"step": "roundup", "target": "duct_m", "params": {"digits": 0, "mode": "half_up"}, "explain": "ROUND (half up) to the rupee, as the sheet"},
                {"step": "scale", "target": "duct_m", "result": "bcs_m", "params": {"a_from_ctx": "cost_accessories"}, "formula": "base+a", "explain": "+ 110 accessories per metre"},
                {"step": "scale", "target": "bcs_m", "result": "supply", "params": {"m_from_ctx": "supply_markup"}, "formula": "base*(1+m)", "explain": "x (1 + the SKU's supply markup)"},
                {"step": "roundup", "target": "supply", "params": {"digits": -1}, "explain": "ROUNDUP to tens"}]},
            "install": {"output": ["install"], "steps": [
                {"step": "match_master_row", "params": {"kind": KIND}, "explain": "match the Spiral / Oval SKU of the gauge"},
                {"step": "scale", "target": "cost_install", "result": "inst_m", "params": {"d_from_attr": "dia_mm"}, "formula": "base*3.14*d/1000", "explain": "BCS installation per sq.m x 3.14 x dia (m)"},
                {"step": "roundup", "target": "inst_m", "params": {"digits": 0, "mode": "half_up"}, "explain": "ROUND (half up) to the rupee, as the sheet"},
                {"step": "scale", "target": "inst_m", "result": "install", "params": {"m_from_ctx": "install_markup"}, "formula": "base*(1+m)", "explain": "x (1 + the SKU's install markup)"},
                {"step": "roundup", "target": "install", "params": {"digits": -1}, "explain": "ROUNDUP to tens"}]}}


def _perimeter_pipes(formula, explain):
    """G-5: a per-metre duct from its size: the sq.m per metre x the per-sq.m costs (accessories per sq.m), markup, ROUNDUP to tens."""
    return {"supply": {"output": ["supply"], "steps": [
                {"step": "match_master_row", "params": {"kind": KIND}, "explain": "match the duct SKU (type and gauge)"},
                {"step": "component", "name": "duct", "target": "cost_duct", "formula": "base", "explain": "BCS duct supply (the sheet)"},
                {"step": "component", "name": "accessories", "target": "cost_accessories", "formula": "base", "explain": "BCS accessories (110 per sq.m)"},
                {"step": "sum_components", "result": "bcs_sqm", "explain": "BCS supply per sq.m"},
                {"step": "scale", "target": "bcs_sqm", "result": "bcs_m", "params": {"w_from_attr": "duct_w_mm", "h_from_attr": "duct_h_mm"}, "formula": formula, "explain": explain},
                {"step": "scale", "target": "bcs_m", "result": "supply", "params": {"m_from_ctx": "supply_markup"}, "formula": "base*(1+m)", "explain": "x (1 + the SKU's supply markup)"},
                {"step": "roundup", "target": "supply", "params": {"digits": -1}, "explain": "ROUNDUP to tens"}]},
            "install": {"output": ["install"], "steps": [
                {"step": "match_master_row", "params": {"kind": KIND}, "explain": "match the duct SKU (type and gauge)"},
                {"step": "scale", "target": "cost_install", "result": "inst_m", "params": {"w_from_attr": "duct_w_mm", "h_from_attr": "duct_h_mm"}, "formula": formula, "explain": explain},
                {"step": "scale", "target": "inst_m", "result": "install", "params": {"m_from_ctx": "install_markup"}, "formula": "base*(1+m)", "explain": "x (1 + the SKU's install markup)"},
                {"step": "roundup", "target": "install", "params": {"digits": -1}, "explain": "ROUNDUP to tens"}]}}


RECT_PER_M = ("base*2*(w+h)/1000", "x 2 x (W + H) / 1000 = the sq.m in one metre of the duct")
OVAL_PER_M = ("base*(3.14*h+2*(w-h))/1000", "x (3.14 x minor axis + 2 x (major - minor)) / 1000 = the sq.m in one metre of the flat oval duct")

# -------------------------------------------------------------------------------------------------------------------------------
# the model's questions (draft DU-D0 D3, final notes; every reading only from the row's own payload block)
QUESTIONS = [
    {"id": "duct_type", "label": "Duct type", "type": "choice", "values": [RECT, SPIRAL, ROUND, PIR, MS, NONE_FAM], "allow_none": True,
     "note": ("Which duct THIS row buys: Rectangular (GI); Spiral / Oval (GI) (spiral, flat oval, elliptical, and round / circular ducts priced"
              " per sq.m); Round (GI) - per metre (a round / circular duct the row prices per metre with its diameter); PIR (Pre Insulated Duct)"
              " (pre-insulated panel ducts); Fire Rated (MS) (MS / black steel / fire-rated / kitchen exhaust ducts). Answer from the row, or a"
              " heading that describes this row's duct. 'None' when the row names a duct but no shape. 'none of these' when the row is not a"
              " duct at all (a damper, plenum, grille, diffuser, attenuator, flexible duct, canvas, turning vanes, insulation, painting,"
              " testing / balancing) - copy what it is in duct_type_as_written.")},
    {"id": "duct_type_as_written", "label": "Duct type as written", "type": "text",
     "note": "The duct shape / material words as the BoQ writes them for THIS row ('GSS rectangular', 'spiral flat oval', 'MS welded', 'aluminium', 'removal of existing duct'), one continuous piece. Leave out when none."},
    {"id": "gauge_as_written", "label": "Gauge as written", "type": "text",
     "note": ("The gauge and / or sheet thickness as written for THIS row ('24 G', '0.63 mm', '24G / 0.63 mm', '18 SWG'). Where the row or its"
              " notes give a gauge for each size band, copy that whole gauge-by-size text. Never an insulation thickness. Leave out when none.")},
    {"id": "size_as_written", "label": "Size as written", "type": "text",
     "note": ("The duct size THIS row states, with its unit: the sides of a rectangular duct ('1500 x 600'), the diameter of a round duct"
              " ('150 mm dia', 'Ø 200'), the axes of an oval duct, or the size band ('up to 750 mm', '751-1500 mm'). Leave out when none.")},
    {"id": "insulated", "label": "Insulated", "type": "choice", "values": ["Yes", "No"],
     "note": ("Yes when the row, or a heading describing this duct, asks for duct insulation or acoustic lining (any material / thickness);"
              " No only when it says not insulated; leave out when not mentioned. When Yes, also return the insulation as its own item in the"
              " insulation section.")},
]


def ducting_config(cfgs):
    valve_scope = copy.deepcopy([d for d in cfgs[VALVE]["list_spec"]["attribute_definitions"] if d["id"] == "scope"][0])
    valve_scope["note"] = valve_scope["note"].replace("EXISTING or OLD valves", "EXISTING or OLD ducts").replace(
        "'portable' or 'handed over' means Supply only. ", "")
    ins_pr = cfgs[INS]["list_spec"]["pricing"]
    pip_pr = cfgs["hvac_piping"]["list_spec"]["pricing"]
    area_spell = copy.deepcopy(ins_pr["unit_classes"]["area"])
    families = {
        RECT: {"needs": [], "units": {"area": {"needs": ["thickness_mm"], "pipelines": _area_pipes(RECT)}},
               "convert": {"length": [{"to": "area", "needs": ["thickness_mm", "duct_w_mm", "duct_h_mm"], "rule": "a rectangular duct per metre from its sides: 2 x (W + H) / 1000 sq.m per metre (owner G-5)",
                                       "pipelines": _perimeter_pipes(*RECT_PER_M)}]}},
        SPIRAL: {"needs": [], "units": {"area": {"needs": ["thickness_mm"], "pipelines": _area_pipes(SPIRAL)}},
                 "convert": {"length": [{"to": "area", "needs": ["thickness_mm", "dia_mm"], "rule": "a round duct per metre: the Spiral / Oval rate of its gauge x 3.14 x dia + 110 accessories per metre (owner DR1)",
                                         "pipelines": _round_pipes()},
                                        {"to": "area", "needs": ["thickness_mm", "duct_w_mm", "duct_h_mm"], "rule": "a flat oval duct per metre from its axes (owner G-5)",
                                         "pipelines": _perimeter_pipes(*OVAL_PER_M)}]}},
        PIR: {"needs": [], "units": {"area": {"needs": ["thickness_mm"], "pipelines": _area_pipes(PIR)}},
              "convert": {"length": [{"to": "area", "needs": ["thickness_mm", "duct_w_mm", "duct_h_mm"], "rule": "a PIR duct per metre from its sides (owner G-5)",
                                      "pipelines": _perimeter_pipes(*RECT_PER_M)}]}},
        MS: {"needs": [], "units": {"area": {"needs": ["thickness_mm"], "pipelines": _area_pipes(MS)}},
             "convert": {"length": [{"to": "area", "needs": ["thickness_mm", "duct_w_mm", "duct_h_mm"], "rule": "a fire-rated duct per metre from its sides (owner G-5)",
                                     "pipelines": _perimeter_pipes(*RECT_PER_M)}]}},
    }
    gauge = {
        "families": [RECT, SPIRAL, MS],
        "mm": GAUGE_MM, "standard_mm": STANDARD_MM,
        "by_size": {"from": "size_as_written",
                    "dimension": {RECT: "rectangular duct, longer side", SPIRAL: "round / oval duct, diameter or major axis", MS: "rectangular duct, longer side"},
                    "bands": {RECT: RECT_BANDS, SPIRAL: ROUND_BANDS, MS: RECT_BANDS}},
        "lines": {
            "gauge_wins": "BoQ says {said} -> {gauge}G (the gauge wins over the {mm} mm also written)",
            "standard": "BoQ says {said} -> {gauge}G (the standard thickness of {gauge}G)",
            "between": "{gauge}G is not on the sheet -> {top}G (the next thicker gauge)",
            "thinner": "{gauge}G is thinner than the thinnest gauge on the sheet - priced as {top}G",
            "thicker": "{gauge}G is thicker than the thickest gauge on the sheet ({top}G) - price this row by hand",
            "thicker_by_family": {MS: "MS {gauge}G is not on our sheet (thickest MS is {top}G) - price this row by hand"},
            "size_table": "Gauge not stated in the BoQ - taken from the standard size table: {dimension} {band} = {gauge}G",
            "no_size": "Gauge not stated and no size to read it from - price this row by hand",
            "several_band": "BoQ gives several gauges ({gauges}); this row's size ({size} mm) is in the {gauge}G band",
            "several_none": "Several gauges in this row ({gauges}) and none matches its size band - price this row by hand",
            "existing_any_gauge": "Removal / refixing: the duct's installation does not vary by gauge, so the duct type decides",
        },
    }
    rule_lines = [
        ("DR3", "A gauge written in the BoQ wins over a thickness also written; a standard thickness reads as its gauge",
         "'24G / 0.63 mm' -> 24G; 0.5-0.56 mm = 26G, 0.6-0.63 mm = 24G, 0.8 mm = 22G, 1.0 mm = 20G, 1.2-1.25 mm = 18G, 1.6 mm = 16G (not stocked); any other thickness takes the next thicker gauge"),
        ("DR12", "Several gauges in one row: the gauge of this row's size band",
         "read from the gauge-by-size text in the row's own words ('22 G up to 751 to 1500 mm, 20 G 1501-2250 mm'); no band holding the row's size -> priced by hand"),
        ("DR4", "No gauge in the BoQ: the standard size table by the duct's size",
         "rectangular (longer side): up to 750 mm 24G, 751-1500 mm 22G, 1501-2250 mm 20G, above 18G; round / oval (diameter or major axis): up to 600 mm 24G, 601-1200 mm 22G, 1201-1500 mm 20G, above 18G; no size either -> priced by hand; the table is data the owner can change"),
        ("DR2", "A gauge not stocked takes the next THICKER gauge (the ladder runs reverse)",
         "thinner than the thinnest (26G) -> 26G with a note; thicker than the thickest (18G) -> priced by hand; MS 16G -> priced by hand"),
        ("DR7", "Duct insulation quoted on its own row of the same sheet is not priced in the duct row",
         "a row of the Insulation category whose own words or heading say duct (or an insulation row filed Ducting) is the sheet's own duct-insulation row; with one, no Insulation line here, the note naming those rows"),
        ("G3", "The quantity check beside it: the separate rows' sq.m against the sheet's insulated duct area",
         "70% or more -> no line (the ratio named); below 30% -> the Insulation line is added; between -> the insulation is left for a person; quantities missing -> as above on a clear sheet, for a person on a doubtful one (acoustic vs thermal, or under an AHU / plant-room heading); runs on doubtful sheets only today (the limits and the mode are settings)"),
        ("G1", "A borrowed section never reads the duct's gauge words",
         "'22G', '24 gauge' in the row are the duct's; Insulation's cladding check reads only its own words"),
        ("DR14", "Removal 0.5 x and refixing 1.0 x the duct's installation; both named -> 1.5 x",
         "no supply and no insulation; the installation read live from the matching duct item; the gauge does not matter (the installation does not vary by gauge)"),
        ("O10", "Installation only follows the Valve rule as built, with Ducting's own uplift on the supply-row case",
         "the supply quoted on its own row of the sheet -> the installation x (1 + 'Ducting - installation-only uplift', 0% today); no supply row -> supply + installation with a note; a 'Supply of' row with its installation on its own row -> supply only"),
    ]
    why = {   # owner + date per ruling (feature ruling 2026-11-15 14:33 "2 ok")
        "DR3": "\"agree with a+b\" - the gauge wins over a thickness; standard thicknesses read as their gauge (owner, 2026-11-13; reconfirmed 19:50)",
        "DR12": "\"the description gives gauge as per size..we can determine the applicable gauge for the row using it\" (owner, 2026-11-13 20:42)",
        "DR4": "\"usse thhis table if BoQ is silent on Gauge. If gauge cannot be still determined leave it unpriced\" (owner, 2026-11-13 19:49)",
        "DR2": "\"ladder up for gauges ... be careful with ladder up for gauges, it runs reverse\" (owner, 2026-11-12)",
        "DR7": "\"if there is seprate row for duct insulationthen insulation should not be priced witthe duct row\" (owner, 2026-11-13 21:06)",
        "G3": "\"the qty check is in addition to the checks we are using currenly and not a replacment\" (owner, 2026-11-15 13:15-13:18)",
        "G1": "G-1 fix: Insulation's cladding check reads only its own words (owner, 2026-11-15 13:10)",
        "DR14": "\"removal is priced at 0.5 times, and refixing is at 1 time the installation price for that SKU\"; both = 1.5 (owner, 2026-11-13 19:58; DU-1 QR-1 Q3 2026-11-15)",
        "O10": "Ducting follows the Valve installation-only rule as built, except removal / refixing; its own uplift input at 0% (owner, 2026-11-15 11:43 \"Option A\"; G-4 13:1x; QR-1 Q2 15:47)",
    }
    reasons = [{"rule": r, "why": why[r]} for r, _t, _d in rule_lines] + [
        # DU-1 Part B guard (UNREASONED 0): the generated lines with no reason yet -- placed FIRST, because the first matching title wins
        {"title": " is priced as .*existing ducts$", "why": "removal 0.5 x, refixing 1.0 x, both 1.5 x the installation, no supply (owner, 2026-11-13 19:58; QR-1 Q3 2026-11-15 15:47)"},
        {"title": "^A row whose words name .* refuses$", "why": "ADP items and non-ducts filed Ducting are left unpriced with a re-file note (owner DR13, 2026-11-13 20:14)"},
        {"title": "left unanswered is read from", "why": "the duct type as the BoQ writes it decides when the model gives none; MS is priced as MS Fire Rated (owner DR11, 2026-11-13 20:53)"},
        {"title": "answer where the BoQ names no material|^A row-kind material on the other row kind", "why": "shape not stated - priced as rectangular, in amber, switchable (owner DR8, 2026-11-13 21:03)"},
        {"title": "^A diameter is (picked|typed)", "why": "\"diameter for round with 'Other...'\" (owner DR17, 2026-11-13 00:01-00:05; mockup signed off 2026-11-15 14:47; NOTE 3 19:04): the sheet's round diameters, any other typed"},
        {"title": "not in this price$", "why": "\"all the extras are priced seprately inthe BoQ. so the duct row just needs duct prices\" (owner DR10, 2026-11-13 20:10)"},
        {"title": "^A per-metre item needs|^The width and height are typed|^A third part of a size|^A two-part size on a Width", "why": "a rectangular / oval duct per metre is priced by area from its sides, 2 x (W + H); without them it is priced by hand (owner G-5, 2026-11-15)"},
        {"title": "^The row's unit", "why": "per sq.m; per sq.ft = per sq.m x 0.0929; per metre for a round duct with its diameter; no unit, Nos, Kg, Lot priced by hand (owner, 2026-11-13 20:06)"},
        {"title": "^The item's own kind", "why": "only the 15 items of the Ducting sheet are loaded; every other sheet row is derived (owner V1, 2026-11-12)"},
        {"title": "^A row that names no material", "why": "shape not stated - priced as rectangular, in amber, switchable (owner, 2026-11-13 21:03)"},
        {"title": "^A duct type written as", "why": "MS (not fire-rated) priced as MS Fire Rated with a note (owner, 2026-11-13 20:53)"},
        {"title": "^A duct type the catalogue does not stock", "why": "MS 16G / aluminium unpriced; stainless steel rows are butterfly valves - re-file (owner, 2026-11-13 20:53 / 20:57)"},
        {"title": "^An item the model could not match|^A material the model could not match", "why": "ADP items and non-ducts filed Ducting are left unpriced with a re-file note (owner, 2026-11-13 20:14)"},
        {"title": "^That kind's rule for that unit", "why": "the sheet's own BoQ = ROUNDUP(BCS x 1.4, -1) per sq.m (owner V1, 2026-11-12)"},
        {"title": "^The facts that rule needs", "why": "a missing gauge or diameter is named and not priced (owner, 2026-11-13)"},
        {"title": "^A per-metre .* is priced from the per-", "why": "round per metre = spiral of the same gauge x 3.14 x dia + 110 / m (owner D4, 2026-11-12); rectangular / oval per metre by area (owner G-5, 2026-11-15)"},
        {"title": "^A per-metre .* without", "why": "a per-metre duct without its size is priced by hand (owner G-5, 2026-11-15)"},
        {"title": "^A gauge written|^A gauge the catalogue", "why": "the ladder on gauges runs reverse (owner, 2026-11-12)"},
        {"title": "^Fitting the stated", "why": "an unstocked gauge takes the next thicker; PIR 25 mm -> 30 mm (owner, 2026-11-12; 2026-11-13 20:30)"},
        {"title": "^A fact the row does not mention", "why": "a ruled default is shown in amber (standing)"},
        {"title": "^Then the priced steps", "why": "supply = ROUNDUP((BCS duct + 110) x 1.4, -1); install = ROUNDUP(BCS install x 1.4, -1) (owner V1, 2026-11-12)"},
        {"title": "^The rate converts", "why": "\"Convert sqm rate into sqft\" (owner, 2026-11-13 20:06)"},
        {"title": "^Multiplied by how many", "why": "the quantity per row unit, 1 unless typed (standing)"},
        {"title": "carries a note$|^A row naming|^Also names", "why": "\"all the extras are priced seprately inthe BoQ. so the duct row just needs duct prices\" (owner, 2026-11-13 20:10)"},
        {"title": "insulation", "why": "\"ducting should read these directly for insulation and not keep a second copy\" (owner, 2026-11-13 00:19); 9 mm thermal when silent (Q5 20:07); by area on a round duct (D1 option b)"},
        {"title": "misc", "why": "\"Balancing, testing,Painting are part of miscelalenous and should be inherited from there\"; only the sheet's items and units (owner, 2026-11-13 20:14; 2026-11-15 15:50)"},
        {"title": "^The row total", "why": "every line rounded by its own rules; QR-1 (a) two lines (owner, 2026-11-15 12:15)"},
        {"title": "^A kind not stocked in the row's unit|^An unstocked combination", "why": "a unit or combination not on the sheet is named and priced by hand (standing)"},
        {"title": "^A row priced per Lot", "why": "Lot / LS rows are priced by hand, with the red bar (owner, 2026-11-15 14:33 \"2 ok\")"},
        {"title": "^The BoQ scope|^A 'Supply of' row", "why": "Ducting follows the Valve installation-only rule as built + the pair rule (owner, 2026-11-15 11:43)"},
        {"title": "^Work on existing|existing", "why": "removal 0.5 x, refixing 1.0 x the installation (owner, 2026-11-13 19:58)"},
    ]
    scope = copy.deepcopy(cfgs[VALVE]["list_spec"]["pricing"]["scope"])
    scope["uplift_input"] = UPLIFT_ID
    scope["lines"]["install_only_note"] = "Installation only: each line's install rate x (1 + {pct}) (Pricing Input \"Ducting - installation-only uplift\"), rounded up to the rupee; supply not in scope = 0:"
    scope["lines"]["uplift_missing"] = "BoQ says installation only, but the Pricing Input 'Ducting - installation-only uplift' is not set - set it in Pricing Inputs"
    scope["supply_row"] = {
        "normal_note": "Installation only: the installation rate x (1 + the Ducting installation-only uplift, 0% today), because this sheet quotes the supply of this duct on its own row; supply not in scope = 0.",
        "with_row": "Supply row(s) of this duct on this sheet: {rows}.",
        "no_row": "The sheet does not quote this duct's supply on another row.",
        "uplift": True,
    }
    cfg = {
        "discipline": "HVAC", "category_id": DUCT, "category_display": "Ducting", "item_kinds": [KIND],
        "attribute_definitions": [
            {"id": "duct_type", "label": "Duct type", "type": "choice", "values": [RECT, SPIRAL, PIR, MS]},
            {"id": "material", "label": "Material", "type": "choice", "values": ["GI", "PIR", "MS"]},
            {"id": "gauge", "label": "Gauge", "type": "choice", "values": ["26G", "24G", "22G", "20G", "18G"]},
            {"id": "thickness_mm", "label": "mm", "type": "number"},
            {"id": "item_name", "label": "Item", "type": "choice", "values": [], "selector": False, "panel": False},
        ],
        "pipelines": {}, "matching_mode": "item_list",
        "notes": ("DU-1: the 15 items of the owner's Ducting sheet; accessories 110 per sq.m on every item; markups 0.4 / 0.4; brand blank. "
                  "No insulation figure is kept here - insulation is read live from the Insulation category."),
        "list_spec": {
            "family_attribute_id": "duct_type",
            "attribute_definitions": QUESTIONS + [valve_scope],
            "sections": [
                {"id": "duct", "label": "Duct", "add_label": "Add duct"},
                {"id": "insulation", "label": "Insulation", "add_label": "Add insulation", "category_id": INS, "unit_class": "area",
                 "families": ["Thermal Nitrile Insulation", "Acoustic Nitrile Insulation", " Fiberglass Rigid Board Insulation, Density 48Kg/m3"],
                 "include_when": {"attr": "insulated", "equals": "Yes"},
                 "absent": {"value": "No", "line": "insulation not mentioned -> No"},
                 "area_basis": {"length": {"unit": "Sqm", "missing": "insulation on a duct per metre needs the duct's diameter or sides - price the insulation by hand",
                                           "options": [{"needs": ["dia_mm"], "formula": "3.14*dia_mm/1000", "line": "insulation by area: 3.14 x {dia_mm} mm = {area} sq.m per metre"},
                                                       {"needs": ["duct_w_mm", "duct_h_mm"], "formula": "2*(duct_w_mm+duct_h_mm)/1000", "line": "insulation by area: 2 x ({duct_w_mm} + {duct_h_mm}) mm = {area} sq.m per metre"}]}}},
                {"id": "misc", "label": "Misc item", "add_label": "Add misc item", "category_id": MISC, "unit_class": "area",
                 "families": ["Paint", "Fire Retardant Spray Paint", "Air Balancing"]},
            ],
            "second_opinion": False,
            "pricing": {
                "kind": KIND, "label_attr": "item_name", "unit_class_attr": "unit_class",
                "unit_classes": {"area": area_spell, "length": copy.deepcopy(pip_pr["unit_classes"]["length"]), "airflow": ["CFM", "cfm", "Cfm"]},
                "unit_words": {"area": "sq.m", "length": "metre", "airflow": "CFM"},
                "unit_factors": copy.deepcopy(ins_pr["unit_factors"]),
                "unit_refusal": "unit '{unit}' - ducting is priced per sq.m or per metre - price this row by hand",
                "blank_unit_refuses": True,
                "lot_units": {"units": ["Lot", "LS", "L.S.", "Lumpsum", "Lump sum", "Job", "Nos", "Kg"],
                              "bar": "THIS ROW IS A WHOLE LOT - PRICE IT BY HAND.",
                              "line": "Unit \"{unit}\" is not a duct unit: ducting is priced per sq.m or per metre. Price this row by hand."},
                "numbers": {
                    "thickness_mm": {"from": ["gauge_as_written"], "name": "gauge", "unit": "mm", "gauge": gauge},
                    "dia_mm": {"from": ["dia_mm"], "name": "diameter", "unit": "mm", "typed_only": True, "length_from": "size_as_written", "label": "Diameter (mm)",
                               # DR17 + NOTE 3: the dropdown offers the owner sheet's round-row diameters (DU-D0 D4); "Other..." types any
                               "offered": [80, 100, 150, 200, 250, 300]},
                    "duct_w_mm": {"from": ["duct_w_mm"], "name": "width (or major axis)", "unit": "mm", "typed_only": True, "length_from": "size_as_written", "face_side": "width", "label": "Width / major axis (mm)"},
                    "duct_h_mm": {"from": ["duct_h_mm"], "name": "height (or minor axis)", "unit": "mm", "typed_only": True, "length_from": "size_as_written", "face_side": "height", "label": "Height / minor axis (mm)"},
                },
                "ladders": ["thickness_mm"], "match_attrs": ["thickness_mm", "dia_mm", "duct_w_mm", "duct_h_mm"], "choice_attrs": [],
                "size_match": {"dp": [2, 1], "below_smallest": "smallest"},
                "families": families,
                "family_alias": {ROUND: SPIRAL},
                "family_alias_offered": [ROUND],
                "family_when_none": {"by_unit_class": {"area": RECT, "length": RECT},
                                     "rule": "shape not stated - priced as rectangular (owner DR8)"},
                "family_text": {
                    "map": [{"from": "MS", "to": MS, "rule": "DR11 MS (not fire-rated) is priced as MS Fire Rated (owner 2026-11-13 20:53)"},
                            {"from": "black steel", "to": MS, "rule": "DR11 MS (not fire-rated) is priced as MS Fire Rated (owner 2026-11-13 20:53)"},
                            {"from": "MS welded", "to": MS, "rule": "DR11 MS (not fire-rated) is priced as MS Fire Rated (owner 2026-11-13 20:53)"}],
                    "refuse": [{"from": "aluminium", "refuse": "Aluminium duct is not on our sheet - price this row by hand", "rule": "DR11 aluminium unpriced (owner 2026-11-13 20:57)"},
                               {"from": "aluminum", "refuse": "Aluminium duct is not on our sheet - price this row by hand", "rule": "DR11 aluminium unpriced (owner 2026-11-13 20:57)"},
                               {"from": "stainless steel", "refuse": "Reads as butterfly valves (stainless steel), not a duct - re-file this row", "rule": "DR11 stainless steel rows are butterfly valves (owner 2026-11-13 20:57)"}],
                    "line": "BoQ says {from} -> priced as {to}: MS duct priced as MS Fire Rated, the only MS duct on our sheet",
                    "from_attr": "duct_type_as_written",
                },
                "no_sku_families": [NONE_FAM],
                "no_sku_named_by": "duct_type_as_written",
                "no_sku_refusals": [
                    {"words": ["damper", "vcd", "fire damper"], "refuse": "Reads as a damper, not a duct - re-file this row under ADP"},
                    {"words": ["plenum"], "refuse": "Reads as a plenum, not a duct - re-file this row under ADP"},
                    {"words": ["grille", "grill", "diffuser", "louver", "louvre", "register"], "refuse": "Reads as a grille / diffuser, not a duct - re-file this row under ADP"},
                    {"words": ["attenuator", "silencer"], "refuse": "Reads as a sound attenuator, not a duct - re-file this row under ADP"},
                    {"words": ["flexible", "flex duct"], "refuse": "Reads as a flexible duct, not a ducting item - re-file this row under ADP"},
                    {"words": ["canvas"], "refuse": "Reads as a canvas connection, not a duct - re-file this row under ADP"},
                    {"words": ["vane", "splitter"], "refuse": "Reads as turning vanes, not a duct - re-file this row under ADP"},
                    {"words": ["insulation", "lining"], "refuse": "Reads as duct insulation - re-file this row under Insulation"},
                ],
                "text_notes": [
                    {"families": [RECT, SPIRAL, PIR, MS], "from_text": "own_and_headings", "pattern": "flang|tdf|tdc|joints?",
                     "line": "Also names flanges / TDF joints - priced in its own row, not in this price", "rule": "DR10",
                     "rule_line": "A duct row naming flanges or TDF joints carries a note that they are not in this price"},
                    {"families": [RECT, SPIRAL, PIR, MS], "from_text": "own_and_headings", "pattern": "access\\s*doors?|damper|grille|diffuser|turning\\s*vanes?|paint|testing|balancing",
                     "line": "Also names access doors / dampers / grilles / painting / testing - each priced in its own row, not in this price", "rule": "DR10",
                     "rule_line": "A duct row naming access doors, dampers, grilles, painting or testing carries a note that they are not in this price"},
                ],
                "existing_work": [
                    {"words": ["removal and refixing", "removal & refixing", "removing and refixing", "dismantling and refixing", "removal and re-fixing", "dismantling & refixing"],
                     "install_times": 1.5, "line": "removal and refixing of existing ducts", "rule": "DR14 both named: 0.5 + 1.0 (owner 2026-11-13 19:58; QR-1 Q3 2026-11-15)"},
                    {"words": ["refixing", "re-fixing", "reinstallation", "re-installation", "reinstalling", "re-fixing of existing", "shifting of existing"],
                     "install_times": 1.0, "line": "refixing of existing ducts", "rule": "DR14 refixing = 1.0 x the installation (owner 2026-11-13 19:58)"},
                    {"words": ["removal", "removing", "dismantling", "dismantle"],
                     "install_times": 0.5, "line": "removal of existing ducts", "rule": "DR14 removal = 0.5 x the installation (owner 2026-11-13 19:58)"},
                ],
                "scope": scope,
                "sheet_insulation": {
                    "category": INS, "section": "insulation",
                    "duct_words": "\\bducts?\\b|ducting|ductwork",
                    "insulation_words": "insulat|lining",
                    "acoustic_words": "acoustic|lining|sound",
                    "doubtful_heading_words": "\\bAHU\\b|air\\s*handling|plant\\s*room|machine\\s*room",
                    "mode": "doubtful_only", "high": 0.7, "low": 0.3, "area_units": area_spell + ["sqft", "sq.ft", "sq ft", "sft"],
                    "lines": {
                        "dropped": "Duct insulation is quoted on its own row{s} on this sheet (rows {rows}) - not priced in this row.",
                        "ratio": "The separate rows cover about {pct}% of the insulated duct area on this sheet ({ins} of {area} sq.m).",
                        "added": "Duct insulation rows on this sheet (rows {rows}) cover only about {pct}% of the insulated duct area ({ins} of {area} sq.m) - the insulation is priced in this row too.",
                        "unpriced": "Duct insulation rows on this sheet (rows {rows}) cover about {pct}% of the insulated duct area ({ins} of {area} sq.m) - check whether they cover this duct; insulation left for a person.",
                        "missing_doubtful": "This sheet quotes duct insulation on its own row{s} (rows {rows}) but of another kind or under a plant heading, and the quantities cannot be compared - check whether they cover this duct; insulation left for a person.",
                    },
                },
                "panel_controls": {"duct_type": "dropdown", "thickness_mm": "dropdown_or_other", "dia_mm": "dropdown_or_other", "duct_w_mm": "text", "duct_h_mm": "text"},
                "panel_notes": {
                    "thickness_mm": "Type the gauge the BoQ states (e.g. 24G) or its thickness in mm (0.63 mm reads as 24G). No gauge: the standard size table picks it.",
                    "dia_mm": "Any diameter is priced by area (3.14 x dia per metre)",
                    "duct_w_mm": "Type the duct's width (or an oval duct's major axis) in mm.",
                    "duct_h_mm": "Type the duct's height (or an oval duct's minor axis) in mm.",
                },
                "panel_readonly": ["duct_type_as_written", "size_as_written"],
                "rule_lines": [{"rule": r, "title": t, "detail": d} for r, t, d in rule_lines],
                "derivation_reasons": reasons,
            },
        },
    }
    return cfg


def misc_config(prev):
    """v70's Misc + the 3 borrow-only families for the 5 Misc-tab items (owner's unit rule): Paint / Fire Retardant per sq.m (per sq.ft by
    the direct conversion), Air Balancing per sq.m of duct, per CFM (2 decimals), per sq.ft of carpet (its own sheet item)."""
    c = copy.deepcopy(prev)
    pr = c["list_spec"]["pricing"]
    pr["unit_classes"] = dict(pr["unit_classes"])
    pr["unit_classes"]["area"] = list(copy.deepcopy(pr.get("unit_classes", {}).get("area") or []) or ["Sqm", "sqm", "sq.m", "sq m", "sq.mt", "sqmt", "sq.mtr", "m2", "sqm.", "smt"])
    pr["unit_classes"]["airflow"] = ["CFM", "cfm", "Cfm"]
    pr["unit_classes"]["carpet_area"] = ["Sqft", "sqft", "sq.ft", "sq ft", "sft"]
    pr["unit_words"] = dict(pr.get("unit_words") or {}, area="sq.m", airflow="CFM", carpet_area="sq.ft")
    item_def = [d for d in c["list_spec"]["attribute_definitions"] if d["id"] == "item"][0]
    for fam in ("Paint", "Fire Retardant Spray Paint", "Air Balancing"):
        if fam not in item_def["values"]:
            item_def["values"] = item_def["values"][:-1] + [fam] + item_def["values"][-1:] if item_def["values"] and item_def["values"][-1] == NONE_FAM else item_def["values"] + [fam]

    def pipes(digits):
        return {"supply": {"output": ["supply"], "steps": [
                    {"step": "match_master_row", "params": {"kind": "hvac_misc_item"}, "explain": "match the Misc SKU (item and unit)"},
                    {"step": "component", "name": "unit", "target": "cost_supply", "formula": "base", "explain": "BCS supply: the SKU's own cost from the sheet"},
                    {"step": "sum_components", "result": "bcs_supply", "explain": "BCS supply"},
                    {"step": "scale", "target": "bcs_supply", "result": "supply", "params": {"m_from_ctx": "supply_markup"}, "formula": "base*(1+m)", "explain": "x (1 + the SKU's supply markup)"},
                    {"step": "roundup", "target": "supply", "params": {"digits": digits}, "explain": "ROUNDUP, as the sheet"}]},
                "install": {"output": ["install"], "steps": [
                    {"step": "match_master_row", "params": {"kind": "hvac_misc_item"}, "explain": "match the Misc SKU (item and unit)"},
                    {"step": "component", "name": "install", "target": "cost_install", "formula": "base", "explain": "BCS install: the SKU's own installation cost from the sheet"},
                    {"step": "sum_components", "result": "bcs_install", "explain": "BCS install"},
                    {"step": "scale", "target": "bcs_install", "result": "install", "params": {"m_from_ctx": "install_markup"}, "formula": "base*(1+m)", "explain": "x (1 + the SKU's install markup)"},
                    {"step": "roundup", "target": "install", "params": {"digits": digits}, "explain": "ROUNDUP, as the sheet"}]}}

    def sqft_pipes():
        """per sq.ft = the per-sq.m BoQ rate x 0.0929, rounded up to the rupee (the direct conversion; owner 2026-11-15 15:50)"""
        out = {}
        for k, cost, mk in (("supply", "cost_supply", "supply_markup"), ("install", "cost_install", "install_markup")):
            out[k] = {"output": [k], "steps": [
                {"step": "match_master_row", "params": {"kind": "hvac_misc_item"}, "explain": "match the Misc SKU per sq.m"},
                {"step": "scale", "target": cost, "result": k + "_sqm", "params": {"m_from_ctx": mk}, "formula": "base*(1+m)", "explain": "the per-sq.m rate: BCS x (1 + markup)"},
                {"step": "roundup", "target": k + "_sqm", "params": {"digits": 0}, "explain": "ROUNDUP, as the sheet"},
                {"step": "scale", "target": k + "_sqm", "result": k, "params": {}, "formula": "base*0.0929", "explain": "per sq.ft = per sq.m x 0.0929"},
                {"step": "roundup", "target": k, "params": {"digits": 0}, "explain": "rounded up to the rupee"}]}
        return out
    sqft_conv = lambda: [{"to": "area", "direct": True, "needs": [], "rule": "per sq.ft = the per sq.m rate x 0.0929 (the direct conversion; owner 2026-11-15 15:50)", "pipelines": sqft_pipes()}]
    pr["families"] = dict(pr["families"])
    # per sq.ft for Paint / Fire Retardant = the direct conversion (owner Q4 15:46-15:50 + NOTE 3 19:04): a sq.ft row is in the
    # carpet_area class, priced through a `direct` convert option onto the per-sq.m SKU; any other unit stays unpriced with its note
    pr["families"]["Paint"] = {"needs": [], "units": {"area": {"needs": [], "pipelines": pipes(0)}}, "convert": {"carpet_area": sqft_conv()}}
    pr["families"]["Fire Retardant Spray Paint"] = {"needs": [], "units": {"area": {"needs": [], "pipelines": pipes(0)}}, "convert": {"carpet_area": sqft_conv()}}
    pr["families"]["Air Balancing"] = {"needs": [], "units": {"area": {"needs": [], "pipelines": pipes(0)}, "airflow": {"needs": [], "pipelines": pipes(2)},
                                                             "carpet_area": {"needs": [], "pipelines": pipes(0)}}}
    assert c["list_spec"].get("second_opinion") is False
    # its borrowers (the Valve Package, Ducting) each ask the model only for the Misc items their own section offers
    c["list_spec"]["borrowers_ask_offered_only"] = True
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


def transform(prev, taken):
    """v70 -> v71 (pure but for the uid set): returns (the new payload, the new items)."""
    final = copy.deepcopy(prev)
    cfgs = {c["category_id"]: c for c in prev["category_configs"]}
    assert DUCT not in cfgs, "v70 already has hvac_ducting"
    new_items = duct_items(taken) + misc_items(taken) + [uplift_item(taken)]
    duct = ducting_config(cfgs)
    duct["attribute_definitions"][4]["values"] = [it["attributes"]["item_name"] for it in new_items if it["kind"] == KIND]
    idx = {c["category_id"]: n for n, c in enumerate(prev["category_configs"])}
    final["category_configs"][idx[MISC]] = misc_config(cfgs[MISC])
    final["category_configs"].append(duct)
    final["items"] = prev["items"] + new_items
    return final, new_items


def build(out):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import config_validation, extraction
    from nirmaan_stack.services.boq_rate_master.loader import _validate_items, _validate_one_config
    raw = open(V70, "rb").read()
    prev = json.loads(raw.decode("utf-8"))
    if _dump(prev).encode("utf-8") != raw:
        raise SystemExit("re-dumping v70 does not reproduce its bytes -- the series convention is not what this mint writes")
    taken = {i["item_uid"] for i in prev["items"]}
    taken |= {(r["item_uid"] or "").strip() for r in frappe.get_all("BoQ Rate Master Item", filters={"discipline": "HVAC"}, fields=["item_uid"])}
    final, new_items = transform(prev, taken)
    assert _canon(final["items"][:len(prev["items"])]) == _canon(prev["items"]), "a v70 item moved"
    assert len(new_items) == 21 and len({i["item_uid"] for i in new_items}) == 21
    for x in prev["category_configs"]:
        y = [c for c in final["category_configs"] if c["category_id"] == x["category_id"]][0]
        if x["category_id"] != MISC:
            assert _canon(x) == _canon(y), x["category_id"]
    mprev = [c for c in prev["category_configs"] if c["category_id"] == MISC][0]["list_spec"]["pricing"]["families"]
    mnew = [c for c in final["category_configs"] if c["category_id"] == MISC][0]["list_spec"]["pricing"]["families"]
    for f in mprev:
        assert _canon(mprev[f]) == _canon(mnew[f]), ("a Misc family moved", f)
    assert sorted(set(mnew) - set(mprev)) == ["Air Balancing", "Fire Retardant Spray Paint", "Paint"]
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
    if not extraction.has_runnable_pricing_rules(cfgs[("HVAC", DUCT)]) or not extraction.config_is_eligible(cfgs[("HVAC", DUCT)], cfgs):
        raise SystemExit("hvac_ducting is not runnable / eligible")
    if extraction.config_is_eligible(cfgs[("HVAC", MISC)], cfgs):
        raise SystemExit("hvac_misc must stay BORROW-ONLY")
    eligible = sorted(c["category_id"] for c in stored if extraction.config_is_eligible(c, cfgs))
    eligible_base = sorted(c["category_id"] for c in stored_base if extraction.config_is_eligible(c, cfgs_base))
    assert eligible == sorted(eligible_base + [DUCT]), (eligible, eligible_base)

    # STUB PROOF: every other item-list request byte-identical (the Valve Package's Misc section asks its own 4 instruments only)
    def requests(st, cf):
        return {c["category_id"]: json.dumps(extraction.build_items_spec(cf[("HVAC", c["category_id"])], cf, "HVAC"), sort_keys=True)
                for c in st if c.get("list_spec")}
    r_base, r_new = requests(stored_base, cfgs_base), requests(stored, cfgs)
    diff = sorted(k for k in set(r_base) | set(r_new) if r_base.get(k) != r_new.get(k))
    print("STUB PROOF: item-list requests v70 vs v71 -- identical:", sorted(k for k in r_base if r_base[k] == r_new.get(k)), "| differing / new:", diff)
    assert diff == [DUCT, MISC], diff   # Misc's own request (never sent: borrow-only) and the new Ducting one
    dq = json.dumps(extraction.build_items_spec(cfgs[("HVAC", DUCT)], cfgs, "HVAC"), ensure_ascii=False)
    print("hvac_ducting ITEMS_SPEC chars", len(dq))
    assert "Paint" in dq and "Air Balancing" in dq and "Thermal Nitrile Insulation" in dq
    print("eligible configs v71:", eligible)

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
            out[disc]["second_opinion"] = {c: ((LC[c].get("list_spec") or {}).get("second_opinion")) for c in (DUCT, MISC, VALVE) if c in LC}
    print(json.dumps(out, indent=1, sort_keys=True))
    frappe.destroy()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("phase", choices=["build", "load", "verify"])
    ap.add_argument("--candidate", default=V71)
    a = ap.parse_args()
    if a.phase == "build":
        build(a.candidate)
    elif a.phase == "load":
        load(a.candidate)
    else:
        verify(a.candidate)
