// src/pages/vendors/components/LedgerTableRow.tsx

import React from 'react';
import { TableRow, TableCell } from "@/components/ui/table";
import { formatToRoundedIndianRupee } from '@/utils/FormatPrice';
import { formatDate } from '@/utils/FormatDate';

export interface LedgerEntry {
    date: string;
    transactionType: 'PO Created' | 'Invoice Recorded' | 'Payment Made' | 'Refund Received' | 'Credit Note Received';
    project: string;
    details: string;
    amount: number;
    payment: number;
    balance: number;
}

interface LedgerTableRowProps {
  item: LedgerEntry;
}

export const LedgerTableRow: React.FC<LedgerTableRowProps> = ({ item }) => {
  const getTransactionClass = () => {
    switch(item.transactionType) {
        case 'PO Created':
        case 'Invoice Recorded':
            return 'font-semibold text-gray-800';
        case 'Refund Received':
        case 'Credit Note Received':
            return 'font-semibold text-red-600';
        default:
            return 'text-muted-foreground';
    }
  }

  return (
    <TableRow>
      {/* --- PADDING REDUCED ON ALL TABLE CELLS --- */}
      <TableCell className="px-2 py-1 text-sm">{formatDate(new Date(item.date))}</TableCell>
      <TableCell className={`px-2 py-1 text-sm ${getTransactionClass()}`}>
        {item.transactionType}
      </TableCell>
      <TableCell className="px-2 py-1 text-sm text-gray-600 truncate" title={item.project}>
        {item.project}
      </TableCell>
      <TableCell className="px-2 py-1 text-sm text-muted-foreground" style={{ whiteSpace: 'pre-wrap' }}>
        {item.details}
      </TableCell>
      <TableCell className="px-2 py-1 text-right font-mono text-sm">
        {item.amount > 0 ? formatToRoundedIndianRupee(item.amount / 100) : null}
      </TableCell>
      <TableCell className="px-2 py-1 text-right font-mono text-sm">
        {item.payment !== 0 ? formatToRoundedIndianRupee(item.payment / 100) : null}
      </TableCell>
      <TableCell className="px-2 py-1 text-right font-mono text-sm font-semibold">
        {formatToRoundedIndianRupee(item.balance / 100)}
      </TableCell>
    </TableRow>
  );
};