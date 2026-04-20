import frappe


def _build_category_package_map():
    """
    Source of truth:
      category -> work_package
    """
    categories = frappe.get_all("Category", fields=["name", "work_package"], limit=0)
    return {c.get("name"): c.get("work_package") for c in categories if c.get("name")}


def _fetch_child_rows(child_doctype, parenttype=None):
    filters = {}
    if parenttype:
        filters["parenttype"] = parenttype

    return frappe.get_all(
        child_doctype,
        filters=filters,
        fields=["name", "parent", "parenttype", "item_id", "category", "procurement_package"],
        limit=0,
    )


def _update_child_table(child_doctype, parenttype, category_package_map):
    rows = _fetch_child_rows(child_doctype, parenttype=parenttype)
    updated = 0
    skipped_no_category = 0
    skipped_no_package = 0
    mismatch_before_update = 0
    skipped_no_category_docs = set()
    skipped_no_package_docs = set()

    for row in rows:
        parent_id = row.get("parent")
        row_category = (row.get("category") or "").strip()
        if not row_category:
            skipped_no_category += 1
            if parent_id:
                skipped_no_category_docs.add(parent_id)
            continue

        expected_package = category_package_map.get(row_category)
        if not expected_package:
            skipped_no_package += 1
            if parent_id:
                skipped_no_package_docs.add(parent_id)
            continue

        current_package = row.get("procurement_package") or ""
        target_package = expected_package or ""

        if current_package == target_package:
            continue

        mismatch_before_update += 1

        # Raw SQL update intentionally avoids modified timestamp updates.
        frappe.db.sql(
            f"""
            UPDATE `tab{child_doctype}`
            SET procurement_package = %s
            WHERE name = %s
            """,
            (target_package, row.get("name")),
        )
        updated += 1

    return {
        "total_rows": len(rows),
        "mismatch_before_update": mismatch_before_update,
        "updated": updated,
        "skipped_no_category": skipped_no_category,
        "skipped_no_package": skipped_no_package,
        "skipped_no_category_docs": sorted(skipped_no_category_docs),
        "skipped_no_package_docs": sorted(skipped_no_package_docs),
    }


def execute():
    """
    Fix procurement_package mismatches in child rows using:
      child.category -> Category.work_package

    Targets:
      1) Procurement Requests.order_list (Procurement Request Item Detail)
      2) Sent Back Category.order_list (Procurement Request Item Detail)
      3) Procurement Orders.items (Purchase Order Item)
      4) Delivery Notes.items (Delivery Note Item)

    Important:
      - Uses direct SQL updates on child rows to avoid modified timestamp changes.
      - Does not update parent docs.
      - Does not update Items.
      - Does not rely on child item_id.
    """
    try:
        category_package_map = _build_category_package_map()
        frappe.log(
            "[fix_child_item_category_package_mismatch] "
            f"Category mapped: {len(category_package_map)}"
        )

        pr_result = _update_child_table(
            child_doctype="Procurement Request Item Detail",
            parenttype="Procurement Requests",
            category_package_map=category_package_map,
        )
        sb_result = _update_child_table(
            child_doctype="Procurement Request Item Detail",
            parenttype="Sent Back Category",
            category_package_map=category_package_map,
        )
        po_result = _update_child_table(
            child_doctype="Purchase Order Item",
            parenttype="Procurement Orders",
            category_package_map=category_package_map,
        )
        dn_result = _update_child_table(
            child_doctype="Delivery Note Item",
            parenttype="Delivery Notes",
            category_package_map=category_package_map,
        )

        total_updated = (
            pr_result["updated"]
            + sb_result["updated"]
            + po_result["updated"]
            + dn_result["updated"]
        )

        frappe.db.commit()

        print("\n[fix_child_item_category_package_mismatch] SUMMARY")
        print(
            f"PR  -> total_rows={pr_result['total_rows']}, "
            f"mismatch_before_update={pr_result['mismatch_before_update']}, "
            f"updated={pr_result['updated']}, "
            f"skipped_no_category={pr_result['skipped_no_category']}, "
            f"skipped_no_package={pr_result['skipped_no_package']}"
        )
        print(
            f"SB  -> total_rows={sb_result['total_rows']}, "
            f"mismatch_before_update={sb_result['mismatch_before_update']}, "
            f"updated={sb_result['updated']}, "
            f"skipped_no_category={sb_result['skipped_no_category']}, "
            f"skipped_no_package={sb_result['skipped_no_package']}"
        )
        print(
            f"PO  -> total_rows={po_result['total_rows']}, "
            f"mismatch_before_update={po_result['mismatch_before_update']}, "
            f"updated={po_result['updated']}, "
            f"skipped_no_category={po_result['skipped_no_category']}, "
            f"skipped_no_package={po_result['skipped_no_package']}"
        )
        print(
            f"DN  -> total_rows={dn_result['total_rows']}, "
            f"mismatch_before_update={dn_result['mismatch_before_update']}, "
            f"updated={dn_result['updated']}, "
            f"skipped_no_category={dn_result['skipped_no_category']}, "
            f"skipped_no_package={dn_result['skipped_no_package']}"
        )
        print(f"TOTAL updated={total_updated}")

        # print("\n[fix_child_item_category_package_mismatch] SKIPPED DOC IDS")
        # print(f"PR skipped_no_category_docs: {pr_result['skipped_no_category_docs']}")
        # print(f"PR skipped_no_package_docs: {pr_result['skipped_no_package_docs']}")
        # print(f"SB skipped_no_category_docs: {sb_result['skipped_no_category_docs']}")
        # print(f"SB skipped_no_package_docs: {sb_result['skipped_no_package_docs']}")
        # print(f"PO skipped_no_category_docs: {po_result['skipped_no_category_docs']}")
        # print(f"PO skipped_no_package_docs: {po_result['skipped_no_package_docs']}")
        # print(f"DN skipped_no_category_docs: {dn_result['skipped_no_category_docs']}")
        # print(f"DN skipped_no_package_docs: {dn_result['skipped_no_package_docs']}")
    except Exception:
        print(
            "Patche Failed Rollback "
        )
        frappe.db.rollback()
        raise
