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

from nirmaan_stack.services.boq_rate_master import csv_exporter, exporter, freeze, loader, spec_reader, xlsx_io

ITEM_DOCTYPE = "BoQ Rate Master Item"
CONFIG_DOCTYPE = "BoQ Rate Category Config"

# The uid form slice 2 fixed: `rmi-` + 12 lowercase hex. Named here rather than imported from the
# one-off backfill script, which is a maintenance script and not an importable module.
UID_PREFIX = "rmi-"
UID_HEX_LEN = 12

# One shared batch per apply, mirroring the loader's one-batch-per-run provenance and the module's
# existing `rmbulk-` / `manual-` prefixes.
BATCH_PREFIX = "csvup-"


def mint_item_uid(discipline, taken=None):
    """SLICE 1g (owner Z-a) -- THE ONE uid mint. `rmi-` + 12 lowercase hex, unique among EVERY row of
    the discipline (active and inactive: a retired row keeps its uid, and a successor row re-uses its
    predecessor's, so uniqueness is checked against all of them). `taken` is the caller's set of uids
    already known (the apply passes its own so a batch never mints the same uid twice); the minted uid
    is added to it. The manual create endpoint and the upload apply both mint here -- never inline."""
    if taken is None:
        taken = {
            (r["item_uid"] or "").strip()
            for r in frappe.get_all(ITEM_DOCTYPE, filters={"discipline": discipline}, fields=["item_uid"])
        }
    uid = UID_PREFIX + frappe.generate_hash(length=UID_HEX_LEN)
    while uid in taken:
        uid = UID_PREFIX + frappe.generate_hash(length=UID_HEX_LEN)
    taken.add(uid)
    return uid
# SLICE 1e: the provenance the SYSTEM stamps on a new row -- a file no longer carries source columns
# (owner X-b), so this is the one value a row added by upload can have. Stored, never downloaded.
DEFAULT_SOURCE_SHEET = "Rate master upload"

# A rate change AT OR ABOVE this, IN EITHER DIRECTION, is expanded by default in the preview.
# ⚠️ BOTH directions matter and the reason is asymmetric only in how it hurts: ₹26,100 typed for
# ₹2,610 is invisible in a count, and ₹261 for ₹2,610 quotes catastrophically low.
# ⚠️ "AT OR ABOVE" IS INCLUSIVE AND THE COMPARISON MUST BE ROUNDED (F-21) -- see `_diff_fields`.
MAJOR_RATE_CHANGE_PCT = 10.0

_LEAD = set(csv_exporter.LEAD_COLUMNS)          # item_uid, kind, brand, unit (kind OPTIONAL since 1e)
_TAIL = set(csv_exporter.TAIL_COLUMNS)          # source_sheet, source_row -- SYSTEM columns: IGNORED since 1e
_CATEGORY = csv_exporter.CATEGORY_COLUMN        # `category` -- in EVERY file since 1g (Mode B's marker before)
_DISCIPLINE = csv_exporter.DISCIPLINE_COLUMN    # `discipline` -- in every file since 1g (owner Z-c)
FORMAT_XLSX = csv_exporter.FORMAT_XLSX
FORMAT_CSV = csv_exporter.FORMAT_CSV

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


def read_upload(raw):
    """SLICE 1e -- ONE reader for BOTH formats: (headers, data_rows, encoding, format).

    Detection is by CONTENT (an .xlsx is a zip: `PK\\x03\\x04`), never by file name, so a workbook
    saved under a .csv name and a csv under any name both read. An .xlsx yields the rows exactly as
    `parse_csv_text` would have -- text as is, numbers as their str(), a date as ISO text so it
    SURFACES -- and from there the two formats share EVERY step: the same column classification,
    the same preview, the same spec reader, the same digest, the same apply. A zip that is not a
    workbook is reported as such rather than raised."""
    if xlsx_io.is_xlsx(raw):
        try:
            headers, data_rows = xlsx_io.read_xlsx(raw)
        except Exception as exc:  # noqa: BLE001 -- surfaced to the plan as one named error
            return None, str(exc), FORMAT_XLSX, FORMAT_XLSX
        return headers, data_rows, FORMAT_XLSX, FORMAT_XLSX
    text, encoding = decode_csv_bytes(raw)
    headers, data_rows = parse_csv_text(text)
    return headers, data_rows, encoding, FORMAT_CSV


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


def _category_kinds(discipline):
    """SLICE 1e: {category_id: [kinds]} for one discipline -- what fills `kind` on a new row of a
    single-kind category, and what names the kinds when a multi-kind row leaves it blank."""
    out = {}
    for c in frappe.get_all(CONFIG_DOCTYPE,
                            filters={"discipline": discipline, "active": 1},
                            fields=["category_id", "config"], order_by="category_id asc"):
        cfg = c["config"] if isinstance(c["config"], dict) else json.loads(c["config"] or "{}")
        out[c["category_id"]] = list(csv_exporter._config_kinds(cfg))
    return out


def _spec_owned_columns(discipline, spec_cats):
    """SLICE 1c: {category_id: the attribute ids the SPEC READER owns} for every opted-in category --
    its declared definitions minus the two text keys, plus the two reserved flag keys. A NON-blank
    cell in one of these columns on an opted-in row is refused (S-c 3: no back door); a blank one is
    ignored, never a clearing. Empty for a discipline with no opted-in category."""
    owned = {}
    if not spec_cats:
        return owned
    wanted = set(spec_cats.values())
    for c in frappe.get_all(CONFIG_DOCTYPE,
                            filters={"discipline": discipline, "active": 1},
                            fields=["category_id", "config"]):
        if c["category_id"] not in wanted:
            continue
        cfg = c["config"] if isinstance(c["config"], dict) else json.loads(c["config"] or "{}")
        owned[c["category_id"]] = set(spec_reader.derived_attr_ids(cfg)) | set(spec_reader.RESERVED_ATTRS)
    return owned


def classify_columns(headers, attr_ids, rate_keys):
    """PURE. (spec, errors) -- which column index carries what.

    spec = {"attributes": {name: idx}, "rates": {name: idx}, "fixed": {name: idx}, "mode": ...}

    THE MODE IS DECIDED BY THE FILE'S VALUES (SLICE 1g), not by the presence of the `category`
    column -- every file carries it now. `build_plan` calls the upload "all" when the rows name (or
    belong to) more than one category and "category" otherwise. ⚠️ THE MODE IS INFORMATIONAL: items
    carry no category of their own -- a category is derived from an item's `kind` -- so the upsert
    is uid-keyed and MODE-INDEPENDENT. The same rows in either shape produce the same result.

    A header that is neither fixed, nor a known attribute, nor a known rate is an ERROR: a column
    nobody can place is a file we cannot read, and guessing is how a typo becomes a new attribute.

    SLICE 1e (owner X-b / X-d / X-e): the SYSTEM columns (`source_sheet`, `source_row`) are no longer
    written and, when an OLD file still carries them, are classified `ignored` -- never an error,
    never read. `kind` is no longer REQUIRED: a 1e file carries it only for a multi-kind category;
    `build_plan` fills it from the category otherwise. `item_uid` stays mandatory.
    """
    errors = []
    spec = {"attributes": {}, "rates": {}, "fixed": {}, "ignored": {}, "mode": "category"}
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
        if name in (_CATEGORY, _DISCIPLINE):
            spec["fixed"][name] = idx          # SLICE 1g: self-describing columns, checked in build_plan
        elif name in _TAIL:
            spec["ignored"][name] = idx            # a system column from an old file: read past, never applied
        elif name in _LEAD:
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
                       "The file has no 'item_uid' column. Download the file again -- without it an "
                       "edit cannot be told from a new item."})
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


# ── SLICE 1f: same-meaning duplicates ──────────────────────────────────────────────────
#
# Owner rulings (quoted): Y-a "for the duplicate cases a warning should be shown that the old record
# will itself be updated if the user confirms. if the user declines no change should be made."; Y-b
# declining skips only that row, two identical new rows in one file are refused, an edit that turns an
# item into a twin of another gets the same warning; Y-c "same item" means SAME MEANING -- identical
# attributes (for the same unit), whatever the exact words; Y-d on confirm the existing item KEEPS ITS
# OWN WORDING, only its rates and markups are updated; Y-e on an edit the OTHER item takes the rates
# and the edited item stays exactly as it was; Y-f on for HVAC AND Electrical.
#
# THE IDENTITY (`twin_identity`) is the one definition every path shares -- the upload preview, the
# upload apply (which re-derives it), the manual add and the manual edit. A category that reads its
# attributes from the spec (HVAC) compares the DERIVED attributes, unit and brand -- the wording is
# deliberately NOT in it, that is the whole point; an item whose spec is not understood has no
# meaning to compare and never counts; a confirmed (1d) item counts like a read one. Any other
# category (Electrical) compares kind, brand, unit and EVERY attribute: two items differing only in
# brand are NOT twins. Inactive items never count, and the index is keyed by uid so an item shared by
# two categories under ONE uid is one item, never its own twin.
#
# WHEN IT FIRES: a NEW row (blank uid) whose identity matches an active item, or an EDIT whose
# identity CHANGED into another active item's. It never fires for a rates-only edit or an unchanged
# row, even when the item already has a twin today -- an unchanged re-upload stays zero changes, zero
# warnings (pinned for every Electrical file and the HVAC file).
#
# NOTHING IS DECIDED HERE. The preview carries the warning (`change["twin"]`) with both wordings,
# both sets of numbers and a FINGERPRINT of the target; the apply re-derives the target and refuses a
# confirm whose fingerprint is not the one previewed (the target differs, or changed since). A row the
# user CONFIRMS becomes an UPDATE of the existing item -- its uid, wording, attributes and spec
# status untouched, only the rates and markups the row carries; a DECLINED row is skipped; an
# UNANSWERED one refuses the whole apply (two outcomes, never a silent third). Two new rows that are
# twins of each other are an ERROR naming both rows (Y-b 2).

TWIN_CONFIRM = "confirm"
TWIN_DECLINE = "decline"


def _twin_value(v):
    """Numbers compare as floats (a typed 2 and a stored 2.0 mean the same); everything else verbatim."""
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, dict):
        return {k: _twin_value(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_twin_value(x) for x in v]
    return v


def twin_identity(kind, brand, unit, attributes, spec_cat=None):
    """The MEANING of an item as a canonical string, or None when it has none to compare.

    spec category (HVAC): kind + brand + unit + the DERIVED attributes (text and flag keys stripped);
    a not-understood spec -> None. Other categories: kind + brand + unit + every attribute. A blank
    attribute value contributes nothing (a new row declares only what it has; a stored "" means the
    same). Brand and unit: None and "" are the same absence."""
    attributes = attributes or {}
    if spec_cat:
        if attributes.get(spec_reader.SPEC_STATUS_ATTR) == spec_reader.NOT_UNDERSTOOD:
            return None
        attrs = {k: v for k, v in attributes.items()
                 if k not in spec_reader.TEXT_ATTRS and k not in spec_reader.RESERVED_ATTRS}
    else:
        attrs = dict(attributes)
    attrs = {k: v for k, v in attrs.items() if not _blankish(v)}
    return json.dumps([(kind or "").strip(), (brand or "").strip(), (unit or "").strip(), _twin_value(attrs)],
                      sort_keys=True, default=str)


def _twin_key(row):
    """One entry per ITEM: the uid, or -- for an item that has none (a manual entry, which has never been
    given a uid) -- its document name. An item shared by two categories under one uid is ONE entry."""
    uid = (row.get("item_uid") or "").strip()
    return uid or ("doc:" + (row.get("name") or ""))


def twin_index(active_rows, spec_cats):
    """{identity: {item key: row}} over ACTIVE rows (see `_twin_key`)."""
    idx = {}
    for r in active_rows:
        uid = _twin_key(r)
        if uid == "doc:":
            continue
        attrs = r["attributes"] if isinstance(r["attributes"], dict) else json.loads(r["attributes"] or "{}")
        ident = twin_identity(r["kind"], r["brand"], r["unit"], attrs, spec_cats.get(r["kind"]))
        if ident is None:
            continue
        idx.setdefault(ident, {})[uid] = r
    return idx


def twin_wording(kind, brand, unit, attributes, spec_cat, attr_order=None):
    """The item in its own words, for the warning. A spec category shows `item_name / item_detail`;
    any other shows its identifying fields as the file shows them -- kind, brand, unit, then every
    non-blank attribute in the given column order (the file's), else sorted."""
    attributes = attributes or {}
    if spec_cat:
        name, detail = spec_reader.text_of(attributes)
        return " / ".join(t for t in (name.strip(), detail.strip()) if t)
    bits = []
    for label, v in (("kind", kind), ("brand", brand), ("unit", unit)):
        if not _blankish(v):
            bits.append("%s=%s" % (label, v))
    order = [k for k in (attr_order or []) if k in attributes] + sorted(k for k in attributes if k not in (attr_order or []))
    for k in order:
        if not _blankish(attributes.get(k)):
            bits.append("%s=%s" % (k, _cell(attributes[k])))
    return ", ".join(bits)


def twin_compared(attributes, spec_cat):
    """Which fields the meaning was compared on (for the warning): the derived attribute ids for a spec
    category, else kind, brand, unit and every attribute key."""
    attributes = attributes or {}
    if spec_cat:
        return sorted(k for k in attributes if k not in spec_reader.TEXT_ATTRS and k not in spec_reader.RESERVED_ATTRS)
    return ["kind", "brand", "unit"] + sorted(attributes)


def twin_fingerprint(target, ident):
    """What the apply re-verifies: the target's uid, its document, its identity and its rates. Any of
    them moving between preview and apply changes it, and the confirm is refused."""
    rates = target["rates"] if isinstance(target["rates"], dict) else json.loads(target["rates"] or "{}")
    blob = "|".join([(target.get("item_uid") or ""), (target.get("name") or ""), ident, _canon(rates)])
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:24]


def merge_rates(target_rates, row_rates):
    """The confirmed write: the target's rate map with every NON-blank rate the row carries set on it.
    A blank in the row is 'I have no value', never a clearing -- the row was typed as a new item."""
    out = dict(target_rates or {})
    for k, v in (row_rates or {}).items():
        if v is not None:
            out[k] = v
    return out


def twin_block(case, target, ident, row_kind, row_brand, row_unit, row_attributes, row_rates, spec_cat,
               attr_order=None, edited_uid=None):
    """The warning's payload for one row / one form entry. PUBLIC (no underscore) -- it rides the plan
    to the client, which renders it verbatim."""
    t_attrs = target["attributes"] if isinstance(target["attributes"], dict) else json.loads(target["attributes"] or "{}")
    t_rates = target["rates"] if isinstance(target["rates"], dict) else json.loads(target["rates"] or "{}")
    return {
        "case": case,
        "item_uid": (target.get("item_uid") or "").strip(),
        "name": target.get("name"),
        "existing_wording": twin_wording(target["kind"], target["brand"], target["unit"], t_attrs, spec_cat, attr_order),
        "row_wording": twin_wording(row_kind, row_brand, row_unit, row_attributes, spec_cat, attr_order),
        "existing_rates": {k: _cell(v) for k, v in sorted(t_rates.items())},
        "row_rates": {k: _cell(v) for k, v in sorted((row_rates or {}).items())},
        "compared": twin_compared(row_attributes, spec_cat),
        "fingerprint": twin_fingerprint(target, ident),
        "decision": None,
        "edited_item_uid": edited_uid,
    }


def find_active_twin(discipline, kind, brand, unit, attributes, exclude_uid=None, exclude_name=None):
    """THE MANUAL ENDPOINTS' finder (the upload builds its own index once per plan from the same
    functions). Returns (target_row | None, identity, ambiguous_keys). `ambiguous_keys` is non-empty
    when MORE than one active item already carries the meaning -- the caller refuses rather than pick.
    `exclude_name` / `exclude_uid` leave the item being edited out (it is never its own twin)."""
    spec_cats = spec_reader.spec_categories(discipline)
    spec_cat = spec_cats.get((kind or "").strip())
    ident = twin_identity(kind, brand, unit, attributes, spec_cat)
    if ident is None:
        return None, None, []
    rows = frappe.get_all(ITEM_DOCTYPE,
                          filters={"discipline": discipline, "active": 1, "kind": (kind or "").strip()},
                          fields=["name", "item_uid", "kind", "brand", "unit", "attributes", "rates"])
    cands = {u: r for u, r in twin_index(rows, spec_cats).get(ident, {}).items()
             if not (exclude_uid and u == exclude_uid) and not (exclude_name and r.get("name") == exclude_name)}
    if not cands:
        return None, ident, []
    if len(cands) > 1:
        return None, ident, sorted(cands)
    return next(iter(cands.values())), ident, []


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


def _now_iso():
    return frappe.utils.now_datetime().replace(microsecond=0).isoformat()


def build_plan(discipline, raw, decisions=None, category_id=None, twin_decisions=None):
    """READ-ONLY. The whole decision, computed from the file and the live catalog.

    Returns {discipline, mode, format, encoding, row_count, columns, counts, errors, changes, digest}.
    Never writes, never commits, never throws on file content -- a file we cannot read comes back
    as `errors`, because a preview that raises tells the user less than a preview that explains.

    SLICE 1e: `raw` may be an .xlsx or a csv (detected by content; ONE pipeline after `read_upload`).
    `category_id` is an optional HINT for typing a NEW row when the file carries no `kind` column and
    no `category` column: it is used ONLY when the file's own existing rows cannot say (a headers-only
    template) -- a file's matched rows always win over the hint, so a Mode A file for category X
    uploaded while viewing category Y still types its new rows as X.

    SLICE 1d: `decisions` = {"<data row number>": "accept" | "reject"} -- the user's answers to the
    per-row question the preview asked for a spec the exact read refused. ABSENT (the preview) means
    every such row is planned as not_understood, exactly as 1c; "accept" plans the SUGGESTED attributes
    with spec_status "confirmed" (who + when); "reject" is not_understood. An accept for a row that has
    no suggestion is a row ERROR, never a silent no-op.

    SLICE 1f: `twin_decisions` = {"<data row number>": "confirm" | "decline"} -- the answers to the
    duplicate warning. ABSENT (the preview): a row that means the same as an active item is planned as
    the file says (an add, or the edit) and carries `change["twin"]`; "confirm" re-plans it as an UPDATE
    of the existing item's rates (its wording, attributes, uid and spec status untouched); "decline"
    drops the row. Two new rows that mean the same as each other are an ERROR (owner Y-b 2).

    SLICE 1g (owner Z-c / Z-d): every file carries `discipline` and `category`. A non-blank discipline
    must equal THIS discipline; a non-blank category must be one of its categories; when the file's rows
    name ONE category it must equal the page's `category_id` (when given) -- a single-category upload;
    when they name several it is an all-categories upload. An EXISTING item's category cell must be its
    real category (an item is never moved by editing the cell). A NEW row with a blank category takes
    the one category the file's rows agree on; disagreeing rows refuse it; a file with NO discipline /
    category value at all is typed as before (matched rows, the page hint, the only category) and the
    plan says so. The plan carries `target` = {discipline, category, mode, from_page} for the banner.
    A pre-1g file WITHOUT these columns uploads exactly as before.
    """
    discipline = (discipline or "").strip()
    if not discipline:
        frappe.throw("discipline is required to read a rate-master CSV.")
    decisions = {str(k): v for k, v in (decisions or {}).items()}
    twin_decisions = {str(k): v for k, v in (twin_decisions or {}).items()}

    headers, data_rows, encoding, fmt = read_upload(raw)
    if headers is None:
        # an unreadable workbook: ONE named error, the same shape as a header problem
        attr_ids, rate_keys, attr_types, kind_cat = set(), set(), {}, {}
        spec = {"attributes": {}, "rates": {}, "fixed": {}, "ignored": {}, "mode": "category"}
        errors = [{"row": 0, "column": "", "message":
                   "The file could not be read as an Excel workbook: %s" % data_rows}]
        headers, data_rows = [], []
    else:
        attr_ids, rate_keys, attr_types, kind_cat = column_spaces(discipline)
        spec, errors = classify_columns(headers, attr_ids, rate_keys)
        # SLICE 1g (owner Z-c): a file that SAYS it is another discipline's is refused by its rows -- "the file
        # says X but this page is Y" -- BEFORE the column check, whose "unknown column" errors would otherwise
        # bury the real reason (an HVAC file has no Electrical column at all).
        if _DISCIPLINE in headers:
            dix = headers.index(_DISCIPLINE)
            foreign = []
            for rownum, cells in data_rows:
                v = (cells[dix] if dix < len(cells) else "") or ""
                if v.strip() and v.strip() != discipline:
                    foreign.append({"row": rownum, "column": _DISCIPLINE, "message":
                                    "the file says discipline '%s' but this page is '%s' -- upload the file on "
                                    "its own discipline's page, or fix the cell." % (v.strip(), discipline)})
            if foreign:
                errors = foreign
    cat_kinds = _category_kinds(discipline) if not errors else {}
    # SLICE 1c: the opted-in categories ({kind: category_id}; {} for Electrical) and the columns the
    # reader owns for each. Resolved ONCE per plan, never per row.
    spec_cats = spec_reader.spec_categories(discipline)
    spec_owned = _spec_owned_columns(discipline, spec_cats)

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
    # SLICE 1f: the meaning of every active item, ONCE per plan (keyed by uid inside, so a shared item is one).
    twin_idx = twin_index(active, spec_cats)
    in_file_identities = {}      # identity -> [rows] over the rows whose identity is NEW or CHANGED (Y-b 2)

    plan = {
        "discipline": discipline,
        "mode": spec["mode"],
        "format": fmt,
        "encoding": encoding,
        "row_count": len(data_rows),
        "columns": {
            "attributes": sorted(spec["attributes"]),
            "rates": sorted(spec["rates"]),
            "fixed": sorted(spec["fixed"]),
            "ignored": sorted(spec["ignored"]),
        },
        "errors": errors,
        "changes": [],
        "counts": {"rates_changed": 0, "items_added": 0, "unchanged": 0,
                   "other_changed": 0, "errors": 0, "twins": 0, "twins_declined": 0},
        "digest": "",
    }
    if errors:
        # A header we cannot place makes every cell position meaningless -- reading the rows anyway
        # would produce a page of derived nonsense on top of the one real problem.
        plan["counts"]["errors"] = len(errors)
        plan["digest"] = _digest(discipline, plan)
        return plan

    ui, ki = spec["fixed"]["item_uid"], spec["fixed"].get("kind")
    ci_cat = spec["fixed"].get(_CATEGORY)
    di_disc = spec["fixed"].get(_DISCIPLINE)
    seen_uids = {}
    width = len(headers)

    def cell(cells, idx):
        return cells[idx] if idx < len(cells) else ""

    # SLICE 1e: the category a Mode A file is FOR, read from its own matched rows (the kinds of every
    # uid the file names, mapped to their categories). ONE answer means every new row without a kind
    # is typed from it; the caller's `category_id` hint is consulted only when the file has no matched
    # rows to say (a headers-only template). Never guessed from attribute values.
    file_cats = set()
    for _r, cells in data_rows:
        u = (cell(cells, ui) or "").strip()
        m = by_uid.get(u) if u else None
        if m and len(m) == 1:
            c = kind_cat.get(m[0]["kind"])
            if c:
                file_cats.add(c)
    # SLICE 1g: what the file SAYS -- every non-blank discipline / category cell, over every row.
    declared_cats, declared_discs = set(), set()
    for _r, cells in data_rows:
        if not any((c or "").strip() for c in cells):
            continue
        if ci_cat is not None and (cell(cells, ci_cat) or "").strip():
            declared_cats.add(cell(cells, ci_cat).strip())
        if di_disc is not None and (cell(cells, di_disc) or "").strip():
            declared_discs.add(cell(cells, di_disc).strip())
    file_says = bool(declared_cats or declared_discs)
    # every category a kind belongs to -- a kind two configs claim (switch_socket_item, pre-existing) belongs
    # to both, so a row of either category's file names a real category of the item
    kind_cats_all = {}
    for _cat, _ks in cat_kinds.items():
        for _k in _ks:
            kind_cats_all.setdefault(_k, set()).add(_cat)
    # a single-category upload names ONE category (declared, else the matched rows'); several -> "all"
    named_cats = declared_cats or file_cats
    upload_all = len(named_cats) > 1
    file_cat = next(iter(named_cats)) if len(named_cats) == 1 else None
    if file_cat is None and not named_cats and category_id in cat_kinds:
        file_cat = category_id
    if file_cat is None and not named_cats and len(cat_kinds) == 1:
        # a discipline with ONE category (HVAC today): every row is that category's, no hint needed
        file_cat = next(iter(cat_kinds))
    plan["target"] = {
        "discipline": discipline,
        "category": None if upload_all else file_cat,
        "mode": "all" if upload_all else "category",
        # owner Z-d: no row carried a discipline / category value -- the page (or the file's own
        # matched rows) decided, and the banner says so
        "from_page": not file_says,
    }
    plan["mode"] = plan["target"]["mode"]

    def kind_for_new_row(cells):
        """(kind, error) for a NEW row whose kind cell is blank or absent (owner X-d)."""
        cat = ((cell(cells, ci_cat) or "").strip() if ci_cat is not None else "") or file_cat
        if not cat and len(declared_cats) > 1:
            # SLICE 1g: the file's rows name several categories, so a blank cell cannot be filled from them
            return None, ("category is required for this new row -- the file's rows name more than one "
                          "category (%s), so a blank cell cannot be filled from them. Fill the category cell."
                          % ", ".join(sorted(declared_cats)))
        if not cat:
            return None, ("'kind' is required -- this file has no kind column and the row's category "
                          "could not be determined. Upload the file downloaded for its category, or add "
                          "a 'kind' column.")
        kinds = cat_kinds.get(cat)
        if kinds is None:
            return None, "category '%s' is not a category of this discipline." % cat
        if len(kinds) == 1:
            return kinds[0], None
        return None, ("'kind' is required for a new %s row -- this category has more than one item kind "
                      "(%s). Fill the kind column for this row." % (cat, ", ".join(kinds)))

    for rownum, cells in data_rows:
        if not any((c or "").strip() for c in cells):
            continue  # a wholly blank line (Excel loves adding one) is not a row
        if len(cells) > width:
            errors.append({"row": rownum, "column": "", "message":
                           "Row %d has %d cells but the header has %d."
                           % (rownum, len(cells), width)})
            continue

        uid = (cell(cells, ui) or "").strip()
        kind = (cell(cells, ki) or "").strip() if ki is not None else ""
        row_errors = []

        # ══════════════════════════════════════════════════════════════════════════════════
        # SLICE 1g (owner Z-c) -- the file must describe THIS page. A wrong discipline, a category that
        # is not this discipline's, or a single-category file naming a category other than the page's
        # is refused NAMING the row and saying what the file says versus the page.
        # ══════════════════════════════════════════════════════════════════════════════════
        # (a wrong DISCIPLINE never reaches this loop: the pre-scan above refuses the whole file by its rows)
        row_cat = (cell(cells, ci_cat) or "").strip() if ci_cat is not None else ""
        if row_cat and row_cat not in cat_kinds:
            row_errors.append(
                "the file says category '%s', which is not a category of %s (%s)."
                % (row_cat, discipline, ", ".join(sorted(cat_kinds))))
        elif row_cat and not upload_all and category_id in cat_kinds and row_cat != category_id:
            row_errors.append(
                "the file says category '%s' but this page is on '%s' -- upload the file on its own "
                "category's page, or fix the cell." % (row_cat, category_id))

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
                # SLICE 1g (owner Z-c): an existing item is never MOVED by editing these cells
                real_cats = kind_cats_all.get(existing["kind"], set())
                if row_cat and real_cats and row_cat in cat_kinds and row_cat not in real_cats:
                    row_errors.append(
                        "item '%s' belongs to category '%s'; the file says '%s' -- an item cannot be moved "
                        "to another category by editing these cells." % (uid, " / ".join(sorted(real_cats)), row_cat))
        if not kind:
            # SLICE 1e: the file carries no kind for this row. An EXISTING item keeps its own; a NEW row
            # is typed from its category (one kind) or refused by a message naming the kinds (several).
            if existing is not None:
                kind = existing["kind"]
            else:
                kind, kind_err = kind_for_new_row(cells)
                if kind_err:
                    row_errors.append(kind_err)
                kind = kind or ""

        # Build the payload that WOULD be stored.
        stored = _stored_payload(existing) if existing else None
        attributes, rates = ({}, {})
        if stored:
            attributes = dict(stored["attributes"])
            rates = dict(stored["rates"])

        spec_cat = spec_cats.get(kind) if kind else None
        spec_info = None
        if spec_cat:
            # ══════════════════════════════════════════════════════════════════════════════════
            # SLICE 1c -- an opted-in category: ITEM NAME + ITEM DETAIL ARE THE SOURCE OF TRUTH.
            # ══════════════════════════════════════════════════════════════════════════════════
            # Missing derived columns are EXPECTED (the export omits them). A NON-blank cell in a
            # derived (or reserved flag) column is refused by name -- attributes are never hand-edited
            # (S-c 3). A new row, or a row whose item_name / item_detail / unit changed, is READ by the
            # spec reader; an unchanged row keeps its attributes EXACTLY as stored. The preview carries
            # what the reader understood, or why it could not, and the apply writes exactly that
            # (the payload rides the plan). A not-understood spec is NOT an error: the row is saved
            # with the flag (D4) and shown as "won't price: spec not understood".
            owned = spec_owned.get(spec_cat, set())
            for name, idx in spec["attributes"].items():
                if name in spec_reader.TEXT_ATTRS:
                    continue
                if name in owned and (cell(cells, idx) or "") != "":
                    row_errors.append(
                        "%s: the attributes of %s are read from Item and Item detail and cannot be typed "
                        "in -- leave this column blank (or remove it) and change the text instead."
                        % (name, spec_cat))
            old_name, old_detail = spec_reader.text_of(stored["attributes"]) if stored else ("", "")
            ni = spec["attributes"].get("item_name")
            di = spec["attributes"].get("item_detail")
            new_name = cell(cells, ni) if ni is not None else old_name
            new_detail = cell(cells, di) if di is not None else old_detail
            new_unit = (_opt(cell(cells, spec["fixed"]["unit"])) if "unit" in spec["fixed"]
                        else (stored["unit"] if stored else None))
            text_changed = stored is None or (new_name, new_detail, new_unit) != (old_name, old_detail, stored["unit"])
            if stored is None and not (new_name or "").strip():
                row_errors.append(
                    "item_name is required for a new %s row -- its attributes are read from it." % spec_cat)
            elif text_changed and not spec_reader.has_reader(spec_cat):
                row_errors.append(
                    "category %s declares attributes_from_spec but no spec reader exists for it." % spec_cat)
            elif text_changed:
                attributes, reason = spec_reader.attributes_for(spec_cat, new_name, new_detail, new_unit)
                spec_info = {
                    "status": spec_reader.NOT_UNDERSTOOD if reason else "ok",
                    "reason": reason,
                    # SLICE 1d: the text the verdict is about, so the preview can quote BOTH halves on an
                    # existing item too (only the CHANGED half is in `fields`; found live at the cert).
                    "text": {"item_name": new_name, "item_detail": new_detail},
                    "read": {k: v for k, v in attributes.items()
                             if k not in spec_reader.TEXT_ATTRS and k not in spec_reader.RESERVED_ATTRS},
                }
                if reason:
                    # ══════════════════════════════════════════════════════════════════════════
                    # SLICE 1d -- the exact read refused: offer the BEST MATCH, store it only on an
                    # explicit ACCEPT (owner T-a / T-b). The preview (no decisions) shows the suggestion
                    # or why there is none and plans the row as not_understood, exactly as 1c; the apply
                    # re-derives the suggestion and checks its fingerprint against the one the preview
                    # showed (apply_plan). "reject" / undecided -> not_understood.
                    # ══════════════════════════════════════════════════════════════════════════
                    sugg, why = spec_reader.suggest_spec(spec_cat, new_name, new_detail, new_unit)
                    decision = decisions.get(str(rownum))
                    spec_info["suggestion"] = ({
                        "attributes": sugg["attributes"],
                        "label": spec_reader.suggestion_label(sugg["attributes"]),
                        "notes": sugg["notes"],
                        "fingerprint": sugg["fingerprint"],
                    } if sugg else None)
                    spec_info["no_suggestion_reason"] = None if sugg else why
                    spec_info["decision"] = decision
                    if decision == "accept":
                        if not sugg:
                            row_errors.append(
                                "Row %d was accepted, but it has no suggestion to accept -- %s" % (rownum, why))
                        else:
                            attributes = spec_reader.confirmed_attributes(
                                new_name, new_detail, sugg["attributes"], frappe.session.user, _now_iso())
                            spec_info["status"] = spec_reader.CONFIRMED
                            spec_info["read"] = dict(sugg["attributes"])
                    elif decision not in (None, "reject"):
                        row_errors.append("Row %d: decision '%s' is neither accept nor reject." % (rownum, decision))
            # else: text and unit unchanged -> the stored attributes stand, untouched (a CONFIRMED row is
            # therefore never asked again while its wording stands -- E5)
        else:
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
        if ci is not None and kind and stored is None:      # SLICE 1g: an existing row is judged above
            declared = (cell(cells, ci) or "").strip()
            real = kind_cat.get(kind)
            if declared and real and declared != real:
                row_errors.append(
                    "category '%s' does not match kind '%s', which belongs to '%s'. An item's "
                    "category comes from its kind and is never stored." % (declared, kind, real))

        # SLICE 1e: provenance is the SYSTEM'S -- an existing row keeps what it has, a new row is stamped;
        # a source column in an old file is never read (owner X-b / X-e).
        src_sheet, src_row = _source_for(stored, rownum)

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

        # ══════════════════════════════════════════════════════════════════════════════════
        # SLICE 1f -- does this row MEAN THE SAME as an existing item? Only a NEW row, or an edit
        # whose identity CHANGED, is checked (a rates-only edit never is). The identity is taken from
        # the attributes that WOULD be stored; for a spec row the reader could not read but has a
        # suggestion for, from the suggestion -- so the warning is on the preview a user sees, and an
        # accept + confirm at apply lands on the same target (same derived attributes, same identity).
        # ══════════════════════════════════════════════════════════════════════════════════
        twin_info = None
        twin_target = None
        twin_attrs = attributes
        if (spec_cat and spec_reader.is_not_understood(attributes) and spec_info
                and spec_info.get("suggestion") and spec_info.get("decision") is None):
            # UNDECIDED only: a rejected suggestion stores a not-understood item, which has no meaning.
            twin_attrs = {"item_name": new_name, "item_detail": new_detail, **spec_info["suggestion"]["attributes"]}
        ident_new = twin_identity(kind, new_payload["brand"], new_payload["unit"], twin_attrs, spec_cat)
        ident_old = (twin_identity(stored["kind"], stored["brand"], stored["unit"], stored["attributes"], spec_cat)
                     if stored is not None else None)
        if ident_new is not None and (stored is None or ident_new != ident_old):
            in_file_identities.setdefault(ident_new, []).append(rownum)
            cands = {u: r for u, r in twin_idx.get(ident_new, {}).items() if not (uid and u == uid)}
            if len(cands) > 1:
                errors.append({"row": rownum, "column": "", "message":
                               "Row %d means the same as %d existing items (%s) -- the catalog already holds "
                               "twins; resolve those first." % (rownum, len(cands), ", ".join(sorted(cands)))})
                continue
            if cands:
                twin_target = next(iter(cands.values()))
                twin_info = twin_block("edit" if stored is not None else "new", twin_target, ident_new,
                                       kind, new_payload["brand"], new_payload["unit"], twin_attrs, rates, spec_cat,
                                       attr_order=[n for n, _i in sorted(spec["attributes"].items(), key=lambda x: x[1])],
                                       edited_uid=uid or None)
                plan["counts"]["twins"] += 1
                decision = twin_decisions.get(str(rownum))
                twin_info["decision"] = decision
                if decision == TWIN_DECLINE:
                    plan["counts"]["twins_declined"] += 1
                    continue                                    # skipped: nothing for this row (Y-a, Y-b 1)
                if decision == TWIN_CONFIRM:
                    # THE EXISTING ITEM takes the row's rates and markups and NOTHING else (Y-d / Y-e): its
                    # uid, wording, attributes, spec status and provenance are its own. The edited item
                    # (edit case) gets no change at all.
                    t_stored = _stored_payload(twin_target)
                    t_payload = {**t_stored, "rates": merge_rates(t_stored["rates"], rates)}
                    if _canon(t_payload) == _canon(t_stored):
                        plan["counts"]["unchanged"] += 1
                        continue
                    t_fields, _t_major = _diff_fields(t_stored, t_payload, spec)
                    plan["changes"].append({
                        "row": rownum,
                        "kind": "update",
                        "item_uid": twin_info["item_uid"],
                        "name": twin_target["name"],
                        "label": _label(t_stored),
                        "major": True,
                        "fields": t_fields,
                        "_payload": t_payload,
                        "twin": twin_info,
                    })
                    plan["counts"]["rates_changed"] += 1
                    continue
                if decision is not None:
                    errors.append({"row": rownum, "column": "", "message":
                                   "Row %d: duplicate decision '%s' is neither confirm nor decline." % (rownum, decision)})
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
        if twin_info is not None:
            # SLICE 1f: the warning rides the change (undecided); shown in full, like a spec question.
            change["twin"] = twin_info
            change["major"] = True
        if spec_info is not None:
            # SLICE 1c: what the reader understood from the new / changed text, or why it could not.
            # PUBLIC (no underscore) -- this is the preview's U2 line.
            change["spec"] = spec_info
            # SLICE 1d: a row the reader must ASK about (a suggestion awaiting an answer) or FLAGS is
            # shown in full, whatever its rate movement -- the question box and the red reason render
            # only inside the expanded group, and "Accept all shown" acts on every suggestion in the
            # plan, so a collapsed question would be accepted unseen. Found live: a changed wording on
            # an EXISTING item is otherwise a "smaller change". An exact-reading wording change stays
            # where the rate rule puts it. The expansion rule lives HERE (owner-ruled), never client-side.
            if spec_info.get("status") != "ok":
                change["major"] = True
        plan["changes"].append(change)
        if stored is None:
            plan["counts"]["items_added"] += 1
        elif any(f["space"] == "rate" for f in fields):
            plan["counts"]["rates_changed"] += 1
        else:
            plan["counts"]["other_changed"] += 1

    # SLICE 1f (owner Y-b 2): two or more rows in THIS file that mean the same item -- refused, naming
    # the rows; the system cannot know which rate was meant. Only new / changed-identity rows are in
    # the registry, so two existing twins re-uploaded (unchanged, or rates only) never trip it.
    for ident, rows_ in in_file_identities.items():
        if len(rows_) > 1:
            errors.append({"row": rows_[0], "column": "", "message":
                           "Rows %s mean the same item -- remove one; the system cannot know which rate you meant."
                           % " and ".join(str(r) for r in rows_)})

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


def _source_for(stored, rownum):
    """(source_sheet, source_row) -- the SYSTEM's provenance (SLICE 1e, owner X-b). An existing item
    keeps exactly what it has; a new row is stamped `DEFAULT_SOURCE_SHEET` and the file's own data-row
    number. The file has no say: the two columns are no longer written, and an old file's copy of them
    is ignored (X-e)."""
    if stored is not None:
        return stored["source_sheet"], stored["source_row"]
    return DEFAULT_SOURCE_SHEET, rownum


def _label(payload):
    """A human handle for a row in the preview -- the catalog `item` when there is one, else the
    kind plus whatever attributes it carries. Never a document name; the user has never seen one."""
    attrs = payload.get("attributes") or {}
    for key in ("item_name", "item", "description", "type", "size", "rating"):
        v = attrs.get(key)
        if isinstance(v, str) and v.strip():
            return "%s / %s" % (payload.get("kind") or "?", v.strip()[:90])
    bits = [str(v) for v in attrs.values() if v not in (None, "")]
    return "%s%s" % (payload.get("kind") or "?", (" / " + " ".join(bits[:4])) if bits else "")


def _diff_fields(stored, new_payload, spec):
    """(fields, any_major_rate). One entry per column that actually moved, with the exporter's own
    rendering on both sides so the 'old' text matches the file the user edited.

    Each RATE-space field also carries its own `major` verdict (F-21). The change-level flag is
    simply "any rate field major" and still drives the preview's expand/collapse grouping."""
    fields = []
    major = False
    old = stored or {"kind": None, "brand": None, "unit": None, "attributes": {}, "rates": {},
                     "source_sheet": None, "source_row": None}

    # SLICE 1e: the source pair is system-owned and cannot move through a file, so it is not diffed
    # (a new row's stamp is not a "change" a user made).
    for key in ("kind", "brand", "unit"):
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
        #
        # F-21: ROUND BEFORE COMPARING. `(new - old) / abs(old) * 100` carries binary rounding
        # error, and `>=` turns that error into a wrong answer whenever the result lands a hair
        # SHORT: an exactly -10% edit computed -9.999999999999993 and was classified NOT major, so
        # the row folded away behind a count -- in the one direction that quotes LOW. It bit 60% of
        # integer rupee rates. Rounding to 6dp is far finer than any real rate move and far coarser
        # than float noise (~1e-14), and it is this module's own idiom: the same value is rounded
        # one line below for display. This is what makes the docstring's "AT OR ABOVE" promise true.
        field_major = pct is None or round(abs(pct), 6) >= MAJOR_RATE_CHANGE_PCT
        if field_major:
            major = True
        fields.append({"space": "rate", "column": name,
                       "old": _cell(o), "new": _cell(n),
                       "pct": None if pct is None else round(pct, 2),
                       # F-21 R2 -- ONE DEFINITION. The dialog used to decide its own colour from
                       # `Math.abs(f.pct) >= 10`, reading the ROUNDED percentage; at the boundary
                       # the two disagreed and a row rendered RED while sitting COLLAPSED. The
                       # verdict now travels WITH the field so the client renders it, never
                       # recomputes it. Rate-space fields only: a percentage -- and therefore this
                       # verdict -- is meaningless on a `kind` rename or an attribute edit.
                       "major": field_major})
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
             "fields": [(f["column"], f["old"], f["new"]) for f in c["fields"]],
             # SLICE 1f: a warning's target is part of what the user saw -- present ONLY on such a row,
             # so every other plan's digest is byte-identical to before.
             **({"twin": c["twin"]["fingerprint"]} if c.get("twin") else {})}
            for c in plan["changes"]
        ],
    }
    blob = json.dumps(material, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


# ── apply ───────────────────────────────────────────────────────────────────────────────


def apply_plan(discipline, raw, expected_digest=None, decisions=None, accepted_fingerprints=None,
               category_id=None, twin_decisions=None, twin_fingerprints=None):
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
    # ⚠️ THE DEPLOYMENT FREEZE, GUARDED HERE AND NOT ONLY AT THE ENDPOINT (slice RMF-1).
    # This function is the SECOND of the two write mechanisms that reach the rate master, and it
    # is the one that does NOT go through `doc.save`: it supersedes by RAW SQL and inserts fresh
    # documents. A guard placed only on the audited `doc.save` endpoints would therefore miss the
    # entire CSV upload -- the single largest-blast-radius write in the module, and the exact
    # shape of the 2026-08-18 incident this freeze exists to prevent.
    #
    # It sits FIRST, ahead of `build_plan`, so a frozen system reads nothing and writes nothing
    # (reject-mutates-nothing). `build_plan` is deliberately NOT guarded: `preview_rate_master_csv`
    # calls it, and the preview must keep working while frozen (owner ruling R3) -- previewing a
    # file is how you find out what the deploy will do.
    freeze.guard_not_frozen()
    # The DECISION-FREE plan is what the preview showed: its digest is the one the client holds.
    plan = build_plan(discipline, raw, category_id=category_id)
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
    if decisions or twin_decisions:
        # SLICE 1d: re-plan WITH the user's answers, then verify every ACCEPT against the fingerprint the
        # preview showed -- the suggestion is RE-DERIVED here, never trusted from the client, and an accept
        # whose suggestion differs (or that names a row with no suggestion) is refused before any write.
        # SLICE 1f: the duplicate answers ride the same re-plan; each CONFIRM's target is re-derived and
        # checked below.
        plan = build_plan(discipline, raw, decisions, category_id=category_id, twin_decisions=twin_decisions)
        if plan["errors"]:
            first = plan["errors"][0]
            frappe.throw(
                "This file has %d problem(s) and NOTHING has been applied. First: %s%s"
                % (len(plan["errors"]),
                   ("Row %d -- " % first["row"]) if first.get("row") else "",
                   first["message"]),
                title="Upload refused",
            )
        fps = {str(k): v for k, v in (accepted_fingerprints or {}).items()}
        for c in plan["changes"]:
            sp = c.get("spec") or {}
            if sp.get("decision") != "accept":
                continue
            shown = fps.get(str(c["row"]))
            actual = (sp.get("suggestion") or {}).get("fingerprint")
            if not shown or not actual or shown != actual:
                frappe.throw(
                    "Row %d: the suggestion is not the one that was previewed (or no fingerprint was sent), "
                    "so it cannot be applied. Preview the file again and re-confirm." % c["row"],
                    title="Suggestion out of date",
                )

    # SLICE 1f: every duplicate warning must be ANSWERED, and every CONFIRM must land on the target the
    # preview showed -- the target is re-derived from the live catalog here, never trusted from the
    # client; a target that differs, or whose rates / identity / document moved since, is refused before
    # any write. Two changes on one document (a confirm onto an item the file ALSO edits) are refused
    # too: one supersede per document per apply.
    tfps = {str(k): v for k, v in (twin_fingerprints or {}).items()}
    for c in plan["changes"]:
        tw = c.get("twin")
        if not tw:
            continue
        if tw.get("decision") is None:
            frappe.throw(
                "Row %d means the same as an existing item (%s) and the warning was not answered -- confirm "
                "or decline it and apply again. Nothing has been applied." % (c["row"], tw.get("item_uid")),
                title="Duplicate not answered",
            )
        if tw.get("decision") == TWIN_CONFIRM:
            shown = tfps.get(str(c["row"]))
            if not shown or shown != tw.get("fingerprint"):
                frappe.throw(
                    "Row %d: the existing item this row would update is not the one that was previewed, or "
                    "it changed since (or no fingerprint was sent). Preview the file again and re-confirm. "
                    "Nothing has been applied." % c["row"],
                    title="Duplicate target out of date",
                )
    seen_docs = {}
    for c in plan["changes"]:
        if c["kind"] == "update" and c.get("name"):
            if c["name"] in seen_docs:
                frappe.throw(
                    "Rows %d and %d both update the same existing item (%s) -- apply them one at a time. "
                    "Nothing has been applied." % (seen_docs[c["name"]], c["row"], c["item_uid"]),
                    title="One change per item",
                )
            seen_docs[c["name"]] = c["row"]

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
        uid = change["item_uid"] or None
        if uid is None:
            uid = mint_item_uid(discipline, existing_uids)
        # SLICE 1f: counted by what the change IS -- a confirmed duplicate whose existing item never had a
        # uid (a manual entry) is an update, and its successor is the first row of that item to carry one.
        if change["kind"] == "add":
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
