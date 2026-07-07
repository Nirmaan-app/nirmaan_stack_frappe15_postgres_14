# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Freeze-and-supersede persistence for the BoQ Row Category overlay (Classifier CL-1a).

Replicates pricing.py's _annot_* freeze-and-supersede plumbing LOCALLY (the private
helpers are NOT imported -- they are replicated so this module has no coupling to the
pricing surface), extended with `discipline` in the identity tuple. Write shape mirrors
save_row_remark: freeze any prior current via frappe.db.set_value(is_current=0), then
insert a fresh current at max(category_version)+1.
"""

import frappe

_ROW_CATEGORY = "BoQ Row Category"


def _identity_filters(boq, sheet_name, excel_row, committed_version, discipline):
    """The identity filter for one classification record. sheet_name VERBATIM (#152);
    discipline is part of the identity (a second engine coexists as its own current)."""
    return {
        "boq": boq,
        "sheet_name": sheet_name,
        "excel_row": excel_row,
        "committed_version": committed_version,
        "discipline": discipline,
    }


def _current_names(boq, sheet_name, excel_row, committed_version, discipline):
    """Names of the is_current=1 record(s) for one identity (0 or 1 -- the invariant)."""
    filters = _identity_filters(boq, sheet_name, excel_row, committed_version, discipline)
    filters["is_current"] = 1
    return frappe.get_all(_ROW_CATEGORY, filters=filters, pluck="name")


def _next_version(boq, sheet_name, excel_row, committed_version, discipline):
    """The next category_version for one identity = max prior + 1 (first write = 1)."""
    agg = frappe.get_all(
        _ROW_CATEGORY,
        filters=_identity_filters(boq, sheet_name, excel_row, committed_version, discipline),
        fields=["max(category_version) as mv"],
    )
    return ((agg[0].mv if agg else None) or 0) + 1


def write_row_categories(boq, sheet_name, committed_version, discipline, rows):
    """Upsert a batch of per-row classifications (freeze-and-supersede per identity).

    Each row dict carries: excel_row (required) + rule_category_id / rule_band /
    rule_score / ai_category_id / ai_confidence / final_category_id / routing /
    routing_reason / description / rules_version / prompt_version / model.

    For each row: freeze the prior current (is_current=0 via set_value -- NEVER doc.save),
    then insert a fresh current at max(category_version)+1. One frappe.db.commit() at the
    end (all rows in one transaction). Returns {count, written:[{name, excel_row,
    category_version, froze_prior}]}.
    """
    written = []
    for r in rows:
        excel_row = r["excel_row"]
        prior = _current_names(boq, sheet_name, excel_row, committed_version, discipline)
        for name in prior:
            frappe.db.set_value(_ROW_CATEGORY, name, "is_current", 0)

        version = _next_version(boq, sheet_name, excel_row, committed_version, discipline)
        doc = frappe.new_doc(_ROW_CATEGORY)
        doc.boq = boq
        doc.sheet_name = sheet_name  # VERBATIM (#152)
        doc.excel_row = excel_row
        doc.committed_version = committed_version
        doc.discipline = discipline
        doc.rule_category_id = r.get("rule_category_id") or ""
        doc.rule_band = r.get("rule_band") or ""
        doc.rule_score = r.get("rule_score")
        doc.ai_category_id = r.get("ai_category_id") or ""
        doc.ai_confidence = r.get("ai_confidence")
        doc.final_category_id = r.get("final_category_id") or ""
        doc.routing = r.get("routing")
        doc.routing_reason = r.get("routing_reason")
        doc.description = r.get("description")
        doc.rules_version = r.get("rules_version")
        doc.prompt_version = r.get("prompt_version")
        doc.model = r.get("model")
        doc.category_version = version
        doc.is_current = 1
        doc.classified_at = frappe.utils.now()
        doc.insert(ignore_permissions=True)
        written.append(
            {
                "name": doc.name,
                "excel_row": excel_row,
                "category_version": version,
                "froze_prior": len(prior),
            }
        )
    frappe.db.commit()
    return {"count": len(written), "written": written}


def set_human_verdict(
    boq, sheet_name, excel_row, committed_version, discipline, human_category_id, user=None
):
    """Record a reviewer's chosen category for one row's durable address.

    When a CURRENT classification record exists, ANNOTATE it IN PLACE -- deliberately does NOT
    mint a new version: the human verdict annotates the same classification run (a new
    category_version is reserved for a re-classification pass that changes rule/ai/routing, not
    for a human accept/override). Updates human_category_id + human_verdict_at + human_verdict_by
    on the single current record.

    When NO current record exists (an ELIGIBLE row that was never classified -- e.g. outside a
    partial classify range), UPSERT: CREATE a fresh current record carrying only the identity
    tuple + the human verdict (rule/ai/routing left blank; a set human_category_id is the
    effective category via get_sheet_categories). This mirrors write_row_categories' fresh-insert
    idiom (there is no prior current to freeze, so no freeze-and-supersede is needed on create).
    Returns {name, human_category_id}.
    """
    names = _current_names(boq, sheet_name, excel_row, committed_version, discipline)
    if not names:
        # First-ever verdict on this address: create a current record. _next_version yields 1 for
        # a true first write (robust if a stale non-current version somehow exists). No freeze loop
        # -- _current_names is empty here, so there is nothing current to supersede.
        version = _next_version(boq, sheet_name, excel_row, committed_version, discipline)
        doc = frappe.new_doc(_ROW_CATEGORY)
        doc.boq = boq
        doc.sheet_name = sheet_name  # VERBATIM (#152)
        doc.excel_row = excel_row
        doc.committed_version = committed_version
        doc.discipline = discipline
        doc.human_category_id = human_category_id or ""
        doc.human_verdict_at = frappe.utils.now()
        doc.human_verdict_by = user or frappe.session.user
        doc.category_version = version
        doc.is_current = 1
        doc.classified_at = frappe.utils.now()
        doc.insert(ignore_permissions=True)
        frappe.db.commit()
        return {"name": doc.name, "human_category_id": human_category_id or ""}
    name = names[0]
    frappe.db.set_value(
        _ROW_CATEGORY,
        name,
        {
            "human_category_id": human_category_id or "",
            "human_verdict_at": frappe.utils.now(),
            "human_verdict_by": user or frappe.session.user,
        },
    )
    frappe.db.commit()
    return {"name": name, "human_category_id": human_category_id or ""}
