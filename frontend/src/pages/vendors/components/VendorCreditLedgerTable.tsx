import React, { useState, useMemo } from 'react';
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { VendorCreditLedger } from '@/types/NirmaanStack/Vendors';
import { formatDate } from '@/utils/FormatDate';
import formatToIndianRupee from '@/utils/FormatPrice';
import { useFrappeGetDocList } from 'frappe-react-sdk';

const USERS_LIST_PARAMS = { fields: ["name", "full_name"] as ("name" | "full_name")[], limit: 0 };

const INITIAL_DISPLAY_COUNT = 10;

const entryTypeBadgeColor: Record<string, string> = {
    "Cron Recalc": "bg-slate-100 text-slate-600 border-slate-200",
    "DN Created": "bg-orange-50 text-orange-700 border-orange-200",
    "DN Deleted": "bg-orange-50 text-orange-600 border-orange-200",
    "Return Note": "bg-purple-50 text-purple-700 border-purple-200",
    "Payment Fulfilled": "bg-green-50 text-green-700 border-green-200",
    "Payment Deleted": "bg-red-50 text-red-700 border-red-200",
    "PO Cancelled": "bg-red-50 text-red-600 border-red-200",
    "PO Merged": "bg-blue-50 text-blue-700 border-blue-200",
    "PO Deleted": "bg-red-50 text-red-600 border-red-200",
    "Adjustment Resolved": "bg-indigo-50 text-indigo-700 border-indigo-200",
    "Revision Approved": "bg-cyan-50 text-cyan-700 border-cyan-200",
    "Credit Limit Updated": "bg-violet-50 text-violet-700 border-violet-200",
};

const getEntryTypeBadgeClass = (entryType: string): string => {
    return entryTypeBadgeColor[entryType] || "bg-gray-100 text-gray-700 border-gray-300";
};

const formatTimestamp = (timestamp?: string): string => {
    if (!timestamp) return "--";
    const date = new Date(timestamp);
    const datePart = formatDate(date);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${datePart} ${hours}:${minutes}`;
};

interface VendorCreditLedgerTableProps {
    ledgerEntries: VendorCreditLedger[];
}

export const VendorCreditLedgerTable: React.FC<VendorCreditLedgerTableProps> = ({ ledgerEntries }) => {
    const [showAll, setShowAll] = useState(false);

    const { data: usersList } = useFrappeGetDocList<any>(
        "Nirmaan Users",
        USERS_LIST_PARAMS
    );

    const userNameMap = useMemo(() => {
        const map = new Map<string, string>();
        usersList?.forEach((u) => map.set(u.name, u.full_name));
        return map;
    }, [usersList]);

    const sortedEntries = useMemo(() => {
        return [...ledgerEntries].sort((a, b) => {
            const dateA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            const dateB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
            return dateB - dateA;
        });
    }, [ledgerEntries]);

    const displayedEntries = showAll ? sortedEntries : sortedEntries.slice(0, INITIAL_DISPLAY_COUNT);

    if (ledgerEntries.length === 0) {
        return <p className="text-sm text-muted-foreground text-center py-4">No ledger entries yet</p>;
    }

    return (
        <div className="space-y-2">
            <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b bg-muted/50">
                            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Timestamp</th>
                            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Entry Type</th>
                            <th className="text-left px-3 py-2 font-medium text-muted-foreground">PO ID</th>
                            <th className="text-right px-3 py-2 font-medium text-muted-foreground">Delta</th>
                            <th className="text-right px-3 py-2 font-medium text-muted-foreground">Credit Used After</th>
                            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Triggered By</th>
                        </tr>
                    </thead>
                    <tbody>
                        {displayedEntries.map((entry) => {
                            const delta = entry.delta_amount ?? 0;
                            // Positive delta = credit consumed (red), Negative delta = credit freed (green)
                            const deltaColor = delta > 0 ? 'text-red-600' : delta < 0 ? 'text-green-600' : 'text-foreground';

                            return (
                                <tr key={entry.name} className="border-b last:border-0 hover:bg-muted/30">
                                    <td className="px-3 py-2 whitespace-nowrap text-xs">
                                        {formatTimestamp(entry.timestamp)}
                                    </td>
                                    <td className="px-3 py-2">
                                        <Badge variant="outline" className={`text-xs ${getEntryTypeBadgeClass(entry.entry_type)}`}>
                                            {entry.entry_type}
                                        </Badge>
                                    </td>
                                    <td className="px-3 py-2 text-xs">
                                        {entry.po_id || "--"}
                                    </td>
                                    <td className={`px-3 py-2 text-right font-medium text-xs ${deltaColor}`}>
                                        {delta > 0 ? '+' : ''}{formatToIndianRupee(delta)}
                                    </td>
                                    <td className="px-3 py-2 text-right text-xs">
                                        {formatToIndianRupee(entry.credit_used_after)}
                                    </td>
                                    <td className="px-3 py-2 text-xs">
                                        {entry.triggered_by ? userNameMap.get(entry.triggered_by) || entry.triggered_by : "--"}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            {sortedEntries.length > INITIAL_DISPLAY_COUNT && (
                <div className="flex justify-center">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowAll(!showAll)}
                        className="text-xs text-muted-foreground"
                    >
                        {showAll ? `Show less` : `Show more (${sortedEntries.length - INITIAL_DISPLAY_COUNT} more)`}
                    </Button>
                </div>
            )}
        </div>
    );
};

export default VendorCreditLedgerTable;
