import frappe
from frappe import _

# Role to subject mapping
ROLE_SUBJECT_MAP = {
    "Nirmaan Accountant Profile": "accountant_remark",
    "Nirmaan Procurement Executive Profile": "procurement_remark",
    "Nirmaan Admin Profile": "admin_remark",
    "Nirmaan PMO Executive Profile": "admin_remark",
    "Nirmaan Project Lead Profile": "admin_remark",
    "Nirmaan Project Manager Profile": "admin_remark",
}

# Subject to display label mapping
SUBJECT_LABELS = {
    "accountant_remark": "Accountant",
    "procurement_remark": "Procurement",
    "admin_remark": "Admin",
}


def get_user_role_profile(user: str) -> str:
    """Get the role profile for a user from Nirmaan Users doctype."""
    if user == "Administrator":
        return "Nirmaan Admin Profile"

    # Nirmaan Users uses lowercased email as name
    user_key = user.strip().lower() if user else ""
    role_profile = frappe.get_value("Nirmaan Users", user_key, "role_profile")
    return role_profile or ""


def get_remark_subject_for_user(user: str) -> str:
    """Determine the remark subject based on user's role profile."""
    role_profile = get_user_role_profile(user)
    return ROLE_SUBJECT_MAP.get(role_profile, "admin_remark")


@frappe.whitelist()
def add_po_remark(po_id: str, content: str) -> dict:
    """
    Add a remark to a Procurement Order.
    Subject is auto-determined from the user's role profile.

    Args:
        po_id: The Procurement Order ID
        content: The remark text

    Returns:
        dict with status and the created remark data
    """
    if not po_id:
        frappe.throw(_("PO ID is required"))

    if not content or not content.strip():
        frappe.throw(_("Remark content cannot be empty"))

    # Validate PO exists
    if not frappe.db.exists("Procurement Orders", po_id):
        frappe.throw(_("Procurement Order {0} not found").format(po_id))

    user = frappe.session.user
    subject = get_remark_subject_for_user(user)

    # Create the comment
    comment_doc = frappe.new_doc("Nirmaan Comments")
    comment_doc.comment_type = "po_remark"
    comment_doc.reference_doctype = "Procurement Orders"
    comment_doc.reference_name = po_id
    comment_doc.content = content.strip()
    comment_doc.subject = subject
    comment_doc.comment_by = user
    comment_doc.insert(ignore_permissions=True)

    frappe.db.commit()

    # Get user's full name (Nirmaan Users uses lowercased email as name)
    user_key = user.strip().lower() if user else user
    full_name = frappe.db.get_value("Nirmaan Users", user_key, "full_name") or user

    return {
        "status": "success",
        "message": _("Remark added successfully"),
        "remark": {
            "name": comment_doc.name,
            "content": comment_doc.content,
            "subject": comment_doc.subject,
            "subject_label": SUBJECT_LABELS.get(comment_doc.subject, "Unknown"),
            "comment_by": comment_doc.comment_by,
            "comment_by_name": full_name,
            "creation": str(comment_doc.creation),
        }
    }


@frappe.whitelist()
def get_po_remarks(po_id: str, subject_filter: str = None) -> dict:
    """
    Get all remarks for a Procurement Order.

    Args:
        po_id: The Procurement Order ID
        subject_filter: Optional filter by subject (accountant_remark, procurement_remark, admin_remark)

    Returns:
        dict with remarks list and counts per category
    """
    if not po_id:
        frappe.throw(_("PO ID is required"))

    # Build filters
    filters = {
        "reference_doctype": "Procurement Orders",
        "reference_name": po_id,
        "comment_type": "po_remark",
    }

    if subject_filter and subject_filter in SUBJECT_LABELS:
        filters["subject"] = subject_filter

    # Fetch remarks
    remarks = frappe.get_all(
        "Nirmaan Comments",
        filters=filters,
        fields=["name", "content", "subject", "comment_by", "creation"],
        order_by="creation desc",
        limit=100,
    )

    # Get unique user IDs (lowercased for Nirmaan Users lookup)
    user_ids = list(set([r["comment_by"].strip().lower() if r["comment_by"] else "" for r in remarks]))
    user_ids = [uid for uid in user_ids if uid]  # Remove empty strings

    # Fetch user full names
    user_names = {}
    if user_ids:
        users = frappe.get_all(
            "Nirmaan Users",
            filters={"name": ["in", user_ids]},
            fields=["name", "full_name"],
        )
        user_names = {u["name"]: u["full_name"] for u in users}

    # Enrich remarks with user names and labels
    enriched_remarks = []
    for remark in remarks:
        comment_by = remark["comment_by"] or ""
        comment_by_key = comment_by.strip().lower() if comment_by else ""
        enriched_remarks.append({
            "name": remark["name"],
            "content": remark["content"],
            "subject": remark["subject"],
            "subject_label": SUBJECT_LABELS.get(remark["subject"], "Unknown"),
            "comment_by": comment_by,
            "comment_by_name": user_names.get(comment_by_key, comment_by),
            "creation": str(remark["creation"]),
        })

    # Get counts per category (without filter)
    all_remarks_for_counts = frappe.get_all(
        "Nirmaan Comments",
        filters={
            "reference_doctype": "Procurement Orders",
            "reference_name": po_id,
            "comment_type": "po_remark",
        },
        fields=["subject"],
    )

    counts = {
        "total": len(all_remarks_for_counts),
        "accountant_remark": 0,
        "procurement_remark": 0,
        "admin_remark": 0,
    }

    for r in all_remarks_for_counts:
        if r["subject"] in counts:
            counts[r["subject"]] += 1

    return {
        "status": "success",
        "remarks": enriched_remarks,
        "counts": counts,
    }


@frappe.whitelist()
def get_po_remarks_count(po_id: str) -> dict:
    """
    Get the count of remarks for a Procurement Order.
    Lightweight endpoint for table views.

    Args:
        po_id: The Procurement Order ID

    Returns:
        dict with total count
    """
    if not po_id:
        return {"count": 0}

    count = frappe.db.count(
        "Nirmaan Comments",
        filters={
            "reference_doctype": "Procurement Orders",
            "reference_name": po_id,
            "comment_type": "po_remark",
        },
    )

    return {"count": count}


@frappe.whitelist()
def delete_po_remark(remark_id: str) -> dict:
    """
    Delete a remark. Users can only delete their own remarks.

    Args:
        remark_id: The Nirmaan Comments document name

    Returns:
        dict with status
    """
    if not remark_id:
        frappe.throw(_("Remark ID is required"))

    # Check if remark exists
    if not frappe.db.exists("Nirmaan Comments", remark_id):
        frappe.throw(_("Remark not found"))

    # Get the remark
    remark = frappe.get_doc("Nirmaan Comments", remark_id)

    # Verify it's a PO remark
    if remark.comment_type != "po_remark":
        frappe.throw(_("Invalid remark type"))

    # Check ownership - users can only delete their own remarks
    current_user = frappe.session.user
    current_user_lower = current_user.strip().lower() if current_user else ""
    remark_owner_lower = remark.comment_by.strip().lower() if remark.comment_by else ""

    # Allow if user is owner or Administrator
    if current_user != "Administrator" and current_user_lower != remark_owner_lower:
        frappe.throw(_("You can only delete your own remarks"))

    # Delete the remark
    frappe.delete_doc("Nirmaan Comments", remark_id, ignore_permissions=True)
    frappe.db.commit()

    return {
        "status": "success",
        "message": _("Remark deleted successfully"),
    }


@frappe.whitelist()
def get_po_recent_remarks(po_id: str, limit: int = 3) -> dict:
    """
    Get recent remarks for a PO (for hover display in tables).

    Args:
        po_id: The Procurement Order ID
        limit: Number of remarks to return (default 3)

    Returns:
        dict with recent remarks
    """
    if not po_id:
        return {"remarks": [], "total": 0}

    # Get total count
    total = frappe.db.count(
        "Nirmaan Comments",
        filters={
            "reference_doctype": "Procurement Orders",
            "reference_name": po_id,
            "comment_type": "po_remark",
        },
    )

    # Get recent remarks
    remarks = frappe.get_all(
        "Nirmaan Comments",
        filters={
            "reference_doctype": "Procurement Orders",
            "reference_name": po_id,
            "comment_type": "po_remark",
        },
        fields=["name", "content", "subject", "comment_by", "creation"],
        order_by="creation desc",
        limit=limit,
    )

    # Get user names
    user_ids = list(set([r["comment_by"].strip().lower() for r in remarks if r["comment_by"]]))
    user_names = {}
    if user_ids:
        users = frappe.get_all(
            "Nirmaan Users",
            filters={"name": ["in", user_ids]},
            fields=["name", "full_name"],
        )
        user_names = {u["name"]: u["full_name"] for u in users}

    # Enrich remarks
    enriched = []
    for r in remarks:
        comment_by = r["comment_by"] or ""
        comment_by_key = comment_by.strip().lower()
        enriched.append({
            "name": r["name"],
            "content": r["content"],
            "subject": r["subject"],
            "subject_label": SUBJECT_LABELS.get(r["subject"], "Unknown"),
            "comment_by": comment_by,
            "comment_by_name": user_names.get(comment_by_key, comment_by),
            "creation": str(r["creation"]),
        })

    return {
        "remarks": enriched,
        "total": total,
    }
