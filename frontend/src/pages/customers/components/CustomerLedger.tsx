import React, { useMemo, useState, useCallback } from 'react';
import Fuse from 'fuse.js';
import { Search, FileUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/use-toast';
import { AlertDestructive } from '@/components/layout/alert-banner/error-alert';
import { exportToCsv } from '@/utils/exportToCsv';
import { formatDate } from '@/utils/FormatDate';
import { dateFilterFn } from '@/utils/tableFilters';
import { DateFilterValue } from '../../vendors/components/AdvancedDateFilter';
import { useCustomerLedgerData, CustomerLedgerTransaction, parseLedgerDate } from '../data/useCustomerLedger';
import { CustomerLedgerTable } from './CustomerLedgerTable';
import { CustomerLedgerEntry } from './CustomerLedgerRow';

interface CustomerLedgerProps {
  customerId: string;
  customerName?: string;
}

/**
 * Receivable ledger for one customer: invoices raised vs. cash received.
 *
 * Deliberately simpler than the vendor ledger — the running receivable is
 * seeded at ZERO and covers full history, so there is no opening-balance row,
 * no balancing figures on the Customers doctype, and no 2025-04-01 cutoff.
 */
export const CustomerLedger: React.FC<CustomerLedgerProps> = ({ customerId, customerName }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [projectFilter, setProjectFilter] = useState<Set<string>>(new Set());
  const [dateFilter, setDateFilter] = useState<DateFilterValue | undefined>(undefined);

  const { data: apiResponse, isLoading, error } = useCustomerLedgerData(customerId);
  const transactions = apiResponse?.message;

  const projectFacetOptions = useMemo(() => {
    if (!transactions) return [];
    const projectNames = new Set(transactions.map(t => t.project).filter(Boolean));
    return Array.from(projectNames).map((name) => ({ label: name, value: name }));
  }, [transactions]);

  // Filters run BEFORE the running total, so narrowing to one project yields
  // that project's own receivable trail (same semantics as the vendor ledger).
  const processedItems = useMemo(() => {
    let items: CustomerLedgerTransaction[] = transactions || [];

    if (dateFilter?.value) {
      items = items.filter(item => {
        const mockRow = { getValue: (columnId: string) => item[columnId as keyof CustomerLedgerTransaction] };
        return dateFilterFn(mockRow as any, 'date', dateFilter, () => { });
      });
    }
    if (searchTerm.trim()) {
      const fuse = new Fuse(items, { keys: ['details', 'project', 'type'], threshold: 0.3 });
      items = fuse.search(searchTerm).map(result => result.item);
    }
    if (projectFilter.size > 0) {
      items = items.filter(item => projectFilter.has(item.project));
    }

    let runningReceivable = 0;
    return items.map((entry): CustomerLedgerEntry => {
      runningReceivable += entry.invoice - entry.inflow;
      return { ...entry, receivable: runningReceivable };
    });
  }, [transactions, dateFilter, searchTerm, projectFilter]);

  const totals = useMemo(() => (
    processedItems.reduce((acc, item) => {
      acc.invoice += item.invoice;
      acc.inflow += item.inflow;
      return acc;
    }, { invoice: 0, inflow: 0 })
  ), [processedItems]);

  const closingReceivable = processedItems.length > 0
    ? processedItems[processedItems.length - 1].receivable
    : 0;

  const hasAnyTransactions = (transactions?.length ?? 0) > 0;
  const hasActiveFilters = Boolean(dateFilter?.value) || searchTerm.trim() !== "" || projectFilter.size > 0;

  const handleClearFilters = useCallback(() => {
    setSearchTerm("");
    setProjectFilter(new Set());
    setDateFilter(undefined);
  }, []);


  const handleExportCsv = useCallback(() => {
    const exportColumns = [
      { header: 'Date', accessorKey: 'date' },
      { header: 'Transaction', accessorKey: 'type' },
      { header: 'Project', accessorKey: 'project' },
      { header: 'Details', accessorKey: 'details' },
      { header: 'Invoice', accessorKey: 'invoice' },
      { header: 'Inflow', accessorKey: 'inflow' },
      { header: 'Receivable', accessorKey: 'receivable' },
    ];

    const formattedRows = processedItems.map(item => ({
      date: formatDate(parseLedgerDate(item.date)),
      type: item.type,
      project: item.project,
      details: item.details.replace(/\n/g, ' | '),
      invoice: item.invoice !== 0 ? Number(item.invoice).toFixed(2) : '',
      inflow: item.inflow !== 0 ? Number(item.inflow).toFixed(2) : '',
      receivable: Number(item.receivable).toFixed(2),
    }));

    const footerRow = {
      date: '', type: '', project: '', details: 'Totals & Closing Receivable',
      invoice: Number(totals.invoice).toFixed(2),
      inflow: Number(totals.inflow).toFixed(2),
      receivable: Number(closingReceivable).toFixed(2),
    };

    const label = customerName || customerId;
    const sanitized = label.replace(/[/\\?%*:|"<>]/g, '-');
    exportToCsv(`${sanitized}_Customer_Ledger.csv`, [...formattedRows, footerRow], exportColumns);
    toast({ title: "Export Successful" });
  }, [processedItems, totals, closingReceivable, customerId, customerName]);

  if (error) return <AlertDestructive error={error} />;
  if (isLoading) return <div className="p-4"><Skeleton className="h-48 w-full" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search invoice no, UTR, project..."
            className="h-9 pl-8"
          />
        </div>
        <Button onClick={handleExportCsv} variant="outline" size="sm" className="h-9">
          <FileUp className="mr-2 h-4 w-4" /> Export
        </Button>
      </div>

      <CustomerLedgerTable
        items={processedItems}
        projectOptions={projectFacetOptions}
        projectFilter={projectFilter}
        onSetProjectFilter={setProjectFilter}
        dateFilter={dateFilter}
        onSetDateFilter={setDateFilter}
        totals={totals}
        closingReceivable={closingReceivable}
        hasAnyTransactions={hasAnyTransactions}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={handleClearFilters}
      />
    </div>
  );
};

export default CustomerLedger;
