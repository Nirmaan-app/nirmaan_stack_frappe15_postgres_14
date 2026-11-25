"""VAV-1 (2026-11-19, desktop) -- MINT HVAC v76 = v75 + THE VAV BOX PRICE SHEET (VAV-D0 design D2 / D3 / D5 / D7 / D9 / D10).

What changes (owner rulings 2026-11-18 22:16 - 2026-11-19 01:39, VAV_Rulings_Capture_2026-11-18.md; plan 2026-11-19 00:13):
  items          + 91 hvac_vav_item: the workbook's VAV Box tab rows 2-87 (84 box lines + 2 VAV Integrator lines), READ FROM THE
                   WORKBOOK, BCS float noise cleaned, the tab's "AHRI Certfied" spelled "AHRI Certified"; + the 4 NEW SKUs of the owner's
                   rulings (BACnet over IP controller 33,000 + 2,000 22:30; Duct connection 1,200 + 0 23:24; Conical piece 1,200 + 0
                   23:27 / 23:49; Integrator cabling 140 + 0 per Mtr 23:14) + "VAV installation - any size" 0 + 1,500 (owner 23:49
                   point 7 "yes"; SKU agreed 2026-11-19 01:23 "agree on all 3"); VAV sheet markups 0.4 / 0.6
                 + 2 hvac_misc_item from the workbook's Misc tab: Digital Thermostat (row 11), Transformation Pieces (row 19)
                 + 2 hvac_sensor_item from the workbook's Sensors tab: CO2 Sensor (row 14), Differential Pressure Switch (row 10),
                   both Greystone/Honeywell
                 + 1 hvac_pricing_input "VAV - installation-only uplift" = 0 (the scope's required input; QR-B (a): the other VAV-2
                   inputs arrive with the code that reads them, VAV-2a)
  configs        + hvac_vav_box (kind hvac_vav_item, family attribute vav_item, sections: own VAV items + Misc + Sensors borrowed)
                 + hvac_sensors BORROW-ONLY (as Misc at VP-1: no top-level attribute_definitions, offered-only)
                 hvac_misc: + 2 families (Digital Thermostat, Transformation Pieces) and their 2 values on `item`; nothing else
Every other config and item byte-identical to v75; second_opinion stays FALSE everywhere.

QR-A (owner): ELIGIBILITY decides whether the VAV config carries its top-level attribute_definitions (`--eligibility`):
  calculator_only  top-level attributes + `calculator_only: true` (QR-A (a): needs the switch's code first)
  live             top-level attributes, no switch (QR-A (b): VAV rows eligible)
  catalogue        top-level attributes EMPTY (QR-A (c) / (d): never eligible, like Misc)

Runs IN THE CONTAINER under the bench's python. Phases: build (v75 -> the candidate; NO database write), fixture (the T1 parity
fixture from the workbook), load, verify.
Usage (container, from frappe-bench): env/bin/python -I <this> <phase> [--candidate P] [--eligibility E] [--workbook W]
"""
import argparse, copy, hashlib, json, os, re

APP = "/workspace/development/frappe-bench/apps/nirmaan_stack"
DATA = os.path.join(APP, "nirmaan_stack/services/boq_rate_master/data")
V75 = os.path.join(DATA, "rate_master_hvac_all_v75.json")
V76 = os.path.join(DATA, "rate_master_hvac_all_v76.json")
FIXTURE = os.path.join(APP, "frontend/src/pages/boq-wizard/rate-helper/__fixtures__/vav1VavBoxTab.json")
WORKBOOK_SHA = "a801d02742a1489ca4d29cc21a56d9257d105b0a780d92f210448f3c2abc5539"
VAV, SENS, MISC = "hvac_vav_box", "hvac_sensors", "hvac_misc"
VAV_KIND, SENS_KIND, MISC_KIND = "hvac_vav_item", "hvac_sensor_item", "hvac_misc_item"
UPLIFT_ID = "vav_install_only_uplift"

BOX, INTEGRATOR, BACNET, CONNECTION, CONICAL, CABLING, INSTALL_ANY = (
    "VAV box", "VAV Integrator", "BACnet over IP controller", "Duct connection", "Conical piece", "Integrator cabling",
    "VAV installation - any size")
FAMILIES = [BOX, INTEGRATOR, BACNET, CONNECTION, CONICAL, CABLING, INSTALL_ANY]
SHAPES = ["Rectangular", "Oval"]
BOX_TYPES = ["Nothing specific mentioned", "AHRI Certified", "AHRI Certified Imported"]
INTEGRATOR_TYPES = ["Nothing specific mentioned", "Imported"]       # the tab's own two lines (rows 44 / 45)
CFM_BANDS = ["0-450", "450-800", "800-1350", "1350-2100", "2100-3200", "3200-4000", "4000-8000"]
TAB_TYPES = {"AHRI Certfied": "AHRI Certified", "AHRI Certfied Imported": "AHRI Certified Imported",
             "Nothing specific mentioned": "Nothing specific mentioned", "Imported": "Imported"}
VAV_MARKUPS = (0.4, 0.6)
# (family, BCS supply, BCS install, unit, the owner's words)
NEW_SKUS = [
    (BACNET, 33000.0, 2000.0, "Nos", "\"Additional BCS supply is 33000, Adiitonal BCS Install iz 2000 for bacnet controller. same suppl;y and install "
                                    "markup as others\" (owner 2026-11-18 22:30)"),
    (CONNECTION, 1200.0, 0.0, "Nos", "\"extra cost - bcs suplly 1200, bcxs install -0. standard nmargins\" (owner 2026-11-18 23:24)"),
    (CONICAL, 1200.0, 0.0, "Nos", "its own SKU at the duct connection's rate (owner 2026-11-18 23:27 / 23:32; 23:49 \"agree with both\")"),
    (CABLING, 140.0, 0.0, "Mtr", "\"2 mts of cabling per VAV at 140 per meter supply BCS. install BCS is zero. standard supply and install margin\" "
                                 "(owner 2026-11-18 23:14)"),
    (INSTALL_ANY, 0.0, 1500.0, "Nos", "installation only with no airflow -> the installation rate, BCS 1,500 on every box line (owner 2026-11-18 23:49 "
                                      "point 7 \"yes\"); its own SKU (owner 2026-11-19 01:23 \"agree on all 3\")"),
]
MISC_NEW = [("Digital Thermostat", 11), ("Transformation Pieces", 19)]
SENS_NEW = [("CO2 Sensor", 14), ("Differential Pressure Switch", 10)]
SENS_MAKE = "Greystone/Honeywell"

COUNT_UNITS = ["Nos", "nos", "no", "no's", "nos.", "no.", "no.s", "number", "each", "ea", "pcs", "unit", "Set", "Sets"]
SCOPE_OPTIONS = ["Supply + installation", "Supply only", "Installation only"]

ITEM_AS_WRITTEN_NOTE = ("Copy the words exactly as the BoQ writes them, as one continuous piece; never shorten, never join pieces with '...' or "
                        "any other mark; if the words are long, copy the shortest continuous piece that holds the value.")

# B4: a "why" on every Derivation line this config prices by (owner + date per ruling); VAV-2's rules are NOT declared here
VAV_REASONS = [
    {"title": "^The row's unit decides", "why": "VAV items are priced per Nos, the VAV Box sheet's unit; a row with no unit is refused, never assumed (HVAC helper feature standard #29, an acceptance item of every category build: owner 2026-11-15 13:39 / 13:41)"},
    {"title": "^The item's own kind decides", "why": "the box and VAV's own extras are separate VAV items on one row (owner QR-1 (a), 2026-11-19 00:57); the kinds = the VAV Box sheet's box and VAV Integrator, the four extras the owner made SKUs (BACnet over IP controller 2026-11-18 22:30; duct connection 23:24; conical piece 23:27 / 23:32; integrator cabling 23:14) and 'VAV installation - any size' (owner 2026-11-19 01:23 \"agree on all 3\")"},
    {"title": "^A material the model could not match", "why": "a row that is not a VAV item is not priced (owner point 5, 2026-11-18 23:53 \"agree on all these\")"},
    {"title": "^That kind's rule for that unit", "why": "every VAV item has one rate per Nos on the VAV Box sheet; integrator cabling is a per-metre rate counted per box (owner 2026-11-18 23:14 \"2 mts of cabling per VAV at 140 per meter\")"},
    {"title": "^The facts that rule needs", "why": "the VAV Box sheet prices a box by shape, type, integrator included and airflow band (the owner's workbook, 2 Nov 2026); integrator inside the rate -> Yes, else No (owner item 4, 2026-11-18 22:37); the VAV Integrator by its type (the sheet's two lines; owner point 8, 23:53)"},
    {"title": "^Then the priced steps", "why": "BoQ rate = BCS x (1 + markup), rounded up to the rupee: supply x 1.4, install x 1.6 on the VAV Box sheet (the owner's workbook, 2 Nov 2026; the new SKUs 'same supply and install markup as others', owner 2026-11-18 22:30)"},
    {"title": "^Multiplied by how many", "why": "every extra is its own item with its own quantity per box, the user can add or remove it (owner 2026-11-18 23:15 / 23:18)"},
    {"title": "^The misc item section", "why": "borrowed, never copied: Digital Thermostat (owner item 3, 2026-11-18 22:35), Temperature Gauge / Thermometer as 'Room temperature sensor' (22:35; QR-3d (a), 2026-11-19 00:57), Transformation Pieces (22:38 \"option A\") are priced by Misc's own rules; \"ducting should read these directly ... and not keep a second copy\" (owner 2026-11-13 00:19)"},
    {"title": "^The sensor section", "why": "the CO2 sensor and the differential pressure switch are borrowed from the Sensors sheet under its own rules (owner 2026-11-18 23:14; QR-2 (a) borrow-only Sensors, 2026-11-19 00:57)"},
    {"title": "^The row total adds", "why": "the row total is every item; one item that needs a person makes the row need a person (HVAC helper feature standard #26; owner 2026-11-15 13:39)"},
    {"title": "^A kind not stocked in the row's unit", "why": "VAV items are stocked per Nos only; any other unit is priced by hand (HVAC helper feature standard #29; owner 2026-11-15 13:39)"},
    {"title": "^An unstocked combination", "why": "a box whose facts match no VAV Box sheet line is not priced - never a nearest pick (owner points 3 / 4, 2026-11-18 23:53: above 8,000 CFM or no airflow -> not priced)"},
    {"title": "^A row priced per Lot", "why": "a Lot or a job is not a VAV unit and is priced by hand (HVAC helper feature standard #30; owner 2026-11-15 13:39)"},
    {"title": "^The BoQ scope", "why": "installation only -> the installation rate only (owner ruling D \"2d agree\", 2026-11-18 22:16); the Pricing Input 'VAV - installation-only uplift' is 0, so no uplift"},
]
# (no panel_notes: the validator refuses a note on a dropdown -- 'would never be read'; VAV has no typed field, so the field audit's
#  MISSING NOTES is 0 with none; each field's own note is on its list_spec attribute definition)

def read_workbook(path):
    import openpyxl
    raw = open(path, "rb").read()
    if hashlib.sha256(raw).hexdigest() != WORKBOOK_SHA:
        raise SystemExit("workbook sha256 is not the 2 Nov workbook's a801d027...")
    wb = openpyxl.load_workbook(path, data_only=True)
    vav = []
    ws = wb["VAV Box"]
    head = [ws.cell(1, c).value for c in range(1, 12)]
    assert head[:11] == ["Item", "Type", "Integrator Included", "CFM Range", "Size (inches)", "Supply Markup", "Install Markup",
                         "BCS Supply", "BCS Install", "BoQ Supply", "BoQ Install"], head
    for r in range(2, ws.max_row + 1):
        v = [ws.cell(r, c).value for c in range(1, 12)]
        if v[0] is None:
            continue
        vav.append({"row": r, "item": v[0], "type": v[1], "integrator": v[2], "cfm": v[3], "size": v[4], "supply_markup": v[5],
                    "install_markup": v[6], "bcs_supply": v[7], "bcs_install": v[8], "boq_supply": v[9], "boq_install": v[10]})
    assert [x["row"] for x in vav] == list(range(2, 88)), [x["row"] for x in vav]
    misc, ms = {}, wb["Misc"]
    for name, r in MISC_NEW:
        v = [ms.cell(r, c).value for c in range(1, 10)]
        assert v[0] == name and v[2] == "Nos", v
        misc[name] = {"row": r, "detail": v[1], "supply_markup": v[3], "install_markup": v[4], "bcs_supply": v[5], "bcs_install": v[6],
                      "boq_supply": v[7], "boq_install": v[8]}
    sens, ss = {}, wb["Sensors"]
    for name, r in SENS_NEW:
        v = [ss.cell(r, c).value for c in range(1, 9)]
        assert v[0].replace("₂", "2") == name and v[1] == SENS_MAKE, v
        sens[name] = {"row": r, "written": v[0], "supply_markup": v[2], "install_markup": v[3], "bcs_supply": v[4], "bcs_install": v[5],
                      "boq_supply": v[6], "boq_install": v[7]}
    return vav, misc, sens

def clean(x):
    """the clean BCS value: the tab's float noise (15950.000000000002) removed; never a change above a millionth"""
    c = round(float(x), 6)
    assert abs(c - float(x)) < 1e-6, x
    return float(c)

def _uid(key, taken):
    for n in range(100):
        u = "rmi-" + hashlib.sha256(("VAV-1 %s %d" % (key, n)).encode()).hexdigest()[:12]
        if u not in taken:
            taken.add(u)
            return u
    raise SystemExit("no free item_uid for %s" % key)

def own_uids():
    keys = ["vav tab row %d" % r for r in range(2, 88)] + ["vav new %s" % f for f, *_ in NEW_SKUS] + \
           ["misc row %d" % r for _, r in MISC_NEW] + ["sensors row %d" % r for _, r in SENS_NEW] + ["pricing input " + UPLIFT_ID]
    return {"rmi-" + hashlib.sha256(("VAV-1 %s %d" % (k, n)).encode()).hexdigest()[:12] for k in keys for n in range(100)}

def vav_items(tab, taken):
    out = []
    for x in tab:
        sm, im = float(x["supply_markup"]), float(x["install_markup"])
        assert (sm, im) == VAV_MARKUPS, x
        if x["item"] == "VAV Integrator":
            assert x["integrator"] == "NA" and x["cfm"] == "NA", x
            at = {"group": "VAV Box", "vav_item": INTEGRATOR, "item_name": "VAV Integrator", "vav_type": TAB_TYPES[x["type"]]}
        else:
            shape = {"Rectangular VAV/ CAV": "Rectangular", "Oval VAV/ CAV": "Oval"}[x["item"]]
            assert x["integrator"] in ("Yes", "No") and x["cfm"] in CFM_BANDS, x
            at = {"group": "VAV Box", "vav_item": BOX, "item_name": x["item"], "shape": shape, "vav_type": TAB_TYPES[x["type"]],
                  "integrator_included": x["integrator"], "cfm_range": x["cfm"]}
        out.append({"kind": VAV_KIND, "brand": None, "unit": "Nos", "attributes": at,
                    "rates": {"cost_supply": clean(x["bcs_supply"]), "supply_markup": sm, "cost_install": clean(x["bcs_install"]), "install_markup": im},
                    "source": {"sheet": "VAV Box", "row": x["row"]}, "item_uid": _uid("vav tab row %d" % x["row"], taken)})
    for fam, s, i, unit, why in NEW_SKUS:
        out.append({"kind": VAV_KIND, "brand": None, "unit": unit,
                    "attributes": {"group": "VAV Box", "vav_item": fam, "item_name": fam, "remarks": "VAV-1 new SKU: " + why},
                    "rates": {"cost_supply": s, "supply_markup": VAV_MARKUPS[0], "cost_install": i, "install_markup": VAV_MARKUPS[1]},
                    "source": {"sheet": "VAV Box", "row": 0}, "item_uid": _uid("vav new " + fam, taken)})
    return out

def misc_items(misc, taken):
    return [{"kind": MISC_KIND, "brand": None, "unit": "Nos", "attributes": {"group": "Misc", "item": name, "item_name": name},
             "rates": {"cost_supply": clean(m["bcs_supply"]), "supply_markup": float(m["supply_markup"]), "cost_install": clean(m["bcs_install"]),
                       "install_markup": float(m["install_markup"])},
             "source": {"sheet": "Misc", "row": m["row"]}, "item_uid": _uid("misc row %d" % m["row"], taken)}
            for name, m in ((n, misc[n]) for n, _ in MISC_NEW)]

def sensor_items(sens, taken):
    return [{"kind": SENS_KIND, "brand": None, "unit": "Nos",
             "attributes": {"group": "Sensors", "sensor": name, "item_name": "%s - %s" % (name, SENS_MAKE), "make": SENS_MAKE},
             "rates": {"cost_supply": clean(m["bcs_supply"]), "supply_markup": float(m["supply_markup"]), "cost_install": clean(m["bcs_install"]),
                       "install_markup": float(m["install_markup"])},
             "source": {"sheet": "Sensors", "row": m["row"]}, "item_uid": _uid("sensors row %d" % m["row"], taken)}
            for name, m in ((n, sens[n]) for n, _ in SENS_NEW)]

def uplift_item(taken):
    return {"kind": "hvac_pricing_input", "brand": None, "unit": "share of the final install (0.5 = 50%)",
            "attributes": {"item": UPLIFT_ID, "name": "VAV - installation-only uplift",
                           "remarks": "A VAV Box row the BoQ prices as INSTALLATION ONLY: each line's final install x (1 + this), rounded up to the "
                                      "rupee once; no supply. 0 = the installation rate itself (owner 2026-11-18 22:16 ruling D \"installation only "
                                      "-> installation rate only\").",
                           "shared_by": "vav"},
            "rates": {"factor": 0.0}, "source": {"sheet": "Pricing Inputs", "row": 0}, "item_uid": _uid("pricing input " + UPLIFT_ID, taken)}

def family_block(kind, sku_words, needs):
    """a count-unit family = Misc's / Valve's own pipeline (match the SKU, BCS x (1 + the SKU's markup), ROUNDUP 0)"""
    def side(name, target, bcs, out, word):
        return {"output": [out], "steps": [
            {"step": "match_master_row", "params": {"kind": kind}, "explain": "match the %s SKU" % sku_words},
            {"step": "component", "name": name, "target": target, "formula": "base", "explain": "BCS %s: the SKU's own %s from the sheet" % (word, "cost" if out == "supply" else "installation cost")},
            {"step": "sum_components", "result": bcs, "explain": "BCS %s" % word},
            {"step": "scale", "target": bcs, "result": out, "params": {"m_from_ctx": "%s_markup" % out}, "formula": "base*(1+m)",
             "explain": "BCS %s x (1 + the SKU's %s markup)" % (word, out)},
            {"step": "roundup", "target": out, "params": {"digits": 0}, "explain": "ROUNDUP(%s, 0)" % out}]}
    return {"needs": [], "units": {"count": {"needs": list(needs), "pipelines": {
        "supply": side("unit", "cost_supply", "bcs_supply", "supply", "supply"),
        "install": side("install", "cost_install", "bcs_install", "install", "install")}}}}

def vav_config(eligibility):
    box_attrs = ["shape", "vav_type", "integrator_included", "cfm_range"]
    top_defs = [
        {"id": "vav_item", "label": "VAV item", "type": "choice", "values": list(FAMILIES)},
        {"id": "item_name", "label": "Item", "type": "choice",
         "values": ["Rectangular VAV/ CAV", "Oval VAV/ CAV", "VAV Integrator", BACNET, CONNECTION, CONICAL, CABLING, INSTALL_ANY],
         "note": "The VAV Box sheet's own Item text, verbatim.", "selector": False, "panel": False},
        {"id": "shape", "label": "Shape", "type": "choice", "values": list(SHAPES)},
        {"id": "vav_type", "label": "Type", "type": "choice", "values": BOX_TYPES + ["Imported"]},
        {"id": "integrator_included", "label": "Integrator included", "type": "choice", "values": ["Yes", "No"]},
        {"id": "cfm_range", "label": "CFM range", "type": "choice", "values": list(CFM_BANDS)},
    ]
    list_defs = [
        {"id": "vav_item", "label": "VAV item", "type": "choice", "values": FAMILIES + ["none of these"], "allow_none": True,
         "note": "Which VAV Box sheet item this line is: a VAV box (a VAV or CAV terminal box); the VAV Integrator; a BACnet over IP controller; a "
                 "duct connection; a conical piece; integrator cabling (per metre); or the installation of a VAV box of any size. Answer 'none "
                 "of these' for anything else and copy its words into 'VAV item as written'."},
        {"id": "vav_item_as_written", "label": "VAV item as written", "type": "text", "note": "The item in the BoQ's own words. " + ITEM_AS_WRITTEN_NOTE},
        {"id": "shape", "label": "Shape", "type": "choice", "values": list(SHAPES), "allow_none": True,
         "note": "VAV boxes only: Rectangular or Oval, as the BoQ states."},
        {"id": "vav_type", "label": "Type", "type": "choice", "values": BOX_TYPES + ["Imported"], "allow_none": True,
         "values_by_family": {BOX: list(BOX_TYPES), INTEGRATOR: list(INTEGRATOR_TYPES)},
         "note": "VAV box: Nothing specific mentioned, AHRI Certified, or AHRI Certified Imported. VAV Integrator: Nothing specific mentioned or "
                 "Imported. As the BoQ states."},
        {"id": "integrator_included", "label": "Integrator included in this rate", "type": "choice", "values": ["Yes", "No"], "allow_none": True,
         "note": "VAV boxes only: Yes when the box's rate includes its VAV integrator, No when it does not."},
        {"id": "cfm_range", "label": "Airflow band (CFM)", "type": "choice", "values": list(CFM_BANDS), "allow_none": True,
         "note": "VAV boxes only: the airflow band of the box on the VAV Box sheet, in CFM."},
        {"id": "qty_per_box", "label": "Qty per box", "type": "number", "allow_none": True,
         "note": "How many of this item go with one row unit (one box); for integrator cabling, the metres per box."},
        {"id": "scope", "label": "Scope", "type": "choice", "values": list(SCOPE_OPTIONS), "allow_none": True,
         "note": "What the row pays for: supply + installation, supply only, or installation only. 'None' when nothing is said."},
    ]
    families = {f: family_block(VAV_KIND, "VAV Box sheet", box_attrs if f == BOX else (["vav_type"] if f == INTEGRATOR else [])) for f in FAMILIES}
    pricing = {
        "kind": VAV_KIND, "label_attr": "vav_item" if eligibility == "catalogue" else "item_name",  # a label: a top-level column or the family
        "unit_class_attr": "unit_class",
        "unit_classes": {"count": list(COUNT_UNITS)}, "unit_words": {"count": "Nos"},
        "unit_refusal": "unit '{unit}' is not a VAV unit - VAV items are priced per Nos - price this row by hand",
        "no_sku_families": ["none of these"],
        "numbers": {}, "ladders": [],
        "match_attrs": list(box_attrs), "choice_attrs": list(box_attrs),
        "families": families,
        "lot_units": {"units": ["Lot", "LS", "L.S.", "Lumpsum", "Lump sum", "Job"],
                      "bar": "PRICED PER LOT - NOT PRICED. PRICE THIS ROW BY HAND.",
                      "line": "Unit \"{unit}\" is not a VAV unit: VAV items are priced per Nos. A Lot or a job is priced by hand."},
        "panel_controls": {"vav_item": "dropdown", "shape": "dropdown", "vav_type": "dropdown", "integrator_included": "dropdown", "cfm_range": "dropdown"},
        "panel_readonly": ["vav_item_as_written"],
        "derivation_reasons": copy.deepcopy(VAV_REASONS),
        "no_sku_named_by": "vav_item_as_written",
        "blank_unit_refuses": True,
        "scope": {
            "options": list(SCOPE_OPTIONS), "supply_only": "Supply only", "install_only": "Installation only",
            "uplift_input": UPLIFT_ID, "title": "Scope", "model_attr": "scope",
            "lines": {
                "supply_only_note": "BoQ says supply only - no installation: install 0 on every line of this row.",
                "install_only_note": "Installation only: each line's install rate x (1 + {pct}) (Pricing Input \"VAV - installation-only uplift\"), rounded up to the rupee; supply not in scope = 0:",
                "install_only_line": "{title} {rate} x (1 + {pct}) = {figure}",
                "no_install": "BoQ says installation only, but {title} has no installation rate - price this row by hand",
                "uplift_missing": "BoQ says installation only, but the Pricing Input 'VAV - installation-only uplift' is not set - set it in Pricing Inputs",
                "row_title": "the row"},
            "panel_pick": {"note": "Scope changed by user (the helper chose {helper}{because})"},
        },
    }
    sections = [
        {"id": "vav", "label": "VAV item", "add_label": "Add VAV item"},
        {"id": "misc", "label": "Misc item", "add_label": "Add misc item", "category_id": MISC, "unit_class": "count",
         "families": ["Digital Thermostat", "Temperature Gauge / Thermometer", "Transformation Pieces"],
         "family_note": "Which Misc item goes with THIS VAV box: Digital Thermostat (a thermostat for the box); Temperature Gauge / Thermometer = "
                        "Room temperature sensor - priced at Misc's Temperature Gauge / Thermometer (a room temperature sensor with no thermostat); "
                        "Transformation Pieces (a transition / transformation piece between the box and the duct). Answer 'none of these' for "
                        "anything else and copy its words into 'Item as written'."},
        {"id": "sensors", "label": "Sensor", "add_label": "Add sensor", "category_id": SENS, "unit_class": "count",
         "families": ["CO2 Sensor", "Differential Pressure Switch"],
         "family_note": "Which sensor goes with THIS VAV box: CO2 Sensor (a CO2 sensor); Differential Pressure Switch (a differential pressure "
                        "switch or DP sensor). Answer 'none of these' for anything else and copy its words into 'Sensor as written'."},
    ]
    cfg = {
        "discipline": "HVAC", "category_id": VAV, "category_display": "VAV Box", "item_kinds": [VAV_KIND],
        "attribute_definitions": [] if eligibility == "catalogue" else top_defs,
        "pipelines": {},
        "notes": "VAV-1 (2026-11-19): the VAV Box price sheet -- the workbook's VAV Box tab (84 box lines + 2 VAV Integrator lines; BoQ = "
                 "ROUNDUP(BCS x 1.4) supply, ROUNDUP(BCS x 1.6) install) + the owner's 4 new SKUs and 'VAV installation - any size'; the "
                 "Misc and Sensors items borrowed live under their own rules (list_spec.sections). The BoQ-row rules (the reading, the "
                 "sheet checks, the panel) are VAV-2a / VAV-2b.",
        "matching_mode": "item_list",
        "list_spec": {"family_attribute_id": "vav_item", "qty_attribute_id": "qty_per_box", "attribute_definitions": list_defs,
                      "sections": sections, "second_opinion": False, "borrowers_ask_offered_only": True, "pricing": pricing},
    }
    if eligibility == "calculator_only":
        cfg["calculator_only"] = True
    return cfg

def sensors_config(misc_cfg):
    """BORROW-ONLY exactly as Misc at VP-1: no top-level attribute_definitions (never eligible on its own), offered-only, its own rules"""
    mp = misc_cfg["list_spec"]["pricing"]
    return {
        "discipline": "HVAC", "category_id": SENS, "category_display": "Sensors & Controls", "item_kinds": [SENS_KIND],
        "attribute_definitions": [], "pipelines": {},
        "notes": "VAV-1 (2026-11-19; owner QR-2 (a) 2026-11-19 00:57): the Sensors & Controls category's rules for its 2 priced items, "
                 "BORROW-ONLY as Misc was at VP-1: no top-level attribute_definitions, so it is never eligible on its own -- Sensors rows keep "
                 "'coming soon'; VAV Box prices these items under these rules. Built properly when the Sensors category is built.",
        "matching_mode": "item_list",
        "list_spec": {
            "family_attribute_id": "sensor",
            "attribute_definitions": [
                {"id": "sensor", "label": "Sensor", "type": "choice", "values": [n for n, _ in SENS_NEW] + ["none of these"], "allow_none": True,
                 "note": "Which sensor THIS row buys: a CO2 sensor; a differential pressure switch. Answer 'none of these' for anything else and "
                         "copy its words into 'Sensor as written'."},
                {"id": "sensor_as_written", "label": "Sensor as written", "type": "text", "note": "The sensor in the BoQ's own words. " + ITEM_AS_WRITTEN_NOTE},
            ],
            "second_opinion": False, "borrowers_ask_offered_only": True,
            "pricing": {
                "kind": SENS_KIND, "label_attr": "sensor", "unit_class_attr": "unit_class",
                "unit_classes": {"count": list(mp["unit_classes"]["count"])}, "unit_words": {"count": "Nos"},
                "unit_refusal": "unit '{unit}' is not a Sensors unit - these sensors are priced per Nos - price this row by hand",
                "no_sku_families": ["none of these"], "numbers": {}, "ladders": [], "match_attrs": [], "choice_attrs": [],
                "families": {n: family_block(SENS_KIND, "Sensors", []) for n, _ in SENS_NEW},
                "panel_controls": {"sensor": "dropdown"}, "panel_readonly": ["sensor_as_written"],
                "no_sku_named_by": "sensor_as_written", "blank_unit_refuses": True,
            },
        },
    }

def misc_config(prev):
    """+ the 2 families and their 2 values on `item` (before 'none of these'); nothing else"""
    c = copy.deepcopy(prev)
    d = next(x for x in c["list_spec"]["attribute_definitions"] if x["id"] == "item")
    assert d["values"][-1] == "none of these" and not set(n for n, _ in MISC_NEW) & set(d["values"])
    d["values"] = d["values"][:-1] + [n for n, _ in MISC_NEW] + ["none of these"]
    fams = c["list_spec"]["pricing"]["families"]
    tpl = fams["Temperature Gauge / Thermometer"]
    for n, _ in MISC_NEW:
        assert n not in fams
        fams[n] = copy.deepcopy(tpl)
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

def _sha16(o):
    return hashlib.sha256(_canon(o).encode()).hexdigest()[:16]

def build(out, eligibility, workbook):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import config_validation, extraction
    from nirmaan_stack.services.boq_rate_master.loader import _validate_items, _validate_one_config
    raw = open(V75, "rb").read()
    prev = json.loads(raw.decode("utf-8"))
    if _dump(prev).encode("utf-8") != raw:
        raise SystemExit("re-dumping v75 does not reproduce its bytes -- the series convention is not what this mint writes")
    tab, misc, sens = read_workbook(workbook)
    taken = {i["item_uid"] for i in prev["items"]}
    taken |= {(r["item_uid"] or "").strip() for r in frappe.get_all("BoQ Rate Master Item", filters={"discipline": "HVAC"}, fields=["item_uid"])} - own_uids()
    final = copy.deepcopy(prev)
    new_items = vav_items(tab, taken) + misc_items(misc, taken) + sensor_items(sens, taken) + [uplift_item(taken)]
    final["items"] += new_items
    idx = {c["category_id"]: n for n, c in enumerate(prev["category_configs"])}
    final["category_configs"][idx[MISC]] = misc_config(prev["category_configs"][idx[MISC]])
    final["category_configs"] += [vav_config(eligibility), sensors_config(prev["category_configs"][idx[MISC]])]

    # BYTE-IDENTITY: every v75 item and every v75 config but Misc unchanged, in order; the new ones appended
    assert _canon(prev["items"]) == _canon(final["items"][:len(prev["items"])]), "a v75 item moved"
    assert len(final["items"]) == len(prev["items"]) + 91 + 2 + 2 + 1
    for x, y in zip(prev["category_configs"], final["category_configs"]):
        assert x["category_id"] == y["category_id"]
        assert (_canon(x) == _canon(y)) == (x["category_id"] != MISC), x["category_id"]
    assert [c["category_id"] for c in final["category_configs"][len(prev["category_configs"]):]] == [VAV, SENS]
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
    print("eligible configs v75:", eligible_base, "| v76:", eligible)
    expect = eligible_base + ([VAV] if eligibility == "live" else [])
    assert eligible == sorted(expect), (eligible, expect)

    # STUB PROOF: the model's question for every v75 category byte-identical (Valve / Ducting borrow Misc offered-only)
    def requests(st, cf):
        return {c["category_id"]: json.dumps(extraction.build_items_spec(cf[("HVAC", c["category_id"])], cf, "HVAC"), sort_keys=True)
                for c in st if c.get("list_spec")}
    r_base, r_new = requests(stored_base, cfgs_base), requests(stored, cfgs)
    diff = sorted(k for k in r_base if r_base[k] != r_new.get(k))
    print("STUB PROOF: item-list requests v75 vs v76 -- identical:", sorted(k for k in r_base if r_base[k] == r_new.get(k)), "| differing:", diff,
          "| new:", sorted(set(r_new) - set(r_base)))
    # Misc's OWN request (never sent: borrow-only, no top-level attributes) gains its two values; every borrower asks offered-only
    assert diff == [MISC], diff
    assert not extraction.config_is_eligible(cfgs[("HVAC", MISC)], cfgs) and not extraction.config_is_eligible(cfgs[("HVAC", SENS)], cfgs)

    text = _dump(final)
    tokens = sorted({t for t in re.findall(r"v\d+", text.replace(json.dumps(final.get("source_workbook") or "", ensure_ascii=False), '""'))})
    if tokens:
        raise SystemExit("the asset text carries version-like tokens %r (h07)" % tokens)
    open(out, "w", encoding="utf-8", newline="").write(text)
    print("candidate written:", out, "| eligibility", eligibility, "| items", len(final["items"]), "| configs", len(final["category_configs"]),
          "| sha256", hashlib.sha256(text.encode("utf-8")).hexdigest())
    print("per-config sha16:", {c["category_id"]: _sha16(c) for c in final["category_configs"]})
    print("new item uids:", [i["item_uid"] for i in new_items][:3], "...", [i["item_uid"] for i in new_items][-3:])
    frappe.destroy()

def fixture(workbook, out):
    """T1's pin: every VAV Box tab line's figures as the workbook stores them (never typed by hand)"""
    tab, misc, sens = read_workbook(workbook)
    rows = [{"row": x["row"], "item": x["item"], "type": x["type"], "integrator": x["integrator"], "cfm": x["cfm"],
             "bcs_supply": x["bcs_supply"], "bcs_install": x["bcs_install"], "supply_markup": x["supply_markup"], "install_markup": x["install_markup"],
             "boq_supply": x["boq_supply"], "boq_install": x["boq_install"]} for x in tab]
    doc = {"source": "HVAC_BOQ_BCS PRICING_ Nitesh Edits - 2 nov 2026.xlsx, tab 'VAV Box' rows 2-87 (data_only); Misc rows 11 / 19; Sensors rows 14 / 10",
           "workbook_sha256": WORKBOOK_SHA, "vav_box_tab": rows,
           "misc": {n: misc[n] for n, _ in MISC_NEW}, "sensors": {n: sens[n] for n, _ in SENS_NEW}}
    # T10 (owner 2026-11-19 03:01): the borrowed Temperature Gauge / Thermometer's own Misc-tab line (already loaded, row 28), for the
    # calculator-vs-sheet comparison of the five borrowed items
    import openpyxl
    ms = openpyxl.load_workbook(workbook, data_only=True)["Misc"]
    v = [ms.cell(28, c).value for c in range(1, 10)]
    assert v[0] == "Temparaturre Gauge/ Thermometer" and v[2] == "Nos", v
    doc["misc"]["Temperature Gauge / Thermometer"] = {"row": 28, "detail": v[1], "supply_markup": v[3], "install_markup": v[4], "bcs_supply": v[5],
                                                      "bcs_install": v[6], "boq_supply": v[7], "boq_install": v[8]}
    open(out, "w", encoding="utf-8", newline="").write(json.dumps(doc, indent=1, ensure_ascii=False) + "\n")
    print("fixture written:", out, "| rows", len(rows))

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
    print(json.dumps(out, indent=1, sort_keys=True))
    frappe.destroy()

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("phase", choices=["build", "fixture", "load", "verify"])
    ap.add_argument("--candidate", default=V76)
    ap.add_argument("--eligibility", choices=["calculator_only", "live", "catalogue"], default="calculator_only")
    ap.add_argument("--workbook", default="/tmp/vav1/in/wb.xlsx")
    ap.add_argument("--out", default=FIXTURE)
    a = ap.parse_args()
    if a.phase == "build":
        build(a.candidate, a.eligibility, a.workbook)
    elif a.phase == "fixture":
        fixture(a.workbook, a.out)
    elif a.phase == "load":
        load(a.candidate)
    else:
        verify(a.candidate)
