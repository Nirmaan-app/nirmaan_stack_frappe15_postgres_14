import { useMemo } from "react";
import Fuse from "fuse.js";
import type { Row } from "@tanstack/react-table";
import { exportToCsv } from "@/utils/exportToCsv";
import { formatDate } from "@/utils/FormatDate";
import { dateFilterFn } from "@/utils/tableFilters";
import type { DateFilterValue } from "../../vendors/components/AdvancedDateFilter";
import type { CustomerLedgerEntry } from "../components/CustomerLedgerRow";
import { type CustomerLedgerTransaction, parseLedgerDate } from "./useCustomerLedger";

/**
 * The receivable ledger's row rules, shared by the customer's Ledger tab and the project's
 * Financials -> Project Ledger so the two never disagree: filter first, then run the receivable
 * (seeded at ZERO, full history), then total. Narrowing to one project therefore yields that
 * project's own receivable trail (same semantics as the vendor ledger).
 */
export interface ReceivableLedgerFilters {
  dateFilter?: DateFilterValue;
  searchTerm: string;
  /** Fields the search matches on. Pass a module-level constant, so the memo holds. */
  searchKeys: readonly (keyof CustomerLedgerTransaction)[];
  /** Customer ledger only: project names to keep; empty keeps every project. */
  projectFilter?: Set<string>;
}

export interface ReceivableLedger {
  items: CustomerLedgerEntry[];
  totals: { invoice: number; inflow: number };
  closingReceivable: number;
}

export const buildReceivableLedger = (
  transactions: readonly CustomerLedgerTransaction[] | undefined,
  { dateFilter, searchTerm, searchKeys, projectFilter }: ReceivableLedgerFilters,
): ReceivableLedger => {
  let rows: CustomerLedgerTransaction[] = [...(transactions || [])];

  if (dateFilter?.value) {
    rows = rows.filter(item => {
      const mockRow = { getValue: (columnId: string) => item[columnId as keyof CustomerLedgerTransaction] };
      return dateFilterFn(mockRow as unknown as Row<CustomerLedgerTransaction>, 'date', dateFilter, () => { });
    });
  }
  if (searchTerm.trim()) {
    const fuse = new Fuse(rows, { keys: [...searchKeys], threshold: 0.3 });
    rows = fuse.search(searchTerm).map(result => result.item);
  }
  if (projectFilter && projectFilter.size > 0) {
    rows = rows.filter(item => projectFilter.has(item.project));
  }

  let runningReceivable = 0;
  const items = rows.map((entry): CustomerLedgerEntry => {
    runningReceivable += entry.invoice - entry.inflow;
    return { ...entry, receivable: runningReceivable };
  });
  const totals = items.reduce((acc, item) => {
    acc.invoice += item.invoice;
    acc.inflow += item.inflow;
    return acc;
  }, { invoice: 0, inflow: 0 });
  const closingReceivable = items.length > 0 ? items[items.length - 1].receivable : 0;
  return { items, totals, closingReceivable };
};

export const useReceivableLedgerRows = (
  transactions: readonly CustomerLedgerTransaction[] | undefined,
  { dateFilter, searchTerm, searchKeys, projectFilter }: ReceivableLedgerFilters,
): ReceivableLedger =>
  useMemo(
    () => buildReceivableLedger(transactions, { dateFilter, searchTerm, searchKeys, projectFilter }),
    [transactions, dateFilter, searchTerm, searchKeys, projectFilter],
  );

/**
 * Downloads the ledger as shown (filters applied) as `<label>_<suffix>.csv`, with a totals row.
 * `withProject` adds the Project column (the customer ledger; the project ledger is one project).
 */
export const exportReceivableLedgerCsv = (
  { items, totals, closingReceivable }: ReceivableLedger,
  { label, suffix, withProject }: { label: string; suffix: string; withProject: boolean },
) => {
  const exportColumns = [
    { header: 'Date', accessorKey: 'date' },
    { header: 'Transaction', accessorKey: 'type' },
    ...(withProject ? [{ header: 'Project', accessorKey: 'project' }] : []),
    { header: 'Details', accessorKey: 'details' },
    { header: 'Invoice', accessorKey: 'invoice' },
    { header: 'Inflow', accessorKey: 'inflow' },
    { header: 'Receivable', accessorKey: 'receivable' },
  ];

  const formattedRows = items.map(item => ({
    date: formatDate(parseLedgerDate(item.date)),
    type: item.type,
    ...(withProject ? { project: item.project } : {}),
    details: item.details.replace(/\n/g, ' | '),
    invoice: item.invoice !== 0 ? Number(item.invoice).toFixed(2) : '',
    inflow: item.inflow !== 0 ? Number(item.inflow).toFixed(2) : '',
    receivable: Number(item.receivable).toFixed(2),
  }));

  const footerRow = {
    date: '', type: '', ...(withProject ? { project: '' } : {}), details: 'Totals & Closing Receivable',
    invoice: Number(totals.invoice).toFixed(2),
    inflow: Number(totals.inflow).toFixed(2),
    receivable: Number(closingReceivable).toFixed(2),
  };

  const sanitized = label.replace(/[/\\?%*:|"<>]/g, '-');
  exportToCsv(`${sanitized}_${suffix}.csv`, [...formattedRows, footerRow], exportColumns);
};
