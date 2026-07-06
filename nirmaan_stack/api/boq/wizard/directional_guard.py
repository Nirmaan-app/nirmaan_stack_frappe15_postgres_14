# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Cross-stage directional guard -- state-floor existence checks (Phase C0 / ADR-0011).

BoQ phases run ONE-WAY: Config -> Review -> Commit -> Pricing/Tendering. A user acting in an
EARLIER stage must not SILENTLY orphan the work another user produced in a LATER stage. Every
existing guard is a user-agnostic FORWARD freeze (parse_in_progress, wizard_status=="Finalized",
BoQ Sheet.is_locked, commit-eligibility) and NONE looks downstream. These checks add the missing
"does a LATER stage hold orphanable work?" question to the disturbing endpoints (re-commit,
force re-parse, un-finalize, root-metadata edit, Parsed-window review edit).

WHY IT MATTERS (verified rug-pull): a Force Re-parse + re-commit over a priced committed version
silently orphans a downstream pricer's work onto the frozen version -- the editor only loads
is_current, so the pricer sees a blank sheet; copy-forward recovers rates only, partially, and
formulas/remarks/colors not at all.

C0 IS THE STATE FLOOR: it turns a SILENT orphan into an EXPLICIT, acknowledged action -- the
disturbing endpoint throws with the orphan count (marker BOQ_DOWNSTREAM_ORPHAN) UNLESS the caller
passes an explicit confirm flag. Re-committing / re-parsing a sheet with NO downstream pricing is
free forward progress (count 0 -> no guard).

ADR-0011 Amendment A1: the response is WARN-ONLY (never a block). When ANOTHER user is live-pricing
the current committed version the message NAMES them (a "Live" warning); otherwise it is count-only
(a "Vacated" warning) -- see live_pricing_holder + guard_no_downstream_orphan. The dropped tiered
block / Author-or-Admin gate / attribution fields are NOT built.
"""
import frappe
from frappe.utils import now_datetime

_BOQ_SHEET = "BoQ Sheet"
_PRICING = "BoQ Cell Pricing"

# Stable token at the START of the throw so the frontend can detect a downstream-orphan gate
# distinctly (and re-submit with the confirm flag after the user acknowledges the count).
ORPHAN_MARKER = "BOQ_DOWNSTREAM_ORPHAN"


def _truthy(v) -> bool:
    """Coerce a whitelisted-endpoint confirm arg (bool / "1" / "true" / 1 / None) to bool."""
    if isinstance(v, str):
        return v.strip().lower() in ("1", "true", "yes")
    return bool(v)


def current_commit_version(boq: str, sheet_name: str):
    """The current committed version of (boq, sheet_name VERBATIM #152), or None if uncommitted."""
    return frappe.db.get_value(
        _BOQ_SHEET, {"boq": boq, "sheet_name": sheet_name, "is_current": 1}, "commit_version"
    )


def downstream_priced_count(boq: str, sheet_name: str) -> int:
    """Count of CURRENT priced cells on the current committed version of (boq, sheet_name) -- the
    work a re-commit / re-parse would ORPHAN. 0 when the sheet is uncommitted or unpriced."""
    version = current_commit_version(boq, sheet_name)
    if version is None:
        return 0
    return frappe.db.count(
        _PRICING,
        {"boq": boq, "sheet_name": sheet_name, "committed_version": version, "is_current": 1},
    )


def boq_downstream_priced_count(boq: str) -> int:
    """Total CURRENT priced cells across ALL sheets of a BoQ -- the work a BoQ-ROOT metadata
    change (tax_treatment / version, which every committed sheet snapshotted) would desync.
    Used by the per-BoQ update_boq_draft guard (D18)."""
    return frappe.db.count(_PRICING, {"boq": boq, "is_current": 1})


def live_pricing_holder(boq: str, sheet_name: str):
    """The full name of ANOTHER user who holds a FRESH pricing lock on this sheet's CURRENT
    committed version -- the "Live" downstream editor (ADR-0011 Amendment A1). Returns None when
    the sheet is uncommitted, or the lock is absent / stale / held by the SAME user (you are never
    warned about yourself) -- in which case the orphan warning is "Vacated" (count-only)."""
    version = current_commit_version(boq, sheet_name)
    if version is None:
        return None
    # Lazy import: pricing_lock is a leaf lock engine; keep directional_guard cheap to import.
    from nirmaan_stack.api.boq.wizard import pricing_lock

    info = pricing_lock.read_lock_info(
        boq, sheet_name, version, frappe.session.user, now_datetime()
    )
    if info and not info["is_stale"] and not info["is_locked_by_me"]:
        return info["locked_by_name"]
    return None


def boq_live_pricing_holders(boq: str):
    """[(sheet_name, holder_full_name)] for every committed sheet of `boq` whose CURRENT version is
    being live-priced by ANOTHER user (Amendment A1). Empty when none -- used by the per-BoQ
    root-metadata guard to name who is affected."""
    out = []
    for s in frappe.get_all(_BOQ_SHEET, filters={"boq": boq, "is_current": 1}, pluck="sheet_name"):
        holder = live_pricing_holder(boq, s)
        if holder:
            out.append((s, holder))
    return out


def guard_no_downstream_orphan(boq: str, sheet_name: str, confirm, action: str) -> int:
    """C0 state floor + Amendment A1 presence escalation: throw (with the orphan count +
    ORPHAN_MARKER) UNLESS `confirm` when `action` on (boq, sheet_name) would orphan downstream
    pricing. When ANOTHER user is live-pricing the current version the message NAMES them (Live);
    otherwise it is count-only (Vacated). `action` is a short human label ("re-commit", "re-parse",
    "un-finalize", ...). Returns the orphan count (0 = no guard fired). WRITES NOTHING -- call it
    before any destructive write, so a rejected action mutates nothing (mirrors the lock
    reject-mutates-nothing contract). It NEVER blocks -- the caller re-submits with `confirm`."""
    count = downstream_priced_count(boq, sheet_name)
    if count and not _truthy(confirm):
        holder = live_pricing_holder(boq, sheet_name)
        live = f" {holder} is pricing it right now." if holder else ""
        frappe.throw(
            f"{ORPHAN_MARKER}: '{sheet_name}' has {count} priced cell(s) on the current committed "
            f"version.{live} A {action} will orphan them -- they stay on the frozen version but are "
            f"NOT carried forward (only rates are partially recoverable via copy-forward). Confirm "
            f"to proceed.",
            title="This will orphan priced cells",
        )
    return count


@frappe.whitelist()
def get_downstream_state(boq_name: str = None, sheet_name: str = None) -> dict:
    """Read-only downstream state for the on-entry directional banner (Amendment A1) of ONE sheet:
    {committed_version, orphanable_count, live_holder}. `live_holder` is ANOTHER user's name pricing
    the current committed version right now, else None. NEVER mutates."""
    if not boq_name or not sheet_name:
        frappe.throw("boq_name and sheet_name are required.")
    return {
        "committed_version": current_commit_version(boq_name, sheet_name),
        "orphanable_count": downstream_priced_count(boq_name, sheet_name),
        "live_holder": live_pricing_holder(boq_name, sheet_name),
    }


@frappe.whitelist()
def get_boq_downstream_state(boq_name: str = None) -> dict:
    """Read-only downstream state for ALL committed sheets of a BoQ (Hub per-card indicators + the
    per-BoQ root-metadata note): {sheets: {name: {orphanable_count, live_holder}}, total_priced,
    live_any}. Only sheets with orphanable work are listed. NEVER mutates."""
    if not boq_name:
        frappe.throw("boq_name is required.")
    sheets = {}
    total = 0
    for s in frappe.get_all(
        _BOQ_SHEET, filters={"boq": boq_name, "is_current": 1}, pluck="sheet_name"
    ):
        c = downstream_priced_count(boq_name, s)
        if c:
            sheets[s] = {"orphanable_count": c, "live_holder": live_pricing_holder(boq_name, s)}
            total += c
    return {
        "sheets": sheets,
        "total_priced": total,
        "live_any": any(v["live_holder"] for v in sheets.values()),
    }
