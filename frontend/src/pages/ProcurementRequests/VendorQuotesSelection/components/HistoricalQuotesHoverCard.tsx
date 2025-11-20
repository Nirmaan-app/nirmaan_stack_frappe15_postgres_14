// frontend/src/pages/ProcurementRequests/ApproveVendorQuotes/components/HistoricalQuotesHoverCard.tsx
import React from 'react';
import {
    HoverCard,
    HoverCardContent,
    HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Info, ShoppingCart, CalendarDays, User, Tag, Truck /* Import Truck icon */ } from 'lucide-react';
import { ApprovedQuotations } from '@/types/NirmaanStack/ApprovedQuotations'; // Ensure this type has dispatch_date
import { formatDate as fnsFormatDate } from 'date-fns'; // Aliasing to avoid conflict if you have another formatDate
import { parseNumber } from '@/utils/parseNumber';
import { formatToRoundedIndianRupee } from '@/utils/FormatPrice';
import { Link } from 'react-router-dom';

interface HistoricalQuotesHoverCardProps {
    quotes: ApprovedQuotations[] | undefined | null;
    children: React.ReactNode;
    title?: string;
    maxVisibleQuotes?: number;
    contentClassName?: string;
}

const DEFAULT_MAX_VISIBLE_QUOTES = 5;

export const HistoricalQuotesHoverCard: React.FC<HistoricalQuotesHoverCardProps> = ({
    quotes,
    children,
    title = "Contributing Historical Quotes",
    maxVisibleQuotes = DEFAULT_MAX_VISIBLE_QUOTES,
    contentClassName,
}) => {

    if (!quotes || quotes.length === 0) {
        return <>{children}</>;
    }

    const hasMoreQuotes = quotes.length > maxVisibleQuotes;
    const visibleQuotes = quotes.slice(0, 1000); // Consider if 1000 is a practical limit for rendering

    return (
        <HoverCard openDelay={200} closeDelay={100}>
            <HoverCardTrigger asChild>
                <span className="cursor-help border-b border-dashed border-gray-500">
                    {children}
                </span>
            </HoverCardTrigger>
            <HoverCardContent
                side="top"
                align="center"
                className={`w-auto max-w-md p-4 shadow-xl rounded-lg bg-background ${contentClassName}`}
            >
                <div className="space-y-3">
                    <div className="flex items-center space-x-2 mb-2 border-b pb-2">
                        <Info className="h-5 w-5 text-primary" />
                        <h4 className="text-sm font-semibold text-foreground">{title}</h4>
                        <Badge variant="secondary" className="ml-auto">{quotes.length} total</Badge>
                    </div>

                    <ScrollArea className={`pr-2 ${hasMoreQuotes ? 'max-h-[250px] overflow-y-auto' : ''}`}>
                        <div className="space-y-2.5">
                            {visibleQuotes.map((quote, index) => (
                                <div key={quote.name || index} className="text-xs border rounded-md p-2 space-y-1 bg-muted/50">
                                    {quote.procurement_order && (
                                        <div className="flex items-center justify-between text-muted-foreground">
                                            <span className="flex items-center gap-1">
                                                <ShoppingCart className="h-3 w-3" /> PO:
                                            </span>
                                            <Link to={`/purchase-orders/${quote.procurement_order?.replaceAll("/", "&=")}?tab=Dispatched+PO`} className="underline hover:underline-offset-2 text-primary">
                                                {quote.procurement_order}
                                            </Link>
                                        </div>
                                    )}
                                    {/* Use quote.vendor_name if available, otherwise quote.vendor */}
                                    {(quote.vendor_name || quote.vendor) && (
                                        <div className="flex items-center justify-between text-muted-foreground">
                                            <span className="flex items-center gap-1">
                                                <User className="h-3 w-3" /> Vendor:
                                            </span>
                                            <Link to={`/vendors/${quote.vendor || quote.vendor_name}`} className="underline hover:underline-offset-2 text-primary">
                                                {quote.vendor_name || quote.vendor}
                                            </Link>
                                        </div>
                                    )}
                                    {/* Creation Date (assuming this is PO/Quote creation) */}
                                    {/* <div className="flex items-center justify-between text-muted-foreground">
                                        <span className="flex items-center gap-1">
                                            <CalendarDays className="h-3 w-3" /> Quote Date:
                                        </span>
                                        <span className="font-medium text-foreground">
                                            {quote.creation ? fnsFormatDate(new Date(quote.creation), 'dd-MMM-yyyy') : 'N/A'}
                                        </span>
                                    </div> */}
                                    {/* Dispatch Date - NEWLY ADDED */}
                                    {quote.dispatch_date && (
                                        <div className="flex items-center justify-between text-muted-foreground">
                                            <span className="flex items-center gap-1">
                                                <Truck className="h-3 w-3" /> Dispatch: {/* Use Truck Icon */}
                                            </span>
                                            <span className="font-medium text-foreground">
                                                {fnsFormatDate(new Date(quote.dispatch_date), 'dd-MMM-yyyy')}
                                            </span>
                                        </div>
                                    )}
                                    {quote.make && (
                                        <div className="flex items-center justify-between text-muted-foreground">
                                            <span className="flex items-center gap-1">
                                                <Truck className="h-3 w-3" /> Make: {/* Use Truck Icon */}
                                            </span>
                                            <span className="font-medium text-foreground">
                                                {quote.make || 'N/A'}
                                            </span>
                                        </div>
                                    )}
                                    <div className="flex items-center justify-between text-muted-foreground">
                                        <span className="flex items-center gap-1">
                                            <Tag className="h-3 w-3" /> Rate/Qty:
                                        </span>
                                        <span className="font-semibold text-foreground">
                                            {formatToRoundedIndianRupee(parseNumber(quote.quote || quote.rate))} {/* Check if quote or rate */}
                                            <span className="text-muted-foreground font-normal"> x {quote.quantity || 0} {quote.unit || ''}</span>
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </ScrollArea>
                </div>
            </HoverCardContent>
        </HoverCard>
    );
};