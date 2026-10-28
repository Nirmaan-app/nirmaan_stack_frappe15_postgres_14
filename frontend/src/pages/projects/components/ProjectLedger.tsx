import React, { useMemo, useState, useCallback } from 'react';
import Fuse from 'fuse.js';
import { Row } from '@tanstack/react-table';
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
import { CustomerLedgerTransaction, parseLedgerDate } from '../../customers/data/useCustomerLedger';
import { CustomerLedgerTable } from '../../customers/components/CustomerLedgerTable';
import { CustomerLedgerEntry } from '../../customers/components/CustomerLedgerRow';
import { useProjectLedgerData } from '../data/useProjectLedger';

interface ProjectLedgerProps {
  projectId: string;
  projectName?: string;
}

/**
 * Receivable ledger for one project (Financials -> Project Ledger): the
 * customer ledger's invoices vs. inflows, narrowed to this project, so it has
 * no Project column or project filter.
 *
 * Same rules as the customer ledger: running receivable seeded at ZERO over
 * full history, filters applied BEFORE the running total, totals in the footer
 * only.
 */
export const ProjectLedger: React.FC<ProjectLedgerProps> = ({ projectId, projectName }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilterValue | undefined>(undefined);

  const { data: apiResponse, isLoading, error } = useProjectLedgerData(projectId);
  const transactions = apiResponse?.message;

  const processedItems = useMemo(() => {
    let items: CustomerLedgerTransaction[] = transactions || [];

    if (dateFilter?.value) {
      items = items.filter(item => {
        const mockRow = { getValue: (columnId: string) => item[columnId as keyof CustomerLedgerTransaction] };
        return dateFilterFn(mockRow as unknown as Row<CustomerLedgerTransaction>, 'date', dateFilter, () => { });
      });
    }
    if (searchTerm.trim()) {
      const fuse = new Fuse(items, { keys: ['details', 'type'], threshold: 0.3 });
      items = fuse.search(searchTerm).map(result => result.item);
    }

    let runningReceivable = 0;
    return items.map((entry): CustomerLedgerEntry => {
      runningReceivable += entry.invoice - entry.inflow;
      return { ...entry, receivable: runningReceivable };
    });
  }, [transactions, dateFilter, searchTerm]);

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
  const hasActiveFilters = Boolean(dateFilter?.value) || searchTerm.trim() !== "";

  const handleClearFilters = useCallback(() => {
    setSearchTerm("");
    setDateFilter(undefined);
  }, []);

  const handleExportCsv = useCallback(() => {
    const exportColumns = [
      { header: 'Date', accessorKey: 'date' },
      { header: 'Transaction', accessorKey: 'type' },
      { header: 'Details', accessorKey: 'details' },
      { header: 'Invoice', accessorKey: 'invoice' },
      { header: 'Inflow', accessorKey: 'inflow' },
      { header: 'Receivable', accessorKey: 'receivable' },
    ];

    const formattedRows = processedItems.map(item => ({
      date: formatDate(parseLedgerDate(item.date)),
      type: item.type,
      details: item.details.replace(/\n/g, ' | '),
      invoice: item.invoice !== 0 ? Number(item.invoice).toFixed(2) : '',
      inflow: item.inflow !== 0 ? Number(item.inflow).toFixed(2) : '',
      receivable: Number(item.receivable).toFixed(2),
    }));

    const footerRow = {
      date: '', type: '', details: 'Totals & Closing Receivable',
      invoice: Number(totals.invoice).toFixed(2),
      inflow: Number(totals.inflow).toFixed(2),
      receivable: Number(closingReceivable).toFixed(2),
    };

    const label = projectName || projectId;
    const sanitized = label.replace(/[/\\?%*:|"<>]/g, '-');
    exportToCsv(`${sanitized}_Project_Ledger.csv`, [...formattedRows, footerRow], exportColumns);
    toast({ title: "Export Successful" });
  }, [processedItems, totals, closingReceivable, projectId, projectName]);

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
            placeholder="Search invoice no, UTR..."
            className="h-9 pl-8"
          />
        </div>
        <Button onClick={handleExportCsv} variant="outline" size="sm" className="h-9">
          <FileUp className="mr-2 h-4 w-4" /> Export
        </Button>
      </div>

      <CustomerLedgerTable
        items={processedItems}
        showProjectColumn={false}
        dateFilter={dateFilter}
        onSetDateFilter={setDateFilter}
        totals={totals}
        closingReceivable={closingReceivable}
        hasAnyTransactions={hasAnyTransactions}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={handleClearFilters}
        emptyMessage="No invoices or inflows recorded for this project yet."
      />
    </div>
  );
};

export default ProjectLedger;
