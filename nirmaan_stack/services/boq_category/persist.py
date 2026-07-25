# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Freeze-and-supersede persistence for the BoQ Row Category overlay (Classifier CL-1a).

Replicates pricing.py's _annot_* freeze-and-supersede plumbing LOCALLY (the private
helpers are NOT imported -- they are replicated so this module has no coupling to the
pricing surface), extended with `discipline` in the identity tuple. Write shape mirrors
save_row_remark: freeze any prior current via frappe.db.set_value(is_current=0), then
insert a fresh current at max(category_version)+1.
"""

import math

import frappe

_ROW_CATEGORY = "BoQ Row Category"
_BOQ_SHEET = "BoQ Sheet"
_BOQ_NODES = "BOQ Nodes"

# Eligible node types for classification. INTENTIONALLY mirrored (not imported) from
# orchestrator._CLASSIFY_NT / context_builder / the harness CLASSIFY_NT: importing orchestrator
# here would be a service<->service circular import (orchestrator imports THIS module at load).
_ELIGIBLE_NODE_TYPES = {"Line Item", "Preamble"}

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


# ── Committed-node qty-bearing test (relocated from pricing.py, Slice G1) ──────────────
# A NODE concern (not a category one), placed here because this module already reads committed
# BOQ Nodes (blank_category_eligible_rows) and because the coming rate-editable category count
# needs it in the service layer. RELOCATED from api/boq/wizard/pricing.py so it is defined ONCE
# and shared: pricing.py imports node_is_qty_bearing UP (api -> service, legal), and the future
# category-count refinement uses it in-module. Behaviour is byte-identical to the former
# pricing._is_nonzero_qty / pricing._node_is_qty_bearing. The frontend isRowQtyBearing mirror in
# PricingGrid.tsx is a DELIBERATE, accepted duplication across the language boundary -- NOT this.
def is_nonzero_qty(v) -> bool:
    """A finite, non-zero numeric quantity -- mirrors the frontend isNonZeroNum
    (typeof number && Number.isFinite && !== 0). None / 0 / 0.0 / a bool / a non-numeric ->
    False; a finite non-zero number, INCLUDING a negative qty -> True. Committed qty coerces
    unset -> 0.0 (never NULL), but None is guarded defensively."""
    return (
        isinstance(v, (int, float))
        and not isinstance(v, bool)
        and math.isfinite(v)
        and v != 0
    )


def node_is_qty_bearing(node_name: str, node_qty) -> bool:
    """"qty anywhere" (owner-locked "Definition A") -- the node's scalar qty OR ANY of its
    BOQ Node Qty By Area child rows' qty is finite non-zero. The committed analog of the
    frontend isRowQtyBearing. DELIBERATELY LOOSER than the per-area / rate-column qty-bearing
    of isPriceableLine (the flags/count axis) -- this answers "can this row be priced at all?".
    Used ONLY for the Preamble branch of the rate-edit guard, so the (cheap) child read fires
    only when a Preamble is being priced without the override."""
    if is_nonzero_qty(node_qty):
        return True
    child_qtys = frappe.get_all(
        "BOQ Node Qty By Area",
        filters={"parent": node_name, "parenttype": _BOQ_NODES, "parentfield": "qty_by_area"},
        pluck="qty",
    )
    return any(is_nonzero_qty(q) for q in child_qtys)


def _qty_bearing_node_names(nodes) -> set:
    """Slice G2a -- the BATCHED analog of node_is_qty_bearing over a whole sheet's nodes.

    `nodes`: an iterable of dicts each carrying at least {"name", "qty"} (qty = the scalar node
    qty). Returns the SET of node names that are qty-bearing under the SAME "qty anywhere" rule
    node_is_qty_bearing uses -- scalar qty finite non-zero OR ANY BOQ Node Qty By Area child qty
    finite non-zero -- but computed with ONE batched child query instead of one query PER node (the
    per-node child read would be N queries on a ~900-row sheet). Reuses the shared is_nonzero_qty
    for BOTH the scalar and the child values, so the NUMBER semantics stay one definition. This is
    an ADDITIONAL reader over the same semantics; node_is_qty_bearing is left unchanged as the
    single-row source of truth for pricing.py. A consistency test pins the two to agree per node."""
    names = [n["name"] for n in nodes]
    result = {n["name"] for n in nodes if is_nonzero_qty(n.get("qty"))}
    if names:
        for r in frappe.get_all(
            "BOQ Node Qty By Area",
            filters={"parent": ["in", names], "parenttype": _BOQ_NODES,
                     "parentfield": "qty_by_area"},
            fields=["parent", "qty"],
        ):
            if is_nonzero_qty(r.get("qty")):
                result.add(r["parent"])
    return result


# ── Multi-engine per-row resolution ladder (relocated from classify.py, Slice 1a) ──────
# THE single source of truth for "one row's resolved effective category across every discipline
# that classified it". Lives in the SERVICE layer so BOTH api callers share ONE ladder without an
# illegal service->api import (mirrors the frozen-reader precedent above): classify.
# get_sheet_categories_resolved AND blank_category_eligible_rows below (and a future pricing
# rate-edit gate). Behaviour is byte-identical to the former classify._resolve_row_ladder.
def resolve_row_ladder(votes):
    """Apply the owner-locked per-row resolution ladder to one row's per-discipline votes.

    votes: {discipline: {rule_category_id, ai_category_id, ai_confidence, final_category_id,
            routing, review_priority, human_category_id, human_verdict_at}}

    Ladder (owner 2026-07-22/23):
      1. HUMAN wins. A discipline whose human_category_id is set. If MULTIPLE disciplines carry a
         human verdict, the MOST RECENT (human_verdict_at) wins; ties break on discipline name
         (deterministic ordering only -- NOT a hardcoded discipline, so the pathway stays generic).
      2. else AUTO-ACCEPTED beats needs-review.
      3. else if MULTIPLE auto-accepts: HIGHER ai_confidence wins, and cross_engine_conflict=True.
         Confidence ties break on discipline name (deterministic).
      4. else (all disciplines say review): effective category BLANK (the blank-review law).

    cross_engine_conflict is TELEMETRY-ONLY: computed here at read time, NEVER persisted and (owner
    ruling) NEVER rendered. It is True ONLY in branch 3.

    Returns (effective_category_id, effective_source, resolved_discipline, conflict,
             human_category_id, human_discipline).
    """
    # 1. Human verdict on any discipline -> most-recent wins.
    humans = [
        (d, v) for d, v in votes.items() if (v.get("human_category_id") or "").strip()
    ]
    if humans:
        # sort by (human_verdict_at, discipline) descending on time, ascending name as tiebreak
        humans.sort(key=lambda dv: ((dv[1].get("human_verdict_at") or ""), _neg_key(dv[0])),
                    reverse=True)
        d, v = humans[0]
        cat = (v.get("human_category_id") or "").strip()
        return cat, "human", d, False, cat, d

    # 2/3. Auto-accepted disciplines.
    autos = [(d, v) for d, v in votes.items() if (v.get("routing") or "") == "Auto-accepted"]
    if autos:
        # highest ai_confidence; discipline name as a deterministic tiebreak
        autos.sort(key=lambda dv: (_conf(dv[1]), _neg_key(dv[0])), reverse=True)
        d, v = autos[0]
        conflict = len(autos) > 1
        return (v.get("final_category_id") or ""), "auto", d, conflict, "", None

    # 4. All review -> blank.
    return "", "blank", None, False, "", None


def _conf(v):
    try:
        return float(v.get("ai_confidence") or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _neg_key(name):
    """A reversible sort helper: under reverse=True we want ASCENDING discipline name as the
    tiebreak, so invert the string ordering. Deterministic; names are data, never branched on."""
    return tuple(-ord(c) for c in (name or ""))


def _current_sheet_doc(boq, sheet_name, committed_version):
    """Docname of the is_current=1 BoQ Sheet for (boq, sheet_name, committed_version), or None.
    Same resolution is_sheet_classification_frozen uses. sheet_name VERBATIM (#152)."""
    return frappe.db.get_value(
        _BOQ_SHEET,
        {"boq": boq, "sheet_name": sheet_name, "commit_version": committed_version, "is_current": 1},
        "name",
    )


def blank_category_eligible_rows(boq, sheet_name, committed_version, population="eligible"):
    """Rows of the chosen POPULATION whose RESOLVED effective category is BLANK across EVERY
    discipline that classified the sheet -- using the SAME resolve_row_ladder that
    get_sheet_categories_resolved uses.

    population (Slice G2a):
      "eligible"      -- the CLASSIFICATION-eligible set: node_type in {Line Item, Preamble}.
                         DEFAULT; BYTE-IDENTICAL to the pre-G2a behaviour (existing callers --
                         get_freeze_summary -- keep this, and no qty child query fires).
      "rate_editable" -- the RATE-EDITABLE set: Line Item ALWAYS; Preamble ONLY when qty-bearing
                         ("qty anywhere"). Mirrors the owner-locked priceability rule. These two
                         populations LEGITIMATELY differ (a qty-less Preamble is eligible but not
                         rate-editable) -- owner ruling; do NOT collapse them.

    LOAD-BEARING (Slice 1a fail-open guard, preserved for BOTH populations): a row with NO BoQ Row
    Category record at all is counted BLANK. Never-classified rows are ABSENT from the resolved
    category read, so a count that scans only classified rows fails OPEN on a never-classified
    sheet. Here the population NODE set is the denominator and the ladder is applied to
    votes.get(excel_row, {}), so an absent row resolves to "" (ladder branch 4) and IS counted blank.

    Blank criterion = the ladder's EFFECTIVE CATEGORY is empty (index [0]), not effective_source ==
    "blank": this matches the old single-discipline get_sheet_categories emptiness test exactly, so
    a single-discipline sheet's counts are unchanged.

    Returns [{excel_row, node_type}] (blank rows only), sorted by excel_row. Empty when the sheet is
    uncommitted. sheet_name VERBATIM (#152).
    """
    if population not in ("eligible", "rate_editable"):
        raise ValueError(
            "population must be 'eligible' or 'rate_editable', got %r" % (population,)
        )
    sheet_doc = _current_sheet_doc(boq, sheet_name, committed_version)
    if not sheet_doc:
        return []

    # `name` + `qty` are fetched for BOTH populations (a free column add -- no extra query); the
    # rate_editable branch is the only consumer of them (via the ONE batched child query below).
    nodes = frappe.get_all(
        _BOQ_NODES,
        filters={"boq": boq, "sheet": sheet_doc, "is_current": 1},
        fields=["name", "source_row_number", "node_type", "qty"],
    )
    if population == "rate_editable":
        qty_bearing = _qty_bearing_node_names(nodes)   # ONE batched child query
        pop_rows = [
            {"excel_row": n["source_row_number"], "node_type": (n.get("node_type") or "").strip()}
            for n in nodes
            if (n.get("node_type") or "").strip() == "Line Item"
            or ((n.get("node_type") or "").strip() == "Preamble" and n["name"] in qty_bearing)
        ]
    else:  # "eligible" -- BYTE-IDENTICAL to pre-G2a (no qty test, no child query)
        pop_rows = [
            {"excel_row": n["source_row_number"], "node_type": (n.get("node_type") or "").strip()}
            for n in nodes
            if (n.get("node_type") or "").strip() in _ELIGIBLE_NODE_TYPES
        ]

    # Every discipline's current votes for the version, grouped by excel_row (NO discipline filter --
    # the multi-engine denominator). Mirrors get_sheet_categories_resolved's read.
    cat_rows = frappe.get_all(
        _ROW_CATEGORY,
        filters={
            "boq": boq, "sheet_name": sheet_name,
            "committed_version": committed_version, "is_current": 1,
        },
        fields=["excel_row", "discipline", "routing", "human_category_id",
                "human_verdict_at", "ai_confidence", "final_category_id"],
    )
    votes_by_row = {}
    for r in cat_rows:
        votes_by_row.setdefault(r["excel_row"], {})[r["discipline"]] = r

    blanks = [
        e for e in pop_rows
        if not (resolve_row_ladder(votes_by_row.get(e["excel_row"], {}))[0] or "").strip()
    ]
    blanks.sort(key=lambda e: e["excel_row"])
    return blanks


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
        # HV-7 priority tier. Absent on the legacy R3d path (route_r3d emits no such key),
        # so it defaults to 0 -- a faithful writer, exactly as for every other field here.
        doc.review_priority = 1 if r.get("review_priority") else 0
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
