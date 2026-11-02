"""VRF-1 (2026-11-03) -- MINT HVAC v55 = v54 + THE VRF CATALOGUE, FOUR SHARED MISC ITEMS AND TWO CONVERSION INPUTS.

DATA ONLY. Nothing prices: the new `hvac_vrf` config carries item kinds and attribute definitions and NO pricing block
(`pipelines` {}, no `list_spec`), so `extraction.config_is_eligible` is false -- no extraction population, no model
question -- and a VRF BoQ row and the calculator keep today's "coming soon" text (pricing is VRF-2, the BoQ row VRF-4).

Runs IN THE CONTAINER under the bench's python (frappe for the ONE uid mint and the loader / exporter). Four phases, each
explicit, in this order (the export -> build -> load -> verify shape of `mint_hvac_v49_adp3b.py`; the catalogue mint of
`mint_hvac_v34_piping.py`):

  export   the HVAC asset exported FROM THE DATABASE (`exporter.build_asset`), proved = v54 by content (items by uid,
           configs by id). NO database write.
  build    v54 (the committed file; its re-dump must reproduce its bytes) + the INPUT workbook (sha256 pinned below)
           -> the candidate:
             * config `hvac_vrf` "VRF": item_kinds [hvac_vrf_item, hvac_misc_item], attribute definitions, pipelines {}
               (no pricing block), appended LAST;
             * 152 `hvac_vrf_item` SKUs, one per VRF sheet row 2..153 (source {sheet: VRF, row});
             * 4 `hvac_misc_item` SKUs from Misc rows 20, 22, 24, 25 (source {sheet: Misc, row}) -- the SHARED kind a
               future Misc category lists too (owner R-MISC "Q8: option B": one stored set, never a copy);
             * 2 `hvac_pricing_input` items, the conversion factors (owner R-INPUTS), shared_by "vrf".
           uids through `csv_importer.mint_item_uid` (the ONE mint), unique against v54 and every HVAC row in the
           database. Every v54 item and config is carried byte-identical (asserted). Series convention: items in
           GLOBAL item_uid order, configs in v54's order with the new one last, v54's top-level keys (incl.
           `intentional_removals`). Every sheet figure is checked before writing (the B3 list). Offline validation:
           the loader's own validators, the config validator on every config, the cross-category section check, the
           STUB PROOF (every item-list category's extraction request identical on v54 and v55) and the eligibility
           check (hvac_vrf NOT eligible). Writes the candidate and a manifest (uid -> sheet row and source cells).
           NO database write.
  load     pre-load HVAC snapshot, then `loader.load_rate_master(path=<candidate>, replace=True)`.
  verify   live HVAC == the candidate BY CONTENT; Electrical's content hashes printed (untouched).

Owner rulings carried: R-SRC (the 2 Nov workbook, VRF sheet 152 rows: Blue Star 122, Daikin 30); R-IGNORE (only its
VRF sheet and the 4 Misc rows; every other category AS IT STANDS in v54); the team's answers already in the file
(Daikin heat top 08HP 211452 / 06HP 199191; VSD-132A / 216A / 240A removed; DSD-72 6.0TR / DSD-96 8.0TR) -- verified,
never re-applied; R-INSTALL (outdoor BOQ install HP x 1,000 Blue Star / x 1,600 Daikin; follow the sheet); R-INPUTS
(per-SKU figures; the two factors as Pricing Inputs); R-ROUND (no rounding in the mint); R-MISC; R-ITEMNAME (item_name
= the sheet's Item); D-6 (compressor Standard / Single Compressor).

Attributes (VRF-D0 D2): brand is the ITEM column ("Blue Star" / "Daikin"; projected into attributes at read time by
`extraction.PROJECTED_ITEM_COLUMNS`); group; item (the family); item_name (the sheet's Item, trimmed); cooling,
discharge, compressor (outdoor); way (cassette); remote_type (remotes); capacity + capacity_unit (HP outdoor, TR
indoor / kit) + capacity_label (the sheet's words, trimmed); model (display only; "NA" / blank -> absent); item_detail
(Misc). Rates per SKU: VRF cost_supply, supply_markup, boq_install, cost_machine_install, cost_commissioning; Misc
cost_supply, supply_markup, cost_install, install_markup (where the sheet gives one) and boq_install on the gas row,
whose BOQ install is typed. A formula cell stores its computed value. Source CELLS: the item carries {sheet, row} (the
loader stores those two); the column of every stored value is fixed by `VRF_COLS` / `MISC_COLS` below, and the
manifest lists each value's cell.

Usage (container, from frappe-bench): env/bin/python <this> <phase> [--workbook P] [--export P] [--candidate P]
[--manifest P]   (absolute paths: the script changes directory to sites/)
"""
import argparse, copy, hashlib, json, math, os, re

DATA = "/workspace/development/frappe-bench/apps/nirmaan_stack/nirmaan_stack/services/boq_rate_master/data"
V54 = os.path.join(DATA, "rate_master_hvac_all_v54.json")
V55 = os.path.join(DATA, "rate_master_hvac_all_v55.json")
WORKBOOK_NAME = "HVAC_BOQ_BCS PRICING_ Nitesh Edits - 2 nov 2026.xlsx"
WORKBOOK_SHA256 = "30588ddbb4541186cb5fde39bd06567fe6865304fadc011dc42953f1cfa65584"   # owner R-SRC

CATEGORY_ID = "hvac_vrf"
VRF_KIND = "hvac_vrf_item"
MISC_KIND = "hvac_misc_item"
INPUT_KIND = "hvac_pricing_input"
VRF_UNIT = "Nos"   # the VRF sheet has no unit column (VRF-D0 D2: design word)

VRF_HEADERS = ["BRAND", "Category", "Item", "Type", "Model", "Capacity", "BCS SUPPLY", "BCS machine Installation",
               "BCS Commissioning", "Total BCS Installation", "Supply Markup", "Installation Markup", "BOQ SUPPLY",
               "BOQ INSTALLATION"]
VRF_COLS = {"brand": "A", "category": "B", "item": "C", "type": "D", "model": "E", "capacity": "F",
            "cost_supply": "G", "cost_machine_install": "H", "cost_commissioning": "I", "total_bcs_install": "J",
            "supply_markup": "K", "installation_markup": "L", "boq_supply": "M", "boq_install": "N"}
MISC_HEADERS = ["ITEM", "ITEM DETAIL", "UNIT", "Supply Markup", "Install Markup", "BCS Supply", "BCS Installation",
                "BoQ Supply", "BoQ Install"]
MISC_COLS = {"item": "A", "item_detail": "B", "unit": "C", "supply_markup": "D", "install_markup": "E",
             "cost_supply": "F", "cost_install": "G", "boq_supply": "H", "boq_install": "I"}
MISC_ROWS = (20, 22, 24, 25)   # owner R-MISC: the four Misc items VRF takes over now
MISC_EXPECT = {20: ("BACnet Integration Controller for VRF Units", "Nos"), 22: ("MS Angle Base Frame Structure", "Kg"),
               24: ("Refrigerant Gas Filling (R-410)", "Kg"), 25: ("Drain Pump", "Nos")}

BRANDS = {"BLUE STAR": "Blue Star", "DAIKIN": "Daikin"}
GROUPS = {"Outdoor Unit": "Outdoor", "Indoor Unit": "Indoor", "Refnet/Y-Joint": "Refnet", "Accessories": "Accessories"}
# the family (`item`) where it is not the sheet's Item as written (VRF-D0 Attribute values)
FAMILY_OF_ITEM = {"Top Discharge": "Outdoor Unit", "Side Discharge": "Outdoor Unit",
                  "AHU EXPANSION KIT": "AHU Expansion Kit",
                  "Cordless Remote Controller": "Remote Controller", "Wired Remote Controller": "Remote Controller",
                  "Touch Screen Central controller": "Touch Screen Central Controller"}
VRF_FAMILIES = ["Outdoor Unit", "Hi-Wall", "Cassette", "Floor-cum-Ceiling Mounted", "Verticool", "Concealed Split",
                "Ductable", "Packaged Unit", "Single Skin Treated Fresh Air", "Refnet/Y-Joint", "AHU Expansion Kit",
                "Remote Controller", "Touch Screen Central Controller"]
WAYS = ["FOUR-WAY", "FOUR-WAY COMPACT", "ONE-WAY", "TWO-WAY"]
CAP_RE = re.compile(r"^(?:(?P<lo>\d+(?:\.\d+)?)\s*/\s*)?(?P<v>\d+(?:\.\d+)?)\s*(?P<u>HP|TR)$")

INPUTS = [
    {"item": "vrf_hp_per_tr", "name": "VRF conversion - HP per TR", "unit": "HP per TR", "factor": 1.25,
     "remarks": "1 TR = 1.25 HP. A cooling load stated in TR converts to the outdoor unit's HP as TR x this "
                "(16 TR x 1.25 = 20 HP). Stored now; read by VRF pricing from VRF-2 (owner R-INPUTS / R-CONV)."},
    {"item": "vrf_kw_per_tr", "name": "VRF conversion - kW per TR", "unit": "kW per TR", "factor": 3.517,
     "remarks": "1 TR = 3.517 kW. A capacity in TR converts to kW as TR x this (10 TR x 3.517 = 35.17 kW), and kW to "
                "TR as kW / this. Stored now; read by VRF pricing from VRF-2 (owner R-INPUTS / R-CONV)."},
]


def _connect():
    os.chdir("/workspace/development/frappe-bench/sites")
    import frappe
    frappe.init(site="localhost"); frappe.connect()
    return frappe


def _canon(o):
    return json.dumps(o, sort_keys=True, separators=(",", ":"), default=str)


def _dump(p):
    return json.dumps(p, indent=1, ensure_ascii=False) + "\n"


def _text(v):
    return "" if v is None else str(v).strip()


def _num(v, where):
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise SystemExit("%s is not a number: %r" % (where, v))
    return float(v)


def _close(a, b):
    return abs(a - b) <= 1e-6 * max(1.0, abs(b))


def _roundup(x):
    return math.ceil(round(x, 9))


# ---------------------------------------------------------------------------------------------------------------
def read_workbook(path):
    """The VRF sheet's 152 rows and the four Misc rows, values (data_only) and formulas, as dicts. Refuses a workbook
    whose sha256 is not R-SRC's or whose header shape differs."""
    import openpyxl
    sha = hashlib.sha256(open(path, "rb").read()).hexdigest()
    if sha != WORKBOOK_SHA256:
        raise SystemExit("workbook sha256 %s is not R-SRC's %s -- STOP" % (sha, WORKBOOK_SHA256))
    wv = openpyxl.load_workbook(path, data_only=True)
    wf = openpyxl.load_workbook(path, data_only=False)
    out = {"vrf": [], "misc": []}
    ws, fs = wv["VRF"], wf["VRF"]
    if [_text(ws.cell(1, c).value) for c in range(1, 15)] != VRF_HEADERS:
        raise SystemExit("VRF header differs from the verified shape: %r" % [ws.cell(1, c).value for c in range(1, 15)])
    last = max(r for r in range(1, ws.max_row + 1) if any(ws.cell(r, c).value is not None for c in range(1, 15)))
    for r in range(2, last + 1):
        rec = {"row": r}
        for k, col in VRF_COLS.items():
            rec[k] = ws[col + str(r)].value
            f = fs[col + str(r)].value
            if isinstance(f, str) and f.startswith("="):
                rec.setdefault("formulas", {})[k] = f
        out["vrf"].append(rec)
    ws, fs = wv["Misc"], wf["Misc"]
    if [_text(ws.cell(1, c).value) for c in range(1, 10)] != MISC_HEADERS:
        raise SystemExit("Misc header differs from the verified shape: %r" % [ws.cell(1, c).value for c in range(1, 10)])
    for r in MISC_ROWS:
        rec = {"row": r}
        for k, col in MISC_COLS.items():
            rec[k] = ws[col + str(r)].value
            f = fs[col + str(r)].value
            if isinstance(f, str) and f.startswith("="):
                rec.setdefault("formulas", {})[k] = f
        out["misc"].append(rec)
    out["notes_O"] = {"O2": wv["VRF"]["O2"].value, "O3": wv["VRF"]["O3"].value}
    return out


def vrf_attributes(rec):
    """One VRF row -> (brand, attributes, quirks). Texts trimmed; the family, cooling / discharge / compressor, way,
    remote type and capacity as VRF-D0 D2 lays them out."""
    r = rec["row"]
    brand = BRANDS.get(_text(rec["brand"]).upper())
    if brand is None:
        raise SystemExit("VRF row %d: unknown brand %r" % (r, rec["brand"]))
    category, item_name, typ = _text(rec["category"]), _text(rec["item"]), _text(rec["type"])
    if category not in GROUPS:
        raise SystemExit("VRF row %d: unknown Category %r" % (r, rec["category"]))
    family = FAMILY_OF_ITEM.get(item_name, item_name)
    if family not in VRF_FAMILIES:
        raise SystemExit("VRF row %d: unknown Item %r" % (r, rec["item"]))
    a = {"group": GROUPS[category], "item": family, "item_name": item_name}
    if family == "Outdoor Unit":
        if category != "Outdoor Unit":
            raise SystemExit("VRF row %d: an outdoor Item outside the Outdoor Unit group" % r)
        a["discharge"] = {"Top Discharge": "Top", "Side Discharge": "Side"}[item_name]
        base = typ.replace("(Single Compressor)", "").strip().upper()
        if base not in ("COOL ONLY", "HEAT PUMP"):
            raise SystemExit("VRF row %d: outdoor Type %r is neither Cool Only nor Heat Pump" % (r, rec["type"]))
        a["cooling"] = "Cool Only" if base == "COOL ONLY" else "Heat Pump"
        a["compressor"] = "Single Compressor" if "(Single Compressor)" in typ else "Standard"   # D-6
    elif family == "Cassette":
        if typ not in WAYS:
            raise SystemExit("VRF row %d: cassette Type %r is not a way" % (r, rec["type"]))
        a["way"] = typ
    elif typ.upper() != "NA":
        raise SystemExit("VRF row %d: Type %r on a %s row (expected NA)" % (r, rec["type"], family))
    if family == "Remote Controller":
        a["remote_type"] = item_name.split()[0]      # Wired / Cordless
    cap = _text(rec["capacity"])
    if cap.upper() != "NA":
        m = CAP_RE.match(cap.replace(" ", "") if "/" not in cap else re.sub(r"\s+", " ", cap))
        if not m:
            raise SystemExit("VRF row %d: Capacity %r not read" % (r, rec["capacity"]))
        a["capacity"] = float(m.group("v"))
        a["capacity_unit"] = m.group("u")
        a["capacity_label"] = cap
        if (family == "Outdoor Unit") != (a["capacity_unit"] == "HP"):
            raise SystemExit("VRF row %d: capacity unit %s on a %s row" % (r, a["capacity_unit"], family))
    elif family not in ("Refnet/Y-Joint", "Remote Controller", "Touch Screen Central Controller"):
        raise SystemExit("VRF row %d: no capacity on a %s row" % (r, family))
    model = _text(rec["model"])
    if model and model.upper() != "NA":
        a["model"] = model
    return brand, a


def vrf_rates(rec):
    r = rec["row"]
    rates = {k: _num(rec[k], "VRF row %d %s" % (r, k))
             for k in ("cost_supply", "supply_markup", "boq_install", "cost_machine_install", "cost_commissioning")}
    return rates


def misc_item(rec):
    r = rec["row"]
    name = _text(rec["item"]); unit = _text(rec["unit"])
    if (name, unit) != MISC_EXPECT[r]:
        raise SystemExit("Misc row %d is %r / %r, expected %r" % (r, name, unit, MISC_EXPECT[r]))
    a = {"group": "Misc", "item": name, "item_name": name}
    if _text(rec["item_detail"]):
        a["item_detail"] = _text(rec["item_detail"])
    rates = {"cost_supply": _num(rec["cost_supply"], "Misc %d F" % r), "supply_markup": _num(rec["supply_markup"], "Misc %d D" % r),
             "cost_install": _num(rec["cost_install"], "Misc %d G" % r)}
    if _text(rec["install_markup"]).upper() == "NA":
        # the sheet TYPES this row's BOQ install (no formula, no markup): stored as the sheet's figure
        if "boq_install" in (rec.get("formulas") or {}):
            raise SystemExit("Misc row %d: install markup NA but BOQ install is a formula" % r)
        rates["boq_install"] = _num(rec["boq_install"], "Misc %d I" % r)
    else:
        rates["install_markup"] = _num(rec["install_markup"], "Misc %d E" % r)
    return unit, a, rates


def check_sheet(wb, vrf_items, misc_items):
    """THE B3 FIGURES, checked on the sheet BEFORE anything is written (the test module re-checks them on the file)."""
    rows = wb["vrf"]
    by_brand = {}
    for rec in rows:
        by_brand[_text(rec["brand"]).upper()] = by_brand.get(_text(rec["brand"]).upper(), 0) + 1
    if len(rows) != 152 or by_brand != {"BLUE STAR": 122, "DAIKIN": 30}:
        raise SystemExit("VRF sheet is %d rows %r, not 152 (Blue Star 122, Daikin 30) -- STOP" % (len(rows), by_brand))
    models = {_text(r["model"]) for r in rows}
    for gone in ("VSD-132A", "VSD-216A", "VSD-240A"):
        if gone in models:
            raise SystemExit("%s is on the sheet (the team removed it)" % gone)
    by_model = {_text(r["model"]): r for r in rows}
    assert _text(by_model["DSD-72"]["capacity"]) == "6.0TR" and _text(by_model["DSD-96"]["capacity"]) == "8.0TR"
    assert float(by_model["RXYQ8BRY16"]["cost_supply"]) == 211452 and _text(by_model["RXYQ8BRY16"]["capacity"]) == "08HP"
    assert float(by_model["RXYQ6BRY16"]["cost_supply"]) == 199191 and _text(by_model["RXYQ6BRY16"]["capacity"]) == "06HP"
    n_bs = n_dk = 0
    for it in vrf_items:
        a, rt = it["attributes"], it["rates"]
        rec = next(x for x in rows if x["row"] == it["source"]["row"])
        if not _close(rt["cost_supply"] * (1 + rt["supply_markup"]), float(rec["boq_supply"])):
            raise SystemExit("VRF row %d: cost x (1 + markup) %r != the sheet's BOQ SUPPLY %r" % (rec["row"], rt["cost_supply"] * (1 + rt["supply_markup"]), rec["boq_supply"]))
        if a["item"] == "Outdoor Unit":
            hp = a["capacity"]
            per = {"Blue Star": 1000.0, "Daikin": 1600.0}[it["brand"]]
            if rt["boq_install"] != hp * per or rt["cost_machine_install"] != hp * 2200.0:
                raise SystemExit("VRF row %d: outdoor install not HP x %s / HP x 2200" % (rec["row"], per))
            if rt["cost_commissioning"] != (hp * 500.0 if it["brand"] == "Daikin" else 0.0):
                raise SystemExit("VRF row %d: commissioning not HP x 500 (Daikin) / 0 (Blue Star)" % rec["row"])
            n_bs += it["brand"] == "Blue Star"; n_dk += it["brand"] == "Daikin"
    if (n_bs, n_dk) != (44, 10):
        raise SystemExit("outdoor rows %d Blue Star / %d Daikin, expected 44 / 10" % (n_bs, n_dk))
    for it, rec in zip(misc_items, wb["misc"]):
        rt = it["rates"]
        if _roundup(rt["cost_supply"] * (1 + rt["supply_markup"])) != float(rec["boq_supply"]):
            raise SystemExit("Misc row %d: BoQ supply does not reproduce" % rec["row"])
        inst = rt["boq_install"] if "boq_install" in rt else _roundup(rt["cost_install"] * (1 + rt["install_markup"]))
        if inst != float(rec["boq_install"]):
            raise SystemExit("Misc row %d: BoQ install does not reproduce" % rec["row"])
    return {"outdoor_blue_star": n_bs, "outdoor_daikin": n_dk}


def _values(items, key, kind=None):
    out = []
    for it in items:
        if kind and it["kind"] != kind:
            continue
        v = it["attributes"].get(key)
        if v is not None and v not in out:
            out.append(v)
    return out


def vrf_config(items):
    """The data-only VRF config: two kinds, the definitions, NO pricing block. Values in sheet order (first seen)."""
    items = [it for it in items if it["kind"] in (VRF_KIND, MISC_KIND)]   # the config's own kinds, never the inputs
    vrf = [it for it in items if it["kind"] == VRF_KIND]
    choice =lambda i, label, vals, **kw: dict({"id": i, "label": label, "type": "choice", "values": vals}, **kw)
    display = {"selector": False, "panel": False}
    defs = [
        choice("brand", "Brand", ["Blue Star", "Daikin"],
               note="The make, from the sheet's BRAND column. Stored in the item's brand column (read into the attributes at "
                    "read time); the four shared Misc items carry none."),
        choice("group", "Group", _values(items, "group"), note="The sheet's Category (Outdoor / Indoor / Refnet / Accessories); "
               "Misc for the four items shared with the future Misc category. Display only.", **display),
        choice("item", "Item", _values(items, "item"), note="The family: the sheet's Item, with the outdoor units as one "
               "family (discharge carries Top / Side) and the two remotes as one (remote type carries Wired / Cordless)."),
        choice("item_name", "Item as on the sheet", _values(items, "item_name"),
               note="The sheet's own Item text, verbatim (owner R-ITEMNAME: 'it should be kept exactly as per the excel "
                    "file. we cant drop it'). Display only.", **display),
        choice("cooling", "Cool / heat", _values(vrf, "cooling"), note="Outdoor units: Cool Only or Heat Pump (the sheet "
               "writes HEAT PUMP on Blue Star and Heat Pump on Daikin: one value)."),
        choice("discharge", "Discharge", _values(vrf, "discharge"), note="Outdoor units: Top or Side, from the sheet's Item."),
        choice("compressor", "Compressor", _values(vrf, "compressor"), note="Outdoor units: Single Compressor where the "
               "sheet's Type says so, else Standard (owner D-6)."),
        choice("way", "Cassette way", _values(vrf, "way"), note="Cassettes: the sheet's Type."),
        choice("remote_type", "Remote type", _values(vrf, "remote_type"), note="Remote controllers: Wired or Cordless."),
        {"id": "capacity", "label": "Capacity", "type": "number",
         "note": "The capacity number: HP on an outdoor unit, TR on an indoor unit or an AHU kit. '12.5 / 15.0TR' stocks at 15."},
        choice("capacity_unit", "Capacity unit", _values(vrf, "capacity_unit"), note="HP or TR.", **display),
        choice("capacity_label", "Capacity as on the sheet", _values(vrf, "capacity_label"),
               note="The sheet's Capacity text, trimmed. Display only.", **display),
        choice("model", "Model", _values(vrf, "model"), note="The maker's model, display only; Daikin's 'NA' and the one "
               "blank model are left empty.", **display),
        choice("item_detail", "Item detail", _values(items, "item_detail"), note="The Misc sheet's Item Detail.", **display),
    ]
    return {
        "discipline": "HVAC",
        "category_id": CATEGORY_ID,
        "category_display": "VRF",
        "item_kinds": [VRF_KIND, MISC_KIND],
        "attribute_definitions": defs,
        "pipelines": {},
        "notes": "VRF-1 (owner, 2026-11-03): the VRF CATALOGUE only -- 152 SKUs from the VRF sheet of '%s' (Blue Star 122, "
                 "Daikin 30), each with the sheet's own cost, supply markup, BOQ install, machine-install cost and "
                 "commissioning cost, stored as the sheet gives them (no rounding: R-ROUND rounds at pricing). Plus the four "
                 "Misc items VRF takes over now as the SHARED kind hvac_misc_item, each with its Misc-sheet markups -- the "
                 "future Misc category lists the same stored set, never a copy (R-MISC). DATA-ONLY: no pricing block, so it "
                 "never prices a BoQ row and the calculator shows 'coming soon' until VRF-2 / VRF-4. The two conversion "
                 "factors are Pricing Inputs (vrf_hp_per_tr, vrf_kw_per_tr)." % WORKBOOK_NAME,
    }


# ---------------------------------------------------------------------------------------------------------------
def export(path):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import exporter
    payload = exporter.build_asset("HVAC")
    open(path, "w", encoding="utf-8", newline="").write(exporter.serialize_asset(payload))
    v54 = json.load(open(V54, encoding="utf-8"))
    e_items = {i["item_uid"]: i for i in payload["items"]}
    v_items = {i["item_uid"]: i for i in v54["items"]}
    missing = sorted(set(v_items) - set(e_items)); extra = sorted(set(e_items) - set(v_items))
    differ = sorted(u for u in set(v_items) & set(e_items) if _canon(v_items[u]) != _canon(e_items[u]))
    e_cfg = {c["category_id"]: c for c in payload["category_configs"]}
    v_cfg = {c["category_id"]: c for c in v54["category_configs"]}
    cdiff = sorted(c for c in set(e_cfg) | set(v_cfg) if _canon(e_cfg.get(c)) != _canon(v_cfg.get(c)))
    print("export written", path, "| items", len(payload["items"]), "| configs", len(payload["category_configs"]))
    print("vs v54 by content: items missing", missing, "| extra", extra, "| differing", differ, "| configs differing", cdiff)
    if missing or extra or differ or cdiff:
        raise SystemExit("the export is not v54 by content -- STOP")
    frappe.destroy()


def build(workbook, out, manifest):
    frappe = _connect()
    from nirmaan_stack.services.boq_rate_master import config_validation, csv_importer, extraction
    from nirmaan_stack.services.boq_rate_master.loader import _validate_items, _validate_one_config
    raw = open(V54, "rb").read()
    v54 = json.loads(raw.decode("utf-8"))
    if _dump(v54).encode("utf-8") != raw:
        raise SystemExit("re-dumping v54 does not reproduce its bytes -- the series convention is not what this mint writes")
    wb = read_workbook(workbook)
    taken = {i["item_uid"] for i in v54["items"]}
    taken |= {(r["item_uid"] or "").strip() for r in frappe.get_all("BoQ Rate Master Item", filters={"discipline": "HVAC"}, fields=["item_uid"])}
    new_items, rows_out = [], []
    for rec in wb["vrf"]:
        brand, attrs = vrf_attributes(rec)
        it = {"kind": VRF_KIND, "brand": brand, "unit": VRF_UNIT, "attributes": attrs, "rates": vrf_rates(rec),
              "source": {"sheet": "VRF", "row": rec["row"]}, "item_uid": csv_importer.mint_item_uid("HVAC", taken)}
        new_items.append(it)
        rows_out.append((it, rec, "VRF", VRF_COLS))
    misc = []
    for rec in wb["misc"]:
        unit, attrs, rates = misc_item(rec)
        it = {"kind": MISC_KIND, "brand": None, "unit": unit, "attributes": attrs, "rates": rates,
              "source": {"sheet": "Misc", "row": rec["row"]}, "item_uid": csv_importer.mint_item_uid("HVAC", taken)}
        misc.append(it); new_items.append(it)
        rows_out.append((it, rec, "Misc", MISC_COLS))
    for spec in INPUTS:
        it = {"kind": INPUT_KIND, "brand": None, "unit": spec["unit"],
              "attributes": {"item": spec["item"], "name": spec["name"], "remarks": spec["remarks"], "shared_by": "vrf"},
              "rates": {"factor": spec["factor"]}, "source": {"sheet": "Pricing Inputs", "row": 0},
              "item_uid": csv_importer.mint_item_uid("HVAC", taken)}
        new_items.append(it)
        rows_out.append((it, None, "Pricing Inputs", None))
    figures = check_sheet(wb, [i for i in new_items if i["kind"] == VRF_KIND], misc)
    if len({i["item_uid"] for i in new_items}) != 158 or {i["item_uid"] for i in new_items} & {i["item_uid"] for i in v54["items"]}:
        raise SystemExit("uid mint did not give 158 fresh uids")
    config = vrf_config(new_items)

    final = copy.deepcopy(v54)
    final["items"] = sorted(v54["items"] + new_items, key=lambda i: i["item_uid"])
    final["category_configs"] = v54["category_configs"] + [config]
    # every v54 item and config carried byte-identical
    a = {i["item_uid"]: _canon(i) for i in v54["items"]}
    b = {i["item_uid"]: _canon(i) for i in final["items"]}
    assert all(b[u] == a[u] for u in a), "a v54 item changed"
    assert [_canon(c) for c in final["category_configs"][:-1]] == [_canon(c) for c in v54["category_configs"]], "a v54 config changed"
    assert list(final.keys()) == list(v54.keys())

    # offline validation: the loader's own validators, the config validator on every config, the section check
    _validate_items(final["items"])
    stored = [dict(c, discipline=final["discipline"]) for c in final["category_configs"]]
    for idx, c in enumerate(stored):
        _validate_one_config(c, "category_configs[%d]" % idx)
        config_validation._validate_config(c)
    problems = config_validation.delegated_section_problems(stored, final["items"])
    if problems:
        raise SystemExit("cross-category check refuses: %r" % problems)
    cfgs = {(final["discipline"], c["category_id"]): c for c in stored}
    if extraction.config_is_eligible(cfgs[("HVAC", CATEGORY_ID)], cfgs) or extraction.has_runnable_pricing_rules(config):
        raise SystemExit("hvac_vrf would be ELIGIBLE for extraction -- it must not be (no pricing block)")
    eligible = sorted(c["category_id"] for c in stored if extraction.config_is_eligible(c, cfgs))
    stored54 = [dict(c, discipline=v54["discipline"]) for c in v54["category_configs"]]
    cfgs54 = {(v54["discipline"], c["category_id"]): c for c in stored54}
    eligible54 = sorted(c["category_id"] for c in stored54 if extraction.config_is_eligible(c, cfgs54))
    assert eligible == eligible54, (eligible, eligible54)

    # the STUB PROOF -- every item-list category's extraction request, from v54 and from v55
    def requests(st, cf):
        return {c["category_id"]: json.dumps(extraction.build_items_spec(cf[("HVAC", c["category_id"])], cf, "HVAC"), sort_keys=True)
                for c in st if c.get("list_spec")}
    r54, r55 = requests(stored54, cfgs54), requests(stored, cfgs)
    diff = sorted(k for k in set(r54) | set(r55) if r54.get(k) != r55.get(k))
    print("STUB PROOF: item-list requests v54 vs v55 -- identical:", sorted(k for k in r54 if r54[k] == r55.get(k)), "| differing:", diff)
    assert diff == [], diff
    print("eligible configs v54 = v55:", eligible)

    text = _dump(final)
    tokens = sorted({t for t in re.findall(r"v\d+", text.replace(json.dumps(final.get("source_workbook") or "", ensure_ascii=False), '""'))})
    if tokens:
        raise SystemExit("the asset text carries version-like tokens %r (h07)" % tokens)
    open(out, "w", encoding="utf-8", newline="").write(text)
    man = []
    for it, rec, sheet, cols in rows_out:
        cells = {}
        if cols:
            for k in list(it["rates"].keys()) + ["brand", "category", "item", "type", "model", "capacity", "unit", "item_detail"]:
                if k in cols:
                    cells[k] = "%s!%s%d" % (sheet, cols[k], rec["row"])
        man.append({"item_uid": it["item_uid"], "kind": it["kind"], "brand": it["brand"], "unit": it["unit"],
                    "attributes": it["attributes"], "rates": it["rates"], "source": it["source"], "cells": cells,
                    "sheet_values": {k: rec[k] for k in cols} if cols else None,
                    "formulas": (rec or {}).get("formulas")})
    json.dump({"items": man, "notes_O": wb["notes_O"], "figures": figures, "eligible": eligible,
               "stub_identical": sorted(r54)}, open(manifest, "w", encoding="utf-8"), ensure_ascii=False, indent=1, default=str)
    kinds = {}
    for i in new_items:
        kinds[i["kind"]] = kinds.get(i["kind"], 0) + 1
    print("candidate written:", out, "| items", len(final["items"]), "(+%d: %r)" % (len(new_items), kinds),
          "| configs", len(final["category_configs"]), "| sha256", hashlib.sha256(text.encode("utf-8")).hexdigest())
    print("manifest written:", manifest, "| figures", figures)
    frappe.destroy()


# ---------------------------------------------------------------------------------------------------------------
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
        out[disc] = {"items": len(L), "configs": len(LC), "sha_items": h_i, "sha_configs": h_c}
        if disc == "HVAC":
            A = {r["item_uid"]: {"kind": r["kind"], "brand": r.get("brand") or None, "unit": r.get("unit") or None, "attributes": r["attributes"], "rates": r["rates"]} for r in asset["items"]}
            AC = {c["category_id"]: c for c in asset["category_configs"]}
            out[disc]["items_differing"] = sorted(u for u in set(L) | set(A) if _canon(L.get(u)) != _canon(A.get(u)))
            out[disc]["configs_differing"] = sorted(c for c in set(LC) | set(AC) if _canon(LC.get(c)) != _canon(AC.get(c)))
            nv = {u: L[u] for u in L if L[u]["kind"] not in (VRF_KIND, MISC_KIND) and not (L[u]["kind"] == INPUT_KIND and (L[u]["attributes"] or {}).get("shared_by") == "vrf")}
            ncfg = {c: LC[c] for c in LC if c != CATEGORY_ID}
            out[disc]["non_vrf_items"] = [len(nv), hashlib.sha256("".join(u + _canon(nv[u]) for u in sorted(nv)).encode()).hexdigest()[:16]]
            out[disc]["non_vrf_configs"] = [len(ncfg), hashlib.sha256("".join(c + _canon(ncfg[c]) for c in sorted(ncfg)).encode()).hexdigest()[:16]]
    print(json.dumps(out, indent=1, sort_keys=True))
    frappe.destroy()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("phase", choices=["export", "build", "load", "verify"])
    ap.add_argument("--workbook", default="/tmp/vrf1/input/vrf_2nov.xlsx")
    ap.add_argument("--export", default="/tmp/vrf1/v55_export.json")
    ap.add_argument("--candidate", default=V55)
    ap.add_argument("--manifest", default="/tmp/vrf1/v55_manifest.json")
    a = ap.parse_args()
    if a.phase == "export":
        export(a.export)
    elif a.phase == "build":
        build(a.workbook, a.candidate, a.manifest)
    elif a.phase == "load":
        load(a.candidate)
    else:
        verify(a.candidate)
