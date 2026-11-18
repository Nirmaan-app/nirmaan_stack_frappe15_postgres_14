"""The two calls a screen makes to follow a background operation it started (ADR 0047).

The lifecycle lives in `services/background_ops.py`; a flow's own endpoint starts the operation there.
"""

import frappe

from nirmaan_stack.services import background_ops


@frappe.whitelist(methods=["GET"])
def get_status(op_id=None):
    """The caller's own operation: `{op_id, kind, state, enqueued_at, started_at, ended_at, timeout, progress,
    result, error, now}`. `now` is the server's clock, so the screen counts its time limit without the browser's.
    Another user's operation is refused."""
    return background_ops.status(op_id)


@frappe.whitelist(methods=["GET"])
def collect_result(op_id=None):
    """The caller's own finished file, as a download. Refused for another user's operation, and before it
    finishes. The finished file stays until the module's 24-hour sweep, so the owner may collect it again."""
    content, filename = background_ops.collect(op_id)
    frappe.local.response.filename = filename
    frappe.local.response.filecontent = content
    frappe.local.response.type = "download"
