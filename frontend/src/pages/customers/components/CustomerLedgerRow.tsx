import React from 'react';
import { Link } from 'react-router-dom';
import { TableRow, TableCell } from "@/components/ui/table";
import { formatToRoundedIndianRupee } from '@/utils/FormatPrice';
import { formatDate } from '@/utils/FormatDate';
import { CustomerLedgerTransaction, parseLedgerDate } from '../data/useCustomerLedger';

export interface CustomerLedgerEntry extends CustomerLedgerTransaction {
  /** Running receivable AFTER this row: previous + invoice - inflow, seeded at 0. */
  receivable: number;
}

interface CustomerLedgerRowProps {
  item: CustomerLedgerEntry;
}

export const CustomerLedgerRow: React.FC<CustomerLedgerRowProps> = ({ item }) => {
  return (
    <TableRow>
      <TableCell className="px-2 py-1 text-sm whitespace-nowrap">
        {formatDate(parseLedgerDate(item.date))}
      </TableCell>
      <TableCell className="px-2 py-1 text-sm font-semibold whitespace-nowrap text-gray-800">
        {item.type}
      </TableCell>
      {/* Linked the same way the Customer Receivable report links it, so the two
          screens showing this data behave alike. */}
      <TableCell className="px-2 py-1 text-sm text-gray-600 truncate" title={item.project}>
        {item.project_id ? (
          <Link
            to={`/projects/${item.project_id}`}
            className="text-blue-600 hover:underline font-medium"
          >
            {item.project}
          </Link>
        ) : (
          item.project
        )}
      </TableCell>
      <TableCell
        className="px-2 py-1 text-sm text-muted-foreground"
        style={{ whiteSpace: 'pre-wrap' }}
      >
        {item.details}
      </TableCell>
      <TableCell className="px-2 py-1 text-right font-mono text-sm">
        {item.invoice !== 0 ? formatToRoundedIndianRupee(item.invoice) : null}
      </TableCell>
      <TableCell className="px-2 py-1 text-right font-mono text-sm">
        {item.inflow !== 0 ? formatToRoundedIndianRupee(item.inflow) : null}
      </TableCell>
      {/* A negative receivable is not an error: the customer has paid ahead of
          billing (advances routinely land before the first invoice). */}
      <TableCell
        className="px-2 py-1 text-right font-mono text-sm font-semibold"
        title={item.receivable < 0 ? "Customer is in credit (paid in advance)" : undefined}
      >
        {formatToRoundedIndianRupee(item.receivable)}
      </TableCell>
    </TableRow>
  );
};
