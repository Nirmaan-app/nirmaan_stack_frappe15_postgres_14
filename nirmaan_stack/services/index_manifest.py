"""The index manifest: every database index nirmaan_stack needs, each under a TABLE-UNIQUE name.

WHY THIS EXISTS. Frappe 15 on PostgreSQL names a `search_index` field's index after the bare
fieldname (`CREATE INDEX IF NOT EXISTS "status" ON "tabX"`). PostgreSQL index names are unique per
SCHEMA, not per table, so:
  * a second table's `status` index is never created -- `IF NOT EXISTS` matches the first table's;
  * when a doctype is next synced, `PostgresTable.alter()` drops an index it believes the field no
    longer needs with `DROP INDEX IF EXISTS "status"` -- no table name -- which removes whichever
    table owns that name today. Frappe decides "indexed" by matching the column name anywhere in the
    whole index definition (`postgres/database.py` get_table_columns_description), so the drop also
    fires for columns that are only mentioned by another index.
CU-0 measured both on dev (Desktop 2026-10-17_CU0_Report.md section 1).

THE FIX, without touching any doctype JSON (an alter is exactly what issues the bare drops): each
index below has its own name, `<table_slug>_<columns>_idx` (truncated with a short stable hash past
PostgreSQL's 63 characters), and `ensure_indexes()` creates any that is missing after every migrate.
A bare-name drop never names one of these, so they survive it.

⚠️ THE SLUG KEEPS THE DOCTYPE'S OWN CASE (`BoQ_Cell_Color_boq_idx`, never `boq_cell_color_boq_idx`).
Frappe's "is this column indexed" test is a case-sensitive LIKE over the whole index definition, which
already carries the table name in its own case. A lowercased slug adds new text -- `color`, `config`,
`choice`, `document` -- that matches an unindexed field of the same table and queues a NEW bare drop
for it (measured on dev: 4). Pinned by test_no_name_adds_a_pending_drop.

⚠️ A NEW `search_index` FIELD, OR A NEW `add_index` / `add_unique` CALL IN A DOCTYPE CONTROLLER, NEEDS
AN ENTRY HERE. `test_index_manifest` derives both sets from live meta and the controller source and
fails on any difference. An `add_index` call that already passes its own explicit, table-specific name
keeps that name here, so no duplicate index is built for it.
"""
from __future__ import annotations

import hashlib
import logging
import re
import time

import frappe

PG_NAME_MAX = 63

# (doctype, columns, index name, unique). Generated from live meta + the controllers' add_index /
# add_unique calls (CU-A, 2026-10-17); kept by hand from here on, guarded by the test.
INDEXES: tuple[tuple[str, tuple[str, ...], str, bool], ...] = (
    ('Asset Master', ('project',), 'Asset_Master_project_idx', False),
    ('BOQ Nodes', ('boq',), 'BOQ_Nodes_boq_idx', False),
    ('BOQ Nodes', ('parent_node',), 'BOQ_Nodes_parent_node_idx', False),
    ('BOQ Nodes', ('path',), 'BOQ_Nodes_path_idx', False),
    ('BOQ Nodes', ('sheet',), 'BOQ_Nodes_sheet_idx', False),
    ('BOQs', ('project',), 'BOQs_project_idx', False),
    ('BoQ AI Run Log', ('boq',), 'boq_ai_run_log_boq', False),
    ('BoQ AI Run Log', ('status',), 'boq_ai_run_log_status', False),
    ('BoQ Category Truth Snapshot', ('boq',), 'BoQ_Category_Truth_Snapshot_boq_idx', False),
    ('BoQ Category Truth Snapshot', ('snapshot_batch',), 'BoQ_Category_Truth_Snapshot_snapshot_batch_idx', False),
    ('BoQ Category Truth Snapshot', ('boq', 'sheet_name', 'excel_row', 'discipline', 'snapshot_batch'), 'BoQ_Category_Truth_Snapshot_boq_sheet_name_excel_r_67a71145_idx', False),
    ('BoQ Cell Amount Formula', ('boq',), 'BoQ_Cell_Amount_Formula_boq_idx', False),
    ('BoQ Cell Color', ('boq',), 'BoQ_Cell_Color_boq_idx', False),
    ('BoQ Cell Dismissal', ('boq',), 'BoQ_Cell_Dismissal_boq_idx', False),
    ('BoQ Cell Pricing', ('boq',), 'BoQ_Cell_Pricing_boq_idx', False),
    ('BoQ Cell Reconciliation Choice', ('boq',), 'BoQ_Cell_Reconciliation_Choice_boq_idx', False),
    ('BoQ Cell Remark', ('boq',), 'BoQ_Cell_Remark_boq_idx', False),
    ('BoQ Committed Sheet Grid', ('boq',), 'BoQ_Committed_Sheet_Grid_boq_idx', False),
    ('BoQ Committed Sheet Grid Row', ('parent',), 'BoQ_Committed_Sheet_Grid_Row_parent_idx', False),
    ('BoQ Rate Category Config', ('discipline',), 'BoQ_Rate_Category_Config_discipline_idx', False),
    ('BoQ Rate Category Config', ('import_batch',), 'BoQ_Rate_Category_Config_import_batch_idx', False),
    ('BoQ Rate Category Config', ('discipline', 'category_id'), 'BoQ_Rate_Category_Config_discipline_category_id_idx', False),
    ('BoQ Rate Master Item', ('discipline',), 'BoQ_Rate_Master_Item_discipline_idx', False),
    ('BoQ Rate Master Item', ('import_batch',), 'BoQ_Rate_Master_Item_import_batch_idx', False),
    ('BoQ Rate Master Item', ('item_uid',), 'BoQ_Rate_Master_Item_item_uid_idx', False),
    ('BoQ Rate Master Item', ('discipline', 'kind', 'brand'), 'BoQ_Rate_Master_Item_discipline_kind_brand_idx', False),
    ('BoQ Rate Master Retirement', ('discipline',), 'BoQ_Rate_Master_Retirement_discipline_idx', False),
    ('BoQ Rate Master Retirement', ('scope_value',), 'BoQ_Rate_Master_Retirement_scope_value_idx', False),
    ('BoQ Rate Master Retirement', ('discipline', 'scope_type'), 'BoQ_Rate_Master_Retirement_discipline_scope_type_idx', False),
    ('BoQ Rate Master Snapshot', ('discipline',), 'BoQ_Rate_Master_Snapshot_discipline_idx', False),
    ('BoQ Rate Master Snapshot', ('import_batch',), 'BoQ_Rate_Master_Snapshot_import_batch_idx', False),
    ('BoQ Rate Master Snapshot', ('discipline', 'version'), 'BoQ_Rate_Master_Snapshot_discipline_version_idx', False),
    ('BoQ Rate Suggestion Event', ('boq',), 'BoQ_Rate_Suggestion_Event_boq_idx', False),
    ('BoQ Rate Suggestion Event', ('run_id',), 'BoQ_Rate_Suggestion_Event_run_id_idx', False),
    ('BoQ Rate Suggestion Event', ('boq', 'sheet_name', 'excel_row'), 'BoQ_Rate_Suggestion_Event_boq_sheet_name_excel_row_idx', False),
    ('BoQ Rate Suggestion Run', ('boq',), 'BoQ_Rate_Suggestion_Run_boq_idx', False),
    ('BoQ Rate Suggestion Run', ('run_id',), 'BoQ_Rate_Suggestion_Run_run_id_idx', False),
    ('BoQ Rate Suggestion Run', ('boq', 'sheet_name', 'active'), 'BoQ_Rate_Suggestion_Run_boq_sheet_name_active_idx', False),
    ('BoQ Review Row', ('boq',), 'BoQ_Review_Row_boq_idx', False),
    ('BoQ Review Row', ('path',), 'BoQ_Review_Row_path_idx', False),
    ('BoQ Row BCS Rate', ('boq',), 'BoQ_Row_BCS_Rate_boq_idx', False),
    ('BoQ Row BCS Rate', ('boq', 'sheet_name', 'committed_version', 'is_current', 'excel_row'), 'BoQ_Row_BCS_Rate_boq_sheet_name_committed_version_1e4269e7_idx', False),
    ('BoQ Row Category', ('boq',), 'BoQ_Row_Category_boq_idx', False),
    ('BoQ Row Category', ('boq', 'sheet_name', 'committed_version', 'discipline', 'is_current'), 'BoQ_Row_Category_boq_sheet_name_committed_version_3b3da27d_idx', False),
    ('BoQ Sheet', ('boq',), 'BoQ_Sheet_boq_idx', False),
    ('BoQ Sheet Pricing Lock', ('boq',), 'BoQ_Sheet_Pricing_Lock_boq_idx', False),
    ('BoQ Template Row', ('path',), 'BoQ_Template_Row_path_idx', False),
    ('BoQ Template Row', ('sheet_name',), 'BoQ_Template_Row_sheet_name_idx', False),
    ('BoQ Template Row', ('template',), 'BoQ_Template_Row_template_idx', False),
    ('CEO Hold Reason', ('project',), 'CEO_Hold_Reason_project_idx', False),
    ('Credit Card Statement', ('holder', 'period_from', 'period_to'), 'credit_card_statement_holder_period_unique', True),
    ('Credit Card Statement', ('import_batch',), 'Credit_Card_Statement_import_batch_idx', False),
    ('Critical PO Task Child Table', ('critical_po_task',), 'critical_po_task_child_table_task_idx', False),
    ('Delivery Notes', ('parent_docname',), 'Delivery_Notes_parent_docname_idx', False),
    ('Delivery Notes', ('procurement_order',), 'Delivery_Notes_procurement_order_idx', False),
    ('Delivery Notes', ('project',), 'Delivery_Notes_project_idx', False),
    ('Delivery Notes', ('vendor',), 'Delivery_Notes_vendor_idx', False),
    ('Expense Request', ('vendor',), 'Expense_Request_vendor_idx', False),
    ('HOD Library Content', ('hod_system',), 'HOD_Library_Content_hod_system_idx', False),
    ('Internal Transfer Memo', ('source_project',), 'Internal_Transfer_Memo_source_project_idx', False),
    ('Internal Transfer Memo', ('status',), 'Internal_Transfer_Memo_status_idx', False),
    ('Internal Transfer Memo', ('target_project',), 'Internal_Transfer_Memo_target_project_idx', False),
    ('Items', ('category',), 'Items_category_idx', False),
    ('Items', ('item_name',), 'Items_item_name_idx', False),
    ('Items', ('unit_name',), 'Items_unit_name_idx', False),
    ('Items', ('linked_tds_item',), 'Items_linked_tds_item_idx', False),
    ('Material Test Certificate', ('procurement_order',), 'mtc_procurement_order_index', False),
    ('Material Test Certificate', ('project',), 'mtc_project_index', False),
    ('Material Test Certificate Item', ('parent',), 'mtc_item_parent_index', False),
    ('Non Project Expenses', ('reimbursement',), 'Non_Project_Expenses_reimbursement_idx', False),
    ('Non Project Expenses', ('request_id',), 'Non_Project_Expenses_request_id_idx', False),
    ('Outflow Import Batch', ('source', 'period_from'), 'ofi_batch_source_period_idx', False),
    ('Outflow Import Expense Rule', ('ledger', 'active'), 'oier_ledger_idx', False),
    ('Outflow Import Project Alias', ('active',), 'oipa_active_idx', False),
    ('Outflow Import Row', ('import_batch', 'row_status'), 'ofr_row_batch_status_idx', False),
    ('Outflow Import Row', ('normalized_account', 'amount', 'row_status'), 'ofr_row_account_amount_idx', False),
    ('Outflow Import Row', ('row_status', 'added_on'), 'ofr_row_status_added_idx', False),
    ('Outflow Import Row', ('transfer_id',), 'ofr_row_transfer_idx', False),
    ('Outflow Row Match', ('import_batch',), 'ofm_match_batch_idx', False),
    ('Outflow Row Match', ('import_row',), 'ofm_match_import_row_idx', False),
    ('Outflow Row Match', ('target_doctype', 'target_name'), 'ofm_match_target_idx', False),
    ('Outflow Row Match', ('transfer_id',), 'ofm_match_transfer_idx', False),
    ('PO Delivery Documents', ('parent_docname',), 'PO_Delivery_Documents_parent_docname_idx', False),
    ('PO Delivery Documents', ('parent_doctype',), 'PO_Delivery_Documents_parent_doctype_idx', False),
    ('PO Delivery Documents', ('project',), 'PO_Delivery_Documents_project_idx', False),
    ('PO Delivery Documents', ('type',), 'PO_Delivery_Documents_type_idx', False),
    ('PO Delivery Documents', ('vendor',), 'PO_Delivery_Documents_vendor_idx', False),
    ('Procurement Orders', ('procurement_request',), 'Procurement_Orders_procurement_request_idx', False),
    ('Procurement Orders', ('project',), 'Procurement_Orders_project_idx', False),
    ('Procurement Orders', ('project_name',), 'Procurement_Orders_project_name_idx', False),
    ('Procurement Orders', ('status',), 'Procurement_Orders_status_idx', False),
    ('Procurement Orders', ('vendor',), 'Procurement_Orders_vendor_idx', False),
    ('Procurement Orders', ('vendor_name',), 'Procurement_Orders_vendor_name_idx', False),
    ('Procurement Request Item Detail', ('item_id',), 'Procurement_Request_Item_Detail_item_id_idx', False),
    ('Procurement Requests', ('amended_from',), 'Procurement_Requests_amended_from_idx', False),
    ('Project Action Item', ('project',), 'Project_Action_Item_project_idx', False),
    ('Project Action Item', ('reference_name',), 'Project_Action_Item_reference_name_idx', False),
    ('Project Billing', ('billing_tracker',), 'Project_Billing_billing_tracker_idx', False),
    ('Project Billing', ('project',), 'Project_Billing_project_idx', False),
    ('Project Expenses', ('request_id',), 'Project_Expenses_request_id_idx', False),
    ('Project HOD Document', ('project',), 'Project_HOD_Document_project_idx', False),
    ('Project HOD Document', ('project', 'hod_system', 'document'), 'unique_project_hod_document', True),
    ('Reminder Schedule Log', ('due_date',), 'Reminder_Schedule_Log_due_date_idx', False),
    ('Reminder Schedule Log', ('reminder_schedule',), 'Reminder_Schedule_Log_reminder_schedule_idx', False),
    ('Sent Back Category', ('amended_from',), 'Sent_Back_Category_amended_from_idx', False),
    ('TDS Items Child Table', ('parent',), 'tds_items_child_parent_index', False),
    ('Target Rates', ('item_name',), 'Target_Rates_item_name_idx', False),
    ('Target Rates', ('rate',), 'Target_Rates_rate_idx', False),
    ('Task', ('assignee',), 'Task_assignee_idx', False),
    ('Task', ('assignee_role',), 'Task_assignee_role_idx', False),
    ('Task', ('status',), 'Task_status_idx', False),
    ('Task', ('task_docname',), 'Task_task_docname_idx', False),
    ('Task', ('task_doctype',), 'Task_task_doctype_idx', False),
    ('Vendor Invoices', ('auto_approved',), 'Vendor_Invoices_auto_approved_idx', False),
    ('Vendor Invoices', ('document_name',), 'Vendor_Invoices_document_name_idx', False),
    ('Vendor Invoices', ('document_type',), 'Vendor_Invoices_document_type_idx', False),
    ('Vendor Invoices', ('invoice_date',), 'Vendor_Invoices_invoice_date_idx', False),
    ('Vendor Invoices', ('invoice_no',), 'Vendor_Invoices_invoice_no_idx', False),
    ('Vendor Invoices', ('project',), 'Vendor_Invoices_project_idx', False),
    ('Vendor Invoices', ('status',), 'Vendor_Invoices_status_idx', False),
    ('Vendor Invoices', ('vendor',), 'Vendor_Invoices_vendor_idx', False),
    ('WO Generated Invoice', ('work_order',), 'WO_Generated_Invoice_work_order_idx', False),
)


def index_name(doctype: str, columns) -> str:
    """The table-unique name for an index on `columns` of `doctype` -- the rule every new entry uses."""
    slug = re.sub(r"[^A-Za-z0-9]+", "_", doctype).strip("_")
    base = f"{slug}_{'_'.join(columns)}_idx"
    if len(base) <= PG_NAME_MAX:
        return base
    digest = hashlib.sha1(f"{doctype}|{','.join(columns)}".encode()).hexdigest()[:8]
    return f"{base[:PG_NAME_MAX - len(digest) - 5].rstrip('_')}_{digest}_idx"


def _visible_indexes() -> dict[str, str]:
    """{index name: table name} for every index visible on the search path (a session's temporary
    tables included, which is what lets the test exercise this on a table it creates)."""
    rows = frappe.db.sql(
        """select ic.relname, tc.relname
           from pg_index x
           join pg_class ic on ic.oid = x.indexrelid
           join pg_class tc on tc.oid = x.indrelid
           where pg_table_is_visible(ic.oid)"""
    )
    return {index: table for index, table in rows}


def _table_columns(table: str) -> set[str] | None:
    """The columns of a visible table, or None when no such table is visible."""
    if not frappe.db.sql("select to_regclass(%s)", (f'"{table}"',))[0][0]:
        return None
    return {
        r[0]
        for r in frappe.db.sql(
            """select a.attname from pg_attribute a
               where a.attrelid = to_regclass(%s) and a.attnum > 0 and not a.attisdropped""",
            (f'"{table}"',),
        )
    }


def ensure_indexes(manifest=None) -> list[dict]:
    """Create every manifest index that is missing; NEVER drops anything. Returns one dict per index
    it had to create (name, table, seconds), and logs each one.

    Wired as `after_migrate` (hooks.py), so it runs after Frappe's model sync -- after any bare-name
    drop that sync issued -- and puts back the named index on the next line of the same migrate.

    Plain `CREATE INDEX IF NOT EXISTS`, NOT `CONCURRENTLY`: Frappe runs `after_migrate` inside a
    transaction (`migrate.py` @atomic) and CONCURRENTLY cannot run in one, and a failed CONCURRENTLY
    build leaves an INVALID index that `IF NOT EXISTS` would then skip for good. The plain form holds
    a SHARE lock on its one table -- reads continue, writes to that table wait -- for the build's
    duration (timed per index in the log). Each index is committed on its own, so a failure costs
    only that index: it is logged and the loop carries on, and a deploy is never failed by an index.
    """
    manifest = INDEXES if manifest is None else manifest
    logger = frappe.logger("nirmaan_indexes", allow_site=True)
    # Frappe file loggers default to ERROR off the dev server (utils/logger.py): INFO needs this
    logger.setLevel(logging.INFO)
    existing = _visible_indexes()
    created = []
    for doctype, columns, name, unique in manifest:
        table = f"tab{doctype}"
        owner = existing.get(name)
        if owner == table:
            continue
        if owner:
            msg = f"index manifest: {name} is owned by {owner}, not {table}; not created"
            logger.error(msg)
            print(msg)
            continue
        cols = _table_columns(table)
        if cols is None or not set(columns) <= cols:
            msg = f"index manifest: {table} or its columns {list(columns)} not present; {name} skipped"
            logger.warning(msg)
            print(msg)
            continue
        column_list = ", ".join(f'"{c}"' for c in columns)
        started = time.monotonic()
        try:
            frappe.db.sql_ddl(
                f'CREATE {"UNIQUE " if unique else ""}INDEX IF NOT EXISTS "{name}" ON "{table}" ({column_list})'
            )
            frappe.db.commit()
        except Exception:
            frappe.db.rollback()
            frappe.log_error(title=f"index manifest: create {name} failed", message=frappe.get_traceback())
            print(f"index manifest: create {name} FAILED (Error Log)")
            continue
        seconds = round(time.monotonic() - started, 3)
        existing[name] = table
        created.append({"name": name, "table": table, "seconds": seconds})
        msg = f"index manifest: created {name} on {table} ({', '.join(columns)}) in {seconds} s"
        logger.info(msg)
        print(msg)
    return created
