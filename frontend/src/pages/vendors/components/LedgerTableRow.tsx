
import React from 'react';
import { TableRow, TableCell } from "@/components/ui/table";
import { formatToRoundedIndianRupee } from '@/utils/FormatPrice';
import { formatDate } from '@/utils/FormatDate';
import {Link} from "react-router-dom";

export interface LedgerEntry {
    date: string;
    transactionType: 'PO Created' | 'Invoice Recorded' | 'Payment Made' | 'Refund Received' | 'Credit Note Recorded';
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
            return 'font-semibold text-gray-800';
        case 'Invoice Recorded':
            return 'font-semibold text-gray-800';
        case 'Refund Received':
        case 'Credit Note Recorded':
            return 'font-semibold text-red-600';
        default:
            return 'text-muted-foreground';
    }
  }

  // **NEW FUNCTION TO RENDER DETAILS WITH CLICKABLE PO**

  
  const renderDetails = () => {
    const parts = item.details.split('\n');
    return parts.map((part, index) => {
        if (part.startsWith('For PO: ')) {
            const poId = part.substring('For PO: '.length);
            return (
                <React.Fragment key={index}>
                    For PO: <Link className="text-blue-600 hover:underline font-medium" to={`${poId.replaceAll("/", "&=")}`}> 
                              {poId}
                          </Link>
                </React.Fragment>
            );
        }
        if (part.startsWith('PO: ')) {
            const poId = part.substring('PO: '.length);
            return (
                <React.Fragment key={index}>
                   PO: <Link className="text-blue-600 hover:underline font-medium" to={`${poId.replaceAll("/", "&=")}`}> 
                              {poId}
                          </Link>
                </React.Fragment>
            );
        }
        return <React.Fragment key={index}>{part}{index < parts.length - 1 && <br />}</React.Fragment>;
    });
  };

  return (
    <TableRow>
      <TableCell className="px-2 py-1 text-sm">{formatDate(new Date(item.date))}</TableCell>
      <TableCell className={`px-2 py-1 text-sm ${getTransactionClass()}`}>
        {item.transactionType}
      </TableCell>
      <TableCell className="px-2 py-1 text-sm text-gray-600 truncate" title={item.project}>
        {item.project}
      </TableCell>
      {/* MODIFIED to use the renderDetails function */}
      <TableCell className="px-2 py-1 text-sm text-muted-foreground" style={{ whiteSpace: 'pre-wrap' }}>
        {renderDetails()}
      </TableCell>
      <TableCell className="px-2 py-1 text-right font-mono text-sm">
        {/* Show negative amount for credit notes */}
        {item.amount !== 0 ? formatToRoundedIndianRupee(item.amount) : null}
      </TableCell>
      <TableCell className="px-2 py-1 text-right font-mono text-sm">
        {item.payment !== 0 ? formatToRoundedIndianRupee(item.payment) : null}
      </TableCell>
      <TableCell className="px-2 py-1 text-right font-mono text-sm font-semibold">
        {formatToRoundedIndianRupee(item.balance)}
      </TableCell>
    </TableRow>
  );
};

