import React from 'react';
import {
    HoverCard,
    HoverCardContent,
    HoverCardTrigger,
} from "@/components/ui/hover-card"; // Adjust path
import { Badge } from "@/components/ui/badge"; // Adjust path
import { ScrollArea } from "@/components/ui/scroll-area"; // Adjust path - for potentially long lists
import { Info, ShoppingCart, CalendarDays, User, Tag } from 'lucide-react'; // Icons for clarity
import { ApprovedQuotations } from '@/types/NirmaanStack/ApprovedQuotations';
import { formatDate } from 'date-fns';
import { parseNumber } from '@/utils/parseNumber';
import { formatToRoundedIndianRupee } from '@/utils/FormatPrice';
import { Link } from 'react-router-dom';

interface HistoricalQuotesHoverCardProps {
    /** The array of historical quotes used for the calculation. */
    quotes: ApprovedQuotations[] | undefined | null;
    /** The element that triggers the hover card (e.g., the displayed rate). */
    children: React.ReactNode;
    /** Optional title for the hover card content. */
    title?: string;
    /** Maximum number of quotes to display initially before showing scroll/more indicator. */
    maxVisibleQuotes?: number;
    /** Optional class name for the HoverCardContent. */
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

    // Don't render hover functionality if there are no quotes to show
    if (!quotes || quotes.length === 0) {
        return <>{children}</>; // Render the trigger element directly
    }

    const hasMoreQuotes = quotes.length > maxVisibleQuotes;
    const visibleQuotes = quotes.slice(0, 1000);

    return (
        <HoverCard openDelay={200} closeDelay={100}>
            <HoverCardTrigger asChild>
                {/* Add a span with underline for visual cue if desired */}
                <span className="cursor-help border-b border-dashed border-gray-500">
                    {children}
                </span>
            </HoverCardTrigger>
            <HoverCardContent
                side="top" // Adjust side as needed (top, bottom, left, right)
                align="center" // Adjust alignment
                className={`w-auto max-w-md p-4 shadow-xl rounded-lg bg-background ${contentClassName}`} // Use theme background
            >
                <div className="space-y-3">
                    {/* Header */}
                    <div className="flex items-center space-x-2 mb-2 border-b pb-2">
                        <Info className="h-5 w-5 text-primary" />
                        <h4 className="text-sm font-semibold text-foreground">{title}</h4>
                        <Badge variant="secondary" className="ml-auto">{quotes.length} total</Badge>
                    </div>

                    {/* Scrollable List Area */}
                    <ScrollArea className={`pr-2 ${hasMoreQuotes ? 'max-h-[250px] overflow-y-auto' : ''}`}> {/* Limit height only if scroll needed */}
                        <div className="space-y-2.5">
                            {visibleQuotes.map((quote, index) => (
                                <div key={quote.name || index} className="text-xs border rounded-md p-2 space-y-1 bg-muted/50">
                                    {/* PO Info */}
                                    {quote.procurement_order && (
                                        <div className="flex items-center justify-between text-muted-foreground">
                                             <span className="flex items-center gap-1">
                                                <ShoppingCart className="h-3 w-3" /> PO:
                                            </span>
                                            <Link to={`/purchase-orders/${quote.procurement_order?.replaceAll("/", "&=")}?tab=Dispatched+PO`} className="underline hover:underline-offset-2">
                                            {quote.procurement_order}
                                            </Link>
                                            {/* <span className="font-medium text-foreground">{quote.procurement_order}</span> */}
                                        </div>
                                    )}
                                     {/* Vendor Info */}
                                     {quote.vendor && (
                                        <div className="flex items-center justify-between text-muted-foreground">
                                             <span className="flex items-center gap-1">
                                                <User className="h-3 w-3" /> Vendor:
                                            </span>
                                            <Link to={`/vendors/${quote.vendor}`} className="underline hover:underline-offset-2">
                                                {quote.vendor}
                                                </Link>
                                            {/* <span className="font-medium text-foreground truncate max-w-[150px]">{quote.vendor}</span> */}
                                        </div>
                                    )}
                                     {/* Date Info */}
                                    <div className="flex items-center justify-between text-muted-foreground">
                                         <span className="flex items-center gap-1">
                                            <CalendarDays className="h-3 w-3" /> Date:
                                        </span>
                                        <span className="font-medium text-foreground">
                                            {quote.creation ? formatDate(new Date(quote.creation), 'dd-MMM-yyyy') : 'N/A'}
                                        </span>
                                    </div>
                                    {/* Rate & Qty Info */}
                                    <div className="flex items-center justify-between text-muted-foreground">
                                         <span className="flex items-center gap-1">
                                            <Tag className="h-3 w-3" /> Rate/Qty:
                                        </span>
                                        <span className="font-semibold text-foreground">
                                            {formatToRoundedIndianRupee(parseNumber(quote.quote))}
                                            <span className="text-muted-foreground font-normal"> x {quote.quantity || 0} {quote.unit || ''}</span>
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </ScrollArea>

                    {/* More Indicator */}
                    {/* {hasMoreQuotes && (
                        <p className="text-xs text-center text-muted-foreground pt-1 border-t mt-2">
                            ... and {quotes.length - maxVisibleQuotes} more historical quotes.
                        </p>
                    )} */}
                </div>
            </HoverCardContent>
        </HoverCard>
    );
};