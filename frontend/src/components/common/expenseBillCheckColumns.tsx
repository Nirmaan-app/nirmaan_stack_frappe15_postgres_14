/**
 * The Bill check column of the Project Expenses and Non-Project Expenses lists, on their Paid and All tabs (#1640,
 * spec #1637, GLOSSARY *Expense bills*): the result and the approval of the Expense's latest Expense bill, or "—"
 * when it has none. Its header holds two filters, one on the result and one on the approval; both filter on the
 * server (`api/data_table/virtual_fields.py`), so they page with the list.
 *
 * The approval filter needs a column of its own to hold its value: `bill_approval`, kept hidden (each list page
 * hides it, `BILL_APPROVAL_COLUMN_HIDDEN`). The list asks for both fields by name (`EXPENSE_BILL_CHECK_FIELDS`).
 */
import { ColumnDef } from "@tanstack/react-table";

import { DataTableFacetedFilter } from "@/components/data-table/data-table-faceted-filter";
import { cn } from "@/lib/utils";
import {
    BILL_APPROVAL_FILTER_OPTIONS,
    BILL_CHECK_FILTER_OPTIONS,
    type BillApprovalStatus,
    type BillCheckResult,
    type ExpenseListBillCheckFields,
    NO_EXPENSE_BILL_TEXT,
    expenseListBillCheck,
    expenseListBillCheckText,
} from "@/pages/tasks/invoices/utils/expenseBillApprovalView";

const BILL_APPROVAL_COLUMN = "bill_approval";

/** The fields the list endpoint fills from the latest Expense bill; add them to the list's fetch fields. */
export const EXPENSE_BILL_CHECK_FIELDS = ["bill_check", BILL_APPROVAL_COLUMN] as const;

/** The list's initial column visibility: the approval filter's column holds a value and shows nothing. */
export const BILL_APPROVAL_COLUMN_HIDDEN = { [BILL_APPROVAL_COLUMN]: false };

const RESULT_TONE: Record<BillCheckResult, string> = {
    Checking: "text-sky-700",
    Matched: "text-green-700",
    Mismatched: "text-red-700",
    "Not read": "text-amber-700",
    "Not checked": "text-gray-700",
};

const APPROVAL_TONE: Record<BillApprovalStatus, string> = {
    "Auto-approved": "text-green-700",
    Approved: "text-green-700",
    Pending: "text-amber-700",
    Rejected: "text-red-700",
};

/** An Expense's Bill check: its latest bill's result over its approval, or "—" when it has no Expense bill. Also
 *  drawn by Project Payments -> All Payments (#1648). */
interface ExpenseBillCheckCellProps {
    row: ExpenseListBillCheckFields;
}

export const ExpenseBillCheckCell = ({ row }: ExpenseBillCheckCellProps) => {
    const shown = expenseListBillCheck(row);
    if (!shown) return <div className="text-muted-foreground">{NO_EXPENSE_BILL_TEXT}</div>;
    return (
        <div className="flex flex-col whitespace-nowrap">
            <span className={cn("font-medium", RESULT_TONE[shown.result])}>{shown.result}</span>
            <span className={cn("text-xs", APPROVAL_TONE[shown.approval])}>{shown.approval}</span>
        </div>
    );
};

/** A list row with the two fields the list endpoint fills (the doctype types do not carry them). */
const billCheckOf = (row: object): ExpenseListBillCheckFields => row as ExpenseListBillCheckFields;

export const getExpenseBillCheckColumns = <T extends object>(): ColumnDef<T>[] => [
    {
        id: "bill_check",
        accessorFn: (row) => billCheckOf(row).bill_check,
        size: 150,
        header: ({ column, table }) => (
            <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-1">
                    <DataTableFacetedFilter column={column} title="Bill check" options={BILL_CHECK_FILTER_OPTIONS} />
                    <span>Bill check</span>
                </div>
                <div className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
                    <DataTableFacetedFilter
                        column={table.getColumn(BILL_APPROVAL_COLUMN)}
                        title="Approval"
                        options={BILL_APPROVAL_FILTER_OPTIONS}
                    />
                    <span>Approval</span>
                </div>
            </div>
        ),
        cell: ({ row }) => <ExpenseBillCheckCell row={billCheckOf(row.original)} />,
        enableSorting: false,
        meta: {
            exportHeaderName: "Bill check",
            exportValue: (row: T) => expenseListBillCheckText(billCheckOf(row)),
        },
    },
    {
        id: BILL_APPROVAL_COLUMN,
        accessorFn: (row) => billCheckOf(row).bill_approval,
        header: "Approval",
        enableSorting: false,
        enableHiding: false,
        meta: { excludeFromExport: true },
    },
];
