# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Fill Invoice Base Amount / Invoice GST Amount on invoices saved before the split existed,
then bring every Work Order's `gst_invoiced` back to source (ticket #1340, ADR-0030).

An invoice is filled ONLY when all of these hold:

  * both figures are blank. The columns are Currency, so Frappe created them NOT NULL
    DEFAULT 0 and "never entered" reads back as 0 / 0 -- the same convention
    `services/invoice_amounts.split_warnings` uses. Anything else was typed by a person
    and is never overwritten.
  * its saved AI extraction (`autofill_all_entities_json`) holds BOTH `net_amount` and
    `total_tax_amount`, each read at >= the confidence the upload form needs before it
    pre-fills a field (`invoice_autofill.MIN_CONFIDENCE`), and each a clean number.

Everything else stays blank and unlocks no GST until an Admin fills it in: no GST is guessed.
"Clean number" is strict on purpose. A currency sign, Indian digit grouping and a trailing
"/-" are stripped; a value such as "3,956 40" (a decimal point read as a space) is NOT a
number and leaves the invoice blank, where the upload form's looser normaliser would have
read it as 395640.

A credit note stores both figures negative, through the shared `invoice_amounts.signed`.

IDEMPOTENT. A filled invoice is no longer blank, so a re-run skips it; the Work Order pass
only touches a Work Order whose stored `gst_invoiced` differs from its source, so a re-run
writes nothing at all (not even `modified`).
"""

import json

import frappe
from frappe.utils import flt

from nirmaan_stack.api.invoice_autofill import MIN_CONFIDENCE
from nirmaan_stack.api.invoices._item_billing_sync import recompute_document_amount_invoiced
from nirmaan_stack.services.invoice_amounts import parse_figure, signed

_BASE_ENTITY = "net_amount"
_GST_ENTITY = "total_tax_amount"
_CURRENCY_PREFIXES = ("₹", "rs.", "rs", "inr")


def execute():
    result = backfill()
    frappe.db.commit()
    print(
        f"  Vendor Invoices: {result['filled']} filled from saved extraction, "
        f"{result['left_blank']} left blank; "
        f"Service Requests: {result['recomputed']} gst_invoiced recomputed"
    )


def backfill(invoices=None):
    """Fill the qualifying invoices and recompute the Work Orders whose GST Invoiced is stale.

    `invoices` scopes the whole run to those invoice names and the Work Orders they belong
    to -- for tests, which run on the live site and must never touch real rows. The patch
    passes nothing: every invoice, every Work Order. Does NOT commit.
    """
    fills, left_blank = planned_fills(invoices)

    for fill in fills:
        # ⚠️ RAW WRITE -- `set_value` fires no doc event, so the Vendor Invoices on_update
        # hook (`recompute_parent_total`) does not run and the Work Order's gst_invoiced is
        # NOT moved here. The recompute pass below does that explicitly. `modified` is left
        # alone on purpose: this is a backfill, not a user edit.
        frappe.db.set_value(
            "Vendor Invoices",
            fill["name"],
            {"invoice_base_amount": fill["base"], "invoice_gst_amount": fill["gst"]},
            update_modified=False,
        )

    work_orders = None
    if invoices is not None:
        work_orders = {
            row.document_name
            for row in frappe.get_all(
                "Vendor Invoices",
                filters={"name": ["in", list(invoices)], "document_type": "Service Requests"},
                fields=["document_name"],
            )
        }
    stale = stale_work_orders(work_orders)
    for work_order in stale:
        # The ONE recompute (#1339): gst_invoiced (and amount_invoiced / amount_due) from source.
        recompute_document_amount_invoiced("Service Requests", work_order)

    return {"filled": len(fills), "left_blank": left_blank, "recomputed": len(stale)}


def planned_fills(invoices=None):
    """(fills, left_blank) over the blank invoices. Reads only -- the measurement uses it too.

    fills: [{name, document_type, base, gst}], already signed for a credit note.
    left_blank: how many blank invoices had nothing clean to fill from.
    """
    scope = ""
    params = {}
    if invoices is not None:
        if not invoices:
            return [], 0
        scope = "AND name IN %(invoices)s"
        params["invoices"] = tuple(invoices)

    rows = frappe.db.sql(
        f"""
        SELECT name, document_type, is_credit_note, autofill_all_entities_json
          FROM "tabVendor Invoices"
         WHERE COALESCE(invoice_base_amount, 0) = 0
           AND COALESCE(invoice_gst_amount, 0) = 0
           {scope}
         ORDER BY name
        """,
        params,
        as_dict=True,
    )

    fills, left_blank = [], 0
    for row in rows:
        base, gst = entity_split(row.autofill_all_entities_json)
        if base is None or gst is None or (base == 0 and gst == 0):
            left_blank += 1
            continue
        credit = bool(row.is_credit_note)
        fills.append(
            {
                "name": row.name,
                "document_type": row.document_type,
                "base": signed(base, credit),
                "gst": signed(gst, credit),
            }
        )
    return fills, left_blank


def entity_split(entities_json):
    """(base, gst) read from a saved extraction, each None when not cleanly present."""
    try:
        entities = json.loads(entities_json) if entities_json else []
    except (TypeError, ValueError):
        return None, None
    if not isinstance(entities, list):
        return None, None
    return _entity_figure(entities, _BASE_ENTITY), _entity_figure(entities, _GST_ENTITY)


def _entity_figure(entities, entity_type):
    """The highest-confidence reading of `entity_type`, if confident enough and a clean number."""
    best, best_conf = None, -1.0
    for entity in entities:
        if not isinstance(entity, dict) or (entity.get("type") or "").strip() != entity_type:
            continue
        conf = flt(entity.get("confidence"))
        if conf > best_conf:
            best, best_conf = entity.get("value"), conf
    if best is None or best_conf < MIN_CONFIDENCE:
        return None
    return parse_figure(_strip_currency(best))


def _strip_currency(value):
    if not isinstance(value, str):
        return value
    text = value.strip()
    lowered = text.lower()
    for prefix in _CURRENCY_PREFIXES:
        if lowered.startswith(prefix):
            text = text[len(prefix):].strip()
            break
    if text.endswith("/-"):
        text = text[:-2].strip()
    return text


def stale_work_orders(work_orders=None):
    """Work Orders whose stored gst_invoiced differs from SUM(invoice_gst_amount) over their
    Approved invoices -- the set `recompute_document_amount_invoiced` reads. A read only: every
    write goes through that one recompute. Selecting just the stale ones keeps a re-run from
    stamping `modified` on hundreds of Work Orders that did not move."""
    scope = ""
    params = {}
    if work_orders is not None:
        if not work_orders:
            return []
        scope = "AND sr.name IN %(work_orders)s"
        params["work_orders"] = tuple(work_orders)

    return frappe.db.sql_list(
        f"""
        SELECT sr.name
          FROM "tabService Requests" sr
          LEFT JOIN (
                SELECT document_name, SUM(COALESCE(invoice_gst_amount, 0)) AS gst
                  FROM "tabVendor Invoices"
                 WHERE document_type = 'Service Requests'
                   AND status = 'Approved'
                 GROUP BY document_name
               ) src ON src.document_name = sr.name
         WHERE COALESCE(sr.gst_invoiced, 0) <> COALESCE(src.gst, 0)
           {scope}
         ORDER BY sr.name
        """,
        params,
    )
