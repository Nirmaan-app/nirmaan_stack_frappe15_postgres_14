# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""THE rate-master deployment freeze -- state, guard and audited writer, defined once.

WHY THIS EXISTS. On 2026-08-18, 235 hand-entered production cable prices were overwritten by
a dev-minted asset, because they existed in no committed asset. The remedy is Deployment Mode:
freeze production, export, merge dev's config with production's items, deploy. This module is
the freeze -- previously an unenforced manual discipline.

WHY IT LIVES IN `services/` AND NOT IN `api/`. Two independent write mechanisms reach the rate
master, and BOTH must be covered:

  1. the five audited `doc.save` endpoints in `api/boq/rate_master.py`
  2. `services/boq_rate_master/csv_importer.apply_plan`, which is freeze-and-supersede via RAW
     SQL + fresh inserts and does NOT go through `doc.save` at all

`csv_importer` is a SERVICE, so it may not import from `api/` -- that is the app's one-way
import rule, and the exact precedent is `services/boq_bcs/readiness.py` (relocated DOWN out of
`api/` for this same reason) and `services/boq_category/persist.py`. So the predicate lives at
the layer both callers may import. `api/boq/rate_master.py` imports it upward; `csv_importer`
imports it sideways within its own package.

⚠️ ONE DEFINITION. A second copy would be bad anywhere; here the two copies would sit on either
side of the SAME upload -- the endpoint admitting a file that the importer then refuses, or
worse, the reverse -- so `test_rate_master` pins the guard by identity at both call sites.

⚠️⚠️ THE GUARD COVERS THE WRITE SUBSET ONLY, AND MUST NEVER BE FOLDED INTO
`_require_rate_admin` (owner ruling R3, 2026-08-18). That function gates NINE endpoints, THREE
of which are reads -- `export_rate_master_asset`, `export_rate_master_csv`,
`preview_rate_master_csv`. The EXPORT IS THE ACTION THE FREEZE EXISTS TO PROTECT: the whole
point of Deployment Mode is to freeze production and THEN export it. A freeze that blocked the
export would make the feature self-defeating, and it would do so silently, because the export
button and the upload button sit in the SAME dashed panel on the Rate Master screen. Guarding
the shared admin gate is therefore the one refactor that must never happen here, however tidy
it looks.

⚠️ PRICING IS NOT AFFECTED, BY CONSTRUCTION, NOT BY EXEMPTION (owner ruling R2). No BoQ pricing
path writes the rate master: the pricing screen reads it through `get_rate_category_config` /
`get_rate_master_items` and computes rates CLIENT-SIDE, and "Use this value" writes a
`BoQ Rate Suggestion Event`. Nothing in this module is imported by any pricing endpoint, so
there is no exemption to maintain and nothing that could drift into blocking a pricer.

⚠️ THE DESK GAP IS AN ACCEPTED OWNER DECISION OF 2026-08-18, NOT AN OVERSIGHT. The doctype
permissions on `BoQ Rate Master Item` / `BoQ Rate Category Config` grant write to
`System Manager` (30 users at the time of the ruling, of whom 22 are NOT rate-master admins),
and Frappe Desk plus the generic `/api/resource/...` REST API do not pass through the app's
gates at all. This freeze covers the APP SURFACE ONLY. Do NOT "close the gap" by changing
doctype permissions or by adding a controller-level `validate` guard -- both were considered
and ruled out, and a controller guard would in any case MISS `csv_importer`'s raw-SQL supersede
while newly breaking the loader.

LIFTING IS MANUAL ONLY (owner ruling R7): no expiry, no timeout, no automatic lift on deploy.
There is deliberately no staleness concept anywhere in this module -- contrast the pricing
lock's `LOCK_STALE_SECONDS`, which is a concurrency device and a different kind of thing.

WHO: the freeze is set and lifted by the population that can already edit the rate master
(Administrator or `Nirmaan Users.role_profile == "Nirmaan Admin Profile"`). That gate stays in
`api/boq/rate_master.py`, where request context belongs; this module NEVER reads
`frappe.session.user` and takes the actor as a parameter.

ENTRY POINTS:
    is_frozen()                 -> bool
    get_freeze_state()          -> {"frozen", "frozen_by", "frozen_at"}
    guard_not_frozen()          -> None, or frappe.throw(BLOCKED_MESSAGE)
    set_freeze_state(frozen, user) -> the new state dict (audited; caller commits)
"""

import frappe
from frappe.utils import cint, now_datetime

FREEZE_DOCTYPE = "BoQ Rate Master Freeze"

# ⚠️ OWNER'S TEXT, VERBATIM (2026-08-18). Not to be reworded, expanded, or given a second
# sentence -- including the spacing inside "Nitesh/ Abhishek", which is the owner's own. This
# is the ONE string every blocked surface shows, server and client alike; the frontend reads it
# from its own single constant (`rateMasterFreeze.ts` FREEZE_BLOCKED_MESSAGE) rather than
# retyping it, and a test pins the two against each other.
BLOCKED_MESSAGE = "Rate master is locked for deployment. Contact Nitesh/ Abhishek."


def get_freeze_state():
    """The live freeze state: {"frozen": bool, "frozen_by": str|None, "frozen_at": str|None}.

    FAILS OPEN (not frozen) on any read error, DELIBERATELY, and the reasoning matters:

      * Before this slice's migrate the doctype does not exist, so `get_meta` raises. Failing
        open makes the feature INERT on such a database -- byte-identical to pre-freeze
        behaviour, which is this codebase's standing preference for a new gate ("ABSENT =>
        byte-identical").
      * Failing CLOSED would refuse every rate-master write on a transient DB error while
        showing a message that names a deployment nobody is doing -- a misleading block, and
        one the user cannot clear. The writes it would "protect" are themselves DB writes and
        would fail on their own.

    This is the OPPOSITE of `ai_settings.get_boq_ai_settings`, which fails closed, and the
    difference is real rather than accidental: there, failing closed means "don't spend money
    on an AI call we are unsure about" -- the safe direction is inaction. Here inaction IS the
    block, so the safe direction reverses.
    """
    try:
        row = frappe.db.get_value(
            FREEZE_DOCTYPE, FREEZE_DOCTYPE, ["frozen", "frozen_by", "frozen_at"], as_dict=True
        )
    except Exception:
        frappe.log_error(
            title="Rate master freeze state read failed", message=frappe.get_traceback()
        )
        return {"frozen": False, "frozen_by": None, "frozen_at": None}

    if not row:  # Single never written -- the default, and not an error
        return {"frozen": False, "frozen_by": None, "frozen_at": None}
    frozen = bool(cint(row.get("frozen")))
    return {
        "frozen": frozen,
        # Provenance is reported ONLY while actually frozen. Both fields are cleared on
        # unfreeze anyway; reading them through the flag means a half-cleared row can never
        # render a banner claiming a freeze that is not on.
        "frozen_by": (row.get("frozen_by") or None) if frozen else None,
        "frozen_at": (row.get("frozen_at") or None) if frozen else None,
    }


def is_frozen() -> bool:
    """True iff the rate master is under a deployment freeze. THE single frozen-state reader
    for every caller (the `persist.is_sheet_classification_frozen` precedent)."""
    return get_freeze_state()["frozen"]


def guard_not_frozen() -> None:
    """Refuse a rate-master WRITE while the deployment freeze is on, with the owner's exact
    message. Called in the position `_require_rate_admin` occupies -- immediately after it, so
    a non-admin still gets the honest "Not permitted" rather than being told to contact someone
    about a freeze they could not have worked around anyway.

    REJECT MUTATES NOTHING: every call site places this before any target resolution, plan
    build, or write (the `_guard_classification_not_frozen` / `_guard_sheet_not_locked`
    contract).

    ⚠️ NEVER call this from an export/preview endpoint (R3), and never from a pricing path (R2).
    """
    if is_frozen():
        frappe.throw(BLOCKED_MESSAGE, title="Rate master locked")


def set_freeze_state(frozen: bool, user: str):
    """Set or clear the freeze, recording who and when. Returns the new state dict.
    DOES NOT COMMIT -- the caller commits (the `_write_category_gate_override_cleared`
    contract). `user` is passed IN: this module never reads request context.

    ⚠️ THE WRITE RECIPE IS `doc.save(ignore_permissions=True, ignore_version=False)`, AND
    `frappe.db.set_single_value` IS FORBIDDEN HERE. set_single_value is a raw UPDATE: it
    bypasses the doc lifecycle and writes NO `Version` row, verified in Frappe's own
    `database.py`. That would destroy the ONE thing that makes owner ruling R6 -- any admin may
    lift any other admin's freeze -- safe to grant: the record of who lifted it. The live
    fields say who SET the current freeze; the Version log is the only place a LIFT is
    attributable, and it exists only because this doctype is track_changes:1 AND this write
    goes through the lifecycle.

    ⚠️ `ignore_version=False` is EXPLICIT and load-bearing: Frappe defaults
    `ignore_version = frappe.flags.in_test`, so without it the audit is silently suppressed
    under `bench run-tests` -- i.e. exactly the tests that assert attribution would be the ones
    unable to see it. This is the same explicit flag the RM-4a/4b editors carry, for the same
    reason.

    `doc.save` is safe on this doctype -- it carries only Check/Data/Datetime fields, so the
    list-valued-JSON wall that forces `BoQ Sheet` onto `set_value` does not apply here.
    """
    doc = frappe.get_doc(FREEZE_DOCTYPE, FREEZE_DOCTYPE)
    if frozen:
        doc.frozen = 1
        doc.frozen_by = user
        doc.frozen_at = now_datetime()
    else:
        # Cleared together. Who LIFTED is recorded by the Version row this save writes.
        doc.frozen = 0
        doc.frozen_by = None
        doc.frozen_at = None
    doc.save(ignore_permissions=True, ignore_version=False)  # AUDITED (track_changes -> Version)
    return get_freeze_state()
