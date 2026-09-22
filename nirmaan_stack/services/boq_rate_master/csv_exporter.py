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

import frappe

from nirmaan_stack.services.boq_rate_master import spec_reader, xlsx_io

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


def _lead(item, with_kind, category=None):
    lead = [item["item_uid"]]
    if category is not None:
        lead.append(category)
    if with_kind:
        lead.append(item["kind"])
    lead += [item["brand"], item["unit"]]
    return lead


def _lead_headers(with_kind, mode_b):
    hdr = ["item_uid"]
    if mode_b:
        hdr.append(CATEGORY_COLUMN)
    if with_kind:
        hdr.append("kind")
    hdr += ["brand", "unit"]
    return hdr


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
    headers = _lead_headers(with_kind, mode_b=False) + attrs + rates
    rows = []
    for it in rows_in:
        rows.append(
            _lead(it, with_kind)
            + [it["attributes"].get(a) for a in attrs]
            + [it["rates"].get(r) for r in rates]
        )
    return {"headers": headers, "rows": rows, "n": len(rows),
            "numeric": _numeric_columns(attrs, rates, attr_types)}


def build_all_categories_rows(discipline):
    """MODE B -- every category in one file, format-neutral, with a `category` column and the UNION
    of every category's attribute and rate keys. Sparse by construction."""
    items, kind_cat, cat_kinds, attr_types = _load_full(discipline)
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
    headers = _lead_headers(with_kind, mode_b=True) + attrs + rates
    rows = []
    for it in items:
        if it["kind"] in spec_kinds:
            attr_cells = [it["attributes"].get(a) if a in TEXT_COLUMNS else None for a in attrs]
        else:
            attr_cells = [it["attributes"].get(a) for a in attrs]
        rows.append(
            _lead(it, with_kind, category=kind_cat.get(it["kind"], ""))
            + attr_cells
            + [it["rates"].get(r) for r in rates]
        )
    return {"headers": headers, "rows": rows, "n": len(rows),
            "numeric": _numeric_columns(attrs, rates, attr_types)}


# ── writers ──────────────────────────────────────────────────────────────────────────────────


def to_csv(headers, rows):
    """csv.writer with \\r\\n (the RFC line ending Excel expects) and a UTF-8 BOM so Excel renders
    non-ASCII correctly -- the same BOM convention exportReviewCsv already uses. Values as stored."""
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow(headers)
    for r in rows:
        w.writerow([_cell(v) for v in r])
    return "﻿" + buf.getvalue()


def to_xlsx(headers, rows, numeric):
    """One-sheet workbook bytes: text columns as TEXT, the numeric columns as numbers (xlsx_io)."""
    return xlsx_io.write_xlsx(headers, rows, numeric)


def build_category_csv(discipline, category_id):
    """MODE A as CSV: (text, headers, row_count)."""
    b = build_category_rows(discipline, category_id)
    return to_csv(b["headers"], b["rows"]), b["headers"], b["n"]


def build_all_categories_csv(discipline):
    """MODE B as CSV: (text, headers, row_count)."""
    b = build_all_categories_rows(discipline)
    return to_csv(b["headers"], b["rows"]), b["headers"], b["n"]


def build_category_xlsx(discipline, category_id):
    """MODE A as .xlsx: (bytes, headers, row_count)."""
    b = build_category_rows(discipline, category_id)
    return to_xlsx(b["headers"], b["rows"], b["numeric"]), b["headers"], b["n"]


def build_all_categories_xlsx(discipline):
    """MODE B as .xlsx: (bytes, headers, row_count)."""
    b = build_all_categories_rows(discipline)
    return to_xlsx(b["headers"], b["rows"], b["numeric"]), b["headers"], b["n"]
