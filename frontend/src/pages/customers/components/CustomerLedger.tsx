import React, { useMemo, useState, useCallback } from 'react';
import { Search, FileUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/use-toast';
import { AlertDestructive } from '@/components/layout/alert-banner/error-alert';
import { DateFilterValue } from '../../vendors/components/AdvancedDateFilter';
import { useCustomerLedgerData } from '../data/useCustomerLedger';
import { exportReceivableLedgerCsv, useReceivableLedgerRows } from '../data/useReceivableLedgerRows';
import { CustomerLedgerTable } from './CustomerLedgerTable';

interface CustomerLedgerProps {
  customerId: string;
  customerName?: string;
}

const SEARCH_KEYS = ['details', 'project', 'type'] as const;

/**
 * Receivable ledger for one customer: invoices raised vs. cash received.
 *
 * Deliberately simpler than the vendor ledger — the running receivable is
 * seeded at ZERO and covers full history, so there is no opening-balance row,
 * no balancing figures on the Customers doctype, and no 2025-04-01 cutoff.
 * Row rules: `useReceivableLedgerRows`, shared with the project's Project Ledger.
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
  const ledger = useReceivableLedgerRows(transactions, { dateFilter, searchTerm, searchKeys: SEARCH_KEYS, projectFilter });
  const { items: processedItems, totals, closingReceivable } = ledger;

  const hasAnyTransactions = (transactions?.length ?? 0) > 0;
  const hasActiveFilters = Boolean(dateFilter?.value) || searchTerm.trim() !== "" || projectFilter.size > 0;

  const handleClearFilters = useCallback(() => {
    setSearchTerm("");
    setProjectFilter(new Set());
    setDateFilter(undefined);
  }, []);


  const handleExportCsv = useCallback(() => {
    exportReceivableLedgerCsv(ledger, { label: customerName || customerId, suffix: 'Customer_Ledger', withProject: true });
    toast({ title: "Export Successful" });
  }, [ledger, customerId, customerName]);

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
