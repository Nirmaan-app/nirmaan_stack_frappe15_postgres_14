"""Asset Category -> the monthly audit (owner, 2026-10-14).

Ticking "Monthly audit required" opens the cycle month's audits (from the 28th, next month's) of the
category's assigned assets at once, so nobody waits for a run. Unticking writes nothing: no new audits open,
and audits already open stay until the holder sends them or the 7th after their month records them Missed
and closes them. Rules: `services/asset_audit_open.py`.
"""

from nirmaan_stack.services.asset_audit import NOTE_CATEGORY_ON
from nirmaan_stack.services.asset_audit_open import open_due_audits


def on_update(doc, method):
    """Open the month's audits when the category's audit is switched on."""
    if doc.flags.in_insert or not doc.audit_required or not doc.has_value_changed("audit_required"):
        return  # a new category has no assets yet
    # Read by api/assets/audits.set_category_audit to say how many opened.
    doc.flags.audits_opened = open_due_audits(category=doc.name, note=NOTE_CATEGORY_ON)
