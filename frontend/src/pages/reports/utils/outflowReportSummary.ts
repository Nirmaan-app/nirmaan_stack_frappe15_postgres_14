/**
 * The Project Outflow Report's summary (#1542): which part-reconciled money its total adds, and the
 * note that walks its total to the glossary's *Project outflow*.
 *
 * The report lists Paid payments and Paid expenses. Its headline adds the confirmed part of records
 * still Reconciliation Pending (`usePartiallyReconciled`). That add-on is filtered here by the SAME
 * columns, facet filters and search the table applies to its rows, so a filtered total is filtered in
 * every part, and mobile and desktop print the same figure.
 */
import {
    ColumnDef,
    ColumnFiltersState,
    createTable,
    getCoreRowModel,
    getFilteredRowModel,
} from "@tanstack/react-table";

import { fuzzyFilter } from "@/components/data-table/data-table-models";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import type { PartiallyReconciledFigure, PartiallyReconciledItem } from "../hooks/usePartiallyReconciled";
import type { OutflowRowData } from "../hooks/useOutflowReportData";

/** The report's "Expense Type" for a payment, by the kind of order it pays. */
export const paymentExpenseType = (documentType?: string | null): string => {
    if (documentType === "Procurement Orders") return "Payment Against PO";
    if (documentType === "Service Requests") return "Payment Against SR";
    return "Unknown Payment";
};

type ReconciledRow = Pick<OutflowRowData, "project" | "vendor" | "amount" | "expense_type" | "details" | "ref"> & {
    payment_date: string | null;
    effective_gst: number;
    item: PartiallyReconciledItem;
};

const asReportRow = (item: PartiallyReconciledItem): ReconciledRow => {
    const isPayment = item.doctype === "Project Payments";
    return {
        payment_date: null,
        project: item.project ?? "",
        vendor: item.vendor ?? "",
        amount: item.amount,
        expense_type: isPayment ? paymentExpenseType(item.document_type) : item.expense_type_name || item.type || "",
        details: (isPayment ? item.document_name : item.description) ?? "",
        effective_gst: 0,
        ref: "--",
        item,
    };
};

/**
 * The part of `items` the report's filters keep, worked out by a table built from the report's own
 * `columns`, so a facet or the search box treats this money exactly as it treats the rows.
 */
export const reconciledInReportFilters = (
    items: PartiallyReconciledItem[],
    columns: ColumnDef<OutflowRowData>[],
    columnFilters: ColumnFiltersState,
    search: string,
): PartiallyReconciledFigure => {
    const table = createTable<ReconciledRow>({
        data: items.map(asReportRow),
        columns: columns as unknown as ColumnDef<ReconciledRow>[],
        state: {},
        onStateChange: () => {},
        renderFallbackValue: null,
        globalFilterFn: fuzzyFilter,
        getCoreRowModel: getCoreRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
    });
    table.setOptions((prev) => ({
        ...prev,
        state: { ...table.initialState, columnFilters, globalFilter: search },
    }));
    const kept = table.getFilteredRowModel().rows.map((row) => row.original.item);
    return {
        amount: kept.reduce((sum, item) => sum + item.amount, 0),
        count: kept.length,
        items: kept,
    };
};

/**
 * The project the note is about: set only when one project is the report's whole filter. With any
 * other filter or a search the list is part of a project, and the note's sum would not hold.
 */
export const singleProjectFilter = (columnFilters: ColumnFiltersState, search: string): string | null => {
    if (search || columnFilters.length !== 1) return null;
    const [filter] = columnFilters;
    if (filter.id !== "project" || !Array.isArray(filter.value) || filter.value.length !== 1) return null;
    return String(filter.value[0]);
};

/**
 * "This list: ₹… · Not in this list: refunds −₹…, TDS +₹… · Project outflow: ₹…". `listTotal` is the
 * table's Paid rows; `refunds`, `tds` and `outflow` are the server's project money for the same project
 * and range, where outflow = payments + expenses − refunds + TDS.
 */
export const projectOutflowNote = (
    listTotal: number,
    money: { refunds: number; tds: number; outflow: number },
): string =>
    `This list: ${formatToRoundedIndianRupee(listTotal)} · ` +
    `Not in this list: refunds −${formatToRoundedIndianRupee(money.refunds)}, ` +
    `TDS +${formatToRoundedIndianRupee(money.tds)} · ` +
    `Project outflow: ${formatToRoundedIndianRupee(money.outflow)}`;
