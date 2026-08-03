# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Rate-master import loader (RM-1).

Reads the extracted rate-master JSON (items + per-category config), validates its shape,
normalizes attribute casing to CANONICAL UPPERCASE at ingest, and loads it into the two
committed doctypes -- BoQ Rate Master Item (one row per item) and BoQ Rate Category Config
(one row for the category). Every row loaded in one run carries ONE shared import_batch id
(prefix 'rmbulk-'), mirroring BoQ Category Truth Snapshot's gtbulk batch-provenance.

Provenance / idempotence model (freeze-and-supersede, never delete):
  - The discipline for every item is stamped from the payload's category_config.discipline
    (items in the source file carry no discipline of their own).
  - A re-run against EXISTING ACTIVE data for the same discipline REFUSES cleanly
    (frappe.ValidationError via frappe.throw) and writes NOTHING.
  - replace=True DEACTIVATES the prior active rows for that discipline (items) and for that
    (discipline, category_id) (config) -- active=0, rows retained -- then loads a fresh batch.
    Result: exactly the new batch is active, the old batch is inactive, no duplicate active rows.

Normalization (owner ruling 2026-07-28): material/insulation attribute values are uppercased
at ingest so messy future workbook exports self-clean at the boundary; ALL downstream matching
is EXACT on canonical values -- there is NO case-insensitive matching anywhere.

This is a service-side loader (like services/boq_category/harness/corpus_classify_and_label.py),
run out-of-band; RM-1 ships NO write endpoint.
"""

import json
import os

import frappe

ITEM_DOCTYPE = "BoQ Rate Master Item"
CONFIG_DOCTYPE = "BoQ Rate Category Config"

BATCH_PREFIX = "rmbulk-"
# Only these attribute keys are canonicalized to UPPERCASE at ingest (per normalization_rule).
NORMALIZE_ATTRS = ("material", "insulation")

DEFAULT_DATA_FILE = os.path.join(
    os.path.dirname(__file__), "data", "rate_master_wiring_cabling_v3.json"
)


def _load_payload(payload=None, path=None):
    """Return the parsed payload dict from an in-memory dict OR a JSON file path
    (defaults to the committed data asset)."""
    if payload is not None:
        return payload
    with open(path or DEFAULT_DATA_FILE, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _validate_payload(payload):
    """Light shape validation -- raise on anything structurally wrong. Does NOT assert
    data-specific counts (those are the caller's / test's concern)."""
    if not isinstance(payload, dict):
        frappe.throw("Rate-master payload must be a JSON object.")

    items = payload.get("items")
    if not isinstance(items, list) or not items:
        frappe.throw("Rate-master payload has no 'items' list.")
    for idx, it in enumerate(items):
        if not isinstance(it, dict):
            frappe.throw("items[%d] is not an object." % idx)
        if not (it.get("kind") or "").strip():
            frappe.throw("items[%d] is missing 'kind'." % idx)
        if not isinstance(it.get("attributes"), dict):
            frappe.throw("items[%d] is missing an 'attributes' object." % idx)
        if not isinstance(it.get("rates"), dict):
            frappe.throw("items[%d] is missing a 'rates' object." % idx)
        if not isinstance(it.get("source"), dict):
            frappe.throw("items[%d] is missing a 'source' object." % idx)

    cfg = payload.get("category_config")
    if not isinstance(cfg, dict):
        frappe.throw("Rate-master payload has no 'category_config' object.")
    if not (cfg.get("discipline") or "").strip():
        frappe.throw("category_config is missing 'discipline'.")
    if not (cfg.get("category_id") or "").strip():
        frappe.throw("category_config is missing 'category_id'.")
    if not isinstance(cfg.get("attribute_definitions"), list) or not cfg["attribute_definitions"]:
        frappe.throw("category_config is missing 'attribute_definitions'.")
    pipelines = cfg.get("pipelines")
    if not isinstance(pipelines, dict) or not pipelines:
        frappe.throw("category_config is missing 'pipelines'.")
    for pname, pl in pipelines.items():
        if not isinstance(pl, dict) or not isinstance(pl.get("steps"), list) or not pl["steps"]:
            frappe.throw("pipeline '%s' has no 'steps'." % pname)
    return payload


def _canonicalize_attributes(attributes):
    """Return a copy of the attributes dict with material/insulation uppercased. Non-string or
    absent values are left untouched (numbers stay numbers)."""
    out = dict(attributes)
    for key in NORMALIZE_ATTRS:
        val = out.get(key)
        if isinstance(val, str):
            out[key] = val.upper()
    return out


def _active_item_count(discipline):
    return frappe.db.count(ITEM_DOCTYPE, {"discipline": discipline, "active": 1})


def _deactivate_prior(discipline, category_id):
    """Freeze-and-supersede: set active=0 on the prior active items (discipline) and config
    (discipline, category_id). Returns (items_deactivated, configs_deactivated)."""
    n_items = _active_item_count(discipline)
    n_cfg = frappe.db.count(
        CONFIG_DOCTYPE, {"discipline": discipline, "category_id": category_id, "active": 1}
    )
    frappe.db.sql(
        'UPDATE "tabBoQ Rate Master Item" SET active = 0 WHERE discipline = %s AND active = 1',
        discipline,
    )
    frappe.db.sql(
        'UPDATE "tabBoQ Rate Category Config" SET active = 0 '
        "WHERE discipline = %s AND category_id = %s AND active = 1",
        (discipline, category_id),
    )
    return n_items, n_cfg


def load_rate_master(payload=None, path=None, replace=False):
    """Load the rate-master payload. Returns a summary dict on success; raises
    frappe.ValidationError on a non-replace re-run against existing active data.

    Summary keys: status, batch, discipline, category_id, cable/termination/<kind> counts
    (as `items_by_kind`), items_total, config_loaded (1), items_deactivated, configs_deactivated.
    """
    payload = _validate_payload(_load_payload(payload, path))
    cfg = payload["category_config"]
    discipline = cfg["discipline"].strip()
    category_id = cfg["category_id"].strip()

    existing_active = _active_item_count(discipline)
    if existing_active and not replace:
        frappe.throw(
            "Rate master already loaded for discipline '%s' (%d active items). "
            "Re-run with replace=True to supersede the prior batch."
            % (discipline, existing_active),
            title="Rate master already loaded",
        )

    items_deactivated = configs_deactivated = 0
    if replace:
        items_deactivated, configs_deactivated = _deactivate_prior(discipline, category_id)

    batch = BATCH_PREFIX + frappe.generate_hash(length=12)

    by_kind = {}
    for it in payload["items"]:
        kind = it["kind"].strip()
        attrs = _canonicalize_attributes(it["attributes"])
        src = it.get("source") or {}
        doc = frappe.get_doc(
            {
                "doctype": ITEM_DOCTYPE,
                "discipline": discipline,
                "kind": kind,
                "brand": it.get("brand"),
                "unit": it.get("unit"),
                "attributes": json.dumps(attrs),
                "rates": json.dumps(it["rates"]),
                "source_sheet": src.get("sheet"),
                "source_row": src.get("row"),
                "import_batch": batch,
                "active": 1,
            }
        )
        doc.insert(ignore_permissions=True)
        by_kind[kind] = by_kind.get(kind, 0) + 1

    cfg_doc = frappe.get_doc(
        {
            "doctype": CONFIG_DOCTYPE,
            "discipline": discipline,
            "category_id": category_id,
            "config": json.dumps(cfg),
            "source_workbook": payload.get("source_workbook"),
            "import_batch": batch,
            "active": 1,
        }
    )
    cfg_doc.insert(ignore_permissions=True)

    frappe.db.commit()

    return {
        "status": "loaded",
        "batch": batch,
        "discipline": discipline,
        "category_id": category_id,
        "items_by_kind": by_kind,
        "items_total": sum(by_kind.values()),
        "config_loaded": 1,
        "items_deactivated": items_deactivated,
        "configs_deactivated": configs_deactivated,
    }
