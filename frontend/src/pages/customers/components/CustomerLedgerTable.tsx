import React from 'react';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableFooter,
} from "@/components/ui/table";
import { SimpleFacetedFilter } from '../../projects/components/SimpleFacetedFilter';
import { AdvancedDateFilter, DateFilterValue } from '../../vendors/components/AdvancedDateFilter';
import { Button } from '@/components/ui/button';
import { formatToRoundedIndianRupee } from '@/utils/FormatPrice';
import { CustomerLedgerRow, CustomerLedgerEntry } from './CustomerLedgerRow';

interface CustomerLedgerTableProps {
  items: CustomerLedgerEntry[];
  projectOptions: { label: string; value: string }[];
  projectFilter: Set<string>;
  onSetProjectFilter: (selected: Set<string>) => void;
  dateFilter: DateFilterValue | undefined;
  onSetDateFilter: (filter: DateFilterValue | undefined) => void;
  totals: { invoice: number; inflow: number };
  closingReceivable: number;
  /** False when the customer has no invoices and no inflows at all. */
  hasAnyTransactions: boolean;
  /** True when a search / project / date filter is currently narrowing the rows. */
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}

/**
 * Plain (non-virtualized) table. The busiest live customer has ~60 ledger rows
 * across all history, so the virtualizer the vendor ledger uses would cost more
 * than it saves.
 */
export const CustomerLedgerTable: React.FC<CustomerLedgerTableProps> = ({
  items,
  projectOptions,
  projectFilter,
  onSetProjectFilter,
  dateFilter,
  onSetDateFilter,
  totals,
  closingReceivable,
  hasAnyTransactions,
  hasActiveFilters,
  onClearFilters,
}) => {
  const colSpan = 7;

  return (
    <div className="rounded-md border overflow-x-auto max-h-[70vh] overflow-y-auto relative">
      <Table>
        <TableHeader className="bg-gray-50 sticky top-0 z-10">
          <TableRow>
            <TableHead className="px-2 py-1 min-w-[150px] font-semibold">
              <AdvancedDateFilter value={dateFilter} onChange={onSetDateFilter} />
              Date
            </TableHead>
            <TableHead className="px-2 py-1 min-w-[140px] font-semibold">Transaction</TableHead>
            <TableHead className="px-2 py-1 min-w-[180px] font-semibold">
              <div className="flex items-center gap-1">
                <SimpleFacetedFilter
                  title="Project"
                  options={projectOptions}
                  selectedValues={projectFilter}
                  onSelectedValuesChange={onSetProjectFilter}
                />
                <span>Project</span>
              </div>
            </TableHead>
            <TableHead className="px-2 py-1 min-w-[200px] font-semibold">Details</TableHead>
            <TableHead className="px-2 py-1 text-right min-w-[120px] font-semibold">Invoice</TableHead>
            <TableHead className="px-2 py-1 text-right min-w-[120px] font-semibold">Inflow</TableHead>
            <TableHead className="px-2 py-1 text-right min-w-[130px] font-semibold">Receivable</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {/* Two different empty states. "No transactions found for this period" told a
              customer with genuinely zero activity to go clear a date filter that was never
              applied; and a filter that empties the grid must always offer a way back. */}
          {items.length === 0 && (
            <TableRow>
              <TableCell colSpan={colSpan} className="h-24 text-center">
                {hasActiveFilters ? (
                  <div className="flex flex-col items-center gap-2">
                    <span className="text-muted-foreground">
                      No transactions match the current filters.
                    </span>
                    <Button variant="outline" size="sm" onClick={onClearFilters}>
                      Clear filters
                    </Button>
                  </div>
                ) : hasAnyTransactions ? (
                  <span className="text-muted-foreground">No transactions to show.</span>
                ) : (
                  <span className="text-muted-foreground">
                    No invoices or inflows recorded for this customer yet.
                  </span>
                )}
              </TableCell>
            </TableRow>
          )}
          {items.map((item, index) => (
            <CustomerLedgerRow key={`row-${index}`} item={item} />
          ))}
        </TableBody>

        <TableFooter className="sticky bottom-0 bg-gray-100">
          <TableRow>
            <TableCell colSpan={4} className="px-2 py-1 font-semibold text-gray-700 text-right">
              Totals &amp; Closing Receivable
            </TableCell>
            <TableCell className="px-2 py-1 text-right font-mono font-semibold">
              {formatToRoundedIndianRupee(totals.invoice)}
            </TableCell>
            <TableCell className="px-2 py-1 text-right font-mono font-semibold">
              {formatToRoundedIndianRupee(totals.inflow)}
            </TableCell>
            <TableCell className="px-2 py-1 text-right font-mono font-semibold">
              {formatToRoundedIndianRupee(closingReceivable)}
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
};
