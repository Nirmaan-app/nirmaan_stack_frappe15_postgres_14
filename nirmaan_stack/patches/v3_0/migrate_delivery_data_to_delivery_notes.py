"""
Migration patch to convert delivery_data JSON on Procurement Orders
into standalone Delivery Notes records with Delivery Note Item child rows.

This patch:
1. Queries all POs where status IN ("Partially Delivered", "Delivered")
2. Parses the delivery_data JSON field
3. For each delivery event (sorted by date key):
   - Positive deltas (to > from): Creates a Delivery Notes record with child items
   - Negative deltas (to < from): Adjusts (reduces) the most recently created DN
     for this PO using LIFO walk-back. If a DN item reaches 0, the child row is
     deleted. If all child rows are removed, the DN itself is deleted.
   - Zero deltas: Skipped
   - Sets is_stub=0 (full record)
4. Note numbers are only consumed when a DN is actually created (no gaps)
5. Preserves original timestamps for historical accuracy (both parent DN and child items)
6. Does NOT modify or delete the delivery_data JSON on the PO
7. Writes a detailed log file to site logs directory

Idempotency: Checks if a DN with the same procurement_order + note_no already exists.
"""

import frappe
import json
import os
from datetime import datetime


LOG_FILENAME = "dn_migration_{ts}.log"


class MigrationLogger:
    """Writes a detailed log file for the migration run."""

    def __init__(self):
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        log_dir = os.path.join(frappe.get_site_path(), "logs")
        os.makedirs(log_dir, exist_ok=True)
        self.log_path = os.path.join(log_dir, LOG_FILENAME.format(ts=ts))
        self._lines = []

    def write(self, line=""):
        self._lines.append(line)

    def section(self, title):
        self.write("")
        self.write("=" * 70)
        self.write(title)
        self.write("=" * 70)

    def subsection(self, title):
        self.write("")
        self.write(f"--- {title} ---")

    def flush(self):
        with open(self.log_path, "w") as f:
            f.write("\n".join(self._lines))


def execute():
    """Migrate delivery_data JSON to Delivery Notes doctype records."""
    log = MigrationLogger()
    log.section("DELIVERY DATA TO DELIVERY NOTES MIGRATION")
    log.write(f"Started at: {datetime.now().isoformat()}")

    print("\n" + "=" * 60)
    print("DELIVERY DATA TO DELIVERY NOTES MIGRATION")
    print("=" * 60)

    existing_count = frappe.db.count("Delivery Notes")
    print(f"\nExisting Delivery Notes: {existing_count}")
    log.write(f"Existing Delivery Notes before migration: {existing_count}")

    stats = {
        "pos_processed": 0,
        "pos_skipped": 0,
        "dns_created": 0,
        "dns_skipped": 0,
        "dns_zero_items": 0,
        "errors": 0,
        "adjustments_applied": 0,
        "dns_deleted_after_adjustment": 0,
        "unresolvable_negatives": 0,
        "catchall_pos_processed": 0,
        "catchall_dns_created": 0,
        "catchall_dns_skipped": 0,
        "catchall_errors": 0,
    }

    # Collect detailed issues for the log
    error_details = []       # (po_name, date_key, error_message, traceback)
    dn_insert_failures = []  # (po_name, date_key, note_no, expected_name, error_message, traceback)
    skipped_details = []     # (po_name, reason, extra_info)
    zero_item_details = []   # (po_name, date_key, note_no, raw_items_count)
    adjustment_details = []  # (po_name, date_key, item_name, delta, target_dn, old_qty, new_qty)
    unresolvable_details = [] # (po_name, date_key, item_name, remaining_delta)

    # Track created DNs per PO for negative adjustment lookups
    # {po_name: [(dn_name, [{"item_name": str, "qty": float, "child_name": str}, ...]), ...]}
    created_dns = {}

    # Query all POs that have delivery data
    pos = frappe.db.sql(
        """
        SELECT name, project, vendor, delivery_data
        FROM "tabProcurement Orders"
        WHERE status IN ('Partially Delivered', 'Delivered')
        AND delivery_data IS NOT NULL
        ORDER BY modified ASC
        """,
        as_dict=True,
    )

    print(f"Found {len(pos)} POs with delivery data to process")
    log.write(f"Found {len(pos)} POs with delivery data to process")

    batch_size = 20
    batch_count = 0

    for po in pos:
        stats["pos_processed"] += 1
        try:
            # Build lookup from PO Items for authoritative field values
            po_items = frappe.get_all("Purchase Order Item",
                filters={"parent": po.name},
                fields=["item_name", "item_id", "category", "make", "procurement_package",
                         "unit", "received_quantity"],
                limit_page_length=0)
            po_item_lookup = {}
            for pi in po_items:
                if pi.item_name and pi.item_name not in po_item_lookup:
                    po_item_lookup[pi.item_name] = pi

            # Parse delivery_data JSON
            raw = po.delivery_data
            if isinstance(raw, str):
                try:
                    parsed = json.loads(raw)
                except json.JSONDecodeError as e:
                    stats["pos_skipped"] += 1
                    reason = f"Invalid JSON: {str(e)}"
                    skipped_details.append((po.name, reason, raw[:200] if raw else ""))
                    print(f"  SKIP {po.name}: {reason}")
                    continue
            elif isinstance(raw, dict):
                parsed = raw
            else:
                stats["pos_skipped"] += 1
                skipped_details.append((po.name, f"Unexpected type: {type(raw).__name__}", ""))
                continue

            delivery_events = parsed.get("data", {})
            if not delivery_events:
                stats["pos_skipped"] += 1
                skipped_details.append((po.name, "Empty delivery_data.data", ""))
                continue

            if not isinstance(delivery_events, dict):
                stats["pos_skipped"] += 1
                skipped_details.append((
                    po.name,
                    f"delivery_data.data is {type(delivery_events).__name__}, expected dict",
                    str(delivery_events)[:200],
                ))
                continue

            # Sort events by date key (chronological)
            sorted_dates = sorted(delivery_events.keys())
            # Running counter — only increments when a DN is actually created
            next_note_no = 1

            for date_key in sorted_dates:
                event = delivery_events[date_key]

                if not isinstance(event, dict):
                    stats["errors"] += 1
                    error_details.append((
                        po.name, date_key,
                        f"Event is {type(event).__name__}, expected dict",
                        str(event)[:200],
                    ))
                    continue

                # Parse delivery date from date_key (remove timestamp if present)
                delivery_date = date_key.split(" ")[0] if date_key else None
                if delivery_date:
                    try:
                        datetime.strptime(delivery_date, "%Y-%m-%d")
                    except ValueError:
                        skipped_details.append((
                            po.name,
                            f"Invalid date_key format",
                            f"date_key={date_key!r}",
                        ))
                        delivery_date = None

                # Get updated_by
                updated_by = event.get("updated_by")

                # Get attachment
                attachment_id = event.get("attachment_id") or event.get("dc_attachment_id")

                # Split items into positive (new delivery) and negative (return/correction)
                raw_items = event.get("items", [])
                child_items = []
                negative_items = []
                for item in raw_items:
                    from_qty = float(item.get("from", 0) or 0)
                    to_qty = float(item.get("to", 0) or 0)
                    delta = to_qty - from_qty

                    item_name = item.get("item_name", "")
                    matched = po_item_lookup.get(item_name)

                    if delta > 0:
                        child_items.append({
                            "item_id": matched.item_id if matched else item.get("item_id", ""),
                            "item_name": item_name,
                            "make": matched.make if matched else item.get("make", ""),
                            "unit": item.get("unit", ""),
                            "category": matched.category if matched else item.get("category", ""),
                            "procurement_package": matched.procurement_package if matched else "",
                            "delivered_quantity": delta,
                        })
                    elif delta < 0:
                        negative_items.append({
                            "item_name": item_name,
                            "delta": delta,  # negative value
                        })
                    # delta == 0 → skip

                # Apply negative adjustments to previously created DNs (LIFO)
                if negative_items:
                    po_dns = created_dns.get(po.name, [])
                    for neg_item in negative_items:
                        remaining = abs(neg_item["delta"])

                        # Walk backwards through created DNs for this PO
                        for dn_entry in reversed(po_dns):
                            if remaining <= 0:
                                break
                            dn_name, dn_items_info = dn_entry
                            for di in dn_items_info:
                                if remaining <= 0:
                                    break
                                if di["item_name"] != neg_item["item_name"]:
                                    continue
                                if di["qty"] <= 0:
                                    continue

                                old_qty = di["qty"]
                                reduction = min(remaining, old_qty)
                                new_qty = old_qty - reduction
                                remaining -= reduction

                                # Update the child row in DB
                                if new_qty > 0:
                                    frappe.db.set_value(
                                        "Delivery Note Item", di["child_name"],
                                        "delivered_quantity", new_qty,
                                        update_modified=False,
                                    )
                                else:
                                    # Remove the child row entirely
                                    frappe.db.sql(
                                        """DELETE FROM "tabDelivery Note Item" WHERE name = %(name)s""",
                                        {"name": di["child_name"]},
                                    )

                                # Update in-memory tracking
                                di["qty"] = new_qty

                                adjustment_details.append((
                                    po.name, date_key, neg_item["item_name"],
                                    neg_item["delta"], dn_name, old_qty, new_qty,
                                ))
                                stats["adjustments_applied"] += 1

                        # Check if any DN became empty after adjustments
                        for dn_entry in list(po_dns):
                            dn_name, dn_items_info = dn_entry
                            if all(di["qty"] <= 0 for di in dn_items_info):
                                # Delete the empty DN record
                                try:
                                    frappe.db.sql(
                                        """DELETE FROM "tabDelivery Note Item" WHERE parent = %(parent)s""",
                                        {"parent": dn_name},
                                    )
                                    frappe.db.sql(
                                        """DELETE FROM "tabDelivery Notes" WHERE name = %(name)s""",
                                        {"name": dn_name},
                                    )
                                    po_dns.remove(dn_entry)
                                    stats["dns_deleted_after_adjustment"] += 1
                                    stats["dns_created"] -= 1  # offset the earlier increment
                                    log.write(f"  Deleted empty DN {dn_name} after negative adjustments")
                                except Exception as e:
                                    log.write(f"  WARN: Failed to delete empty DN {dn_name}: {str(e)}")

                        if remaining > 0:
                            stats["unresolvable_negatives"] += 1
                            unresolvable_details.append((
                                po.name, date_key, neg_item["item_name"], -remaining,
                            ))
                            log.write(
                                f"  UNRESOLVABLE: PO={po.name} date={date_key} "
                                f"item={neg_item['item_name']} excess={-remaining}"
                            )

                # If no positive items, skip DN creation (counter doesn't increment)
                if not child_items:
                    if not negative_items:
                        # Truly zero — all items had delta == 0
                        stats["dns_zero_items"] += 1
                        zero_item_details.append((
                            po.name, date_key, 0, len(raw_items),
                        ))
                    continue

                # Assign sequential note_no only when creating a DN
                note_no = next_note_no

                # Idempotency check
                existing = frappe.db.exists(
                    "Delivery Notes",
                    {"procurement_order": po.name, "note_no": note_no},
                )
                if existing:
                    stats["dns_skipped"] += 1
                    skipped_details.append((
                        po.name,
                        f"DN already exists for note_no={note_no}",
                        f"existing={existing}, date_key={date_key}",
                    ))
                    next_note_no += 1
                    continue

                next_note_no += 1

                # Create DN record
                # Expected name: DN/<series>/<project>/<fin_year>/<note_no>
                expected_name = po.name.replace("PO/", "DN/", 1) + f"/{note_no}" if po.name.startswith("PO/") else f"{po.name}/{note_no}"

                try:
                    dn = frappe.new_doc("Delivery Notes")
                    dn.update({
                        "procurement_order": po.name,
                        "project": po.project,
                        "vendor": po.vendor,
                        "note_no": note_no,
                        "delivery_date": delivery_date,
                        "updated_by_user": updated_by,
                        "nirmaan_attachment": attachment_id,
                        "is_stub": 0,
                    })

                    for ci in child_items:
                        dn.append("items", ci)

                    dn.flags.ignore_permissions = True
                    dn.flags.ignore_mandatory = True
                    dn.flags.skip_po_recalculate = True
                    dn.insert()

                    # Track created DN for future negative adjustments and post-processing
                    dn_items_info = [
                        {"item_name": ci["item_name"], "item_id": ci["item_id"], "qty": ci["delivered_quantity"], "child_name": child.name}
                        for child, ci in zip(dn.items, child_items)
                    ]
                    created_dns.setdefault(po.name, []).append((dn.name, dn_items_info))

                    # Preserve original timestamps on the parent DN record
                    # Use the date_key as creation time if possible
                    creation_time = date_key if " " in date_key else f"{date_key} 00:00:00.000000"
                    try:
                        frappe.db.set_value(
                            "Delivery Notes",
                            dn.name,
                            {
                                "creation": creation_time,
                                "modified": creation_time,
                            },
                            update_modified=False,
                        )
                    except Exception:
                        pass  # Timestamp preservation is best-effort

                    # Preserve original timestamps on child Delivery Note Item rows
                    try:
                        frappe.db.sql(
                            """
                            UPDATE "tabDelivery Note Item"
                            SET creation = %(ts)s, modified = %(ts)s
                            WHERE parent = %(parent)s
                            """,
                            {"ts": creation_time, "parent": dn.name},
                        )
                    except Exception:
                        pass  # Timestamp preservation is best-effort

                    stats["dns_created"] += 1

                except Exception as e:
                    stats["errors"] += 1
                    tb = frappe.get_traceback()
                    dn_insert_failures.append((
                        po.name, date_key, note_no, expected_name,
                        str(e), tb,
                    ))
                    print(f"  FAIL DN insert: PO={po.name} note_no={note_no} name={expected_name}: {str(e)}")
                    continue

            # ---- Post-processing: reconcile DN items with current PO items ----
            po_dns_list = created_dns.get(po.name, [])
            if po_dns_list:
                # Build set of valid PO item_ids (excluding Additional Charges)
                valid_po_items = {}
                for pi in po_items:
                    if pi.category != "Additional Charges" and pi.item_id:
                        valid_po_items[pi.item_id] = pi

                first_dn_with_removals = None
                covered_item_ids = set()

                # Step 1: Remove DN items whose item_id is not in current PO
                for dn_name, dn_items_info in po_dns_list:
                    had_removals = False
                    for di in list(dn_items_info):
                        if di["item_id"] not in valid_po_items:
                            frappe.db.sql(
                                """DELETE FROM "tabDelivery Note Item" WHERE name = %(name)s""",
                                {"name": di["child_name"]},
                            )
                            dn_items_info.remove(di)
                            had_removals = True
                            log.write(
                                f"  Removed stale item: PO={po.name} DN={dn_name} "
                                f"item_id={di['item_id']} item_name={di['item_name']}"
                            )
                        else:
                            covered_item_ids.add(di["item_id"])

                    if had_removals and first_dn_with_removals is None:
                        first_dn_with_removals = dn_name

                # Step 2: Find PO items not covered by any DN
                uncovered_item_ids = set(valid_po_items.keys()) - covered_item_ids

                # Step 3: Add uncovered items to the first DN that had removals
                if uncovered_item_ids and first_dn_with_removals:
                    dn_doc = frappe.get_doc("Delivery Notes", first_dn_with_removals)
                    for item_id in uncovered_item_ids:
                        pi = valid_po_items[item_id]
                        dn_doc.append("items", {
                            "item_id": pi.item_id,
                            "item_name": pi.item_name,
                            "make": pi.make or "",
                            "unit": pi.unit or "",
                            "category": pi.category or "",
                            "procurement_package": pi.procurement_package or "",
                            "delivered_quantity": float(pi.received_quantity or 0),
                        })
                        log.write(
                            f"  Added PO item: PO={po.name} DN={first_dn_with_removals} "
                            f"item_id={pi.item_id} item_name={pi.item_name} "
                            f"qty={pi.received_quantity}"
                        )
                    dn_doc.flags.ignore_permissions = True
                    dn_doc.flags.ignore_mandatory = True
                    dn_doc.flags.skip_po_recalculate = True
                    dn_doc.save()

                # Step 4: Delete DNs left empty after removals
                for dn_name, dn_items_info in list(po_dns_list):
                    if not dn_items_info:
                        frappe.db.sql(
                            """DELETE FROM "tabDelivery Note Item" WHERE parent = %(name)s""",
                            {"name": dn_name},
                        )
                        frappe.db.sql(
                            """DELETE FROM "tabDelivery Notes" WHERE name = %(name)s""",
                            {"name": dn_name},
                        )
                        po_dns_list.remove((dn_name, dn_items_info))
                        stats["dns_created"] -= 1
                        log.write(f"  Deleted empty DN after reconciliation: {dn_name}")

            batch_count += 1
            if batch_count >= batch_size:
                frappe.db.commit()
                batch_count = 0

        except Exception as e:
            stats["errors"] += 1
            tb = frappe.get_traceback()
            error_details.append((po.name, "*", str(e), tb))
            frappe.log_error(
                title="Delivery Data Migration Error",
                message=f"Failed to migrate PO {po.name}: {str(e)}\n{tb}",
            )

    frappe.db.commit()

    # ---- PASS 2: Catch-all for POs with no delivery_data ----
    log.section("PASS 2: CATCH-ALL FOR POs WITHOUT DELIVERY DATA")

    print("\n" + "=" * 60)
    print("PASS 2: CATCH-ALL FOR POs WITHOUT DELIVERY DATA")
    print("=" * 60)

    catchall_pos = frappe.db.sql(
        """
        SELECT name, project, vendor, modified
        FROM "tabProcurement Orders"
        WHERE status IN ('Partially Delivered', 'Delivered')
        AND (delivery_data IS NULL OR delivery_data::text = '' OR delivery_data::text = '{}')
        ORDER BY modified ASC
        """,
        as_dict=True,
    )

    print(f"Found {len(catchall_pos)} POs without delivery_data")
    log.write(f"Found {len(catchall_pos)} POs without delivery_data")

    catchall_batch_count = 0

    for po in catchall_pos:
        stats["catchall_pos_processed"] += 1
        try:
            note_no = 1

            # Idempotency: skip if DN already exists for this PO with note_no=1
            existing = frappe.db.exists(
                "Delivery Notes",
                {"procurement_order": po.name, "note_no": note_no},
            )
            if existing:
                stats["catchall_dns_skipped"] += 1
                skipped_details.append((
                    po.name,
                    f"Catch-all: DN already exists for note_no={note_no}",
                    f"existing={existing}",
                ))
                continue

            # Fetch PO items (excluding Additional Charges)
            po_items = frappe.get_all(
                "Purchase Order Item",
                filters={"parent": po.name},
                fields=["item_id", "item_name", "unit", "quantity", "category",
                         "make", "procurement_package"],
                limit_page_length=0,
            )

            child_items = []
            for item in po_items:
                if item.category == "Additional Charges":
                    continue
                child_items.append({
                    "item_id": item.item_id or "",
                    "item_name": item.item_name or "",
                    "make": item.make or "",
                    "unit": item.unit or "",
                    "category": item.category or "",
                    "procurement_package": item.procurement_package or "",
                    "delivered_quantity": float(item.quantity or 0),
                })

            if not child_items:
                stats["catchall_dns_skipped"] += 1
                skipped_details.append((
                    po.name,
                    "Catch-all: No non-Additional-Charges items found",
                    "",
                ))
                continue

            # Use PO's modified date as delivery_date
            delivery_date = str(po.modified).split(" ")[0] if po.modified else None
            creation_time = str(po.modified) if po.modified else None

            expected_name = po.name.replace("PO/", "DN/", 1) + f"/{note_no}" if po.name.startswith("PO/") else f"{po.name}/{note_no}"

            try:
                dn = frappe.new_doc("Delivery Notes")
                dn.update({
                    "procurement_order": po.name,
                    "project": po.project,
                    "vendor": po.vendor,
                    "note_no": note_no,
                    "delivery_date": delivery_date,
                    "is_stub": 0,
                    "is_return": 0,
                })

                for ci in child_items:
                    dn.append("items", ci)

                dn.flags.ignore_permissions = True
                dn.flags.ignore_mandatory = True
                dn.flags.skip_po_recalculate = True
                dn.insert()

                # Preserve timestamps using PO's modified date (best-effort)
                if creation_time:
                    try:
                        frappe.db.set_value(
                            "Delivery Notes", dn.name,
                            {"creation": creation_time, "modified": creation_time},
                            update_modified=False,
                        )
                    except Exception:
                        pass

                    try:
                        frappe.db.sql(
                            """
                            UPDATE "tabDelivery Note Item"
                            SET creation = %(ts)s, modified = %(ts)s
                            WHERE parent = %(parent)s
                            """,
                            {"ts": creation_time, "parent": dn.name},
                        )
                    except Exception:
                        pass

                stats["catchall_dns_created"] += 1
                log.write(f"  Created catch-all DN: {dn.name} for PO={po.name}")

            except Exception as e:
                stats["catchall_errors"] += 1
                tb = frappe.get_traceback()
                dn_insert_failures.append((
                    po.name, "catch-all", note_no, expected_name,
                    str(e), tb,
                ))
                print(f"  FAIL catch-all DN: PO={po.name}: {str(e)}")
                continue

            catchall_batch_count += 1
            if catchall_batch_count >= batch_size:
                frappe.db.commit()
                catchall_batch_count = 0

        except Exception as e:
            stats["catchall_errors"] += 1
            tb = frappe.get_traceback()
            error_details.append((po.name, "catch-all", str(e), tb))
            frappe.log_error(
                title="Delivery Data Migration Error (Catch-all)",
                message=f"Failed catch-all for PO {po.name}: {str(e)}\n{tb}",
            )

    frappe.db.commit()

    final_count = frappe.db.count("Delivery Notes")

    # ---- Write separate failures log if any DN inserts failed ----
    if dn_insert_failures:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        fail_log_dir = os.path.join(frappe.get_site_path(), "logs")
        fail_log_path = os.path.join(fail_log_dir, f"dn_migration_failures_{ts}.log")
        fail_lines = []
        fail_lines.append("=" * 70)
        fail_lines.append(f"DN MIGRATION FAILURES — {len(dn_insert_failures)} failed inserts")
        fail_lines.append(f"Generated at: {datetime.now().isoformat()}")
        fail_lines.append("=" * 70)
        for i, (po_name, dk, nno, exp_name, msg, tb) in enumerate(dn_insert_failures, 1):
            fail_lines.append("")
            fail_lines.append(f"--- Failure #{i} ---")
            fail_lines.append(f"  PO:            {po_name}")
            fail_lines.append(f"  date_key:      {dk}")
            fail_lines.append(f"  note_no:       {nno}")
            fail_lines.append(f"  expected_name: {exp_name}")
            fail_lines.append(f"  error:         {msg}")
            fail_lines.append(f"  traceback:")
            fail_lines.append(tb)
        with open(fail_log_path, "w") as f:
            f.write("\n".join(fail_lines))
        print(f"\n  *** {len(dn_insert_failures)} DN insert failures — see {fail_log_path}")
    else:
        fail_log_path = None

    # ---- Console summary ----
    print("\n" + "-" * 60)
    print("MIGRATION SUMMARY")
    print("-" * 60)
    print(f"  POs processed:              {stats['pos_processed']}")
    print(f"  POs skipped (no data):      {stats['pos_skipped']}")
    print(f"  DN records created:         {stats['dns_created']}")
    print(f"  DN records skipped (exist): {stats['dns_skipped']}")
    print(f"  DN skipped (zero items):    {stats['dns_zero_items']}")
    print(f"  Negative adjustments:       {stats['adjustments_applied']}")
    print(f"  DNs deleted (empty):        {stats['dns_deleted_after_adjustment']}")
    print(f"  Unresolvable negatives:     {stats['unresolvable_negatives']}")
    print(f"  DN insert failures:         {len(dn_insert_failures)}")
    print(f"  Other errors:               {stats['errors'] - len(dn_insert_failures)}")
    print(f"\n  --- Catch-all (Pass 2) ---")
    print(f"  Catch-all POs processed:    {stats['catchall_pos_processed']}")
    print(f"  Catch-all DNs created:      {stats['catchall_dns_created']}")
    print(f"  Catch-all DNs skipped:      {stats['catchall_dns_skipped']}")
    print(f"  Catch-all errors:           {stats['catchall_errors']}")
    print(f"\n  Total Delivery Notes:       {existing_count} -> {final_count} (+{final_count - existing_count})")
    print(f"  Log file: {log.log_path}")
    if fail_log_path:
        print(f"  Failures log: {fail_log_path}")
    print("=" * 60 + "\n")

    # ---- Detailed log file ----
    log.section("MIGRATION SUMMARY")
    log.write(f"Completed at: {datetime.now().isoformat()}")
    log.write(f"POs processed:              {stats['pos_processed']}")
    log.write(f"POs skipped (no data):      {stats['pos_skipped']}")
    log.write(f"DN records created:         {stats['dns_created']}")
    log.write(f"DN records skipped (exist): {stats['dns_skipped']}")
    log.write(f"DN skipped (zero items):    {stats['dns_zero_items']}")
    log.write(f"Negative adjustments:       {stats['adjustments_applied']}")
    log.write(f"DNs deleted (empty):        {stats['dns_deleted_after_adjustment']}")
    log.write(f"Unresolvable negatives:     {stats['unresolvable_negatives']}")
    log.write(f"Errors:                     {stats['errors']}")
    log.write(f"")
    log.write(f"--- Catch-all (Pass 2) ---")
    log.write(f"Catch-all POs processed:    {stats['catchall_pos_processed']}")
    log.write(f"Catch-all DNs created:      {stats['catchall_dns_created']}")
    log.write(f"Catch-all DNs skipped:      {stats['catchall_dns_skipped']}")
    log.write(f"Catch-all errors:           {stats['catchall_errors']}")
    log.write(f"")
    log.write(f"Total Delivery Notes:       {existing_count} -> {final_count} (+{final_count - existing_count})")

    if dn_insert_failures:
        log.section(f"DN INSERT FAILURES ({len(dn_insert_failures)} total)")
        if fail_log_path:
            log.write(f"Detailed failures log: {fail_log_path}")
        for i, (po_name, dk, nno, exp_name, msg, tb) in enumerate(dn_insert_failures, 1):
            log.subsection(f"Failure #{i}: PO={po_name}, note_no={nno}, name={exp_name}")
            log.write(f"date_key: {dk}")
            log.write(f"Error: {msg}")
            log.write(f"Traceback:")
            log.write(tb)

    if error_details:
        log.section(f"ERRORS ({len(error_details)} total)")
        for i, (po_name, date_key, message, tb) in enumerate(error_details, 1):
            log.subsection(f"Error #{i}: PO={po_name}, date_key={date_key}")
            log.write(f"Message: {message}")
            log.write(f"Traceback:")
            log.write(tb)

    if skipped_details:
        log.section(f"SKIPPED POs / EVENTS ({len(skipped_details)} total)")
        for po_name, reason, extra in skipped_details:
            log.write(f"  PO={po_name}  reason={reason}")
            if extra:
                log.write(f"    detail: {extra}")

    if adjustment_details:
        log.section(f"NEGATIVE ADJUSTMENTS ({len(adjustment_details)} total)")
        log.write("Items with negative deltas (returns/corrections) applied to previous DNs.")
        log.write("")
        for po_name, date_key, item_name, delta, target_dn, old_qty, new_qty in adjustment_details:
            log.write(f"  PO={po_name}  date={date_key}  item={item_name}  delta={delta}  DN={target_dn}  qty: {old_qty} -> {new_qty}")

    if unresolvable_details:
        log.section(f"UNRESOLVABLE NEGATIVES ({len(unresolvable_details)} total)")
        log.write("Negative deltas that could not be fully absorbed by existing DNs (data inconsistency).")
        log.write("")
        for po_name, date_key, item_name, remaining in unresolvable_details:
            log.write(f"  PO={po_name}  date={date_key}  item={item_name}  unabsorbed={remaining}")

    if zero_item_details:
        log.section(f"ZERO-ITEM DELIVERY EVENTS ({len(zero_item_details)} total)")
        log.write("These events had items in delivery_data but all had delta == 0 (no actual delivery).")
        log.write("")
        for po_name, date_key, note_no, raw_count in zero_item_details:
            log.write(f"  PO={po_name}  date={date_key}  note_no={note_no}  raw_items={raw_count}")

    if not error_details and not skipped_details and not zero_item_details and not adjustment_details and not unresolvable_details:
        log.section("ALL CLEAN")
        log.write("No errors, no skipped POs, no zero-item events.")

    log.flush()

    frappe.logger().info(
        f"Delivery data migration: created={stats['dns_created']}, "
        f"skipped={stats['dns_skipped']}, zero_items={stats['dns_zero_items']}, "
        f"adjustments={stats['adjustments_applied']}, "
        f"dns_deleted={stats['dns_deleted_after_adjustment']}, "
        f"unresolvable={stats['unresolvable_negatives']}, "
        f"errors={stats['errors']}, catchall_created={stats['catchall_dns_created']}, "
        f"catchall_errors={stats['catchall_errors']}, log={log.log_path}"
    )
