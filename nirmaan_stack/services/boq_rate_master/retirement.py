# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Retirement state -- the ONE owning module for "what has been deliberately retired".

WHY IT EXISTS
-------------
`retired_kinds` and `retired_category_ids` are the only two loader inputs consumed to drive
behaviour and never persisted. `_load_multi` reads them from the payload, hands them to
`_deactivate_scope`, and the entire effect is `active = 0` -- INDISTINGUISHABLE from an ordinary
supersede. Once the database is the source of truth and the asset is built FROM it, an export
walking rows alone would drop the lists silently.

⚠️ PAYLOAD IS THE INSTRUCTION, TABLE IS THE RECORD.
`record_retirements` is called by the loader as a SIDE EFFECT of a payload declaring a retirement.
Nothing here is ever read to drive deactivation -- `_deactivate_scope` still takes its scope from the
payload alone. Mixing the two would change import behaviour, which is deliberately out of scope.

⚠️ DERIVATION WAS REJECTED, and the reason is not stylistic.
"A kind/category with rows but none active" matches the four known entries exactly on the current
database. It still cannot be used: it returns EMPTY on a fresh bootstrap database, so the lists would
vanish in precisely the case the asset exists to serve. It is also coupled to history retention
(archiving superseded rows would silently shrink it) and cannot tell "deliberately retired" from
"happens to have no active rows just now".

⚠️ KNOWN GAP, deliberately not fixed here: the SINGULAR-config loader path
(`loader.load_rate_master`, the branch taken by a payload carrying `category_config` rather than
`category_configs`) ignores the retirement lists ENTIRELY -- it never reads them and therefore never
records them. No shipped asset takes that branch, but the gap is real.
"""

import frappe

RETIREMENT_DOCTYPE = "BoQ Rate Master Retirement"

SCOPE_KIND = "kind"
SCOPE_CATEGORY = "category"


def _clean(values):
    """Non-blank, stripped, de-duplicated, order preserved."""
    out, seen = [], set()
    for v in values or []:
        s = (v or "").strip() if isinstance(v, str) else v
        if not s or s in seen:
            continue
        seen.add(s)
        out.append(s)
    return out


def reason_map(reasons):
    """The asset's `retirement_reasons` map -> {(scope_type, scope_value): reason}.

    THE ONE PLACE that knows the asset shape `{"kinds": {...}, "categories": {...}}`. The two
    sub-maps exist because a KIND and a CATEGORY can share a name -- which is exactly why
    `retired_kinds` and `retired_category_ids` are two lists rather than one -- so a single flat map
    would reintroduce an ambiguity the rest of the module is careful to avoid.

    Tolerant by design: a missing key, a non-dict, or a blank value all yield "no reason", because
    an ABSENT reason is legal (F-19 R2). Type ENFORCEMENT lives in the loader, which is where a bad
    payload should be refused by name.
    """
    out = {}
    if not isinstance(reasons, dict):
        return out
    for key, scope_type in (("kinds", SCOPE_KIND), ("categories", SCOPE_CATEGORY)):
        sub = reasons.get(key)
        if not isinstance(sub, dict):
            continue
        for value, reason in sub.items():
            if not isinstance(value, str) or not isinstance(reason, str):
                continue
            v, r = value.strip(), reason.strip()
            if v and r:
                out[(scope_type, v)] = r
    return out


def record_retirements(discipline, retired_kinds=None, retired_category_ids=None, reasons=None):
    """Record any retirement entries not already present for this discipline.

    IDEMPOTENT: the doctype's autoname is `format:{discipline}::{scope_type}::{scope_value}`, so an
    entry that already exists is skipped by an existence check and could not be duplicated anyway --
    a second insert would be a primary-key collision. Uniqueness is therefore STRUCTURAL, not a
    validation that can race or be skipped.

    `reasons` (F-19) is the asset's optional `retirement_reasons` map, in its own shape:
    `{"kinds": {<kind>: <reason>}, "categories": {<category_id>: <reason>}}`. A NEWLY MINTED row
    stores the matching reason; a reason with no entry is simply absent, which is allowed and
    records BLANK (the shipped v32 asset declares retirements and carries no reasons at all, and it
    must keep loading). The loader is what REFUSES a reason naming an undeclared kind or category --
    the map must never become a second, quieter way to declare a retirement.

    ⚠️ AN EXISTING ROW IS NEVER UPDATED, INCLUDING ITS REASON (F-19 R5). The skip above is what
    makes a re-load safe, and turning it into an upsert to fill a historical blank would trade that
    guarantee for two fields. The two blank rows F-16 and F-17 minted are filled by the one-off
    `scripts/backfill_retirement_reasons.py` instead. A replay therefore reports them as `existing`
    and changes nothing -- pinned by test.

    ⚠️ `retired_at` / `retired_by` are STILL left empty, deliberately, and F-19 does not change
    that. The loader knows when it ran, not when the decision was made, and it has never known by
    whom; the only signal is a batch creation timestamp, which is approximate. A field asserting a
    precision it does not have is worse than an empty one. `reason` is different in kind: it is
    AUTHORED FACT travelling with the payload, not something inferred after the event.

    Does NOT commit -- the caller owns the transaction (the loader commits once at the end).
    Returns {"created": [...], "existing": [...], "unreasoned": <int>} -- the first two lists of
    "scope_type::scope_value" strings, the last a count of rows CREATED with no reason.
    """
    discipline = (discipline or "").strip()
    if not discipline:
        return {"created": [], "existing": [], "unreasoned": 0}

    pairs = [(SCOPE_KIND, v) for v in _clean(retired_kinds)]
    pairs += [(SCOPE_CATEGORY, v) for v in _clean(retired_category_ids)]
    by_scope = reason_map(reasons)

    created, existing, unreasoned = [], [], 0
    for scope_type, scope_value in pairs:
        if frappe.db.exists(
            RETIREMENT_DOCTYPE,
            {"discipline": discipline, "scope_type": scope_type, "scope_value": scope_value},
        ):
            # ⚠️ NEVER UPDATED -- not even to add a reason. See the docstring (F-19 R5).
            existing.append(f"{scope_type}::{scope_value}")
            continue
        reason = by_scope.get((scope_type, scope_value))
        if not reason:
            unreasoned += 1
        frappe.get_doc(
            {
                "doctype": RETIREMENT_DOCTYPE,
                "discipline": discipline,
                "scope_type": scope_type,
                "scope_value": scope_value,
                # F-19: the AUTHORED reason, when the payload carries one. Absent is allowed and
                # records blank. retired_at / retired_by stay absent -- see the docstring.
                "reason": reason or None,
            }
        ).insert(ignore_permissions=True)
        created.append(f"{scope_type}::{scope_value}")
    return {"created": created, "existing": existing, "unreasoned": unreasoned}


def get_retirement_lists(discipline):
    """The current retirement state for a discipline, IN THE EXACT SHAPE THE ASSET USES.

    Returns {"retired_kinds": [...], "retired_category_ids": [...], "retirement_reasons": {...}} --
    the two lists of plain strings sorted for a stable export, plus (F-19) the reasons in the SAME
    shape the asset uses: {"kinds": {...}, "categories": {...}}. The export calls this instead of
    carrying anything forward from the previous asset file.

    ⚠️ ONLY `reason` is surfaced -- never `retired_at` / `retired_by` (F-19 R4). A timestamp in the
    payload would break the two-consecutive-exports-are-byte-identical guarantee the moment two
    exports straddled a new retirement, and `retired_by` records an actor the table never observed.
    A reason is authored text: stable, and the thing worth self-documenting.

    A row with a BLANK reason contributes NOTHING to the map, so a discipline with no reasons at all
    exports two empty sub-maps -- the same "inherit nothing" discipline the two lists already keep.
    """
    rows = frappe.get_all(
        RETIREMENT_DOCTYPE,
        filters={"discipline": (discipline or "").strip()},
        fields=["scope_type", "scope_value", "reason"],
        order_by="scope_value asc",
    )
    reasons = {"kinds": {}, "categories": {}}
    for r in rows:
        text = (r.get("reason") or "").strip()
        if not text:
            continue
        key = "kinds" if r["scope_type"] == SCOPE_KIND else "categories"
        reasons[key][r["scope_value"]] = text
    return {
        "retired_kinds": sorted(
            r["scope_value"] for r in rows if r["scope_type"] == SCOPE_KIND
        ),
        "retired_category_ids": sorted(
            r["scope_value"] for r in rows if r["scope_type"] == SCOPE_CATEGORY
        ),
        # sorted by key so two exports of an unchanged database stay byte-identical
        "retirement_reasons": {
            k: {kk: sub[kk] for kk in sorted(sub)} for k, sub in reasons.items()
        },
    }
