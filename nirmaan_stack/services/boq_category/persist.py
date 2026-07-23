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
_BOQ_SHEET = "BoQ Sheet"

# Reject marker for a write against a classification-frozen sheet. Mirrors pricing.py's
# _LOCKED_WRITE_MESSAGE idiom (a stable, greppable string the frontend can match on).
_FROZEN_WRITE_MESSAGE = (
    "Classification is frozen for this sheet. Unfreeze to make changes."
)


def is_sheet_classification_frozen(boq, sheet_name, committed_version) -> int:
    """1 iff the CURRENT committed BoQ Sheet for (boq, sheet_name, committed_version) is
    classification-frozen; 0 when unfrozen OR no current row (an uncommitted / re-committed-away
    version is not frozen -- pass-through). A pure read. THE single frozen-state reader: the
    classify endpoints, this module's set_human_verdict guard, and the orchestrator all call it
    (api -> service is the only legal import direction, so the reader lives here in the service
    layer). sheet_name VERBATIM (#152)."""
    name = frappe.db.get_value(
        _BOQ_SHEET,
        {"boq": boq, "sheet_name": sheet_name, "commit_version": committed_version, "is_current": 1},
        "name",
    )
    if not name:
        return 0
    return 1 if frappe.db.get_value(_BOQ_SHEET, name, "classification_frozen") else 0


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


# The full machine + human field set a carry reads from a source record and writes to the dest.
# ONE source of truth so the source read (committed_carry._walk_category_layer) and this write can
# never drift. `excel_row` + `discipline` are the per-row identity the carry re-keys; the rest is
# the field split preserved verbatim (classified_at carried too -- the same classification, not a
# re-run). `is_current` / `category_version` are NOT read -- the DEST's own version is resolved at
# write time (max(prior) + 1), never copied from the source.
CARRY_READ_FIELDS = [
    "excel_row", "discipline",
    "rule_category_id", "rule_band", "rule_score",
    "ai_category_id", "ai_confidence", "final_category_id",
    "routing", "routing_reason",
    "human_category_id", "human_verdict_at", "human_verdict_by",
    "rules_version", "prompt_version", "model", "description", "classified_at",
]


def current_category_keys(boq, sheet_name, committed_version) -> set:
    """The set of (excel_row, discipline) that ALREADY hold a current classification at one
    committed version. ONE query -- the presence map a carry consults before writing (Amendment C).
    sheet_name VERBATIM (#152)."""
    rows = frappe.get_all(
        _ROW_CATEGORY,
        filters={
            "boq": boq, "sheet_name": sheet_name,
            "committed_version": committed_version, "is_current": 1,
        },
        fields=["excel_row", "discipline"],
    )
    return {(r.excel_row, r.discipline) for r in rows}


def carry_row_categories(boq, sheet_name, committed_version, rows, overwrite=False):
    """Carry a batch of source category rows onto a committed version (ADR-0014 D8 / Amendment C).

    PRESERVES THE FIELD SPLIT -- machine -> machine, human -> human -- copying the whole
    CARRY_READ_FIELDS set verbatim (NEVER routing a machine label into human_category_id: that
    would replicate the freeze bug, #1096, inside carry). The per-discipline fan-out rides the
    row list (`discipline` is per-row). NO commit -- the caller owns the transaction (the commit
    seam shares `_commit_one_sheet`'s; the post-commit carry endpoint owns its own atomic one).

    ⚠️ AMENDMENT C reverses this function's old "the dest triple is brand new -> no prior current
    to freeze, category_version = 1" contract. That held only at the COMMIT seam. Post-commit the
    dest may already hold a classification (the user ran Classify, set a verdict, or carried once
    before), so this now freezes any prior current via set_value(is_current=0) -- NEVER doc.save --
    and inserts at max(category_version) + 1, exactly like `write_row_categories`. The CALLER is
    responsible for presence-filtering (see `current_category_keys`): a row reaching here is one
    the caller decided to write, so `overwrite` here only documents intent and asserts the
    freeze-first path. At commit nothing is ever present, so the behaviour is unchanged: no prior
    to freeze, version resolves to 1.

    Each row dict carries the CARRY_READ_FIELDS keys (excel_row already re-mapped to the dest by
    the D6 twin). Returns the count written. sheet_name VERBATIM (#152)."""
    count = 0
    for r in rows:
        excel_row = r["excel_row"]
        discipline = r["discipline"]
        prior = _current_names(boq, sheet_name, excel_row, committed_version, discipline)
        for name in prior:
            frappe.db.set_value(_ROW_CATEGORY, name, "is_current", 0)

        doc = frappe.new_doc(_ROW_CATEGORY)
        doc.boq = boq
        doc.sheet_name = sheet_name  # VERBATIM (#152)
        doc.excel_row = excel_row
        doc.committed_version = committed_version
        doc.discipline = discipline
        # Machine layer (verbatim).
        doc.rule_category_id = r.get("rule_category_id") or ""
        doc.rule_band = r.get("rule_band") or ""
        doc.rule_score = r.get("rule_score")
        doc.ai_category_id = r.get("ai_category_id") or ""
        doc.ai_confidence = r.get("ai_confidence")
        doc.final_category_id = r.get("final_category_id") or ""
        doc.routing = r.get("routing")
        doc.routing_reason = r.get("routing_reason")
        # Human layer (verbatim -- NEVER folded into the machine fields, and vice-versa).
        doc.human_category_id = r.get("human_category_id") or ""
        doc.human_verdict_at = r.get("human_verdict_at")
        doc.human_verdict_by = r.get("human_verdict_by")
        # Provenance (carried, not re-stamped -- this is the SAME classification, not a re-run).
        doc.rules_version = r.get("rules_version")
        doc.prompt_version = r.get("prompt_version")
        doc.model = r.get("model")
        doc.description = r.get("description")
        # max(prior) + 1, NEVER a hardcoded 1: a frozen prior can exist with no current (a
        # re-classify supersedes), and re-using 1 would collide. Resolves to 1 at the commit seam.
        doc.category_version = _next_version(
            boq, sheet_name, excel_row, committed_version, discipline
        )
        doc.is_current = 1
        doc.classified_at = r.get("classified_at") or frappe.utils.now()
        doc.insert(ignore_permissions=True)
        count += 1
    return count


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
    # Defence-in-depth: a frozen sheet rejects any human-verdict write here too (the primary guard
    # is in set_row_category). The freeze endpoint does NOT route through this function -- it uses
    # stamp_human_verdicts_bulk (below), which is deliberately guard-free -- so its own stamping is
    # never blocked by this check. Reject-mutates-nothing: this fires before any write.
    if is_sheet_classification_frozen(boq, sheet_name, committed_version):
        frappe.throw(_FROZEN_WRITE_MESSAGE, title="Classification frozen")

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


def stamp_human_verdicts_bulk(boq, sheet_name, committed_version, discipline, stamps, user=None):
    """Stamp human_category_id on many rows IN PLACE for one freeze event -- NO commit (the caller
    owns the single end-commit so the whole freeze is atomic). The freeze-endpoint sibling of
    set_human_verdict: it does NOT call is_sheet_classification_frozen (the freeze IS the write
    that sets the flag, so a guard here would deadlock the operation) and it does NOT commit.

    stamps: iterable of {excel_row, human_category_id}. Each row MUST already have an is_current=1
    BoQ Row Category record -- freeze only ever stamps rows whose EFFECTIVE category is non-blank,
    which implies a current record exists (get_sheet_categories reads current rows only). A stamp
    for a row with no current record is SKIPPED (defensive; should not happen). Annotates in place
    (same category_version) exactly like set_human_verdict's existing-record branch. sheet_name
    VERBATIM (#152). Returns {stamped, skipped}."""
    now = frappe.utils.now()
    who = user or frappe.session.user
    stamped = 0
    skipped = 0
    for s in stamps:
        excel_row = s["excel_row"]
        names = _current_names(boq, sheet_name, excel_row, committed_version, discipline)
        if not names:
            skipped += 1
            continue
        frappe.db.set_value(
            _ROW_CATEGORY,
            names[0],
            {
                "human_category_id": s.get("human_category_id") or "",
                "human_verdict_at": now,
                "human_verdict_by": who,
            },
            update_modified=False,
        )
        stamped += 1
    return {"stamped": stamped, "skipped": skipped}
