# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""SLICE 6 -- the OTHER half of the round trip: reading back the CSV `csv_exporter` emits.

⚠️ THIS IS THE FIRST WRITE PATH INTO THE LIVE CATALOG FROM A FILE A HUMAN EDITED. Everything the
module shipped before it was additive (a new doctype, a new column) or read-only (the exports).

═══════════════════════════════════════════════════════════════════════════════════════════════
THE UPSERT SEMANTICS (owner-ruled, exact) -- and why they are NOT the loader's
═══════════════════════════════════════════════════════════════════════════════════════════════
  * a row whose `item_uid` MATCHES an active item  -> REPLACES it
  * a row with a BLANK `item_uid`                  -> ADDED, minting a fresh uid
  * ⚠️ an active item ABSENT from the file          -> LEFT UNTOUCHED

That last line is the safety property of the whole feature: a PARTIAL upload can never delete
anything. Edit three rows, upload three rows, nothing else moves.

⚠️ THIS IS THE OPPOSITE OF `loader.py`'s `replace=True`, which supersedes an entire SCOPE (every
active row whose kind is in the payload) and would therefore wipe every item the file happened to
omit. **The upload MUST NOT be routed through the loader**, and it is not: this module has its own
write path.

FREEZE-AND-SUPERSEDE IS INTACT, AND IT IS WHAT MAKES "REPLACE" SAFE. A matched row is not mutated
in place. Its existing document is flipped `active = 0` (RETAINED, never deleted) and a NEW document
is inserted carrying the SAME `item_uid`. That is exactly the identity model slice 2 shipped for --
"many rows sharing one uid is the point; every historical version of an item can carry the same
uid", unique only among `active = 1` rows. The DIFFERENCE from the loader is purely the SCOPE of the
supersede: the loader computes it from a payload's KINDS, this computes it from the file's matched
UIDS. Absent items are not in that set, so they cannot be touched.

═══════════════════════════════════════════════════════════════════════════════════════════════
TWO STEPS, NEVER ONE: PREVIEW THEN CONFIRM
═══════════════════════════════════════════════════════════════════════════════════════════════
`build_plan` is READ-ONLY -- it opens no transaction, inserts nothing, and is the only thing the
preview endpoint calls. `apply_plan` RE-BUILDS the plan from the live database rather than trusting
anything the client sends back, so a client cannot post a doctored plan; the preview's `digest` is
carried along only so a catalog that MOVED between the two steps is REFUSED rather than silently
applied against a picture the user never saw.

═══════════════════════════════════════════════════════════════════════════════════════════════
EXCEL MANGLING -- THE PREVIEW IS THE DEFENCE, NOT A REPAIR PASS
═══════════════════════════════════════════════════════════════════════════════════════════════
Measured on the live Electrical catalog, these values are all one Excel round trip away from being
silently rewritten: `16/20A` (rating), `6A/16A 3-Pin Socket` (item), `70 x 6 MM Earth Strip` (type),
`100x50mm` (size), `3 Pin / 2P+E` (pole), `IP44/54 - Splash Proof` (enclosure), and a description
carrying U+2010 hyphens and a bullet.

⚠️ NOTHING IS SILENTLY REPAIRED. A mangled value is not detected, guessed at or reverted -- it
simply lands in the plan as a CHANGE, with the old and the new text side by side, which is what
makes it visible. The one thing this module WILL NOT tolerate is a mangled value slipping through
as "unchanged", so changed-ness is decided by comparing the value that WOULD BE STORED against the
value that IS stored, type-strictly (`json.dumps`, so a stored `2.0` and a typed `2` are told
apart), never by comparing display text.

The two decodes are likewise surfaced, not guessed: a file is read as `utf-8-sig` (our own export,
BOM stripped) and falls back to `cp1252` (what Excel writes when told "CSV" rather than
"CSV UTF-8"). Which one was used is reported in the plan.

═══════════════════════════════════════════════════════════════════════════════════════════════
BLANK CELLS -- ONE RULE, TWO REPRESENTATIONS
═══════════════════════════════════════════════════════════════════════════════════════════════
A blank cell means "empty or absent". Where the stored value is ALREADY empty or absent, nothing
changes -- which is what makes an untouched download/upload round trip a genuine no-op across the
whole catalog (measured: one live attribute holds `""` and two live rates hold `null`; both survive
unchanged). Where a real value is being cleared, the two spaces express it differently, because the
DATA does:
  * ATTRIBUTES have no null convention live (zero None-valued attributes), so a cleared attribute
    is REMOVED from the map.
  * RATES do (`boq_supply` / `boq_install` carry null on some rows, and `update_rate_master_item`
    explicitly supports numeric-OR-null), so a cleared rate becomes `None`.
On a NEW row (blank uid) a blank cell contributes nothing at all -- a new item declares only what it
has.

PURE-ish: `build_plan` reads the database and returns a dict. Only `apply_plan` writes, and it
neither commits nor touches the filesystem -- the caller owns the transaction.
"""

import csv
import hashlib
import io
import json

import frappe

from nirmaan_stack.services.boq_rate_master import csv_exporter, exporter, loader

ITEM_DOCTYPE = "BoQ Rate Master Item"
CONFIG_DOCTYPE = "BoQ Rate Category Config"

# The uid form slice 2 fixed: `rmi-` + 12 lowercase hex. Named here rather than imported from the
# one-off backfill script, which is a maintenance script and not an importable module.
UID_PREFIX = "rmi-"
UID_HEX_LEN = 12

# One shared batch per apply, mirroring the loader's one-batch-per-run provenance and the module's
# existing `rmbulk-` / `manual-` prefixes.
BATCH_PREFIX = "csvup-"
DEFAULT_SOURCE_SHEET = "CSV upload"

# A rate change AT OR ABOVE this, IN EITHER DIRECTION, is expanded by default in the preview.
# ⚠️ BOTH directions matter and the reason is asymmetric only in how it hurts: ₹26,100 typed for
# ₹2,610 is invisible in a count, and ₹261 for ₹2,610 quotes catastrophically low.
MAJOR_RATE_CHANGE_PCT = 10.0

_LEAD = set(csv_exporter.LEAD_COLUMNS)          # item_uid, kind, brand, unit
_TAIL = set(csv_exporter.TAIL_COLUMNS)          # source_sheet, source_row
_CATEGORY = csv_exporter.CATEGORY_COLUMN        # `category` -- the MODE B marker

# Attribute types that mean "this value is a number". Mirrors the frontend's
# rateMasterStructure.isNumericAttributeType -- the two must agree or a value written here can
# never be matched there. Measured: every numeric attribute in the live catalog is stored as a
# FLOAT, so coercing to float is faithful and there is no int/float ambiguity to resolve.
_NUMERIC_ATTR_TYPES = ("number", "number_choice")


# ── reading the file ────────────────────────────────────────────────────────────────────


def decode_csv_bytes(raw):
    """(text, encoding). `utf-8-sig` first -- that is what our own export emits, and the codec
    strips the BOM. `cp1252` is the fallback because it is what Excel writes when the user picks
    plain "CSV" instead of "CSV UTF-8"; the encoding actually used is REPORTED, never hidden, since
    a cp1252 read means the catalog's `®` and U+2010 hyphens were already mangled on the way out."""
    if isinstance(raw, str):
        return raw.lstrip("﻿"), "utf-8"
    try:
        return raw.decode("utf-8-sig"), "utf-8"
    except UnicodeDecodeError:
        return raw.decode("cp1252", errors="replace"), "cp1252"


def parse_csv_text(text):
    """(headers, rows). Each row is a list of cells, paired with its 1-based DATA row number (the
    number a user sees in Excel is that + 1 for the header, which the messages account for)."""
    reader = csv.reader(io.StringIO(text, newline=""))
    rows = list(reader)
    if not rows:
        return [], []
    headers = [h.strip() for h in rows[0]]
    return headers, list(enumerate(rows[1:], start=1))


# ── column spaces + classification ──────────────────────────────────────────────────────


def column_spaces(discipline):
    """(attr_ids, rate_keys, attr_types, kind_to_category) for one discipline.

    ⚠️ The attribute space is the union of the DECLARED definition ids and the OBSERVED attribute
    keys on active items, and both halves are load-bearing: three live keys (`family`, `location`,
    `pricing_mode`) are carried by real items and declared by NO config, so a declared-only space
    would reject a faithful round trip of those rows outright. (The RM-4a item endpoints validate
    against the declared set alone and would indeed refuse them -- that asymmetry is deliberate
    here, because this file's job is to reproduce what the export emitted.)"""
    attr_types = {}
    kind_cat = {}
    for c in frappe.get_all(CONFIG_DOCTYPE,
                            filters={"discipline": discipline, "active": 1},
                            fields=["category_id", "config"], order_by="category_id asc"):
        cfg = c["config"] if isinstance(c["config"], dict) else json.loads(c["config"] or "{}")
        for d in cfg.get("attribute_definitions") or []:
            if isinstance(d, dict) and d.get("id"):
                attr_types.setdefault(d["id"], d.get("type"))
        for k in csv_exporter._config_kinds(cfg):
            kind_cat.setdefault(k, c["category_id"])

    attr_ids = set(attr_types)
    rate_keys = set()
    for it in frappe.get_all(ITEM_DOCTYPE,
                             filters={"discipline": discipline, "active": 1},
                             fields=["attributes", "rates"]):
        attrs = it["attributes"] if isinstance(it["attributes"], dict) else json.loads(it["attributes"] or "{}")
        rates = it["rates"] if isinstance(it["rates"], dict) else json.loads(it["rates"] or "{}")
        attr_ids.update(attrs.keys())
        rate_keys.update(rates.keys())
    return attr_ids, rate_keys, attr_types, kind_cat


def classify_columns(headers, attr_ids, rate_keys):
    """PURE. (spec, errors) -- which column index carries what.

    spec = {"attributes": {name: idx}, "rates": {name: idx}, "fixed": {name: idx}, "mode": ...}

    MODE DETECTION IS THE PRESENCE OF THE `category` COLUMN, and nothing else. Mode B (all
    categories) carries it; Mode A (one category) does not. ⚠️ THE MODE IS INFORMATIONAL: items
    carry no category of their own -- a category is derived from an item's `kind` -- so the upsert
    is uid-keyed and MODE-INDEPENDENT. The same rows in either shape produce the same result.

    A header that is neither fixed, nor a known attribute, nor a known rate is an ERROR: a column
    nobody can place is a file we cannot read, and guessing is how a typo becomes a new attribute.
    """
    errors = []
    spec = {"attributes": {}, "rates": {}, "fixed": {}, "mode": "category"}
    seen = set()
    for idx, name in enumerate(headers):
        if not name:
            errors.append({"row": 0, "column": "", "message":
                           "Column %d has a blank header." % (idx + 1)})
            continue
        if name in seen:
            errors.append({"row": 0, "column": name, "message":
                           "Column '%s' appears more than once." % name})
            continue
        seen.add(name)
        if name == _CATEGORY:
            spec["mode"] = "all"
            spec["fixed"][name] = idx
        elif name in _LEAD or name in _TAIL:
            spec["fixed"][name] = idx
        elif name in attr_ids and name in rate_keys:
            # Measured DISJOINT on the live catalog, and it has to stay that way: the export emits
            # ONE column per name, so a name meaning both an attribute and a rate makes the FILE
            # ambiguous. Refusing here is the only honest answer -- the import cannot repair an
            # export that cannot represent the data.
            errors.append({"row": 0, "column": name, "message":
                           "Column '%s' is both an attribute and a rate key -- the file cannot be "
                           "read unambiguously." % name})
        elif name in attr_ids:
            spec["attributes"][name] = idx
        elif name in rate_keys:
            spec["rates"][name] = idx
        else:
            errors.append({"row": 0, "column": name, "message":
                           "Unknown column '%s' -- it is not a fixed column, an attribute of this "
                           "discipline, or a rate key." % name})

    if "item_uid" not in spec["fixed"]:
        errors.append({"row": 0, "column": "item_uid", "message":
                       "The file has no 'item_uid' column. Download the CSV again -- without it an "
                       "edit cannot be told from a new item."})
    if "kind" not in spec["fixed"]:
        errors.append({"row": 0, "column": "kind", "message":
                       "The file has no 'kind' column."})
    return spec, errors


# ── value coercion ──────────────────────────────────────────────────────────────────────


def coerce_rate(text, label):
    """(value, error). Blank -> None. Otherwise a finite float.

    ⚠️ A value we cannot read is REJECTED BY NAME, never repaired. `1,234.5` (Excel's thousands
    separator) and `₹120` both land here, and both are refused with the text quoted back -- a
    refusal is the loudest possible surfacing, and silently stripping a separator is exactly the
    'helpful' rewrite this module exists to avoid."""
    s = (text or "").strip()
    if s == "":
        return None, None
    try:
        num = float(s)
    except (TypeError, ValueError):
        return None, "%s: '%s' is not a number." % (label, text)
    if num != num or num in (float("inf"), float("-inf")):
        return None, "%s: '%s' is not a finite number." % (label, text)
    return num, None


def coerce_attribute(text, attr_type):
    """The stored form of an attribute cell. Numeric-typed definitions become FLOATS (every numeric
    attribute in the live catalog is stored as a float, so this is faithful and unambiguous);
    everything else -- including the three undeclared keys, which have no type at all -- keeps the
    text EXACTLY as it appears, whitespace included. Surfacing a stray trailing space as a change
    is the point; stripping it would hide an edit."""
    if attr_type in _NUMERIC_ATTR_TYPES:
        s = (text or "").strip()
        try:
            return float(s), None
        except (TypeError, ValueError):
            return None, "'%s' is not a number." % text
    return text, None


def _blankish(value):
    """'empty or absent' -- the ONE predicate behind the blank-cell rule. `None` and `""` both
    qualify; a numeric 0 emphatically does not (0 is a claim, absence is not)."""
    return value is None or value == ""


def _canon(payload):
    """Type-strict canonical form for comparison. `json.dumps` keeps `2` and `2.0` DISTINCT, which
    is what makes an Excel-flattened float show up as a change instead of slipping past."""
    return json.dumps(payload, sort_keys=True, default=str)


# ── plan ────────────────────────────────────────────────────────────────────────────────


def _stored_payload(row):
    """The comparable shape of an existing item row."""
    return {
        "kind": row["kind"],
        "brand": row["brand"],
        "unit": row["unit"],
        "attributes": row["attributes"] if isinstance(row["attributes"], dict)
        else json.loads(row["attributes"] or "{}"),
        "rates": row["rates"] if isinstance(row["rates"], dict)
        else json.loads(row["rates"] or "{}"),
        "source_sheet": row["source_sheet"],
        "source_row": row["source_row"],
    }


def _rate_change_pct(old, new):
    """The signed percentage move, or None when a percentage is meaningless.

    None is returned for an appearance (blank -> a number), a disappearance, and a move away from
    zero. All three are treated as MAJOR by the caller: they are the changes a percentage cannot
    describe, not the changes that do not matter."""
    if not isinstance(old, (int, float)) or isinstance(old, bool):
        return None
    if not isinstance(new, (int, float)) or isinstance(new, bool):
        return None
    if old == 0:
        return None if new != 0 else 0.0
    return (new - old) / abs(old) * 100.0


def _cell(value):
    """Display text for the preview -- the exporter's own rendering, so the old value shown is
    byte-identical to what the file the user edited contained."""
    return csv_exporter._cell(value)


def build_plan(discipline, raw):
    """READ-ONLY. The whole decision, computed from the file and the live catalog.

    Returns {discipline, mode, encoding, row_count, columns, counts, errors, changes, digest}.
    Never writes, never commits, never throws on file content -- a file we cannot read comes back
    as `errors`, because a preview that raises tells the user less than a preview that explains.
    """
    discipline = (discipline or "").strip()
    if not discipline:
        frappe.throw("discipline is required to read a rate-master CSV.")

    text, encoding = decode_csv_bytes(raw)
    headers, data_rows = parse_csv_text(text)
    attr_ids, rate_keys, attr_types, kind_cat = column_spaces(discipline)
    spec, errors = classify_columns(headers, attr_ids, rate_keys)

    active = frappe.get_all(
        ITEM_DOCTYPE,
        filters={"discipline": discipline, "active": 1},
        fields=["name", "item_uid", "kind", "brand", "unit", "attributes", "rates",
                "source_sheet", "source_row"],
    )
    by_uid = {}
    for r in active:
        uid = (r["item_uid"] or "").strip()
        if uid:
            by_uid.setdefault(uid, []).append(r)

    plan = {
        "discipline": discipline,
        "mode": spec["mode"],
        "encoding": encoding,
        "row_count": len(data_rows),
        "columns": {
            "attributes": sorted(spec["attributes"]),
            "rates": sorted(spec["rates"]),
            "fixed": sorted(spec["fixed"]),
        },
        "errors": errors,
        "changes": [],
        "counts": {"rates_changed": 0, "items_added": 0, "unchanged": 0,
                   "other_changed": 0, "errors": 0},
        "digest": "",
    }
    if errors:
        # A header we cannot place makes every cell position meaningless -- reading the rows anyway
        # would produce a page of derived nonsense on top of the one real problem.
        plan["counts"]["errors"] = len(errors)
        plan["digest"] = _digest(discipline, plan)
        return plan

    ui, ki = spec["fixed"]["item_uid"], spec["fixed"]["kind"]
    seen_uids = {}
    width = len(headers)

    def cell(cells, idx):
        return cells[idx] if idx < len(cells) else ""

    for rownum, cells in data_rows:
        if not any((c or "").strip() for c in cells):
            continue  # a wholly blank line (Excel loves adding one) is not a row
        if len(cells) > width:
            errors.append({"row": rownum, "column": "", "message":
                           "Row %d has %d cells but the header has %d."
                           % (rownum, len(cells), width)})
            continue

        uid = (cell(cells, ui) or "").strip()
        kind = (cell(cells, ki) or "").strip()
        row_errors = []

        existing = None
        if uid:
            if uid in seen_uids:
                row_errors.append("item_uid '%s' appears twice (rows %d and %d)."
                                  % (uid, seen_uids[uid], rownum))
            seen_uids[uid] = rownum
            matches = by_uid.get(uid) or []
            if not matches:
                # ⚠️ NOT an insert. A uid the catalog does not carry means a stale file or a
                # hand-typed id, and quietly adding it would mint a duplicate of a real item.
                row_errors.append(
                    "Unknown item_uid '%s' -- no active item carries it. The file may be out of "
                    "date, or the id was edited by hand." % uid)
            elif len(matches) > 1:
                row_errors.append(
                    "item_uid '%s' matches %d active items -- the catalog is ambiguous."
                    % (uid, len(matches)))
            else:
                existing = matches[0]
        if not kind:
            row_errors.append("'kind' is required.")

        # Build the payload that WOULD be stored.
        stored = _stored_payload(existing) if existing else None
        attributes, rates = ({}, {})
        if stored:
            attributes = dict(stored["attributes"])
            rates = dict(stored["rates"])

        for name, idx in spec["attributes"].items():
            raw_text = cell(cells, idx)
            # ⚠️ EXACTLY empty counts as blank here -- a whitespace-only cell is stored verbatim and
            # therefore SHOWS as a change. That asymmetry with rates (which strip before parsing) is
            # deliberate: whitespace cannot alter a number, but it can alter a catalog match key,
            # so the one place it could do damage is the one place it must stay visible.
            if raw_text == "":
                # blank cell -- "empty or absent"
                if stored is not None and name in attributes and not _blankish(attributes[name]):
                    attributes.pop(name)           # a real value was cleared
                elif stored is None:
                    attributes.pop(name, None)     # a new row declares only what it has
                # already empty-or-absent -> leave EXACTLY as stored (no spurious change)
                continue
            value, err = coerce_attribute(raw_text, attr_types.get(name))
            if err:
                row_errors.append("%s: %s" % (name, err))
            else:
                attributes[name] = value

        for name, idx in spec["rates"].items():
            raw_text = cell(cells, idx)
            if (raw_text or "").strip() == "":
                if stored is not None and name in rates:
                    if not _blankish(rates[name]):
                        rates[name] = None         # a real rate was cleared -> the null convention
                elif stored is None:
                    rates.pop(name, None)
                continue
            value, err = coerce_rate(raw_text, name)
            if err:
                row_errors.append(err)
            else:
                rates[name] = value

        # material / insulation -> canonical UPPERCASE, exactly as every other write path does.
        # Applied BEFORE the comparison, so the preview shows the value that will actually land.
        attributes = loader._canonicalize_attributes(attributes)

        # MODE B: the `category` column is DERIVED from the kind and is never stored, so a value
        # disagreeing with the kind's real category is refused rather than silently discarded.
        ci = spec["fixed"].get(_CATEGORY)
        if ci is not None and kind:
            declared = (cell(cells, ci) or "").strip()
            real = kind_cat.get(kind)
            if declared and real and declared != real:
                row_errors.append(
                    "category '%s' does not match kind '%s', which belongs to '%s'. An item's "
                    "category comes from its kind and is never stored." % (declared, kind, real))

        src_sheet, src_row = _source_from(cells, spec, rownum, stored)
        if isinstance(src_row, str):
            row_errors.append(src_row)
            src_row = None

        if row_errors:
            for m in row_errors:
                errors.append({"row": rownum, "column": "", "message": m})
            continue

        new_payload = {
            "kind": kind,
            "brand": _opt(cell(cells, spec["fixed"].get("brand"))) if "brand" in spec["fixed"]
            else (stored["brand"] if stored else None),
            "unit": _opt(cell(cells, spec["fixed"].get("unit"))) if "unit" in spec["fixed"]
            else (stored["unit"] if stored else None),
            "attributes": attributes,
            "rates": rates,
            "source_sheet": src_sheet,
            "source_row": src_row,
        }

        if stored is not None and _canon(new_payload) == _canon(stored):
            plan["counts"]["unchanged"] += 1
            continue

        fields, rate_major = _diff_fields(stored, new_payload, spec)
        change = {
            "row": rownum,
            "kind": "add" if stored is None else "update",
            "item_uid": uid or None,
            "name": existing["name"] if existing else None,
            "label": _label(new_payload),
            "major": stored is None or rate_major,
            "fields": fields,
            # The payload apply_plan writes. It rides the plan so the apply can NEVER derive a
            # different item from the same file than the preview described -- one computation, two
            # readers. The preview endpoint strips it before the client sees it (see `public_plan`).
            "_payload": new_payload,
        }
        plan["changes"].append(change)
        if stored is None:
            plan["counts"]["items_added"] += 1
        elif any(f["space"] == "rate" for f in fields):
            plan["counts"]["rates_changed"] += 1
        else:
            plan["counts"]["other_changed"] += 1

    plan["counts"]["errors"] = len(errors)
    plan["digest"] = _digest(discipline, plan)
    return plan


def public_plan(plan):
    """The plan minus the internal `_payload` blobs -- what a client is shown. Stripping keeps the
    preview response proportional to the CHANGES rather than to the whole edited catalog, and the
    client has no use for the storage form: it renders old/new display text."""
    return {
        **plan,
        "changes": [{k: v for k, v in c.items() if not k.startswith("_")}
                    for c in plan["changes"]],
    }


def _opt(text):
    """A fixed text column: blank means NULL, which is what the exporter's `_cell(None)` emitted."""
    s = text if text is not None else ""
    return s if s != "" else None


def _source_from(cells, spec, rownum, stored):
    """(source_sheet, source_row) for a row, honouring the FILE so a round trip is faithful.

    A NEW row that leaves them blank gets honest provenance instead: 'CSV upload' and the file's own
    data-row number. `source_row` is emitted as an int by the exporter -- including 0, which is a
    real value on the 27 db_shell items -- so a non-integer here is an error, not a coercion."""
    si = spec["fixed"].get("source_sheet")
    ri = spec["fixed"].get("source_row")
    sheet = None
    if si is not None:
        sheet = _opt(cells[si] if si < len(cells) else "")
    elif stored:
        sheet = stored["source_sheet"]
    row_val = None
    if ri is not None:
        raw = (cells[ri] if ri < len(cells) else "") or ""
        raw = raw.strip()
        if raw != "":
            try:
                row_val = int(float(raw)) if float(raw) == int(float(raw)) else None
            except (TypeError, ValueError):
                row_val = None
            if row_val is None:
                return sheet, "source_row: '%s' is not a whole number." % raw
    elif stored:
        row_val = stored["source_row"]
    if stored is None:
        if sheet is None:
            sheet = DEFAULT_SOURCE_SHEET
        if row_val is None:
            row_val = rownum
    return sheet, row_val


def _label(payload):
    """A human handle for a row in the preview -- the catalog `item` when there is one, else the
    kind plus whatever attributes it carries. Never a document name; the user has never seen one."""
    attrs = payload.get("attributes") or {}
    for key in ("item", "description", "type", "size", "rating"):
        v = attrs.get(key)
        if isinstance(v, str) and v.strip():
            return "%s / %s" % (payload.get("kind") or "?", v.strip()[:90])
    bits = [str(v) for v in attrs.values() if v not in (None, "")]
    return "%s%s" % (payload.get("kind") or "?", (" / " + " ".join(bits[:4])) if bits else "")


def _diff_fields(stored, new_payload, spec):
    """(fields, any_major_rate). One entry per column that actually moved, with the exporter's own
    rendering on both sides so the 'old' text matches the file the user edited."""
    fields = []
    major = False
    old = stored or {"kind": None, "brand": None, "unit": None, "attributes": {}, "rates": {},
                     "source_sheet": None, "source_row": None}

    for key in ("kind", "brand", "unit", "source_sheet", "source_row"):
        if _canon(old.get(key)) != _canon(new_payload.get(key)):
            fields.append({"space": "fixed", "column": key,
                           "old": _cell(old.get(key)), "new": _cell(new_payload.get(key)),
                           "pct": None})

    for name in sorted(set(old["attributes"]) | set(new_payload["attributes"])):
        o, n = old["attributes"].get(name), new_payload["attributes"].get(name)
        if _canon(o) != _canon(n):
            fields.append({"space": "attribute", "column": name,
                           "old": _cell(o), "new": _cell(n), "pct": None})

    for name in sorted(set(old["rates"]) | set(new_payload["rates"])):
        o, n = old["rates"].get(name), new_payload["rates"].get(name)
        if _canon(o) == _canon(n):
            continue
        pct = _rate_change_pct(o, n)
        # ⚠️ An UNMEASURABLE move (a rate appearing, disappearing, or leaving zero) counts as major.
        # A percentage that cannot be computed is not the same as a change that does not matter.
        if pct is None or abs(pct) >= MAJOR_RATE_CHANGE_PCT:
            major = True
        fields.append({"space": "rate", "column": name,
                       "old": _cell(o), "new": _cell(n),
                       "pct": None if pct is None else round(pct, 2)})
    return fields, major


def _digest(discipline, plan):
    """A fingerprint of the decision AND of the catalog rows it was computed from.

    ⚠️ THIS IS THE ANSWER TO 'what if the DB moved between preview and apply'. The apply re-reads
    the live catalog and re-derives the plan; if any row the plan TOUCHES has changed underneath,
    the digest differs and the apply is refused with an instruction to preview again. Untouched rows
    are deliberately not in the fingerprint -- an unrelated edit elsewhere must not block a correct
    upload."""
    material = {
        "discipline": discipline,
        "errors": [e["message"] for e in plan["errors"]],
        "changes": [
            {"row": c["row"], "kind": c["kind"], "uid": c["item_uid"], "name": c["name"],
             "fields": [(f["column"], f["old"], f["new"]) for f in c["fields"]]}
            for c in plan["changes"]
        ],
    }
    blob = json.dumps(material, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


# ── apply ───────────────────────────────────────────────────────────────────────────────


def apply_plan(discipline, raw, expected_digest=None):
    """ALL-OR-NOTHING. Writes a snapshot, then supersedes and inserts. Does NOT commit.

    THE TRANSACTIONAL GUARANTEE IS POSTGRES', not a hand-rolled one: every statement below runs in
    the ONE transaction Frappe opens for the request, and nothing here commits. The caller commits
    once, at the end, after every write has succeeded; any exception -- ours or the database's --
    leaves the transaction uncommitted and Frappe rolls it back at request teardown. That is also
    why the SNAPSHOT rides the same transaction: it can never exist for an upload that did not
    land, and an upload can never land without it.

    ⚠️ THE SNAPSHOT IS THE ROLLBACK PATH and is taken BEFORE any write, so it captures the
    pre-upload catalog. An upload with no snapshot behind it is unrecoverable, which is why this is
    not optional. It is skipped in exactly one case -- a plan with nothing to apply -- because there
    is then nothing to roll back to, and writing one would evict a real snapshot from the keep-10.
    """
    plan = build_plan(discipline, raw)
    if plan["errors"]:
        first = plan["errors"][0]
        frappe.throw(
            "This file has %d problem(s) and NOTHING has been applied. First: %s%s"
            % (len(plan["errors"]),
               ("Row %d -- " % first["row"]) if first.get("row") else "",
               first["message"]),
            title="Upload refused",
        )
    if expected_digest and expected_digest != plan["digest"]:
        frappe.throw(
            "The catalog changed since this file was previewed, so the preview no longer describes "
            "what would happen. Preview the file again and re-confirm.",
            title="Preview out of date",
        )

    if not plan["changes"]:
        return {"applied": 0, "items_added": 0, "items_replaced": 0, "snapshot": None,
                "snapshot_version": None, "batch": None, "plan": plan}

    payload, text = exporter.export_asset_text(discipline)
    snapshot = exporter.write_snapshot(discipline, text, payload)

    batch = BATCH_PREFIX + frappe.generate_hash(length=12)
    superseded = [c["name"] for c in plan["changes"] if c["kind"] == "update"]
    if superseded:
        # ONE statement, like loader._deactivate_scope -- but scoped to the MATCHED NAMES, which is
        # precisely what leaves every absent item alone. No Version row is written, exactly as the
        # loader's supersede writes none; the inserted successor row and the snapshot above are the
        # audit trail, and the snapshot is the stronger of the two (it holds the whole pre-state).
        ph = ", ".join(["%s"] * len(superseded))
        frappe.db.sql(
            'UPDATE "tabBoQ Rate Master Item" SET active = 0 WHERE name IN (' + ph + ")",
            superseded,
        )

    existing_uids = {
        (r["item_uid"] or "").strip()
        for r in frappe.get_all(ITEM_DOCTYPE, filters={"discipline": discipline},
                                fields=["item_uid"])
    }
    added = replaced = 0
    for change in plan["changes"]:
        uid = change["item_uid"]
        if uid is None:
            uid = UID_PREFIX + frappe.generate_hash(length=UID_HEX_LEN)
            while uid in existing_uids:
                uid = UID_PREFIX + frappe.generate_hash(length=UID_HEX_LEN)
            existing_uids.add(uid)
            added += 1
        else:
            replaced += 1
        p = change["_payload"]
        frappe.get_doc({
            "doctype": ITEM_DOCTYPE,
            "discipline": discipline,
            "kind": p["kind"],
            "brand": p["brand"],
            "unit": p["unit"],
            "item_uid": uid,
            "attributes": json.dumps(p["attributes"]),
            "rates": json.dumps(p["rates"]),
            "source_sheet": p["source_sheet"],
            "source_row": p["source_row"],
            "import_batch": batch,
            "active": 1,
        }).insert(ignore_permissions=True)

    version = frappe.db.get_value(exporter.SNAPSHOT_DOCTYPE, snapshot, "version")
    return {
        "applied": len(plan["changes"]),
        "items_added": added,
        "items_replaced": replaced,
        "snapshot": snapshot,
        "snapshot_version": version,
        "batch": batch,
        "plan": plan,
    }
