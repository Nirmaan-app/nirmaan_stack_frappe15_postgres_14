import React, { useState, useCallback } from 'react';
import { Search, FileUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/use-toast';
import { AlertDestructive } from '@/components/layout/alert-banner/error-alert';
import { DateFilterValue } from '../../vendors/components/AdvancedDateFilter';
import { CustomerLedgerTable } from '../../customers/components/CustomerLedgerTable';
import { exportReceivableLedgerCsv, useReceivableLedgerRows } from '../../customers/data/useReceivableLedgerRows';
import { useProjectLedgerData } from '../data/useProjectLedger';

interface ProjectLedgerProps {
  projectId: string;
  projectName?: string;
}

// Every row is this project, so the search skips the project name.
const SEARCH_KEYS = ['details', 'type'] as const;

/**
 * Receivable ledger for one project (Financials -> Project Ledger): the
 * customer ledger's invoices vs. inflows, narrowed to this project, so it has
 * no Project column or project filter.
 *
 * Same rules as the customer ledger (`useReceivableLedgerRows`): running
 * receivable seeded at ZERO over full history, filters applied BEFORE the
 * running total, totals in the footer only.
 */
export const ProjectLedger: React.FC<ProjectLedgerProps> = ({ projectId, projectName }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilterValue | undefined>(undefined);

  const { data: apiResponse, isLoading, error } = useProjectLedgerData(projectId);
  const transactions = apiResponse?.message;

  const ledger = useReceivableLedgerRows(transactions, { dateFilter, searchTerm, searchKeys: SEARCH_KEYS });
  const { items: processedItems, totals, closingReceivable } = ledger;

  const hasAnyTransactions = (transactions?.length ?? 0) > 0;
  const hasActiveFilters = Boolean(dateFilter?.value) || searchTerm.trim() !== "";

  const handleClearFilters = useCallback(() => {
    setSearchTerm("");
    setDateFilter(undefined);
  }, []);

  const handleExportCsv = useCallback(() => {
    exportReceivableLedgerCsv(ledger, { label: projectName || projectId, suffix: 'Project_Ledger', withProject: false });
    toast({ title: "Export Successful" });
  }, [ledger, projectId, projectName]);

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
