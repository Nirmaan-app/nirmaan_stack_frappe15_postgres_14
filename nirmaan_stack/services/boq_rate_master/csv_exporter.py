# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The editable rate file -- what a pricer downloads, edits in Excel, and uploads back.

BUILT SERVER-SIDE, deliberately. Three reasons, in order of weight:
  1. MODE B needs the kind -> category map across ALL twelve configs. The Data Viewer holds only the
     SELECTED category's config, so a client build would have to fetch twelve more configs purely to
     label a column.
  2. It gives a REAL admin gate (`_require_rate_admin`), which is what the permissions rule asks for.
     A client-built file could only be gated by hiding a button.
  3. The kind -> category resolution already exists server-side and is reused here rather than
     reimplemented in TypeScript, where it would be a second definition free to drift.

TWO MODES (owner-ruled):
  MODE A -- one category. Columns are exactly THAT category's attribute and rate keys, as real named
            columns. Narrow and directly editable.
  MODE B -- all categories. One file with a `category` column and the UNION of every category's
            attribute and rate keys. ~45 columns and many blanks: a cable row has nothing to say
            about `tray_type`. That sparseness is inherent, not a defect.

TWO FORMATS (SLICE 1e, owner X-a): EXCEL BY DEFAULT, CSV as the second option. The rows are built
ONCE (`build_category_rows` / `build_all_categories_rows`) and written by either writer; the two
files carry the same columns and the same values. Excel is the default because a CSV carries no cell
types and Excel guesses -- it rewrote the ratios "1:6" / "1:4" as times on the owner's own upload --
while an .xlsx written here marks every text column as TEXT (see `xlsx_io`).

NO SYSTEM COLUMNS (SLICE 1e, owner X-b / X-d). A rate file carries `item_uid` (the row's identity),
`brand`, `unit`, every column a person edits and the rate / markup columns -- and NOTHING the system
fills. `source_sheet` / `source_row` are gone from both formats (the system stamps them on upload).
`kind` appears ONLY when the file holds a category whose config lists MORE THAN ONE item kind
(Electrical: wiring_cabling, db_switchgear, popup_boxes; every Mode B Electrical file) -- a new row
in such a category cannot be typed without it; for every single-kind category the upload fills it from
the category. Mode B keeps its `category` column for the same reason: with `kind` gone it is the one
thing that types a new row in the all-categories file. An OLD file that still carries the removed
columns uploads fine -- they are IGNORED (owner X-e).

⚠️ EVERY ROW IN BOTH MODES CARRIES `item_uid`. Without it the round trip is one-way -- the upload
cannot tell an edit from a new item. A BLANK `item_uid` will mean "add this item".

⚠️ MEASURED BEFORE BUILDING MODE B -- do shared attribute keys mean the same thing everywhere?
Four keys are used by more than one category (`description`, `family`, `item`, `material`) and three
rate keys are (`install_rate`, `list_price`, `list_price_per_mtr`). In every case the key names the
SAME CONCEPT -- a description, a product family, the catalog item name, what it is made of -- while
the VALUE DOMAIN is category-scoped, which is exactly how the configs' `values_from.where` filters
already work. So merging them into one column is safe: a row's category is explicit in its own
column, and the upload keys on `item_uid`, never on inferring a category from a value.
⚠️ The usability caveat that follows: a Mode B column holds values from different vocabularies, so a
`material` value copied from a cable row onto a tray row is meaningless. Editing within a row is
safe; copying a cell DOWN a column across categories is not.

⚠️ VALUES ARE EMITTED AS THEY ARE STORED. Nothing is reformatted, padded, quoted-to-force-text or
otherwise "fixed" -- the file must round-trip what is in the database. In the CSV a float stays
`2.0`; in the .xlsx it is the number 2.0 in a numeric cell and a text value sits in a TEXT cell.

PURE: this module reads the database and returns text / bytes. It writes nothing.
"""

import csv
import io
import json
import math
import re

import frappe

from nirmaan_stack.services.boq_rate_master import config_validation, spec_reader, xlsx_io

ITEM_DOCTYPE = "BoQ Rate Master Item"
CONFIG_DOCTYPE = "BoQ Rate Category Config"

# The fixed columns the importer RECOGNISES, in order. `item_uid` is FIRST because it is the row's
# identity and the one column a user must not invent. SLICE 1e: `kind` is written only for a
# multi-kind file (see module docstring); the provenance pair is no longer written at all -- both
# names stay here so an OLD file carrying them is still read (and, for the pair, ignored).
LEAD_COLUMNS = ("item_uid", "kind", "brand", "unit")
TAIL_COLUMNS = ("source_sheet", "source_row")
SYSTEM_COLUMNS = TAIL_COLUMNS          # filled by the system on upload; never in a file since 1e
CATEGORY_COLUMN = "category"
# SLICE 1g (owner Z-c): EVERY rate file is self-describing -- `discipline` and `category` sit right
# after `item_uid`, in both modes and both formats, filled on download. They are the ONLY non-edited
# columns beside the id (the amendment to 1e's X-b): the upload refuses a file whose values do not
# match the page it is uploaded on, so a file can never land in the wrong catalog by accident. The
# category value is the CATEGORY ID (`cabletray_raceway`, `hvac_adp`) -- the same value Mode B's
# category column has always carried; the discipline is the value the system names it by.
DISCIPLINE_COLUMN = "discipline"

# ===================================================================================================
# SLICE 12b(A) -- PRICING INPUTS. The numbers our pricing rules read, as a category of their own.
# ===================================================================================================
# An item kind ending in this suffix is a Pricing Input. Keyed on the SUFFIX, never on a discipline
# name, so a second discipline's inputs (12c) flow through with no code change -- the HV-10 rule.
PRICING_INPUT_KIND_SUFFIX = "_pricing_input"

# ACCEPTANCE 4 / 9: the file carries ONLY these, in this order, and nothing borrowed from a SKU file.
# `item` is the row's name, then one column per KIND of number, then the unit, the remark and the
# read-only used-by count.
# SLICE 12c: `rate` and `factor` are APPENDED, after `amount`, so no existing column moves and every
# Electrical figure keeps its place. A discipline that carries neither still exports the same eight.
PRICING_INPUT_VALUE_COLUMNS = ("discount", "supply_markup", "installation_markup", "bcs_markup",
                               "wastage", "ratio", "share", "amount", "rate", "factor")
# ACCEPTANCE 6: a factor is shown as a PERCENTAGE -- but three columns are not percentages and must be
# named, not inferred. `amount` and `rate` are RUPEES; `factor` is a PLAIN MULTIPLIER (1.25, 0.9) --
# owner ruling, slice 12c, "Rate and Factor as plain numbers".
# ⚠️ THE SET IS A DENY-LIST BECAUSE THE DEFAULT IS "PERCENT", so a value column added without a thought
# renders 450 as 45000%. A new non-percentage column belongs here in the SAME edit that adds it.
PRICING_INPUT_NON_PERCENT_COLUMNS = ("amount", "rate", "factor")
PRICING_INPUT_PERCENT_COLUMNS = tuple(c for c in PRICING_INPUT_VALUE_COLUMNS
                                      if c not in PRICING_INPUT_NON_PERCENT_COLUMNS)
PRICING_INPUT_USED_BY = "used_by"
PRICING_INPUT_SHARED_BY = "shared_by"
PRICING_INPUT_NAME = "item"
PRICING_INPUT_REMARKS = "remarks"


# SLICE 12b(A) -- the columns of a Pricing Inputs file that are READ-ONLY.
#
# ⚠️ THE ROUND TRIP FORCED THIS, AND THE RULING BEHIND IT IS ACCEPTANCE 13. The `item` column shows the
# input's READABLE NAME while the stored attribute holds its ID (`cable_arm`), because the id is what a
# pipeline's `rate_ref` names -- so a faithful re-upload of an untouched file would have RENAMED every
# input to its own description. And a rename is exactly what acceptance 13 forbids for an input in use,
# which all 33 are. So these columns are read past and never applied, like `source_sheet` since 1e.
# The VALUE columns are the editable ones, which is the whole point of the slice.
PRICING_INPUT_READONLY_COLUMNS = (PRICING_INPUT_NAME, "name", PRICING_INPUT_REMARKS,
                                  PRICING_INPUT_SHARED_BY, PRICING_INPUT_USED_BY)


def is_pricing_input_headers(headers):
    """True for a Pricing Inputs rate file, recognised BY ITS OWN SHAPE -- never by a category name.

    The file is fixed-column, so its header row identifies it: the name column sits where every other
    file carries `brand`, and `used_by` exists nowhere else.
    """
    h = list(headers or [])
    return len(h) > 3 and h[3] == PRICING_INPUT_NAME and PRICING_INPUT_USED_BY in h


def is_pricing_input_kind(kind):
    """True for a Pricing Input item kind. Suffix-keyed, so no discipline is named in code."""
    return isinstance(kind, str) and kind.endswith(PRICING_INPUT_KIND_SUFFIX)


def pricing_input_used_by(configs):
    """{input id: (site count, [category ids])} -- DERIVED from the configs, never stored.

    A stored count goes stale the moment a pipeline changes, so it is computed by walking every
    `rate_ref` of every pipeline of the discipline. This is the count acceptance item 13 refuses a
    delete or a rename with.
    """
    out = {}
    for cid, cfg in sorted((configs or {}).items()):
        for pid in sorted((cfg.get("pipelines") or {})):
            for st in ((cfg["pipelines"][pid] or {}).get("steps") or []):
                if st.get("step") != "rate_ref":
                    continue
                iid = (st.get("ref") or {}).get("item")
                if not isinstance(iid, str):
                    continue
                n, cats = out.get(iid, (0, []))
                if cid not in cats:
                    cats = cats + [cid]
                out[iid] = (n + 1, cats)
    return out


def as_percent(value):
    """0.45 -> "45%" for display. The STORED value is untouched; this is the file and the screen."""
    if value in (None, ""):
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return value
    # trim a trailing .0 so 45.0% reads as 45%
    pct = f * 100.0
    return ("%g%%" % round(pct, 6))


FORMAT_XLSX = "xlsx"
FORMAT_CSV = "csv"
FORMATS = (FORMAT_XLSX, FORMAT_CSV)
# Attribute definition types that mean "this value is a number" -- the same pair the importer's
# coercion keys on (`csv_importer._NUMERIC_ATTR_TYPES`); an .xlsx column of this type is written as
# numbers, every other attribute column as text.
NUMERIC_ATTR_TYPES = ("number", "number_choice")


def _parsed(value, default):
    if value in (None, ""):
        return default
    if isinstance(value, (dict, list)):
        return value
    return json.loads(value)


def _config_kinds(cfg):
    """The master-item kinds a config prices: declared `item_kinds`, else derived from the
    pipelines' match_master_row. Mirrors extraction._config_kinds -- the legacy wiring config
    predates item_kinds and derives {cable, termination}."""
    kinds = list(cfg.get("item_kinds") or [])
    if kinds:
        return kinds
    out = []
    for p in (cfg.get("pipelines") or {}).values():
        for s in p.get("steps") or []:
            if s.get("step") == "match_master_row":
                k = (s.get("params") or {}).get("kind")
                if k and k not in out:
                    out.append(k)
    return out


def _load(discipline):
    """(items, kind_to_category, category_to_kinds) for one discipline, active rows only."""
    items, kind_cat, cat_kinds, _types = _load_full(discipline)
    return items, kind_cat, cat_kinds


def _load_full(discipline):
    """(items, kind_to_category, category_to_kinds, attribute_types) -- `_load` plus the declared
    attribute types, which decide TEXT vs NUMBER in the .xlsx (an undeclared key has no type and is
    text, exactly as the importer keeps it as text)."""
    items = frappe.get_all(
        ITEM_DOCTYPE,
        filters={"discipline": discipline, "active": 1},
        fields=["item_uid", "kind", "brand", "unit", "attributes", "rates",
                "source_sheet", "source_row"],
        order_by="kind asc, item_uid asc",
    )
    for it in items:
        it["attributes"] = _parsed(it["attributes"], {})
        it["rates"] = _parsed(it["rates"], {})

    cat_kinds, kind_cat, attr_types = {}, {}, {}
    for c in frappe.get_all(CONFIG_DOCTYPE,
                            filters={"discipline": discipline, "active": 1},
                            fields=["category_id", "config"], order_by="category_id asc"):
        cfg = _parsed(c["config"], {})
        ks = _config_kinds(cfg)
        cat_kinds[c["category_id"]] = ks
        for k in ks:
            # First writer wins; measured: no kind is claimed by two categories today.
            kind_cat.setdefault(k, c["category_id"])
        for d in cfg.get("attribute_definitions") or []:
            if isinstance(d, dict) and d.get("id"):
                attr_types.setdefault(d["id"], d.get("type"))
    return items, kind_cat, cat_kinds, attr_types


def _load_configs(discipline):
    """{category_id: config} for one discipline, active rows only. SLICE 12a: the formula row and the
    two formula columns are rendered FROM THE CONFIG (its pipelines, its `rate_composition`, its
    `derived_rates`), so the builders need the configs themselves and not only the attribute types."""
    out = {}
    for c in frappe.get_all(CONFIG_DOCTYPE,
                            filters={"discipline": discipline, "active": 1},
                            fields=["category_id", "config"], order_by="category_id asc"):
        out[c["category_id"]] = _parsed(c["config"], {})
    return out


def multi_kind_categories(cat_kinds):
    """The categories whose config lists MORE THAN ONE item kind -- the only ones whose rows need a
    `kind` cell to be typed (owner X-d)."""
    return {cat for cat, ks in cat_kinds.items() if len(ks) > 1}


def file_carries_kind(cat_kinds, category_id=None):
    """Whether a file for `category_id` (Mode A) or for the whole discipline (Mode B, None) carries
    the `kind` column: only when a multi-kind category is IN the file."""
    if category_id is not None:
        return len(cat_kinds.get(category_id) or []) > 1
    return bool(multi_kind_categories(cat_kinds))


def _keys_for(items):
    """Attribute and rate column names observed across a set of items, sorted for a stable file."""
    attrs, rates = set(), set()
    for it in items:
        attrs.update(it["attributes"].keys())
        rates.update(it["rates"].keys())
    return sorted(attrs), sorted(rates)


# ── SLICE 1c: a category whose attributes are READ FROM THE SPEC (owner S-b) ────────────────────
# "we should not show the derived attribute columns in the csv to avoid confusion. they will be hidden
# from the user and the spec reader will make modifications based on the item and spec."
#
# For an opted-in category (`attributes_from_spec: true`, resolved through `spec_reader.spec_categories`)
# the file carries the TWO TEXT columns -- `item_name`, `item_detail`, in that order, right after the
# lead identity columns -- and NO derived attribute column and NO reserved flag column. The rates follow
# as before. A discipline with no opted-in category (Electrical) takes none of these branches.
TEXT_COLUMNS = spec_reader.TEXT_ATTRS


def _spec_kinds(discipline):
    """The kinds whose category opts in. Empty for Electrical."""
    return set(spec_reader.spec_categories(discipline))


def _split_keys(items, spec_kinds):
    """(attrs, rates, has_spec_rows): attribute keys observed on NON-spec rows only (a spec row's
    derived keys are never a column), rate keys observed on every row."""
    attrs, rates = set(), set()
    has_spec = False
    for it in items:
        rates.update(it["rates"].keys())
        if it["kind"] in spec_kinds:
            has_spec = True
        else:
            attrs.update(it["attributes"].keys())
    return sorted(attrs), sorted(rates), has_spec


def _cell(value):
    """A value, as stored, for the CSV. None -> empty. Everything else str()'d WITHOUT reformatting:
    a float stays `2.0`, a string keeps its spacing. The csv writer handles quoting for commas/quotes."""
    if value is None:
        return ""
    return str(value)


def _numeric_columns(attrs, rates, attr_types):
    """The columns the .xlsx writes as NUMBERS: every rate / markup column and every attribute whose
    declared type is numeric. Everything else -- identity, labels, text attributes, undeclared keys --
    is TEXT."""
    return set(rates) | {a for a in attrs if attr_types.get(a) in NUMERIC_ATTR_TYPES}


def labelled_rate_headers(labels, rates, kinds_in_file):
    """SLICE 12b(B). `{rate_key: header cell}` for a file's rate columns -- the key, plus its DERIVED
    kind in brackets where the file can state one unambiguously.

    ⚠️ EVERYTHING THE WRITER KEYS ON A HEADER NAME MUST BE TRANSLATED WITH THIS SAME MAP.
    `xlsx_io.write_xlsx` matches `numeric_columns`, `wrap_columns` and each row's locked-cell set
    against the header CELL, so labelling the headers alone would silently make every rate column TEXT
    (losing its number format) and would stop marking a derived cell as not-editable. `xlsx_io` is out
    of this slice's scope, which is exactly why the translation is centralised here instead: one map,
    applied to the headers and to both keyed sets at the same call site.
    """
    return {r: rate_header_cell(r, header_label_for_rate(labels, r, kinds_in_file)) for r in rates}


def _lead(item, with_kind, discipline, category):
    """item_uid, discipline, category, [kind], brand, unit -- the same shape in BOTH modes since 1g."""
    lead = [item["item_uid"], discipline, category]
    if with_kind:
        lead.append(item["kind"])
    lead += [item["brand"], item["unit"]]
    return lead


def _lead_headers(with_kind, mode_b=None):
    """The fixed header run. `mode_b` is accepted for the callers' sake and no longer changes the
    shape: since 1g both modes carry discipline + category (Mode B always had category)."""
    hdr = ["item_uid", DISCIPLINE_COLUMN, CATEGORY_COLUMN]
    if with_kind:
        hdr.append("kind")
    hdr += ["brand", "unit"]
    return hdr


def _source_order(items):
    """The items in the SOURCE WORKBOOK'S OWN ORDER (owner, 2026-09-27: "can we keep the order of rows
    and columns as per the original excell sheet"). Sheet first, then row, then uid as the tie-break.

    ⚠️ SHEET FIRST is load-bearing: `popup_boxes` and `wiring_cabling` each draw from TWO sheets, and
    ordering on the row number alone would interleave them. PRESENTATION ONLY -- the importer keys rows
    by `item_uid`, never by position (pinned).
    """
    def key(it):
        row = it.get("source_row")
        return ((it.get("source_sheet") or ""), 0 if row not in (None, "") else 1,
                int(row) if str(row).strip().lstrip("-").isdigit() else 0,
                it.get("item_uid") or "")
    return sorted(items, key=key)


def _sheet_column_order(cfg, attrs, rates):
    """(attrs, rates) in the SOURCE SHEET'S own left-to-right order, for a category that DECLARES one.

    The declaration is `rate_composition`, which already names the cost parts in the sheet's order plus
    the wastage and the markup -- so the order is read from config, never from a list in code (the HV-10
    rule). Attributes follow the config's own `attribute_definitions` order, which is the order they were
    authored in from the sheet.

    A category with NO `rate_composition` (ADP, every Electrical category) keeps TODAY'S sorted order,
    byte-identical -- there is no sheet order declared for it to follow, and inventing one would reorder
    files the owner did not ask about.
    """
    comp = cfg.get(config_validation.RATE_COMPOSITION_KEY) or {}
    if not comp:
        return attrs, rates
    declared = [d["id"] for d in (cfg.get("attribute_definitions") or [])
                if isinstance(d, dict) and d.get("id")]
    ordered_attrs = [a for a in declared if a in attrs] + [a for a in attrs if a not in declared]
    seq = []
    for side in ("supply", "install"):
        spec = comp.get(side) or {}
        for k in list(spec.get("parts") or []) + [spec.get("wastage_key")]:
            if k and k in rates and k not in seq:
                seq.append(k)
    for side in ("supply", "install"):            # the markups last, after every cost part
        k = (comp.get(side) or {}).get("markup_key")
        if k and k in rates and k not in seq:
            seq.append(k)
    return ordered_attrs, seq + [r for r in rates if r not in seq]


def build_category_rows(discipline, category_id):
    """MODE A -- one category, format-neutral. Returns {headers, rows (raw values), numeric, n}.

    A category with no items yields a HEADERS-ONLY file rather than an error: the header set then
    comes from the config's attribute definitions, so the file is still a usable template.
    """
    items, _kind_cat, cat_kinds, attr_types = _load_full(discipline)
    if category_id not in cat_kinds:
        frappe.throw("Unknown category '%s' for discipline '%s'." % (category_id, discipline),
                     title="Unknown category")

    kinds = set(cat_kinds[category_id])
    rows_in = [it for it in items if it["kind"] in kinds]

    # SLICE 12b(A) -- PRICING INPUTS get a FIXED column set, not the generic attribute/rate union.
    # ACCEPTANCE 4: only the item, its value columns, the unit, the remark and the read-only used-by
    # count -- nothing borrowed from a SKU file. ACCEPTANCE 6: the factors read as percentages.
    if kinds and all(is_pricing_input_kind(k) for k in kinds):
        used = pricing_input_used_by(_load_configs(discipline))
        value_cols = [c for c in PRICING_INPUT_VALUE_COLUMNS
                      if any(c in (it.get("rates") or {}) for it in rows_in)]
        headers = ([ "item_uid", DISCIPLINE_COLUMN, CATEGORY_COLUMN, PRICING_INPUT_NAME]
                   + value_cols
                   + ["unit", PRICING_INPUT_SHARED_BY, PRICING_INPUT_REMARKS, PRICING_INPUT_USED_BY])
        rows = []
        for it in sorted(rows_in, key=lambda x: str(x["attributes"].get("name") or "")):
            a = it.get("attributes") or {}
            r = it.get("rates") or {}
            iid = a.get(PRICING_INPUT_NAME)
            n, cats = used.get(iid, (0, []))
            cells = [it["item_uid"], discipline, category_id, a.get("name")]
            for c in value_cols:
                v = r.get(c)
                cells.append(as_percent(v) if c in PRICING_INPUT_PERCENT_COLUMNS else v)
            cells += [it.get("unit"), a.get(PRICING_INPUT_SHARED_BY) or "",
                      a.get(PRICING_INPUT_REMARKS) or "",
                      ("%d site%s in %s" % (n, "" if n == 1 else "s", ", ".join(cats))) if n else "not used"]
            rows.append(cells)
        # Every value column is TEXT here (a percentage is a string), so nothing is numeric. The
        # used-by column is READ-ONLY and is locked on every row: it is derived from the pipelines, so
        # a typed value there could never mean anything.
        return {"headers": headers, "rows": rows, "n": len(rows), "numeric": [],
                "formula_row": [
                    FORMULA_ROW_MARKER, "", "", "the number a pricer edits",
                ] + ["percentage" if c in PRICING_INPUT_PERCENT_COLUMNS else "rupees"
                     for c in value_cols] + [
                    "", "which categories read it", "what it does, with an example",
                    "derived from the pricing rules - read only",
                ],
                "locked": [{PRICING_INPUT_USED_BY} for _ in rows]}

    spec_kinds = _spec_kinds(discipline)
    if kinds and kinds <= spec_kinds:
        # SLICE 1c -- an opted-in category: text columns, rates, nothing derived. A category with no
        # items still gets the two text columns, so the template is usable.
        _attrs_unused, rates = _keys_for(rows_in)
        attrs = list(TEXT_COLUMNS)
    else:
        attrs, rates = _keys_for(rows_in)
        if not attrs and not rates:
            # No items (or a kind-less category): fall back to the config's declared attribute ids so
            # the file is still a template a user can add rows to.
            cfg = frappe.db.get_value(CONFIG_DOCTYPE,
                                      {"discipline": discipline, "category_id": category_id, "active": 1},
                                      "config")
            defs = _parsed(cfg, {}).get("attribute_definitions") or []
            attrs = sorted({d["id"] for d in defs if isinstance(d, dict) and d.get("id")})

    with_kind = file_carries_kind(cat_kinds, category_id)
    cfg = _load_configs(discipline).get(category_id) or {}
    rows_in = _source_order(rows_in)                      # owner 2026-09-27: the workbook's row order
    attrs, rates = _sheet_column_order(cfg, attrs, rates)  # and its column order, where declared
    # SLICE 12a (owner I-6): the two read-only formula columns, LAST, on every row of every
    # discipline. They are TEXT, so they must stay out of `_numeric_columns` -- which they do by
    # construction: they are neither an attribute nor a rate key.
    # SLICE 12b(B): `header_keys` stays the UNLABELLED run, because the formula row aligns by name; the
    # labelled cells go out as `headers`. Positions are identical, so only the rate cells' TEXT differs.
    header_keys = _lead_headers(with_kind, mode_b=False) + attrs + rates + list(FORMULA_COLUMNS)
    labels = derive_rate_column_labels(_load_configs(discipline), discipline)
    rate_hdr = labelled_rate_headers(labels, rates, sorted(cat_kinds.get(category_id) or []))
    headers = (_lead_headers(with_kind, mode_b=False) + attrs
               + [rate_hdr[r] for r in rates] + list(FORMULA_COLUMNS))
    texts, derived_by_key = formula_cells_for(cfg, rows_in)
    derived = config_validation.derived_cells(cfg)
    rows = []
    for it in rows_in:
        rows.append(
            _lead(it, with_kind, discipline, category_id)
            + [it["attributes"].get(a) for a in attrs]
            + [_rate_cell(it, r, derived) for r in rates]
            + texts.get(it["item_uid"], [FORMULA_TYPED, FORMULA_TYPED])
        )
    numeric = _numeric_columns(attrs, rates, attr_types)
    return {"headers": headers, "rows": rows, "n": len(rows),
            # translated through the SAME map as the headers -- see `labelled_rate_headers`
            "numeric": {rate_hdr.get(n, n) for n in numeric},
            # A rate column whose header gained NO bracket is one the rules do not settle -- exactly
            # what acceptance item 2 wants the formula row to say in words.
            "formula_row": formula_row_cells(cfg, header_keys, set(rates), derived_by_key,
                                             unsettled_rates={r for r in rates
                                                              if rate_hdr[r] == r}),
            # one set per row: the cells a pricer must NOT type in (owner 2026-09-27 -- the .xlsx
            # fills them red, because an EMPTY cell says nothing about whether it is editable)
            "locked": [{rate_hdr.get(r, r) for r in rates if (it["item_uid"], r) in derived}
                       for it in rows_in]}


def build_all_categories_rows(discipline):
    """MODE B -- every category in one file, format-neutral, with a `category` column and the UNION
    of every category's attribute and rate keys. Sparse by construction."""
    items, kind_cat, cat_kinds, attr_types = _load_full(discipline)
    # SLICE 12b(A) / ACCEPTANCE 15: Pricing Inputs STAY OUT of the all-categories file. They are not
    # SKUs, and letting them in would put a `discount` / `share` / `amount` column onto every other
    # category's rows -- a union that is sparse by construction would become sparse and misleading.
    items = [it for it in items if not is_pricing_input_kind(it["kind"])]
    spec_kinds = _spec_kinds(discipline)
    if spec_kinds:
        # SLICE 1c -- the union takes its attribute keys from NON-spec rows only; the two text columns
        # are added (before the other attributes) when any spec row is in the file; a spec row's cell
        # in every other attribute column is BLANK, even where a key name is shared, because its
        # derived values are never a column.
        other_attrs, rates, has_spec = _split_keys(items, spec_kinds)
        attrs = (list(TEXT_COLUMNS) if has_spec else []) + [a for a in other_attrs if a not in TEXT_COLUMNS]
    else:
        attrs, rates = _keys_for(items)
    with_kind = file_carries_kind(cat_kinds, None)
    # owner 2026-09-27: within a CATEGORY, the workbook's own row order. Mode B spans every category,
    # so the category groups the file and the workbook orders each group.
    items = sorted(_source_order(items), key=lambda it: kind_cat.get(it["kind"], ""))
    header_keys = _lead_headers(with_kind, mode_b=True) + attrs + rates + list(FORMULA_COLUMNS)
    # SLICE 12a: Mode B spans every category, so each ROW's formula text is rendered against ITS OWN
    # category's config, and the formula ROW joins the per-category notes for a shared rate column.
    configs = _load_configs(discipline)
    # SLICE 12b(B): Mode B is EVERY kind in one file, so a shared rate key gets a label only where all
    # of them agree (`header_label_for_rate`). Measured on v65: `list_price` across four kinds and
    # `list_price_per_mtr` across two all derive List price, so nothing is suppressed today -- the
    # narrowing exists so that the day two kinds disagree the header says nothing rather than the
    # wrong thing.
    _labels = derive_rate_column_labels(configs, discipline)
    rate_hdr = labelled_rate_headers(_labels, rates, sorted({it["kind"] for it in items}))
    headers = (_lead_headers(with_kind, mode_b=True) + attrs
               + [rate_hdr[r] for r in rates] + list(FORMULA_COLUMNS))
    items_by_cat = {}
    for it in items:
        items_by_cat.setdefault(kind_cat.get(it["kind"], ""), []).append(it)
    texts, derived_by_cat, derived_cells_by_cat = {}, {}, {}
    for cat, cat_items in items_by_cat.items():
        t, dk = formula_cells_for(configs.get(cat) or {}, cat_items)
        texts.update(t)
        derived_by_cat[cat] = dk
        # resolved ONCE per category, never per cell -- Mode B is 1,367 rows x ~45 columns
        derived_cells_by_cat[cat] = config_validation.derived_cells(configs.get(cat) or {})
    rows = []
    for it in items:
        if it["kind"] in spec_kinds:
            attr_cells = [it["attributes"].get(a) if a in TEXT_COLUMNS else None for a in attrs]
        else:
            attr_cells = [it["attributes"].get(a) for a in attrs]
        rows.append(
            _lead(it, with_kind, discipline, kind_cat.get(it["kind"], ""))
            + attr_cells
            + [_rate_cell(it, r, derived_cells_by_cat.get(kind_cat.get(it["kind"], "")) or {})
               for r in rates]
            + texts.get(it["item_uid"], [FORMULA_TYPED, FORMULA_TYPED])
        )
    return {"headers": headers, "rows": rows, "n": len(rows),
            # translated through the SAME map as the headers -- see `labelled_rate_headers`
            "numeric": {rate_hdr.get(n, n) for n in _numeric_columns(attrs, rates, attr_types)},
            "locked": [{rate_hdr.get(r, r) for r in rates
                        if (it["item_uid"], r)
                        in (derived_cells_by_cat.get(kind_cat.get(it["kind"], "")) or {})}
                       for it in items],
            # `header_keys`, never `headers`: this row aligns by NAME (see `formula_row_cells`)
            "formula_row": formula_row_cells_all(configs, header_keys, set(rates), derived_by_cat,
                                                 set(items_by_cat),
                                                 {c: set().union(*[set(i["rates"]) for i in its])
                                                  if its else set()
                                                  for c, its in items_by_cat.items()})}


# ── writers ──────────────────────────────────────────────────────────────────────────────────


def to_csv(headers, rows, formula_row=None):
    """csv.writer with \\r\\n (the RFC line ending Excel expects) and a UTF-8 BOM so Excel renders
    non-ASCII correctly -- the same BOM convention exportReviewCsv already uses. Values as stored.

    SLICE 12a: `formula_row` is written FIRST, directly under the header. A newline inside a quoted
    CSV field is legal and survives the round trip, so the same multi-line text the .xlsx wraps reads
    as indented lines here -- PLAINLY, with no colour (owner I-6: "CSV plain")."""
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow(headers)
    if formula_row:
        w.writerow([_cell(v) for v in formula_row])
    for r in rows:
        w.writerow([_cell(v) for v in r])
    return "﻿" + buf.getvalue()


def to_xlsx(headers, rows, numeric, formula_row=None, locked=None):
    """One-sheet workbook bytes: text columns as TEXT, the numeric columns as numbers (xlsx_io).

    SLICE 12a: the formula row goes first and the formula columns wrap, both COLOURED -- the colour is
    emphasis only, which is why the CSV can drop it and still read (owner I-6). `locked` additionally
    fills every DERIVED cell RED, which is NOT mere emphasis: those cells are exported empty, so
    without it nothing on the sheet says a pricer may not type in them (owner 2026-09-27). The CSV
    cannot carry a fill, and there the row's `supply_formula` / `install_formula` is the only signal."""
    return xlsx_io.write_xlsx(headers, rows, numeric, formula_row=formula_row,
                              wrap_columns=FORMULA_COLUMNS, fill_columns_by_row=locked)


def build_category_csv(discipline, category_id):
    """MODE A as CSV: (text, headers, row_count)."""
    b = build_category_rows(discipline, category_id)
    return to_csv(b["headers"], b["rows"], b.get("formula_row")), b["headers"], b["n"]


def build_all_categories_csv(discipline):
    """MODE B as CSV: (text, headers, row_count)."""
    b = build_all_categories_rows(discipline)
    return to_csv(b["headers"], b["rows"], b.get("formula_row")), b["headers"], b["n"]


def build_category_xlsx(discipline, category_id):
    """MODE A as .xlsx: (bytes, headers, row_count)."""
    b = build_category_rows(discipline, category_id)
    return (to_xlsx(b["headers"], b["rows"], b["numeric"], b.get("formula_row"), b.get("locked")),
            b["headers"], b["n"])


def build_all_categories_xlsx(discipline):
    """MODE B as .xlsx: (bytes, headers, row_count)."""
    b = build_all_categories_rows(discipline)
    return (to_xlsx(b["headers"], b["rows"], b["numeric"], b.get("formula_row"), b.get("locked")),
            b["headers"], b["n"])


# -- SLICE 12a: THE FORMULA EXPLANATIONS (owner I-5 / I-6 / I-7 / I-7a / I-8) ----------------------
#
# TWO surfaces, both generated, both INERT on upload:
#
#   THE COLUMN-LEVEL FORMULA ROW (I-7) -- the first row UNDER the header, one cell per column, saying
#   what each computed rate column IS and how to update it. Generated from the category's OWN
#   pipelines (Electrical, ADP), from `rate_composition` where a category has no pipelines yet
#   (Insulation), and from `derived_rates` for a column some rows derive. I-7a adds, on each markup
#   column, the rule the file cannot otherwise show: the BoQ rate is the cost x (1 + markup), rounded
#   up. It is a NOTE, not a column -- nothing computes from it.
#
#   THE ROW-LEVEL FORMULA COLUMNS (I-6) -- `supply_formula` and `install_formula`, on EVERY row of
#   EVERY discipline, read-only, showing that row's own arithmetic with each step's result and the
#   numbers grouped. A plainly typed cost reads `typed`.
#
# WHY THE HEADER STAYS ROW 1 (owner-confirmed 2026-09-26). `csv_importer.parse_csv_text` and
# `xlsx_io.read_xlsx` both read row 1 as the headers. The formula row is therefore the first row
# UNDER the header, marked by `FORMULA_ROW_MARKER` in its `item_uid` cell, and the importer drops it
# by that marker wherever it sits. Deleting it, blanking it or overwriting it all upload as before
# (I-8) -- see `csv_importer._FORMULA_COLUMNS` and the marker skip.
#
# A CROSS-LANGUAGE DUPLICATION, DELIBERATELY. `rateMasterSpec.ts` renders the SAME text for the Rate
# Master screen (U4/K1 want the explanation on screen, and the screen cannot call an exporter for one
# cell). The two are pinned to byte-identical output on a shared fixture -- `test_rate_master`'s
# `FORMULA_FIXTURE` and `rateMasterSpec.test.ts`'s copy of it -- exactly as `node_is_qty_bearing` /
# `isRowQtyBearing` and `_NUMERIC_ATTR_TYPES` / `isNumericAttributeType` already are.
# ══════════════════════════════════════════════════════════════════════════════════════════════════
# SLICE 12b(B) -- THE RATE-COLUMN LABEL. DERIVED FROM HOW THE RULES USE THE NUMBER.
# ══════════════════════════════════════════════════════════════════════════════════════════════════
#
# THE RULE (owner N-6, 2026-09-28). A rate column is a supplier LIST price, our own COST (BCS), or the
# figure we QUOTE (BoQ) -- and which one it is is settled by what the PIPELINES do to it, never by the
# column's NAME. `junction_box.list_price` is NOT a list price because it is called one; it is one
# because a discount is taken off it.
#
#     a DISCOUNT term reaches the column          -> "List price"
#     no discount, but a markup / wastage /       -> "BCS price"   (the number is our cost)
#        ratio / share term reaches it
#     nothing is applied to it                    -> "BoQ price"   (the number IS the quote)
#     no rule reads it at all                     -> None          (UNLABELLED)
#     every client-facing result it feeds is      -> append " (install)"
#        an install leg
#
# ⚠️ PROVENANCE, NOT THE CONSUMING STEP ALONE. An assembly's multiplier is applied to the SUM, so a
# deriver that reads only the step touching the column reports "nothing applied" for every
# db_switchgear, industrial_socket and switch/socket row -- nine columns mislabelled BoQ price. The
# walk therefore threads (kind, rate_key) -> component -> sum -> scale -> output.
#
# ⚠️ ONLY THE CLIENT-FACING PATH SETTLES A LABEL (owner ruling 2, 2026-09-28). A term applied on the
# way to a `bcs_*` output says how the COST is derived FROM a column, never what the column IS.
# `misc_item.boq_supply` reaches `supply` UNCHANGED and `bcs_supply` via a ratio -- which is exactly
# 12b(A)'s "the rate IS the quote". Counting that ratio relabels it BCS price and re-opens the
# confusion rule change 1 settled. It governs the `(install)` suffix too.
#
# ⚠️ THIS IS WHY THE 0% DISCOUNTS HAD TO BE REAL DATA (slice 12b(B), owner option (b)).
# `junction_box.list_price` and `lms_item.rate` were, until v65, BOTH `base * (1 + one supply markup)`
# and nothing else -- structurally indistinguishable, yet one must read List price and the other BCS
# price (the LMS inversion). No function reading only the rules could separate them. v65 gives cable
# tray and junction box the 0% discount the owner ruled on 2026-09-27, so the distinguishing fact is
# IN THE DATA and the label needs no special case. Do not re-introduce one.
RATE_LABEL_LIST = "List price"
RATE_LABEL_BCS = "BCS price"
RATE_LABEL_BOQ = "BoQ price"
RATE_LABEL_INSTALL_SUFFIX = " (install)"
# The formula row's FIRST line for a column the rules do not settle (acceptance item 2).
RATE_LABEL_UNSETTLED_NOTE = ("the pricing rules do not determine what kind of rate this is, so it "
                             "carries no label.")

# ⚠️ OWNER-SET LABELS -- THE MAP IS EMPTY, AND THE MECHANISM STAYS. It held exactly one entry,
# `("cable_tray", "with_cover_list") -> List price`, ruled by the owner on 2026-09-28 because no step
# read that column and nothing could derive it. **The column itself was REMOVED at Electrical v66**
# (it was reference data that every one of the 450 rows derived exactly as
# `without_cover_list + cover_only_list`, the rule the supply formula already applies), so the label
# went with it -- an owner-set label for a column that does not exist would be the staleness this
# whole labelling system exists to avoid.
#
# The FACILITY is deliberately kept for the next column no rule reads:
#
# ⚠️ DO NOT INVENT A "SAME-KIND SIBLINGS" RULE TO DERIVE SUCH A COLUMN (owner, 2026-09-28). That would
# guess wrong the first time a category has two unrelated unread columns. An owner-set entry is a
# RECORDED DECISION, and `test_rate_master`'s pin asserts this map holds EXACTLY the columns no rule
# reads -- so if a future rule ever does read one, the suite goes RED and the disagreement reads as a
# QUESTION rather than silently overriding a derived label.
#
# ⚠️ AN OWNER-SET ENTRY NEVER SHADOWS A DERIVED LABEL: `rate_column_label` consults it only where the
# derivation yields None. That is what keeps acceptance item 3 true -- change a rule and the label
# follows.
RATE_LABEL_OWNER_SET: dict[tuple[str, str], str] = {}

_BCS_KEY_PREFIX = "bcs_"
_LABEL_DISCOUNT = "discount"
# A derived BoQ/BCS multiplier is `(1 - discount) x (1 + markup)`, so it carries a discount.
_LABEL_MULTIPLIER = "multiplier"
_LABEL_COSTISH = ("markup", "wastage", "ratio", "share")


def _is_internal_value_key(key):
    """A value key on the INTERNAL cost side. `bcs_*` is the shipped convention across all 13 configs."""
    return str(key).startswith(_BCS_KEY_PREFIX)


def _pi_operand_kinds(cfg_pipeline):
    """{ctx key -> 'discount' | 'costish'} for one pipeline's pricing-input preamble, resolved through
    the derived-multiplier scales (a `(1-d)x(1+m)` product counts as carrying a discount)."""
    kinds = {}
    steps = cfg_pipeline.get("steps") or []
    for s in steps:
        if s.get("step") == "rate_ref":
            kinds[s.get("result")] = (_LABEL_DISCOUNT if s.get("target") == _LABEL_DISCOUNT
                                      else "costish")
    for s in steps:
        if s.get("pricing_input") is True:
            srcs = {kinds.get(s.get("target"))}
            for k, v in (s.get("params") or {}).items():
                if k.endswith("_from_ctx"):
                    srcs.add(kinds.get(v))
            kinds[s.get("result")] = _LABEL_DISCOUNT if _LABEL_DISCOUNT in srcs else "costish"
    return kinds


def _step_operand_terms(step, ctx_kinds):
    """The operand kinds THIS step applies, resolved through the pipeline's pricing-input ctx keys."""
    out = set()
    blobs = [step.get("params") or {}]
    blobs += [x or {} for x in (step.get("rate_stages") or [])]
    for c in step.get("conditions") or []:
        blobs.append(c.get("params") or {})
    for b in blobs:
        for k, v in b.items():
            if k.endswith("_from_ctx") and isinstance(v, str):
                kind = ctx_kinds.get(v)
                if kind:
                    out.add(kind)
    return out


# ⚠️ THE DISCIPLINE OPT-IN (owner ruling, 2026-09-28). The label is ELECTRICAL BY RULE, not by accident.
#
# THE QUESTION THE OWNER ASKED, AND THE HONEST ANSWER THAT PROMPTED THIS: the first build gated only on
# the MECHANISM -- "does this config set contain a `rate_ref`?" -- and HVAC produced nothing merely
# because of how its columns happen to be read today. That is an accident waiting to expire: **12c gives
# Insulation its pricing rules, the first HVAC `rate_ref` appears, the mechanism gate opens, and HVAC
# starts carrying labels nobody asked for** -- wrongly, because its markups are stored ITEM COLUMNS and
# the evidence this deriver reads would still be absent. Owner N-6: HVAC's columns "are explicit ...
# there is no confusion", so HVAC needs none.
#
# So the gate is now the DISCIPLINE, declared here as DATA in ONE place. A discipline joins this register
# only by a deliberate edit, which is the moment its own label ruling is needed -- exactly the shape the
# repo already uses for `PROJECTED_ITEM_COLUMNS`, `spec_categories` and `PRICING_ACCESS_SET`. That is
# how this stays compatible with the HV-10 rule: no behaviour is INFERRED from a discipline name in
# logic; there is one explicit register, and it is the ruling written down.
#
# ⚠️ `discipline` IS REQUIRED, NOT OPTIONAL. A default would let a caller silently disable every label
# by forgetting it -- a whole feature vanishing with no error. Omit it and you get a TypeError.
RATE_LABEL_DISCIPLINES = ("Electrical",)


def derive_rate_column_labels(configs, discipline, include_owner_set=True):
    """{(kind, rate_key): label} for every rate column ANY rule reads. PURE -- no DB, no request ctx.

    `configs` is {category_id: config}, i.e. what `_load_configs(discipline)` returns. A column absent
    from the result is one no rule reads; `rate_column_label` turns that into the owner-set label where
    one is recorded, else None.

    ⚠️ MIRRORED in `rateMasterSpec.deriveRateColumnLabels` and pinned byte-identical on the shared
    fixture. The screen cannot call an exporter for one header cell, so the duplication is deliberate
    and the pin is the mechanism (the `FORMULA_FIXTURE` precedent).
    """
    # ⚠️ GATE 1 OF 2 -- THE DISCIPLINE, AND IT IS THE LOAD-BEARING ONE (owner ruling 2026-09-28).
    # See `RATE_LABEL_DISCIPLINES`. This is what makes HVAC label-free BY RULE rather than by accident,
    # and what stops 12c opening the door on its own.
    if str(discipline or "") not in RATE_LABEL_DISCIPLINES:
        return {}

    # ⚠️ GATE 2 OF 2 -- THE VOCABULARY, kept as an INDEPENDENT second stop.
    #
    # This label answers "what do the PRICING-INPUT rules say this number is?" -- every one of its three
    # verdicts is evidence about a discount / markup / ratio / share read through a `rate_ref`. A
    # discipline that does not express its pricing that way has NO ANSWER IN THIS VOCABULARY, and the
    # honest result is silence, not a guess. It is DEFENCE IN DEPTH, not the ruling: were the register
    # above ever mis-set, a discipline that does not price through pricing inputs still gets nothing.
    #
    # HVAC is exactly that case: its markups are STORED COLUMNS on the item (`supply_markup`,
    # `install_markup` on `hvac_adp_item`), not pricing inputs, so its configs carry ZERO `rate_ref`
    # steps. Without this gate the `else` branch below fires and `hvac_adp_item.cost_supply` --
    # plainly a COST -- is labelled "BoQ price", which is both wrong and a change to HVAC's files.
    # Measured: 2 HVAC columns mislabelled before the gate, 0 after.
    #
    # ⚠️ NO DISCIPLINE IS NAMED HERE (the HV-10 rule). The gate is the PRESENCE OF THE MECHANISM, so a
    # discipline that later adopts pricing inputs flows through with no code change -- and one that
    # never does stays silent forever.
    #
    # ⚠️ WHEN HVAC DOES GAIN A PRICING-INPUTS CATEGORY (12c), ITS LABELS NEED THEIR OWN RULING. A
    # stored `supply_markup` COLUMN is still not a pricing input, so the gate would open while the
    # evidence stayed absent, and `cost_supply` would derive "BoQ price" again. Do not assume this
    # deriver extends to HVAC for free.
    if not any((s or {}).get("step") == "rate_ref"
               for cfg in (configs or {}).values()
               for pl in ((cfg or {}).get("pipelines") or {}).values()
               for s in ((pl or {}).get("steps") or [])):
        return {}

    terms = {}      # (kind, rate_key) -> set of operand kinds on the CLIENT-FACING path
    results = {}    # (kind, rate_key) -> set of client-facing value keys it feeds

    def note(col, applied, res):
        if not col[0] or not col[1]:
            return
        terms.setdefault(col, set()).update(applied)
        if res:
            results.setdefault(col, set()).add(res)

    for cid in sorted(configs or {}):
        cfg = configs[cid] or {}
        for pid in sorted(cfg.get("pipelines") or {}):
            pl = cfg["pipelines"][pid] or {}
            steps = list(pl.get("steps") or [])
            ctx_kinds = _pi_operand_kinds(pl)
            # A pipeline whose every output is `bcs_*` says nothing about what a column IS.
            client_facing = any(not _is_internal_value_key(o) for o in (pl.get("output") or []))
            prov = {}       # value key -> set of (kind, rate_key)
            acc = set()     # components accumulated for the next sum_components
            driving = None  # the kind whose OWN rates this pipeline prices

            def prov_add(key, cols):
                if key:
                    prov.setdefault(key, set()).update(cols)

            # THE HOIST: the pricing-input preamble is evaluated first at run time, so read it first
            # here too. Nothing in this walk depends on it, but keeping the orders identical is what
            # stops the two diverging the day a preamble step gains provenance.
            ordered = ([s for s in steps if s.get("step") == "rate_ref" or s.get("pricing_input") is True]
                       + [s for s in steps if not (s.get("step") == "rate_ref"
                                                   or s.get("pricing_input") is True)])
            for s in ordered:
                st = s.get("step")
                if st in ("match_master_row", "catalog_fit"):
                    driving = (s.get("params") or {}).get("kind")
                elif st == "component_ref":
                    cols = {((s.get("ref") or {}).get("kind"), s.get("target"))}
                    prov_add(s.get("name"), cols)
                    prov_add(s.get("result"), cols)
                    acc |= cols
                    if client_facing:           # a component feeds a SUM: the PIPELINE decides
                        for c in cols:
                            note(c, _step_operand_terms(s, ctx_kinds), None)
                elif st in ("component", "component_band"):
                    tgts = ([s.get("target")] if s.get("target")
                            else [b.get("target") for b in (s.get("bands") or [])])
                    cols = {(driving, t) for t in tgts if t and driving}
                    prov_add(s.get("name"), cols)
                    acc |= cols
                    if client_facing:
                        for c in cols:
                            note(c, _step_operand_terms(s, ctx_kinds), None)
                elif st == "sum_components":
                    prov_add(s.get("result"), set(acc))
                elif st in ("scale", "apply_effective_multiplier", "install_as_ratio", "roundup"):
                    tgt = s.get("target")
                    cols = set(prov.get(tgt) or ())
                    # The first read of the matched row's OWN rate: a target with no provenance at all
                    # is a stored rate key on the driving kind.
                    #
                    # ⚠️ `tgt not in prov` IS THE LOAD-BEARING HALF, not `not cols`. An earlier step may
                    # have registered the key with an EMPTY provenance set -- `install_as_ratio` has no
                    # `target`, so its `result` lands in `prov` empty -- and on the next step that reads
                    # it (`roundup target=install_per_set`) the `not cols` test alone fires the fallback
                    # and INVENTS `(termination, "install_per_set")` as though it were a stored column.
                    # It is a COMPUTED value key. The phantom never reached a header (callers only ask
                    # about keys the catalogue actually stores) but it sat in the map waiting to collide
                    # with a real column name. Found by comparing a per-category derivation against the
                    # whole-discipline one, not by a test.
                    if tgt and tgt not in prov and driving:
                        cols = {(driving, tgt)}
                        prov_add(tgt, cols)
                    res = s.get("result") or tgt
                    prov_add(res, cols)
                    if res and not _is_internal_value_key(res):
                        applied = _step_operand_terms(s, ctx_kinds)
                        for c in cols:
                            note(c, applied, res)
            # every client-facing OUTPUT the column ultimately feeds (the `(install)` evidence)
            for out_key in pl.get("output") or []:
                if _is_internal_value_key(out_key):
                    continue
                for c in prov.get(out_key) or ():
                    note(c, set(), out_key)

    labels = {}
    for col, applied in terms.items():
        if _LABEL_DISCOUNT in applied or _LABEL_MULTIPLIER in applied:
            lab = RATE_LABEL_LIST
        elif "costish" in applied:
            lab = RATE_LABEL_BCS
        else:
            lab = RATE_LABEL_BOQ
        res = {r for r in (results.get(col) or ()) if r}
        if res and all(_INSTALL_MARKER in r for r in res):
            lab += RATE_LABEL_INSTALL_SUFFIX
        labels[col] = lab
    # ⚠️ THE OWNER-SET MAP IS FOLDED IN HERE, INSIDE THE DISCIPLINE GATE -- NOT LOOKED UP LATER.
    #
    # It first lived in `rate_column_label`, which is called with no discipline, so an owner-set entry
    # LEAKED PAST THE GATE: a Mode A file for ANY discipline carrying a `cable_tray` kind got
    # `with_cover_list [List price]`, and the suite caught it on a synthetic TEST discipline. A ruling
    # about ELECTRICAL's columns must not label another discipline's.
    #
    # Folded ONLY where the derivation is silent, so it still cannot shadow a derived label -- that is
    # what keeps acceptance item 3 true. `include_owner_set=False` gives the DERIVED-ONLY map, which is
    # what the "this map holds exactly the unread columns" pin needs to ask about.
    if include_owner_set:
        for col, lab in RATE_LABEL_OWNER_SET.items():
            labels.setdefault(col, lab)
    return labels


def rate_column_label(labels, kind, rate_key):
    """The label for ONE column, or None when the rules do not settle it and no owner ruling covers it.

    ⚠️ The owner-set map is consulted ONLY where the derivation is silent, so it can never shadow a
    derived label -- acceptance item 3 ("change a rule and the label follows") depends on that order.
    """
    # A PLAIN LOOKUP. The owner-set entries are already folded in by `derive_rate_column_labels`, behind
    # the discipline gate -- see the note there for why they cannot be consulted here instead.
    return labels.get((kind, rate_key))


def header_label_for_rate(labels, rate_key, kinds_in_file):
    """The label a FILE's header may carry for `rate_key`, given the kinds present in that file.

    ⚠️ ONLY WHEN IT IS UNAMBIGUOUS. One rate key can be carried by several kinds -- `list_price` is on
    four of them -- and a header carries ONE cell. Where two kinds in the same file disagree the header
    carries NO label rather than one of them: a header that names the wrong kind of rate is worse than
    a header that names none. Today every shared key agrees (measured on v65: `list_price` across four
    kinds and `list_price_per_mtr` across two are all List price), so this narrowing is invisible --
    which is exactly why it is pinned by a test rather than left to be discovered.
    """
    seen = {rate_column_label(labels, k, rate_key) for k in (kinds_in_file or ())}
    seen = {s for s in seen if s}
    return seen.pop() if len(seen) == 1 else None


def rate_header_cell(rate_key, label):
    """`list_price` -> `list_price [List price]`. The KEY is unchanged and leads the cell, so the
    importer still matches by name after stripping the suffix (`csv_importer.strip_header_label`).

    ⚠️ Square brackets, and they are load-bearing: NO attribute id or rate key in either discipline
    contains `[` or `]` (measured -- 150 distinct keys), so the suffix can never be confused with part
    of a name, and stripping it is unambiguous.
    """
    return "%s [%s]" % (rate_key, label) if label else rate_key


FORMULA_COLUMNS = ("supply_formula", "install_formula")
FORMULA_ROW_MARKER = "(formula row -- not an item; ignored on upload)"
FORMULA_TYPED = "typed"
# Owner, 2026-09-27: the word that stands in a DERIVED cost cell, so the cell is never EMPTY --
# "i cannot make out" was said of an empty one. Short and lowercase so it cannot be mistaken for a
# value. In the CSV, which carries neither colour nor sheet protection, this word is the ONLY signal.
# ⚠️ The importer must read it as "untouched", NOT as a number it cannot parse -- see
# `csv_importer` DERIVED_CELL_TEXT.
DERIVED_CELL_TEXT = "derived"
# The BoQ-rate rule the file cannot otherwise show (owner I-7a): a cost column plus a markup column
# is a BoQ rate nobody typed. Emitted on the markup columns only, so a discipline with no stored
# markup column (Electrical -- its markups live in pipeline params) never sees it.
BOQ_RATE_NOTE = "BoQ rate = cost x (1 + markup), rounded up."
_MARKUP_MARKER = "markup"
# Owner, 2026-09-27 ("trim electrical"): a column note carries the PLAIN-ENGLISH explanation only.
# The internal pipeline name and the step expression -- `pipelines.tray_boq_supply: base*factor --`
# -- help nobody maintaining a RATE; the sentence after them is the owner's own reasoning, carried
# forward from the config, and it is the part worth reading. A step with no explanation of its own
# still says something true and short rather than an expression or a blank.
_NOTE_MAX_CHARS = 300
_NOTE_FALLBACK = "computed by this category's pricing rules"
_INSTALL_MARKER = "install"


def _fmt_num(value):
    """A number as the formula text writes it: grouped thousands, an integer with no decimals, and at
    most two decimals otherwise with trailing zeros trimmed. MIRRORED in `rateMasterSpec.formatNum` --
    the two must agree character for character or the file and the screen disagree about a figure."""
    if value is None:
        return ""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return str(value)
    if value != value or value in (float("inf"), float("-inf")):
        return str(value)
    if float(value).is_integer():
        return "{:,}".format(int(value))
    txt = "{:,.2f}".format(float(value))
    if txt.endswith("0"):
        txt = txt[:-1]
    return txt


def _wording_attr_ids(cfg):
    """The attribute ids that NAME a row, in display order: the two text keys for a spec-read category,
    else every definition except brand (brand is its own named column)."""
    defs = [d for d in (cfg.get("attribute_definitions") or []) if isinstance(d, dict) and d.get("id")]
    if cfg.get("attributes_from_spec") is True:
        have = {d["id"] for d in defs}
        return [a for a in TEXT_COLUMNS if a in have]
    return [d["id"] for d in defs if d["id"] != "brand"]


def base_wording(cfg, item):
    """A base row AS WORDING, with its id at the end (owner I-5, "your way"): brand, the attributes
    that name it, the unit -- then `[item_uid]`. A catalogue WORDING change therefore cannot
    invalidate a declaration: only the uid is stored, the wording is looked up at render time."""
    if item is None:
        return ""
    bits = []
    if item.get("brand"):
        bits.append(str(item["brand"]))
    attrs = item.get("attributes") or {}
    for aid in _wording_attr_ids(cfg):
        v = attrs.get(aid)
        if v not in (None, ""):
            bits.append(_fmt_num(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else str(v))
    if item.get("unit"):
        bits.append(str(item["unit"]))
    return ", ".join(bits) + " [" + str(item.get("item_uid") or "") + "]"


def _side_of(rate_key):
    """Which formula column a rate key is talked about in. A key naming `install` is the install side;
    everything else is supply. A NAME test, and it is only ever used to pick WHICH of the two columns
    mentions a cell -- never to decide a price."""
    return "install" if _INSTALL_MARKER in (rate_key or "").lower() else "supply"


# What a step DOES, for a step that carries neither a formula nor an explain of its own.
_STEP_PROSE = {
    "component_ref": "read off ANOTHER catalogue row, as one component of an assembly total",
    "component": "read off THIS row, as one component of an assembly total",
    "component_band": "read off THIS row, banded by the selected value",
    "scale": "scaled",
    "roundup": "rounded up",
    "apply_effective_multiplier": "the supplier discount and the company markup applied",
    "install_as_ratio": "taken as a ratio of the supply figure",
}


def _steps_reading(cfg, rate_key):
    """[(pipeline label, formula, explain, step type)] for every pipeline step that READS this rate key
    -- the generated half of a column note (owner I-9: for Electrical the explanations come from the
    pipeline configs). Walks the top-level pipelines and the item-list families' blocks alike."""
    out = []
    for label, _fam, _uc, steps, _is_conv in config_validation._pipeline_scopes(cfg):
        for s in steps:
            if not isinstance(s, dict):
                continue
            explain = (s.get("explain") or "").strip()
            if s.get("target") == rate_key:
                out.append((label, s.get("formula") or "", explain, s.get("step") or ""))
                continue
            # ⚠️ A `component_band` names its targets inside `bands[*].target`, NOT in `step.target`.
            # Found in the browser cert: both gland columns read "no pipeline reads it yet", which is
            # false -- termination_boq reads whichever band the thickness falls in.
            for band in (s.get("bands") or []):
                if isinstance(band, dict) and band.get("target") == rate_key:
                    when = str(band.get("when") or "").strip()
                    said = explain or ("used when %s %s" % (s.get("band_on") or "the banded value", when)
                                       if when else "")
                    out.append((label, s.get("formula") or "", said, s.get("step") or ""))
                    break
    return out


def _composition_role(cfg, rate_key):
    """('part' | 'wastage' | 'markup' | None, side, spec) -- what `rate_composition` says this rate key
    is. Config-declared, never a name in code (the HV-10 rule)."""
    comp = cfg.get(config_validation.RATE_COMPOSITION_KEY) or {}
    for side, spec in comp.items():
        if not isinstance(spec, dict):
            continue
        if rate_key in (spec.get("parts") or []):
            return "part", side, spec
        if rate_key == spec.get("wastage_key"):
            return "wastage", side, spec
        if rate_key == spec.get("markup_key"):
            return "markup", side, spec
    return None, None, None


def column_note(cfg, rate_key, derived_uids=(), unsettled=False):
    """The FORMULA ROW's cell for one rate column (owner I-7). PURE. Mirrored in
    `rateMasterSpec.columnNote`.

    SLICE 12b(B) / ACCEPTANCE ITEM 2: `unsettled=True` prepends ONE line saying the rules do not
    determine what kind of rate this is -- the words that go with an absent header label. It DEFAULTS
    FALSE, so every existing caller and both cross-language pins are byte-identical.
    """
    lines = []
    if unsettled:
        lines.append(RATE_LABEL_UNSETTLED_NOTE)
    if derived_uids:
        lines.append("DERIVED on %d row(s): the value comes from another catalogue row -- see that "
                     "row's supply_formula / install_formula." % len(derived_uids))
    role, side, spec = _composition_role(cfg, rate_key)
    if role == "part":
        parts = " + ".join(spec.get("parts") or [])
        tail = ""
        if spec.get("wastage_key"):
            tail += " x (1 + %s)" % spec["wastage_key"]
        lines.append("a PART of the %s cost: (%s)%s, rounded up." % (side, parts, tail))
    elif role == "wastage":
        lines.append("the %s wastage fraction: (%s) x (1 + this), rounded up."
                     % (side, " + ".join(spec.get("parts") or [])))
    elif role == "markup":
        lines.append("the %s markup fraction." % side)
    # GROUPED BY WHAT THE STEP DOES, not by which pipeline does it. ADP's `cost_supply` is read by 62
    # pipelines that between them do FOUR different things, so one line per pipeline made the cell
    # unreadable -- and an unreadable explanation is the same as none. Identical (formula, explain)
    # pairs collapse to one line, in first-seen order, naming the pipeline only when just one does it.
    # THE EXPLANATION ONLY, deduplicated, in first-seen order. A step with no explanation of its own
    # falls back to what the STEP DOES (db_switchgear's eighteen `component_ref`s are all of this
    # shape), and an unknown step to the generic line -- never an expression, never a blank.
    for _label, _formula, explain, step in _steps_reading(cfg, rate_key):
        said = explain or _STEP_PROSE.get(step) or _NOTE_FALLBACK
        if said not in lines:
            lines.append(said)
    if _MARKUP_MARKER in (rate_key or "").lower():
        lines.append(BOQ_RATE_NOTE)
    if not lines:
        lines.append("a TYPED rate. No pipeline reads it yet.")
    # THE CAP IS PER LINE, NOT PER NOTE. Applied to the whole note it kept only the FIRST line and
    # dropped the rest: ADP's `cost_supply` carries EIGHT distinct explanations, every one short,
    # and a whole-note cap cut it to the DERIVED banner alone. Per line tames the genuinely long
    # ones (the LMS inversion warning, the wiring conduit ruling) and keeps every explanation.
    return "\n".join(_capped(l) for l in lines)


def _capped(text, limit=_NOTE_MAX_CHARS):
    """A note the length of a paragraph is true and unreadable -- the wiring `list_price_per_mtr` note
    ran to several hundred characters of conduit and parallel-run rulings in ONE cell. Past the cap,
    keep whole leading SENTENCES (never a word cut in half) and end with an ellipsis so the reader
    knows there is more; the full text is always in the config and on the Derivation tab."""
    if len(text) <= limit:
        return text
    kept = ""
    for piece in re.split(r"(?<=[.!?])\s+", text):
        if kept and len(kept) + 1 + len(piece) > limit:
            break
        kept = (kept + " " + piece).strip() if kept else piece
    if not kept:
        kept = text[:limit].rsplit(" ", 1)[0]
    return kept.rstrip() + " ..."


def formula_row_cells(cfg, headers, rate_keys, derived_by_key, unsettled_rates=()):
    """The FORMULA ROW aligned with `headers` (owner I-7). `item_uid` carries the marker so the
    importer can drop the row wherever it sits; every identity / attribute cell is blank.

    ⚠️ `headers` MUST be the UNLABELLED key run. Since 12b(B) a rate column's header CELL carries its
    derived kind, and this row aligns by NAME -- handed the labelled run it would match no rate key and
    every explanation would silently become an empty cell. `build_category_rows` therefore keeps
    `header_keys` beside `headers` for exactly this call.

    `unsettled_rates` (12b(B), acceptance item 2) names the rate columns the rules do not settle;
    ABSENT is byte-identical to before.
    """
    cells = []
    for name in headers:
        if name == "item_uid":
            cells.append(FORMULA_ROW_MARKER)
        elif name in FORMULA_COLUMNS:
            cells.append("How this row's %s cost is built. Read-only: edits here are ignored."
                         % ("install" if name.startswith("install") else "supply"))
        elif name in rate_keys:
            cells.append(column_note(cfg, name, derived_by_key.get(name) or (),
                                     unsettled=name in (unsettled_rates or ())))
        else:
            cells.append("")
    return cells


def _part_label(rate_key):
    """A part's human word in the row-level text: its key with the `cost_` prefix dropped and
    underscores spaced, so `cost_install_insulation` reads `install insulation`."""
    key = rate_key[5:] if rate_key.startswith("cost_") else rate_key
    return key.replace("_", " ")


def row_formula(cfg, item, side, base_lookup):
    """The ROW-LEVEL formula cell for one item and one side (owner I-6). PURE. Mirrored in
    `rateMasterSpec.rowFormula`.

    `base_lookup(item_uid)` returns the base item dict (for the I-5 wording) or None.

    A category declaring `rate_composition` shows each step's own result; a derived cost with no
    composition names its base row; anything else reads `typed`.
    """
    rates = item.get("rates") or {}
    cells = config_validation.derived_cells(cfg)
    uid = item.get("item_uid")

    def derived_note(rate_key):
        terms = cells.get((uid, rate_key))
        if not terms:
            return None
        bits = []
        for t in terms:
            src = t.get("from") or {}
            word = base_wording(cfg, base_lookup(src.get("item_uid"))) or str(src.get("item_uid") or "")
            bit = "%s of %s" % (src.get("rate_key"), word)
            mult = t.get("multiplier", 1.0)
            const = t.get("constant", 0.0)
            if mult != 1:
                bit += " x " + _fmt_num(mult)
            if const:
                bit += " + " + _fmt_num(const)
            bits.append(bit)
        return " plus ".join(bits)

    comp = (cfg.get(config_validation.RATE_COMPOSITION_KEY) or {}).get(side)
    if isinstance(comp, dict):
        lines = []
        total = 0.0
        known = True
        for i, part in enumerate(comp.get("parts") or []):
            v = rates.get(part)
            note = derived_note(part)
            if v is None:
                known = False
                txt = "(not set)"
            else:
                total += float(v)
                txt = _fmt_num(v)
            prefix = "" if i == 0 else "+ "
            line = "%s%s %s" % (prefix, _part_label(part), txt)
            if note:
                line += "  <- derived from " + note
            lines.append(line)
        if not known:
            return "\n".join(lines) if lines else FORMULA_TYPED
        lines.append("= " + _fmt_num(total))
        running = total
        wkey = comp.get("wastage_key")
        if wkey and rates.get(wkey) is not None:
            running = running * (1.0 + float(rates[wkey]))
            lines.append("x (1 + %s %s) = %s" % (_part_label(wkey), _fmt_num(rates[wkey]),
                                                 _fmt_num(running)))
        digits = comp.get("roundup", 0)
        running = _roundup(running, digits)
        lines.append("ROUNDUP -> %s   (total BCS %s)" % (_fmt_num(running), side))
        mkey = comp.get("markup_key")
        if mkey and rates.get(mkey) is not None:
            running = running * (1.0 + float(rates[mkey]))
            lines.append("x (1 + %s %s) = %s" % (_part_label(mkey), _fmt_num(rates[mkey]),
                                                 _fmt_num(running)))
            running = _roundup(running, digits)
            lines.append("ROUNDUP -> %s   (BoQ %s)" % (_fmt_num(running), side))
        return "\n".join(lines)

    notes = []
    for rate_key in sorted(rates.keys()) + sorted(
        k for (u, k) in cells if u == uid and k not in rates
    ):
        if _side_of(rate_key) != side:
            continue
        note = derived_note(rate_key)
        if note:
            notes.append("%s <- derived from %s" % (rate_key, note))
    if notes:
        return "\n".join(notes)
    return FORMULA_TYPED


def _roundup(value, digits=0):
    """Excel ROUNDUP away from zero, the same rule `ratePipelineInterpreter` applies."""
    factor = 10.0 ** digits
    scaled = value * factor
    if scaled >= 0:
        return math.ceil(scaled - 1e-9) / factor
    return -math.ceil(-scaled - 1e-9) / factor


def _derived_by_key(cfg, items):
    """{rate_key: [item_uid, ...]} over the items IN THIS FILE whose cell is declared derived."""
    cells = config_validation.derived_cells(cfg)
    present = {it["item_uid"] for it in items}
    out = {}
    for (uid, rate_key) in cells:
        if uid in present:
            out.setdefault(rate_key, []).append(uid)
    return out


def _rate_cell(item, rate_key, derived):
    """A rate cell for the file. A DECLARED DERIVED cell is written EMPTY (owner I-2 / I-3).

    ⚠️ IT DOES NOT CARRY ITS FIGURE, AND THAT IS A CORRECTNESS CHOICE, NOT TIDINESS. Exporting the figure made the .xlsx round trip refuse ITSELF: a cladding cost such as
    46.0587... is 17 significant digits in Python and ~15 in a workbook, so the value read back
    differed in its last digit and the derived guard, comparing type-strictly as this module must,
    called an untouched cell an edit. An empty cell cannot drift. The figure is NOT lost -- the row's
    `supply_formula` / `install_formula` names it AND the row it comes from, which is more than the
    bare number ever said.

    ⚠️ AND IT IS NOT BLANK EITHER (owner, 2026-09-27). A blank cell in this file already means three
    other things -- not applicable, not filled in yet, and not editable -- so it carried no signal at
    all. The cell holds the WORD `derived`, which the importer reads as "untouched" exactly as it reads
    a blank one.
    """
    if (item["item_uid"], rate_key) in derived:
        return DERIVED_CELL_TEXT
    return item["rates"].get(rate_key)


def formula_cells_for(cfg, items):
    """({item_uid: [supply text, install text]}, formula-row-ready derived map). PURE."""
    by_uid = {it["item_uid"]: it for it in items}
    texts = {}
    for it in items:
        texts[it["item_uid"]] = [row_formula(cfg, it, "supply", by_uid.get),
                                 row_formula(cfg, it, "install", by_uid.get)]
    return texts, _derived_by_key(cfg, items)


def formula_row_cells_all(configs, headers, rate_keys, derived_by_cat, cats_in_file,
                          keys_by_cat=None):
    """MODE B's formula row: one cell per column, joining the per-category notes for a rate column
    several categories share, each labelled by its category id. A column no category in the file
    describes falls back to the same "a TYPED rate" line Mode A uses, so the two modes never disagree
    about a column they both carry."""
    keys_by_cat = keys_by_cat or {}
    cells = []
    for name in headers:
        if name == "item_uid":
            cells.append(FORMULA_ROW_MARKER)
            continue
        if name in FORMULA_COLUMNS:
            cells.append("How this row's %s cost is built. Read-only: edits here are ignored."
                         % ("install" if name.startswith("install") else "supply"))
            continue
        if name not in rate_keys:
            cells.append("")
            continue
        notes = []
        for cat in sorted(cats_in_file):
            cfg = configs.get(cat) or {}
            # ONLY the categories that actually CARRY this column. Mode B is the UNION of every
            # category rate key, so without this every one of the twelve contributed a line
            # saying "no pipeline reads it yet" about a column it does not even have -- fifty
            # columns of twelve-line noise, with the one category it belongs to lost in it.
            if not cfg or name not in (keys_by_cat.get(cat) or set()):
                continue
            note = column_note(cfg, name, (derived_by_cat.get(cat) or {}).get(name) or ())
            if note and note not in notes:
                notes.append(cat + ": " + note.replace("\n", "\n  "))
        cells.append("\n".join(notes) if notes else column_note({}, name))
    return cells
