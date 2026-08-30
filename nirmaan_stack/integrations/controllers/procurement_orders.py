import frappe
from frappe import _
from ..Notifications.pr_notifications import PrNotification, get_allowed_lead_users, get_admin_users, get_allowed_procurement_users, get_allowed_accountants
from .procurement_requests import get_user_name
from nirmaan_stack.api.vendor_credit import recalculate_vendor_credit
from nirmaan_stack.api.projects._tendering_guard import validate_won

def after_insert(doc, method):
        proc_admin_account_users = get_allowed_procurement_users(doc) + get_admin_users() + get_allowed_accountants(doc)
        pr = frappe.get_doc("Procurement Requests", doc.procurement_request)
        custom = doc.custom == "true"
        if proc_admin_account_users:
            for user in proc_admin_account_users:
                if user["push_notification"] == "true":
                    # Dynamically generate notification title/body for each lead
                    notification_title = f"New {'Custom PO' if custom else 'PO'} for Project {doc.project_name}"
                    notification_body = None
                    if custom:
                        notification_body = (
                            f"Hi {user['full_name']}, a new Custom PO for the {doc.project_name} "
                            f"project has been approved and created by {get_user_name(frappe.session.user)}, click here to take action."
                            )
                    else:
                        notification_body = (
                            f"Hi {user['full_name']}, a new purchase order for the {pr.work_package} "
                            f"work package has been approved and created by {get_user_name(frappe.session.user)}, click here to take action."
                            )
                    if user['role_profile'] not in ("Nirmaan Accountant Profile", "Nirmaan Accountant Lead Profile"):
                        click_action_url = f"{frappe.utils.get_url()}/frontend/purchase-orders?tab=Approved%20PO"
                    else:
                        click_action_url = f"{frappe.utils.get_url()}/frontend/project-payments?tab=PO%20Wise"
                    # Send notification for each lead
                    PrNotification(user, notification_title, notification_body, click_action_url)
                else:
                    print(f"push notifications were not enabled for user: {user['full_name']}")
        else:
            print("No Proc Execs, Accountants or Admins found with push notifications enabled.")
        

        message = {
            "title": _(f"New {'Custom Purchase' if custom else 'Purchase'} Order"),
            "description": _(f"New {'Custom PO' if custom else 'PO'}: {doc.name} has been approved and created."),
            "project": doc.project,
            "work_package": pr.work_package if not custom else "Custom",
            "sender": frappe.session.user,
            "docname": doc.name
        }
        # Emit the event to the allowed users
        for user in proc_admin_account_users:
            new_notification_doc = frappe.new_doc('Nirmaan Notifications')
            new_notification_doc.recipient = user['name']
            new_notification_doc.recipient_role = user['role_profile']
            if frappe.session.user != 'Administrator':
                new_notification_doc.sender = frappe.session.user
            new_notification_doc.title = message["title"]
            new_notification_doc.description = message["description"]
            new_notification_doc.document = 'Procurement Orders'
            new_notification_doc.docname = doc.name
            new_notification_doc.project = doc.project
            new_notification_doc.work_package = pr.work_package if not custom else "Custom"
            new_notification_doc.seen = "false"
            new_notification_doc.type = "info"
            new_notification_doc.event_id = "po:new"
            action_url = doc.name.replace("/", "&=")
            if user['role_profile'] not in ("Nirmaan Accountant Profile", "Nirmaan Accountant Lead Profile"):
                new_notification_doc.action_url = f"purchase-orders/{action_url}?tab=Approved%20PO"
            else:
                new_notification_doc.action_url = f"project-payments/{action_url}?tab=PO%20Wise"
            new_notification_doc.insert()
            frappe.db.commit()

            message["notificationId"] = new_notification_doc.name
            print(f"running publish realtime for: {user}")

            frappe.publish_realtime(
                event="po:new",  # Custom event name
                message=message,
                user=user['name']  # Notify only specific users
            )


def validate(doc, method):
    """Prevent reverting PO status if Delivery Notes exist."""
    for item in doc.get("items") or []:
        if not item.item_id:
            item.item_id = item.name

    # Defense-in-depth: refuse to create a PO against a Tendering stub.
    # Guard only NEW docs so edits to legacy/operational POs are unaffected.
    if doc.is_new():
        validate_won(doc.project, "Procurement Order")
    _set_po_billing_status(doc)

    old_doc = doc.get_doc_before_save()
    if old_doc and old_doc.status in ("Partially Dispatched", "Dispatched") and doc.status == "PO Approved":
        if frappe.db.exists("Delivery Notes", {"procurement_order": doc.name}):
            frappe.throw("Cannot revert PO with existing Delivery Notes")


def _set_po_billing_status(doc):
    """Roll up the PO-level billing status from its items (in-memory, no query).

    Item-level billing_status is set explicitly wherever a PO item is created or
    its item changes (approve_vendor_quotes, sent-back, merge, revision), so this
    only aggregates: Billable if ANY item is Billable; Non-Billable only if items
    exist and ALL are Non-Billable; empty otherwise (e.g. no items).
    """
    items = doc.get("items") or []
    statuses = [(item.get("billing_status") or "") for item in items]

    if "Billable" in statuses:
        doc.billing_status = "Billable"
    elif statuses and all(s == "Non-Billable" for s in statuses):
        doc.billing_status = "Non-Billable"
    else:
        doc.billing_status = ""


def on_update(doc, method):
    """
    Manage Approved Quotations and Deletion of PO
    """
    old_doc = doc.get_doc_before_save()
    doc = frappe.get_doc("Procurement Orders", doc.name)
    custom = doc.custom == "true"

    if(doc.status=="PO Approved"):
        try:
            delete_existing_aq_docs(doc)
        except frappe.DoesNotExistError:
            print("PO NOT AVAILABLE IN DB")

    # Revert from Partially Dispatched/Dispatched → PO Approved: clear all is_dispatched flags
    if old_doc and old_doc.status in ("Partially Dispatched", "Dispatched") and doc.status == "PO Approved":
        frappe.db.sql("""
            UPDATE "tabPurchase Order Item"
            SET is_dispatched = 0
            WHERE parent = %s
        """, (doc.name,))
        frappe.db.commit()

    # AQ creation on full dispatch
    if old_doc and old_doc.status in ("PO Approved", "Partially Dispatched") and doc.status in ("Dispatched", "Partially Delivered", "Delivered"):
        if _all_items_dispatched(doc):
            _create_approved_quotations(doc, custom)

    if(doc.status=="Cancelled"):
        cleanup_po_linked_docs(doc.name)
        frappe.delete_doc("Procurement Orders", doc.name)

def _po_delete_blockers(doc):
    """Reasons this PO must not be deleted. Empty list means it is safe to delete.

    WHY THIS EXISTS — deleting a PO is irreversible, and `on_trash` below then
    actively DESTROYS linked records: the PO's own `PO Adjustments` doc, the
    `Project Payments` those adjustment rows point at, and its vendor-credit ledger
    entries. That is fine for a PO nobody has transacted against. It is not fine for
    one that other records' money points at, because the OTHER side is not cleaned
    up and is left referring to a document that no longer exists.

    The case that forced this guard (2026-07):

        16-Jul 19:07  Rs.144.67 of overpaid credit transferred
                      PO/011/00097/26-27  ->  PO/055/00106/26-27
        17-Jul 12:26  the incoming payment PAY-00106-058 is deleted
        17-Jul 12:27  PO/055/00106/26-27 is deleted -- 39 seconds later

    Deleting the payment FIRST is what cleared Frappe's Dynamic Link check, which is
    the only thing that had ever stood in the way. The SOURCE PO was left holding an
    outgoing payment and an "RA PO PO/055/00106/26-27" Return term pointing at
    nothing, and its adjustment ledger could never balance again — it sat payment-
    locked until repaired by hand.

    So the checks below deliberately do NOT rely on the live payment row surviving.
    All three ask the same question a different way: does another record's money
    point here?
    """
    DELIBERATELY_NOT_CHECKED = """
    A PO simply HAVING `Project Payments` is not checked here, on purpose.

    Frappe already blocks that: `Project Payments.document_name` is a Dynamic Link,
    so a live payment row makes `delete_doc` fail on its own. Re-asserting it here
    adds nothing and costs a great deal — measured on live data it would block 4,959
    of 6,879 POs (72%) and 25 of the 54 POs currently in a cancellable state, i.e. it
    would silently change what the Cancel button does. It would also bury the 37 + 38
    POs that the two checks below actually identify inside a blanket rule nobody
    could act on.

    The hole this guard closes is the one that opens when the payment is deleted
    FIRST — which is exactly the 39-second sequence above. Both checks below survive
    that, because neither reads the payment row.
    """

    blockers = []

    # Credit RECEIVED from another PO. Survives deletion of the incoming payment,
    # which is precisely the hole the 17-Jul sequence went through.
    credit_terms = frappe.get_all(
        "PO Payment Terms",
        filters={"parent": doc.name, "label": ["like", "Credit PO %"]},
        fields=["label", "amount"],
    )
    for term in credit_terms:
        blockers.append(
            _("This PO holds credit transferred in from another PO ({0}, {1}). "
              "Deleting it would strand that credit on the source PO.").format(
                term.label, frappe.utils.fmt_money(term.amount, currency="INR")
            )
        )

    # Another PO's adjustment ledger names this PO as where its credit went.
    referencing = frappe.db.sql(
        """SELECT a.po_id, i.amount
           FROM "tabPO Adjustment Items" i
           JOIN "tabPO Adjustments" a ON a.name = i.parent
           WHERE i.target_po = %s""",
        (doc.name,),
        as_dict=True,
    )
    for ref in referencing:
        blockers.append(
            _("{0}'s adjustment ledger records {1} transferred to this PO.").format(
                ref.po_id, frappe.utils.fmt_money(ref.amount, currency="INR")
            )
        )

    return blockers


def on_trash(doc, method):
    # GUARD FIRST — before cleanup_po_linked_docs, which is destructive and cannot
    # be undone. Covers every delete path: Desk, api.delete_custom_po_and_pr, and
    # the status=="Cancelled" branch of on_update above.
    blockers = _po_delete_blockers(doc)
    if blockers:
        # Plain text, no markup — same reason as the D1 refusal in revision_logic: the React
        # app renders these in a text toast, where `<br>`/`&bull;` appear literally.
        frappe.throw(
            _("{0} cannot be deleted — money from other records points at it. {1} "
              "Resolve or transfer this first.").format(doc.name, " ".join(blockers)),
            title=_("PO has financial history"),
        )

    # Clean up linked PO Revisions, PO Adjustments, and their Project Payments
    # (defense-in-depth — handle_cancel_po also does this before status change)
    cleanup_po_linked_docs(doc.name)

    # Clean up vendor credit ledger entries referencing this PO
    if doc.vendor:
        frappe.db.sql("""
            DELETE FROM "tabVendor Credit Ledger"
            WHERE po_id = %s AND parent = %s
        """, (doc.name, doc.vendor))
        recalculate_vendor_credit(doc.vendor, "PO Deleted", po_id=doc.name, project=doc.project, exclude_po=doc.name)

    frappe.db.delete("Nirmaan Comments", {
        "reference_name" : ("=", doc.name)
    })
    delete_existing_aq_docs(doc)
    print(f"flagged for delete po document: {doc} {doc.modified_by} {doc.owner}")
    notifications = frappe.db.get_all("Nirmaan Notifications", 
                                      filters={"docname": doc.name},
                                      fields={"name", "recipient"}
                                      )

    if notifications:
        for notification in notifications:
            print(f"running delete notification event for user: {notification['recipient']} with {notification['name']}")
            message = {
            "title": _("PO Deleted"),
            "description": _(f"PO: {doc.name} has been deleted."),
            "docname": doc.name,
            "sender": frappe.session.user,
            "notificationId" : notification["name"]
            }
            frappe.publish_realtime(
                event="po:delete",
                message=message,
                user=notification["recipient"]
            )
    frappe.db.delete("Nirmaan Notifications", {
        "docname": ("=", doc.name)
    })


def delete_existing_aq_docs(doc):
    # Check and delete existing approved quotations for this procurement order
    frappe.db.delete("Approved Quotations", {
        "procurement_order" : ("=", doc.name)
    })


def cleanup_po_linked_docs(po_name):
    """Delete everything that would block deleting this PO but is not itself a record.

    PO Revisions, PO Adjustments and their linked Project Payments, plus the
    Project Action Item projection rows.

    Must run BEFORE frappe.delete_doc("Procurement Orders") so the
    link-existence check doesn't block PO deletion.
    Order: payments → adjustments → revisions → action items (respects referential integrity).
    """
    # 1. Clean up PO Adjustments and their linked Project Payments
    adjustments = frappe.get_all("PO Adjustments", filters={"po_id": po_name}, pluck="name")
    for adj_name in adjustments:
        linked_payments = frappe.get_all(
            "PO Adjustment Items",
            filters={"parent": adj_name, "project_payment": ["is", "set"]},
            pluck="project_payment",
        )
        for pp_name in linked_payments:
            if frappe.db.exists("Project Payments", pp_name):
                frappe.delete_doc("Project Payments", pp_name, force=True, ignore_permissions=True)

        frappe.delete_doc("PO Adjustments", adj_name, force=True, ignore_permissions=True)

    # 2. Clean up PO Revisions
    revisions = frappe.get_all("PO Revisions", filters={"revised_po": po_name}, pluck="name")
    for rev_name in revisions:
        frappe.delete_doc("PO Revisions", rev_name, force=True, ignore_permissions=True)

    # 3. Clean up the Project Action Item projection rows for this PO.
    #
    # WHY THEY MUST GO: the reconciler only ever flips `status` to "Resolved"
    # (_resolve_all_open) and never deletes a row -- and Frappe's link check ignores
    # custom status fields, skipping only docstatus==2. `Project Action Item` is not
    # submittable, so docstatus is always 0 and a Resolved row blocks the delete
    # exactly as hard as an Open one, forever. That is what strands a PO reverted
    # from Dispatched back to PO Approved: its DNs are gone, but the Resolved
    # DN_PENDING/DC_PENDING rows remain and Cancel PO can never complete.
    #
    # Deleting them loses nothing: they are DERIVED state, rebuildable at any time
    # from services.action_items.reconcile.reconcile_all().
    #
    # delete_doc, not frappe.db.delete -- same idiom as the two cleanups above. A raw
    # row delete would work today (the doctype has no child tables and no doc_events),
    # but it silently stops being correct the moment one is added, or the moment users
    # start commenting on / attaching to / being assigned these rows: only delete_doc
    # clears the Comment, File, ToDo, DocShare and Version rows that would otherwise
    # be orphaned. force=True skips the link check on the action item itself, which
    # must never become a new reason a PO delete fails.
    for ai_name in frappe.get_all(
        "Project Action Item",
        filters={"reference_doctype": "Procurement Orders", "reference_name": po_name},
        pluck="name",
    ):
        frappe.delete_doc("Project Action Item", ai_name, force=True, ignore_permissions=True)


def _all_items_dispatched(doc):
    """Check if all non-Additional-Charges items are dispatched."""
    for item in doc.items:
        if item.category != "Additional Charges" and not item.is_dispatched:
            return False
    return True


def _create_approved_quotations(doc, custom):
    """Create AQ records for all PO items."""
    try:
        vendor = frappe.get_doc("Vendors", doc.vendor)
        orders = doc.get("items")
        delete_existing_aq_docs(doc)
        for order in orders:
            aq = frappe.new_doc('Approved Quotations')
            try:
                if not custom:
                    aq.item_id = order.item_id
                aq.vendor = doc.vendor
                aq.procurement_order = doc.name
                aq.item_name = order.item_name
                aq.unit = order.unit
                aq.quantity = order.quantity
                aq.quote = order.quote
                aq.tax = order.tax
                aq.category = order.category if order.category else ""
                aq.procurement_package = order.procurement_package if order.procurement_package else ""
                aq.make = order.make
                aq.city = vendor.vendor_city
                aq.state = vendor.vendor_state
                aq.insert()
            except frappe.DoesNotExistError:
                continue
    except frappe.DoesNotExistError:
        print("VENDOR NOT AVAILABLE IN DB")