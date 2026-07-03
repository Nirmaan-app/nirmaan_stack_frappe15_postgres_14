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
free forward progress (count 0 -> no guard). The full tiered UX (D15/D16: presence-upgrade,
Author-or-Admin, orphan-surfacing both ways) is the later C1 slice.
"""
import frappe

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


def guard_no_downstream_orphan(boq: str, sheet_name: str, confirm, action: str) -> int:
    """C0 state floor: throw (with the orphan count + ORPHAN_MARKER) UNLESS `confirm` when
    `action` on (boq, sheet_name) would orphan downstream pricing. `action` is a short human
    label ("re-commit", "re-parse", "un-finalize", ...). Returns the orphan count (0 = no guard
    fired). WRITES NOTHING -- call it before any destructive write, so a rejected action mutates
    nothing (mirrors the lock reject-mutates-nothing contract)."""
    count = downstream_priced_count(boq, sheet_name)
    if count and not _truthy(confirm):
        frappe.throw(
            f"{ORPHAN_MARKER}: '{sheet_name}' has {count} priced cell(s) on the current committed "
            f"version. A {action} will orphan them -- they stay on the frozen version but are NOT "
            f"carried forward (only rates are partially recoverable via copy-forward). Confirm to "
            f"proceed.",
            title="This will orphan priced cells",
        )
    return count
