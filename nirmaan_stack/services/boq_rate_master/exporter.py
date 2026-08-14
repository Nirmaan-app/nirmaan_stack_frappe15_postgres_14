# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Serialise the LIVE catalog into a loader-ready asset -- the DB is the source of truth.

The asset is now BOOTSTRAP-AND-SNAPSHOT only. This module is what keeps a re-import safe: run the
export and the file provably matches the database, so a load can only replay what is already there.

⭐ THE GOVERNING INVARIANT: CONFIG BLOBS ARE EMITTED VERBATIM.
Never enumerate config keys, never rebuild a config from known fields, never filter. Measured: no
two configs share a key set (`db_switchgear` carries 13 keys, `junction_box_raceway` 6, and
`wiring_cabling` uniquely carries `discipline`); 15 keys have NO screen control and 8 of those reach
the AI prompt. A fixed-schema export would silently drop the 21st key the day someone adds one --
and `_validate_config`'s allowlist has already had to be widened six times, so that day comes. The
same reasoning applies to each item's `attributes` and `rates`: opaque keyed maps, emitted whole.

WHAT IS DELIBERATELY DROPPED (owner-ruled archaeology -- do NOT preserve, do NOT merge from the
previous file): `sha256_prefix`, `extracted_at`, `provenance`, `excluded_categories`, `slice_note`,
`merged_from`, and the `col` key on the 27 db_shell items' `source`.

WHAT IS NEVER EMITTED: `name`, `import_batch`, `creation`, `modified`, `owner`, `active`. Row
identity regenerates on every import by design; `item_uid` is the durable identity and IS emitted.

⚠️ RETIREMENT COMES FROM THE TABLE, NEVER A FILE HEADER. `retired_kinds` /
`retired_category_ids` are read through `retirement.get_retirement_lists` (slice 3). They were the
only two loader inputs consumed to drive behaviour and never persisted, which is exactly why an
export built from rows alone would have dropped them.

⚠️ `source_row`: ALWAYS EMITTED, INCLUDING 0. The 27 db_shell items hold `source_row = 0` in the
database, and 0 is what the database says. Omitting it to reproduce the old asset's absent `row`
would be the export inventing an absence -- and it would conflate a genuine row 0 with "no row",
which matters because `create_rate_master_item` deliberately stamps `source_row = 0` on every
manually created item. Emitting it always is also the option with no special case, so two exports
in a row are byte-identical for free.

⚠️ EXPECTED AND NOT A DEFECT: `loader._canonicalize_attributes` uppercases `material` /
`insulation` at ingest, so the database holds the canonical form and this export reproduces it.
export -> import -> export is therefore stable, but original -> import -> export is NOT
byte-faithful to an original that carried non-canonical casing.

PURE-ish: this module reads the database and returns a dict. It writes nothing, and it never touches
the filesystem or the repo -- a web request cannot write into the repo, and nothing here tries.
"""

import json

import frappe

from nirmaan_stack.services.boq_rate_master import retirement

ITEM_DOCTYPE = "BoQ Rate Master Item"
CONFIG_DOCTYPE = "BoQ Rate Category Config"

# The exact per-item key set `_load_multi` consumes, in this order.
# ⚠️ `source` is REQUIRED to be a dict on every item -- `_validate_items` throws otherwise.
ITEM_KEYS = ("kind", "brand", "unit", "attributes", "rates", "source", "item_uid")


def _parsed(value, default):
    """A JSON column comes back already hydrated from frappe.get_all, or as text. Tolerate both."""
    if value in (None, ""):
        return default
    if isinstance(value, (dict, list)):
        return value
    return json.loads(value)


def _item_payload(row):
    """One item, in the loader's shape. `attributes` and `rates` ride through WHOLE."""
    return {
        "kind": row["kind"],
        "brand": row["brand"],
        "unit": row["unit"],
        "attributes": _parsed(row["attributes"], {}),
        "rates": _parsed(row["rates"], {}),
        # `col` is deliberately absent -- owner-ruled archaeology, and the DB never stored it.
        "source": {"sheet": row["source_sheet"], "row": row["source_row"]},
        "item_uid": row["item_uid"],
    }


def build_asset(discipline):
    """The live catalog for one discipline, as a dict `loader._load_multi` consumes.

    Deterministic ordering (kind, then item_uid) and (category_id) so two exports of an unchanged
    database are byte-identical -- there is no timestamp, no batch id and no hash in the payload to
    make them differ.
    """
    discipline = (discipline or "").strip()
    if not discipline:
        frappe.throw("discipline is required to export the rate master.")

    item_rows = frappe.get_all(
        ITEM_DOCTYPE,
        filters={"discipline": discipline, "active": 1},
        fields=["kind", "brand", "unit", "attributes", "rates",
                "source_sheet", "source_row", "item_uid"],
        order_by="kind asc, item_uid asc",
    )
    items = [_item_payload(r) for r in item_rows]

    cfg_rows = frappe.get_all(
        CONFIG_DOCTYPE,
        filters={"discipline": discipline, "active": 1},
        fields=["category_id", "config", "source_workbook"],
        order_by="category_id asc",
    )

    # ⭐ VERBATIM. The stored blob is emitted as-is; nothing is enumerated, rebuilt or filtered.
    category_configs = [_parsed(c["config"], {}) for c in cfg_rows]

    # goldens: lifted from each blob into the top-level dict, which is where `_load_multi` treats
    # them as authoritative. The blob keeps its own copy untouched (verbatim), and the loader
    # overwrites it from here on the next import -- so the two can never disagree.
    goldens = {}
    for cfg in category_configs:
        cid = (cfg.get("category_id") or "").strip()
        if cid and cfg.get("goldens") is not None:
            goldens[cid] = cfg["goldens"]

    # One value in practice; the loader stamps it onto every config row from the payload.
    workbooks = [c["source_workbook"] for c in cfg_rows if c.get("source_workbook")]

    # ⚠️ FROM THE TABLE, never a file header.
    lists = retirement.get_retirement_lists(discipline)

    return {
        "discipline": discipline,
        "source_workbook": workbooks[0] if workbooks else None,
        "items": items,
        "category_configs": category_configs,
        "goldens": goldens,
        "retired_kinds": lists["retired_kinds"],
        "retired_category_ids": lists["retired_category_ids"],
        # F-19: the AUTHORED reasons, so the asset self-documents its own retirements. Both
        # sub-maps are emitted sorted by key (in get_retirement_lists), and a row with a blank
        # reason contributes nothing -- so a discipline with no reasons exports two empty maps.
        #
        # ⚠️ REASON ONLY -- NEVER `retired_at` / `retired_by` (F-19 R4). A timestamp in the payload
        # would break the two-consecutive-exports-are-byte-identical guarantee the moment two
        # exports straddled a new retirement, and `retired_by` records an actor the table never
        # observed. A reason is authored text: stable, and the half worth self-documenting.
        "retirement_reasons": lists["retirement_reasons"],
    }


def serialize_asset(payload):
    """THE single serialisation. Stable by construction: `indent=1`, `ensure_ascii=False`, and NO
    `sort_keys` -- key order comes from `build_asset`, which is deterministic, and re-sorting would
    reorder the verbatim config blobs. Two exports of an unchanged database are byte-identical."""
    return json.dumps(payload, indent=1, ensure_ascii=False) + "\n"


def export_asset_text(discipline):
    """Convenience: build + serialise in one call. Returns (payload_dict, text)."""
    payload = build_asset(discipline)
    return payload, serialize_asset(payload)


# ── snapshots ────────────────────────────────────────────────────────────────────────────
SNAPSHOT_DOCTYPE = "BoQ Rate Master Snapshot"

# ⚠️ OWNER-RULED: keep the newest 10 per discipline, pruned on write.
KEEP_SNAPSHOTS = 10


def _active_batch(discipline):
    """The import_batch the exported rows belong to -- the join back to the catalog rows this
    snapshot describes. None when the discipline holds no active rows, and None (not a guess) when
    somehow more than one batch is active."""
    rows = frappe.db.sql(
        'SELECT DISTINCT import_batch FROM "tabBoQ Rate Master Item" '
        "WHERE discipline = %s AND active = 1",
        discipline,
    )
    return rows[0][0] if len(rows) == 1 else None


def _prune_snapshots(discipline):
    """Delete snapshots beyond the newest KEEP_SNAPSHOTS for a discipline.

    Raw `frappe.db.delete`, NOT `frappe.delete_doc`, following the documented precedent in
    `api/pricing/workbook._prune_versions`: `delete_doc` hydrates the document, and hydrating a row
    carrying a very large serialised blob is pure waste even where it is safe. Returns the count
    deleted."""
    keep = frappe.get_all(
        SNAPSHOT_DOCTYPE,
        filters={"discipline": discipline},
        fields=["name"],
        order_by="version desc",
        limit=KEEP_SNAPSHOTS,
    )
    keep_names = [r["name"] for r in keep]
    doomed = frappe.get_all(
        SNAPSHOT_DOCTYPE,
        filters={"discipline": discipline, "name": ["not in", keep_names or [""]]},
        fields=["name"],
    )
    for r in doomed:
        frappe.db.delete(SNAPSHOT_DOCTYPE, {"name": r["name"]})
    return len(doomed)


def write_snapshot(discipline, text, payload):
    """Retain one export. Returns the snapshot's name.

    `version` is (max existing for this discipline) + 1 and is NEVER reused after a prune, so a
    version number identifies one snapshot for the life of the site even once its row is gone.

    Does NOT commit -- the caller owns the transaction.
    """
    last = frappe.db.sql(
        'SELECT max(version) FROM "tab%s" WHERE discipline = %%s' % SNAPSHOT_DOCTYPE, discipline
    )[0][0]
    doc = frappe.get_doc(
        {
            "doctype": SNAPSHOT_DOCTYPE,
            "discipline": discipline,
            "version": (last or 0) + 1,
            "payload": text,
            "taken_at": frappe.utils.now(),
            "taken_by": frappe.session.user,
            "import_batch": _active_batch(discipline),
            "item_count": len(payload.get("items") or []),
            "config_count": len(payload.get("category_configs") or []),
        }
    )
    doc.insert(ignore_permissions=True)
    _prune_snapshots(discipline)
    return doc.name
