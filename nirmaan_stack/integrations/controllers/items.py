import frappe

def after_insert(doc, method):
    """
    Create an event after item create
    """
    print("HELLO FROM AFTER CREATE")
    event = frappe.publish_realtime("items:created", {'message': 'item'+doc.name+'created'}, user=frappe.session.user)
    print(event)

    # An item can be BORN linked (the Items form has the TDS field), and
    # `on_update` deliberately skips the insert path, so the mirror is seeded here.
    if doc.get("linked_tds_item"):
        _safe_rebuild(doc.get("linked_tds_item"))


# ─────────────────────────────────────────────────────────────────────────────
# `members` DISPLAY-MIRROR maintenance (owner decision 2026-08-04).
#
# HISTORY: this hook was RETIRED at ADR-0004 because the child table stopped
# being read — there was no denormalized copy left to keep fresh. The owner has
# since asked for the Desk `Members` grid to show members again, so the child
# table is repopulated as a ONE-WAY MIRROR of `Items.linked_tds_item` (the
# source of truth, unchanged). That brings the staleness back, so the hook comes
# back with it.
#
# TWO distinct triggers, and BOTH are needed:
#   * linkage changed  → the item joined and/or left a group; rebuild both ends.
#   * item_name/category changed → the item stayed put, but the mirror stores
#     COPIES of those fields, so its row is now stale. This is the exact bug the
#     original hook existed for.
#
# The `linking.py` endpoints do NOT reach here — they use
# `frappe.db.set_value(update_modified=False)`, which fires no doc lifecycle at
# all, and call the rebuild themselves.
#
# Never raises into a save: an item edit must not fail because a display mirror
# could not be refreshed.
# ─────────────────────────────────────────────────────────────────────────────

_MIRROR_STALE_FIELDS = ("item_name", "category")


def _safe_rebuild(*groups):
    try:
        from nirmaan_stack.api.tds.members import rebuild_group_members_bulk

        rebuild_group_members_bulk([g for g in groups if g])
    except Exception:
        frappe.log_error(
            title="TDS members mirror rebuild failed",
            message=frappe.get_traceback(),
        )


def on_update(doc, method=None):
    """Keep the `members` mirror in step with an Items doc save."""
    before = doc.get_doc_before_save()
    if before is None:
        # Insert path: after_insert already covers a born-linked item.
        return

    previous = before.get("linked_tds_item")
    current = doc.get("linked_tds_item")

    if previous != current:
        _safe_rebuild(previous, current)  # both ends of the move
    elif current and any(
        before.get(f) != doc.get(f) for f in _MIRROR_STALE_FIELDS
    ):
        _safe_rebuild(current)  # same group, now-stale copied fields


def after_delete(doc, method=None):
    """A deleted item leaves a dangling mirror row — drop it by re-deriving."""
    _safe_rebuild(doc.get("linked_tds_item"))
