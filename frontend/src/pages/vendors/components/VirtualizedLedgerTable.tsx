// src/pages/vendors/components/VirtualizedLedgerTable.tsx

import React, { useState, useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableFooter } from "@/components/ui/table";
import { SimpleFacetedFilter } from '../../projects/components/SimpleFacetedFilter';
import { LedgerTableRow, LedgerEntry } from './LedgerTableRow';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Save } from 'lucide-react';
import { formatToRoundedIndianRupee } from '@/utils/FormatPrice';
import { AdvancedDateFilter, DateFilterValue } from './AdvancedDateFilter';


// Define an interface for the props of the editable opening balance row
interface OpeningBalanceRowProps {
    balance: number;
    onSave: (newBalance: number) => void;
    isSaving: boolean;
}

const OpeningBalanceRow: React.FC<OpeningBalanceRowProps> = ({ balance, onSave, isSaving }) => {
    const [editableBalance, setEditableBalance] = useState(balance);

    useEffect(() => {
        setEditableBalance(balance);
    }, [balance]);

    const handleSave = () => {
        if (editableBalance !== balance) {
            onSave(editableBalance);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            handleSave();
        }
    };

    return (
        <TableRow className="bg-gray-100 hover:bg-gray-100">
            <TableCell colSpan={4} className="px-2 py-1 font-semibold text-gray-700 text-right">
                Opening Balance
            </TableCell>
            <TableCell className="px-2 py-1 text-right font-mono font-semibold">{""}</TableCell>
                <TableCell className="px-2 py-1 text-right font-mono font-semibold">{""}</TableCell>
            <TableCell className="px-2 py-1 text-right">
                <div className="flex items-center justify-end gap-2">
                    <Input
                        type="number"
                        value={Number(editableBalance).toString()}
                        onChange={(e) => setEditableBalance(Number(e.target.value))} 
                        onBlur={handleSave}
                        onKeyDown={handleKeyDown}
                        className="h-8 w-32 text-right font-mono"
                        disabled={isSaving}
                        aria-label="Opening Balance"
                    />
                    <Button size="icon" onClick={handleSave} disabled={isSaving || editableBalance === balance} className="h-8 w-8 flex-shrink-0">
                        <Save className="h-4 w-4" />
                    </Button>
                </div>
            </TableCell>
        </TableRow>
    );
}

// Update the main component's props interface
interface VirtualizedLedgerTableProps {
  items: LedgerEntry[];
  activeSubTab: 'poLedger' | 'invoicesLedger';
  projectOptions: { label: string; value: string }[];
  projectFilter: Set<string>;
  onSetProjectFilter: (selected: Set<string>) => void;
  openingBalance: number;
  onSaveOpeningBalance: (newBalance: number) => void;
  isSavingBalance: boolean;
  totals: { amount: number; payment: number; };
  endBalance: number;
  // Props for the date filter
  dateFilter: DateFilterValue | undefined;
  onSetDateFilter: (filter: DateFilterValue | undefined) => void;
}

export const VirtualizedLedgerTable: React.FC<VirtualizedLedgerTableProps> = (props) => {
  const { 
    items, 
    activeSubTab, 
    projectOptions, 
    projectFilter, 
    onSetProjectFilter, 
    openingBalance, 
    onSaveOpeningBalance, 
    isSavingBalance, 
    totals, 
    endBalance,
    dateFilter,
    onSetDateFilter
  } = props;
  
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 10,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom = virtualRows.length > 0 ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end : 0;
  
  const colSpan = 7;

  return (
    <div ref={parentRef} className="rounded-md border overflow-x-auto max-h-[70vh] overflow-y-auto relative">
      <Table>
        <TableHeader className='bg-gray-50 sticky top-0 z-10'>
          <TableRow>
            <TableHead className="px-2 py-1 min-w-[180px] font-semibold">
                <AdvancedDateFilter
                    // title="Filter by Date"
                    value={dateFilter}
                    onChange={onSetDateFilter}
                />
                Date
            </TableHead>
            <TableHead className="px-2 py-1 min-w-[150px] font-semibold">Transactions</TableHead>
            <TableHead className="px-2 py-1 min-w-[180px] font-semibold">
                <div className="flex items-center gap-1">
                    <SimpleFacetedFilter title="Project" options={projectOptions} selectedValues={projectFilter} onSelectedValuesChange={onSetProjectFilter} />
                    <span>Project</span>
                </div>
            </TableHead>
            <TableHead className="px-2 py-1 min-w-[200px] font-semibold">Details</TableHead>
            <TableHead className="px-2 py-1 text-right min-w-[120px] font-semibold">{activeSubTab === 'poLedger' ? 'PO Amount' : 'Invoice Amount'}</TableHead>
            <TableHead className="px-2 py-1 text-right min-w-[120px] font-semibold">Payments</TableHead>
            <TableHead className="px-2 py-1 text-right min-w-[120px] font-semibold">Balance</TableHead>
          </TableRow>
          <OpeningBalanceRow 
            balance={openingBalance} 
            onSave={onSaveOpeningBalance} 
            isSaving={isSavingBalance}
          />
        </TableHeader>
        <TableBody>
          {paddingTop > 0 && (<TableRow><td colSpan={colSpan} style={{ height: `${paddingTop}px` }} /></TableRow>)}
          
          {virtualRows.length === 0 && items.length === 0 && (
              <TableRow><TableCell colSpan={colSpan} className="h-24 text-center">No transactions found for this period.</TableCell></TableRow>
          )}
          
          {virtualRows.map(virtualRow => {
            const item = items[virtualRow.index];
            return (<LedgerTableRow key={`row-${virtualRow.index}`} item={item} />);
          })}

          {paddingBottom > 0 && (<TableRow><td colSpan={colSpan} style={{ height: `${paddingBottom}px` }} /></TableRow>)}
        </TableBody>
        <TableFooter className="sticky bottom-0 bg-gray-100">
            <TableRow>
                <TableCell colSpan={4} className="px-2 py-1 font-semibold text-gray-700 text-right"> Totals & Closing Balance </TableCell>
                <TableCell className="px-2 py-1 text-right font-mono font-semibold">{formatToRoundedIndianRupee(totals.amount)}</TableCell>
                <TableCell className="px-2 py-1 text-right font-mono font-semibold">{formatToRoundedIndianRupee(totals.payment)}</TableCell>
                <TableCell className="px-2 py-1 text-right font-mono font-semibold">{formatToRoundedIndianRupee(endBalance)}</TableCell>
            </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
};

// Before Date Filter is added...

// import React, { useState, useEffect, useRef } from 'react';
// import { useVirtualizer } from '@tanstack/react-virtual';
// import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableFooter } from "@/components/ui/table";
// import { SimpleFacetedFilter } from '../../projects/components/SimpleFacetedFilter';
// import { LedgerTableRow, LedgerEntry } from './LedgerTableRow';
// import { Input } from '@/components/ui/input';
// import { Button } from '@/components/ui/button';
// import { Save } from 'lucide-react';
// import { formatToRoundedIndianRupee } from '@/utils/FormatPrice';

// // Define an interface for the props of the editable opening balance row
// interface OpeningBalanceRowProps {
//     balance: number;
//     onSave: (newBalance: number) => void;
//     isSaving: boolean;
// }

// const OpeningBalanceRow: React.FC<OpeningBalanceRowProps> = ({ balance, onSave, isSaving }) => {
//     const [editableBalance, setEditableBalance] = useState(balance);

//     useEffect(() => {
//         setEditableBalance(balance);
//     }, [balance]);

//     const handleSave = () => {
//         if (editableBalance !== balance) {
//             onSave(editableBalance);
//         }
//     };

//     const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
//         if (e.key === 'Enter') {
//             handleSave();
//         }
//     };

//     return (
//         <TableRow className="bg-gray-100 hover:bg-gray-100">
//             {/* --- PADDING REDUCED and ALIGNMENT CORRECTED --- */}
//             <TableCell colSpan={6} className="px-2 py-1 font-semibold text-gray-700">
//                 Opening Balance
//             </TableCell>
//             <TableCell className="px-2 py-1 text-right">
//                 <div className="flex items-center justify-end gap-2">
//                     <Input
//                         type="number"
//                         value={editableBalance / 100}
//                         onChange={(e) => setEditableBalance(Number(e.target.value) * 100)} 
//                         onBlur={handleSave}
//                         onKeyDown={handleKeyDown}
//                         className="h-8 w-32 text-right font-mono"
//                         disabled={isSaving}
//                         aria-label="Opening Balance"
//                     />
//                     <Button size="icon" onClick={handleSave} disabled={isSaving || editableBalance === balance} className="h-8 w-8 flex-shrink-0">
//                         <Save className="h-4 w-4" />
//                     </Button>
//                 </div>
//             </TableCell>
//         </TableRow>
//     );
// }

// // Update the main component's props interface
// interface VirtualizedLedgerTableProps {
//   items: LedgerEntry[];
//   activeSubTab: 'poLedger' | 'invoicesLedger';
//   projectOptions: { label: string; value: string }[];
//   projectFilter: Set<string>;
//   onSetProjectFilter: (selected: Set<string>) => void;
//   openingBalance: number;
//   onSaveOpeningBalance: (newBalance: number) => void;
//   isSavingBalance: boolean;
//   totals: { amount: number; payment: number; };
//   endBalance: number;
// }

// export const VirtualizedLedgerTable: React.FC<VirtualizedLedgerTableProps> = (props) => {
//   const { 
//     items, 
//     activeSubTab, 
//     projectOptions, 
//     projectFilter, 
//     onSetProjectFilter, 
//     openingBalance, 
//     onSaveOpeningBalance, 
//     isSavingBalance, 
//     totals, 
//     endBalance 
//   } = props;
  
//   const parentRef = useRef<HTMLDivElement>(null);

//   const rowVirtualizer = useVirtualizer({
//     count: items.length,
//     getScrollElement: () => parentRef.current,
//     estimateSize: () => 48, // Adjusted size for more compact rows
//     overscan: 10,
//   });

//   const virtualRows = rowVirtualizer.getVirtualItems();
//   const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
//   const paddingBottom = virtualRows.length > 0 ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end : 0;
  
//   const colSpan = 7;

//   return (
//     <div ref={parentRef} className="rounded-md border overflow-x-auto max-h-[70vh] overflow-y-auto relative">
//       <Table>
//         <TableHeader className='bg-gray-50 sticky top-0 z-10'>
//           <TableRow>
//             {/* --- PADDING AND MIN-WIDTH REDUCED ON ALL TABLE HEADERS --- */}
//             <TableHead className="px-2 py-1 min-w-[100px] font-semibold">Date</TableHead>
//             <TableHead className="px-2 py-1 min-w-[150px] font-semibold">Transactions</TableHead>
//             <TableHead className="px-2 py-1 min-w-[180px] font-semibold">
//                 <div className="flex items-center gap-1">
//                     <SimpleFacetedFilter title="Project" options={projectOptions} selectedValues={projectFilter} onSelectedValuesChange={onSetProjectFilter} />
//                     <span>Project</span>
//                 </div>
//             </TableHead>
//             <TableHead className="px-2 py-1 min-w-[200px] font-semibold">Details</TableHead>
//             <TableHead className="px-2 py-1 text-right min-w-[120px] font-semibold">{activeSubTab === 'poLedger' ? 'PO Amount' : 'Invoice Amount'}</TableHead>
//             <TableHead className="px-2 py-1 text-right min-w-[120px] font-semibold">Payments</TableHead>
//             <TableHead className="px-2 py-1 text-right min-w-[120px] font-semibold">Balance</TableHead>
//           </TableRow>
//           <OpeningBalanceRow 
//             balance={openingBalance} 
//             onSave={onSaveOpeningBalance} 
//             isSaving={isSavingBalance}
//           />
//         </TableHeader>
//         <TableBody>
//           {paddingTop > 0 && (<TableRow><td colSpan={colSpan} style={{ height: `${paddingTop}px` }} /></TableRow>)}
          
//           {virtualRows.length === 0 && items.length === 0 && (
//               <TableRow><TableCell colSpan={colSpan} className="h-24 text-center">No transactions found for this period.</TableCell></TableRow>
//           )}
          
//           {virtualRows.map(virtualRow => {
//             const item = items[virtualRow.index];
//             return (<LedgerTableRow key={`row-${virtualRow.index}`} item={item} />);
//           })}

//           {paddingBottom > 0 && (<TableRow><td colSpan={colSpan} style={{ height: `${paddingBottom}px` }} /></TableRow>)}
//         </TableBody>
//         <TableFooter className="sticky bottom-0 bg-gray-100">
//             <TableRow>
//                 {/* --- PADDING REDUCED and ALIGNMENT CORRECTED --- */}
//                 <TableCell colSpan={4} className="px-2 py-1 font-semibold text-gray-700">Closing Balance (based on filters)</TableCell>
//                 <TableCell className="px-2 py-1 text-right font-mono font-semibold">{formatToRoundedIndianRupee(totals.amount / 100)}</TableCell>
//                 <TableCell className="px-2 py-1 text-right font-mono font-semibold">{formatToRoundedIndianRupee(totals.payment / 100)}</TableCell>
//                 <TableCell className="px-2 py-1 text-right font-mono font-semibold">{formatToRoundedIndianRupee(endBalance / 100)}</TableCell>
//             </TableRow>
//         </TableFooter>
//       </Table>
//     </div>
//   );
// };