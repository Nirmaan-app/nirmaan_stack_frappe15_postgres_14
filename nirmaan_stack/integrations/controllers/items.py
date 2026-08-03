import frappe

def after_insert(doc, method):
    """
    Create an event after item create
    """
    print("HELLO FROM AFTER CREATE")
    event = frappe.publish_realtime("items:created", {'message': 'item'+doc.name+'created'}, user=frappe.session.user)
    print(event)


# RETIRED at ADR-0004 — `on_update` (and its `hooks.py` registration) is gone.
#
# It kept `item_name`/`category` fresh on `TDS Items Child Table` member rows,
# which denormalized those fields via `fetch_from` (and `fetch_from` only
# refreshes when the PARENT `TDS Items` is saved, so a rename left members
# stale). Membership is now N:1 owned by the Item — a group's members are
# DERIVED live as `Items WHERE linked_tds_item = <group>`, reading `item_name`
# and `category` straight off `Items`. There is no denormalized copy left to go
# stale, so the whole class of bug the hook existed for cannot occur.
#
# `TDS Items Child Table` is retired as a writer but left physically dormant
# this cycle (rows retained, not dropped), so nothing here deletes its data.
