# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The editable CSV -- what a pricer downloads, edits in Excel, and uploads back (next slice).

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
otherwise "fixed" -- the file must round-trip what is in the database. Excel hazards are reported,
not silently worked around.

PURE: this module reads the database and returns text. It writes nothing.
"""

import csv
import io
import json

import frappe

ITEM_DOCTYPE = "BoQ Rate Master Item"
CONFIG_DOCTYPE = "BoQ Rate Category Config"

# Fixed columns, in order. `item_uid` is FIRST because it is the row's identity and the one column a
# user must not invent; the provenance pair goes LAST, out of the way of the editable middle.
LEAD_COLUMNS = ("item_uid", "kind", "brand", "unit")
TAIL_COLUMNS = ("source_sheet", "source_row")
CATEGORY_COLUMN = "category"


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

    cat_kinds, kind_cat = {}, {}
    for c in frappe.get_all(CONFIG_DOCTYPE,
                            filters={"discipline": discipline, "active": 1},
                            fields=["category_id", "config"], order_by="category_id asc"):
        ks = _config_kinds(_parsed(c["config"], {}))
        cat_kinds[c["category_id"]] = ks
        for k in ks:
            # First writer wins; measured: no kind is claimed by two categories today.
            kind_cat.setdefault(k, c["category_id"])
    return items, kind_cat, cat_kinds


def _keys_for(items):
    """Attribute and rate column names observed across a set of items, sorted for a stable file."""
    attrs, rates = set(), set()
    for it in items:
        attrs.update(it["attributes"].keys())
        rates.update(it["rates"].keys())
    return sorted(attrs), sorted(rates)


def _cell(value):
    """A value, as stored. None -> empty. Everything else str()'d WITHOUT reformatting: a float
    stays `2.0`, a string keeps its spacing. The csv writer handles quoting for commas/quotes."""
    if value is None:
        return ""
    return str(value)


def _write(headers, rows):
    """csv.writer with \\r\\n (the RFC line ending Excel expects) and a UTF-8 BOM so Excel renders
    non-ASCII correctly -- the same BOM convention exportReviewCsv already uses."""
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow(headers)
    for r in rows:
        w.writerow(r)
    return "﻿" + buf.getvalue()


def build_category_csv(discipline, category_id):
    """MODE A -- one category. Columns are exactly that category's attribute and rate keys.

    A category with no items yields a HEADERS-ONLY file rather than an error: the header set then
    comes from the config's attribute definitions, so the file is still a usable template.
    """
    items, _kind_cat, cat_kinds = _load(discipline)
    if category_id not in cat_kinds:
        frappe.throw("Unknown category '%s' for discipline '%s'." % (category_id, discipline),
                     title="Unknown category")

    kinds = set(cat_kinds[category_id])
    rows_in = [it for it in items if it["kind"] in kinds]
    attrs, rates = _keys_for(rows_in)

    if not attrs and not rates:
        # No items (or a kind-less category): fall back to the config's declared attribute ids so the
        # file is still a template a user can add rows to.
        cfg = frappe.db.get_value(CONFIG_DOCTYPE,
                                  {"discipline": discipline, "category_id": category_id, "active": 1},
                                  "config")
        defs = _parsed(cfg, {}).get("attribute_definitions") or []
        attrs = sorted({d["id"] for d in defs if isinstance(d, dict) and d.get("id")})

    headers = list(LEAD_COLUMNS) + attrs + rates + list(TAIL_COLUMNS)
    rows = []
    for it in rows_in:
        rows.append(
            [_cell(it["item_uid"]), _cell(it["kind"]), _cell(it["brand"]), _cell(it["unit"])]
            + [_cell(it["attributes"].get(a)) for a in attrs]
            + [_cell(it["rates"].get(r)) for r in rates]
            + [_cell(it["source_sheet"]), _cell(it["source_row"])]
        )
    return _write(headers, rows), headers, len(rows)


def build_all_categories_csv(discipline):
    """MODE B -- every category in one file, with a `category` column and the UNION of every
    category's attribute and rate keys. Sparse by construction."""
    items, kind_cat, _cat_kinds = _load(discipline)
    attrs, rates = _keys_for(items)
    headers = ([LEAD_COLUMNS[0], CATEGORY_COLUMN] + list(LEAD_COLUMNS[1:])
               + attrs + rates + list(TAIL_COLUMNS))
    rows = []
    for it in items:
        rows.append(
            [_cell(it["item_uid"]), _cell(kind_cat.get(it["kind"], "")),
             _cell(it["kind"]), _cell(it["brand"]), _cell(it["unit"])]
            + [_cell(it["attributes"].get(a)) for a in attrs]
            + [_cell(it["rates"].get(r)) for r in rates]
            + [_cell(it["source_sheet"]), _cell(it["source_row"])]
        )
    return _write(headers, rows), headers, len(rows)
