"""
Migration patch to convert delivery_data JSON on Procurement Orders
into standalone Delivery Notes records with Delivery Note Item child rows.

This patch:
1. Queries all POs where status IN ("Partially Delivered", "Delivered")
2. Parses the delivery_data JSON field
3. For each delivery event (sorted by date key):
   - Creates a Delivery Notes record with child items
   - Sets is_stub=0 (full record)
4. Preserves original timestamps for historical accuracy (both parent DN and child items)
5. Does NOT modify or delete the delivery_data JSON on the PO
6. Writes a detailed log file to site logs directory

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
    }

    # Collect detailed issues for the log
    error_details = []       # (po_name, date_key, error_message, traceback)
    dn_insert_failures = []  # (po_name, date_key, note_no, expected_name, error_message, traceback)
    skipped_details = []     # (po_name, reason, extra_info)
    zero_item_details = []   # (po_name, date_key, note_no, raw_items_count)

    # Query all POs that have delivery data
    pos = frappe.db.sql(
        """
        SELECT name, project, vendor, delivery_data
        FROM "tabProcurement Orders"
        WHERE status IN ('Partially Delivered', 'Delivered')
        AND delivery_data IS NOT NULL
        ORDER BY creation ASC
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
                fields=["item_name", "item_id", "category", "make", "procurement_package"],
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
            # Track note_nos used for this PO (DB + this run) to resolve collisions
            used_note_nos = set()

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

                note_no = int(event.get("note_no", 0))

                if note_no == 0:
                    # If note_no not set, derive from position
                    note_no = sorted_dates.index(date_key) + 1

                # Resolve duplicate note_no within this PO
                original_note_no = note_no
                while note_no in used_note_nos:
                    note_no += 1
                if note_no != original_note_no:
                    log.write(f"  note_no collision: PO={po.name} date_key={date_key} original={original_note_no} -> reassigned={note_no}")

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
                    used_note_nos.add(note_no)
                    continue

                used_note_nos.add(note_no)

                # Parse delivery date from date_key (remove timestamp if present)
                delivery_date = date_key.split(" ")[0] if date_key else None
                if delivery_date:
                    try:
                        datetime.strptime(delivery_date, "%Y-%m-%d")
                    except ValueError:
                        skipped_details.append((
                            po.name,
                            f"Invalid date_key format",
                            f"date_key={date_key!r}, note_no={note_no}",
                        ))
                        delivery_date = None

                # Get updated_by
                updated_by = event.get("updated_by")

                # Get attachment
                attachment_id = event.get("attachment_id") or event.get("dc_attachment_id")

                # Build child items, tracking skipped zero-delta items
                raw_items = event.get("items", [])
                child_items = []
                for item in raw_items:
                    from_qty = float(item.get("from", 0) or 0)
                    to_qty = float(item.get("to", 0) or 0)
                    delta = to_qty - from_qty

                    if delta <= 0:
                        continue

                    # Match to PO Item for authoritative field values
                    item_name = item.get("item_name", "")
                    matched = po_item_lookup.get(item_name)

                    child_items.append({
                        "item_id": matched.item_id if matched else item.get("item_id", ""),
                        "item_name": item_name,
                        "make": matched.make if matched else item.get("make", ""),
                        "unit": item.get("unit", ""),
                        "category": matched.category if matched else item.get("category", ""),
                        "procurement_package": matched.procurement_package if matched else "",
                        "delivered_quantity": delta,
                    })

                if not child_items:
                    stats["dns_zero_items"] += 1
                    zero_item_details.append((
                        po.name, date_key, note_no, len(raw_items),
                    ))
                    continue

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
                    dn.insert()

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
    print(f"  DN insert failures:         {len(dn_insert_failures)}")
    print(f"  Other errors:               {stats['errors'] - len(dn_insert_failures)}")
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
    log.write(f"Errors:                     {stats['errors']}")
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

    if zero_item_details:
        log.section(f"ZERO-ITEM DELIVERY EVENTS ({len(zero_item_details)} total)")
        log.write("These events had items in delivery_data but all had delta <= 0 (no actual delivery).")
        log.write("")
        for po_name, date_key, note_no, raw_count in zero_item_details:
            log.write(f"  PO={po_name}  date={date_key}  note_no={note_no}  raw_items={raw_count}")

    if not error_details and not skipped_details and not zero_item_details:
        log.section("ALL CLEAN")
        log.write("No errors, no skipped POs, no zero-item events.")

    log.flush()

    frappe.logger().info(
        f"Delivery data migration: created={stats['dns_created']}, "
        f"skipped={stats['dns_skipped']}, zero_items={stats['dns_zero_items']}, "
        f"errors={stats['errors']}, log={log.log_path}"
    )
