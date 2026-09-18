# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""What caused each skip, for the Skipped popup's Skip Type hover (owner, 2026-09-17).

`skip_sources(rows, related)` returns, per SKIPPED row on a page, the document behind its skip:

  * `earlier_import` -- Already imported: the earlier statement that holds this transfer;
  * `earlier_line`   -- Repeated in same file: the earlier line of this statement that holds it;
  * `records`        -- Outflow / Inflow Already Recorded: the records already on the books, each
                        with the facts a reviewer checks (amount, status, date, party, reference);
  * `rule`           -- a bank-rule kind: what that rule catches, in plain words.

Bank refused, No amount and Skipped by hand need nothing extra: the row already carries the bank's
status and the person, reason and date.

⚠️ DERIVED AT READ, NOT STORED, AND THROUGH THE SAME LOOKUPS THE SKIP WAS DECIDED WITH. The earlier
import comes from `candidates.prior_import_sightings` + `duplicates.find_prior_sighting`, the pair
both upload paths use; the earlier line from `duplicates.row_identity`; the records from the SAME
`related_records` the popup already links. A second, simpler rule here would one day point at a
different document than the one that actually caused the skip.

⚠️ DISPLAY ONLY. Nothing here decides anything. A document that cannot be found (a deleted batch, a
renamed record) yields no entry, and the hover falls back to the reason sentence.

Read-only: no writes, no commit.
"""

from __future__ import annotations

from collections import defaultdict

import frappe
from frappe.utils import getdate

from nirmaan_stack.services.outflow_import.candidates import prior_import_sightings
from nirmaan_stack.services.outflow_import.duplicates import find_prior_sighting, row_identity
from nirmaan_stack.services.outflow_import.normalize import normalize_amount
from nirmaan_stack.services.outflow_import.skip_kinds import (
    SKIP_KIND_ALREADY_IMPORTED,
    SKIP_KIND_INFLOW_RECORDED,
    SKIP_KIND_OUTFLOW_RECORDED,
    SKIP_KIND_REPEATED_IN_FILE,
    SKIP_KIND_RULE_DESCRIPTIONS,
)
from nirmaan_stack.services.outflow_import.status import ROW_SKIPPED

__all__ = ["skip_sources"]

ROW_DOCTYPE = "Outflow Import Row"
BATCH_DOCTYPE = "Outflow Import Batch"
_EXPENSE_DOCTYPES = ("Project Expenses", "Non Project Expenses")
_RECORDED_KINDS = (SKIP_KIND_OUTFLOW_RECORDED, SKIP_KIND_INFLOW_RECORDED)

# Per ledger: the column that carries each fact the hover shows; a fact the ledger lacks is absent.
# `party` is (link column, linked doctype, label column on that doctype).
_RECORD_FACTS = {
    "Project Payments": dict(
        party=("vendor", "Vendors", "vendor_name"), project="project", reference="utr", status="status"
    ),
    "Project Expenses": dict(
        party=("vendor", "Vendors", "vendor_name"), project="projects", reference="payment_ref",
        status="status", description="description",
    ),
    "Non Project Expenses": dict(reference="payment_ref", status="status", description="description"),
    "Project Inflows": dict(
        party=("customer", "Customers", "company_name"), project="project", reference="utr"
    ),
    "Non Project Inflows": dict(reference="utr", description="description"),
}


def _date(value):
    try:
        return getdate(value) if value else None
    except Exception:
        return None


def skip_sources(rows: list[dict], related: dict[str, list]) -> dict[str, dict]:
    """`{row name: {earlier_import, earlier_line, records, rule}}` for every Skipped row in `rows`."""
    skipped = [r for r in rows if (r.get("row_status") or "") == ROW_SKIPPED]
    if not skipped:
        return {}
    out = {
        r["name"]: {"earlier_import": None, "earlier_line": None, "records": [], "rule": None}
        for r in skipped
    }

    for row in skipped:
        out[row["name"]]["rule"] = SKIP_KIND_RULE_DESCRIPTIONS.get(row.get("skip_kind") or "")

    _fill_earlier_imports(
        [r for r in skipped if r.get("skip_kind") == SKIP_KIND_ALREADY_IMPORTED], out
    )
    _fill_earlier_lines([r for r in skipped if r.get("skip_kind") == SKIP_KIND_REPEATED_IN_FILE], out)
    _fill_records([r for r in skipped if r.get("skip_kind") in _RECORDED_KINDS], related, out)
    return out


def _fill_earlier_imports(rows: list[dict], out: dict) -> None:
    """The earliest OTHER statement holding each transfer -- the lookup the upload decided with."""
    by_batch: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        if row.get("transfer_id"):
            by_batch[row["import_batch"]].append(row)

    found: dict[str, str] = {}
    for batch, members in by_batch.items():
        index = prior_import_sightings(
            sorted({r["transfer_id"] for r in members}), exclude_batch=batch
        )
        for row in members:
            earlier = find_prior_sighting(
                index, row["transfer_id"], normalize_amount(row.get("amount")), _date(row.get("added_on"))
            )
            if earlier:
                found[row["name"]] = earlier
    if not found:
        return

    meta = {
        b["name"]: b
        for b in frappe.get_all(
            BATCH_DOCTYPE,
            filters={"name": ["in", sorted(set(found.values()))]},
            fields=["name", "original_filename", "source", "uploaded_by", "uploaded_at", "period_from",
                    "period_to"],
        )
    }
    for row_name, batch in found.items():
        b = meta.get(batch)
        if b:
            out[row_name]["earlier_import"] = {
                "name": b["name"],
                "filename": b.get("original_filename") or "",
                "source": b.get("source") or "",
                "uploaded_by": b.get("uploaded_by") or "",
                "uploaded_at": str(b["uploaded_at"]) if b.get("uploaded_at") else None,
                "period_from": str(b["period_from"]) if b.get("period_from") else None,
                "period_to": str(b["period_to"]) if b.get("period_to") else None,
            }


def _identity(row: dict):
    return row_identity(
        row.get("transfer_id") or "",
        normalize_amount(row.get("amount")),
        _date(row.get("added_on")),
        source=row.get("source") or "",
        direction=row.get("direction") or "",
        remarks=row.get("remarks") or "",
    )


def _fill_earlier_lines(rows: list[dict], out: dict) -> None:
    """The first line of the SAME statement with the same identity -- staged before this one.

    Staging inserts rows in file order and the row name is a sequence, so "earlier in the file" is the
    lowest name among the lines sharing the identity.
    """
    by_batch: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        if row.get("transfer_id"):
            by_batch[row["import_batch"]].append(row)

    for batch, members in by_batch.items():
        siblings = frappe.get_all(
            ROW_DOCTYPE,
            filters={"import_batch": batch, "transfer_id": ["in", sorted({r["transfer_id"] for r in members})]},
            fields=["name", "transfer_id", "amount", "added_on", "source", "direction", "remarks",
                    "row_status", "bank_reference_no"],
            order_by="name asc",
        )
        first_by_identity: dict = {}
        for sibling in siblings:
            first_by_identity.setdefault(_identity(sibling), sibling)
        for row in members:
            first = first_by_identity.get(_identity(row))
            if first and first["name"] != row["name"]:
                out[row["name"]]["earlier_line"] = {
                    "name": first["name"],
                    "added_on": str(first["added_on"]) if first.get("added_on") else None,
                    "amount": float(first.get("amount") or 0),
                    "reference": first.get("bank_reference_no") or first.get("transfer_id") or "",
                    "row_status": first.get("row_status") or "",
                }


def _fill_records(rows: list[dict], related: dict[str, list], out: dict) -> None:
    """The records already on the books. `related_records` for a matched source; for Cashbook ("Already
    booked as ..."), the expense carrying this wallet transfer id -- the triple `_already_booked` keys on."""
    wanted: dict[str, list[tuple[str, str]]] = {}
    cashbook: list[dict] = []
    for row in rows:
        pairs = [(r["target_doctype"], r["target_name"]) for r in related.get(row["name"], [])]
        if pairs:
            wanted[row["name"]] = pairs
        elif row.get("transfer_id"):
            cashbook.append(row)

    if cashbook:
        ids = sorted({r["transfer_id"] for r in cashbook})
        for doctype in _EXPENSE_DOCTYPES:
            booked = frappe.get_all(
                doctype,
                filters={"payment_ref": ["in", ids]},
                fields=["name", "payment_ref", "amount"],
                order_by="creation asc",
            )
            for row in cashbook:
                amount = normalize_amount(row.get("amount"))
                hit = next(
                    (
                        b for b in booked
                        if (b.get("payment_ref") or "").strip() == row["transfer_id"]
                        and normalize_amount(b.get("amount")) == amount
                    ),
                    None,
                )
                if hit and row["name"] not in wanted:
                    wanted[row["name"]] = [(doctype, hit["name"])]

    details = _record_details({pair for pairs in wanted.values() for pair in pairs})
    for row_name, pairs in wanted.items():
        out[row_name]["records"] = [details[pair] for pair in pairs if pair in details]


def _record_details(pairs: set[tuple[str, str]]) -> dict[tuple[str, str], dict]:
    by_doctype: dict[str, list[str]] = defaultdict(list)
    for doctype, name in pairs:
        if doctype in _RECORD_FACTS:
            by_doctype[doctype].append(name)

    details: dict[tuple[str, str], dict] = {}
    parties: dict[tuple[str, str], str] = {}
    projects: set[str] = set()
    raw: list[tuple[str, dict]] = []
    for doctype, names in by_doctype.items():
        facts = _RECORD_FACTS[doctype]
        fields = ["name", "amount", "payment_date"]
        for key in ("reference", "status", "description", "project"):
            if facts.get(key):
                fields.append(facts[key])
        if facts.get("party"):
            fields.append(facts["party"][0])
        for record in frappe.get_all(doctype, filters={"name": ["in", sorted(set(names))]}, fields=fields):
            raw.append((doctype, record))
            if facts.get("party") and record.get(facts["party"][0]):
                parties[(facts["party"][1], record[facts["party"][0]])] = ""
            if facts.get("project") and record.get(facts["project"]):
                projects.add(record[facts["project"]])

    labels = _party_labels(parties)
    project_names = {
        p["name"]: p.get("project_name") or p["name"]
        for p in (
            frappe.get_all("Projects", filters={"name": ["in", sorted(projects)]}, fields=["name", "project_name"])
            if projects
            else []
        )
    }

    for doctype, record in raw:
        facts = _RECORD_FACTS[doctype]
        party = None
        if facts.get("party") and record.get(facts["party"][0]):
            party = labels.get((facts["party"][1], record[facts["party"][0]])) or record[facts["party"][0]]
        project = record.get(facts["project"]) if facts.get("project") else None
        details[(doctype, record["name"])] = {
            "doctype": doctype,
            "name": record["name"],
            "amount": float(record.get("amount") or 0),
            "date": str(record["payment_date"]) if record.get("payment_date") else None,
            "status": record.get(facts["status"]) if facts.get("status") else None,
            "party": party,
            "project": project_names.get(project, project) if project else None,
            "reference": (record.get(facts["reference"]) or "").strip() if facts.get("reference") else "",
            "description": (record.get(facts["description"]) or "").strip() if facts.get("description") else "",
        }
    return details


def _party_labels(parties: dict[tuple[str, str], str]) -> dict[tuple[str, str], str]:
    names_by_doctype: dict[str, set[str]] = defaultdict(set)
    for doctype, name in parties:
        names_by_doctype[doctype].add(name)
    label_field = {
        facts["party"][1]: facts["party"][2] for facts in _RECORD_FACTS.values() if facts.get("party")
    }
    labels = {}
    for doctype, names in names_by_doctype.items():
        field = label_field[doctype]
        for p in frappe.get_all(doctype, filters={"name": ["in", sorted(names)]}, fields=["name", field]):
            labels[(doctype, p["name"])] = p.get(field) or p["name"]
    return labels
