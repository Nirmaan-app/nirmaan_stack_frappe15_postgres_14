import { useMemo } from "react";
import { Store } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    TableFooter,
} from "@/components/ui/table";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import formatToIndianRupee from "@/utils/FormatPrice";

/**
 * ServiceItem interface for items displayed in the accordion
 */
export interface ServiceItem {
    id: string;
    category: string;
    description: string;
    uom: string;
    quantity: number;
    rate?: number;
}

/**
 * Vendor information for the vendor card
 */
export interface VendorInfo {
    name: string;
    city?: string | null;
    state?: string | null;
}

/**
 * Props for ServiceItemsAccordion component
 */
export interface ServiceItemsAccordionProps {
    /** Array of service items to display */
    items: ServiceItem[];
    /** Optional vendor information to show in a card */
    vendor?: VendorInfo | null;
    /** Whether to show the vendor info card (default: false) */
    showVendorCard?: boolean;
    /** Whether accordion items should be expanded by default (default: false) */
    defaultExpanded?: boolean;
    /** Optional className for additional styling */
    className?: string;
}

const GST_RATE = 0.18; // 18% GST

/**
 * Helper function to calculate total amount for items
 */
const calculateTotal = (items: ServiceItem[]): number => {
    return items.reduce((total, item) => {
        const rate = item.rate ?? 0;
        return total + item.quantity * rate;
    }, 0);
};

/**
 * Helper function to get unique categories from items
 */
const getUniqueCategories = (items: ServiceItem[]): string[] => {
    return Array.from(new Set(items.map((item) => item.category)));
};

/**
 * Helper function to group items by category
 */
const groupItemsByCategory = (
    items: ServiceItem[]
): Record<string, ServiceItem[]> => {
    return items.reduce(
        (groups, item) => {
            const category = item.category;
            if (!groups[category]) {
                groups[category] = [];
            }
            groups[category].push(item);
            return groups;
        },
        {} as Record<string, ServiceItem[]>
    );
};

/**
 * ServiceItemsAccordion - A reusable vendor-grouped display component for service items
 *
 * Features:
 * - Optional vendor info card at the top
 * - Items grouped by category in an accordion
 * - Each category shows item count badge and subtotal
 * - Items table with description, unit, qty, rate, amount
 * - Totals section with subtotal, GST (18%), and grand total
 *
 * Usage:
 * - In SR form ReviewStep for summary display
 * - In approval screens to replace Ant Design tables
 */
export const ServiceItemsAccordion: React.FC<ServiceItemsAccordionProps> = ({
    items,
    vendor,
    showVendorCard = false,
    defaultExpanded = false,
    className = "",
}) => {
    // Group items by category
    const groupedItems = useMemo(() => groupItemsByCategory(items), [items]);
    const uniqueCategories = useMemo(() => getUniqueCategories(items), [items]);

    // Calculate totals
    const totalAmount = useMemo(() => calculateTotal(items), [items]);
    const gstAmount = totalAmount * GST_RATE;
    const grandTotal = totalAmount + gstAmount;

    // Calculate category subtotals
    const categorySubtotals = useMemo(() => {
        const subtotals: Record<string, number> = {};
        uniqueCategories.forEach((category) => {
            subtotals[category] = calculateTotal(groupedItems[category] || []);
        });
        return subtotals;
    }, [groupedItems, uniqueCategories]);

    // Determine default expanded values
    const defaultExpandedValues = defaultExpanded ? uniqueCategories : [];

    if (items.length === 0) {
        return (
            <div className="h-[10vh] flex items-center justify-center text-muted-foreground">
                No service items to display.
            </div>
        );
    }

    return (
        <div className={`space-y-4 ${className}`}>
            {/* Vendor Info Card */}
            {showVendorCard && vendor && (
                <Card className="border-primary/20 bg-primary/5">
                    <CardHeader className="py-3 px-4 border-b border-primary/10">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                            <Store className="h-4 w-4 text-primary" />
                            Vendor
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="py-3 px-4">
                        <div className="flex flex-wrap gap-4 text-sm">
                            <div>
                                <span className="text-muted-foreground">Name:</span>{" "}
                                <span className="font-medium">{vendor.name}</span>
                            </div>
                            {vendor.city && (
                                <div>
                                    <span className="text-muted-foreground">City:</span>{" "}
                                    <span>{vendor.city}</span>
                                </div>
                            )}
                            {vendor.state && (
                                <div>
                                    <span className="text-muted-foreground">State:</span>{" "}
                                    <span>{vendor.state}</span>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Items Grouped by Category */}
            <Accordion
                type="multiple"
                defaultValue={defaultExpandedValues}
                className="space-y-2"
            >
                {uniqueCategories.map((category) => {
                    const categoryItems = groupedItems[category] || [];
                    const categoryTotal = categorySubtotals[category] || 0;

                    return (
                        <AccordionItem
                            key={category}
                            value={category}
                            className="border rounded-lg overflow-hidden"
                        >
                            <AccordionTrigger className="px-4 py-3 bg-gray-50/80 hover:bg-gray-100/80 hover:no-underline">
                                <div className="flex items-center justify-between w-full pr-2">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-sm">{category}</span>
                                        <Badge
                                            variant="secondary"
                                            className="text-xs bg-gray-200 text-gray-700 px-2 py-0.5"
                                        >
                                            {categoryItems.length} item
                                            {categoryItems.length !== 1 ? "s" : ""}
                                        </Badge>
                                    </div>
                                    <span className="text-sm font-semibold text-primary">
                                        {formatToIndianRupee(categoryTotal)}
                                    </span>
                                </div>
                            </AccordionTrigger>
                            <AccordionContent className="px-0 pb-0">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="bg-gray-50/50">
                                            <TableHead className="w-[5%] text-xs text-center">
                                                #
                                            </TableHead>
                                            <TableHead className="w-[45%] text-xs">
                                                Description
                                            </TableHead>
                                            <TableHead className="w-[12%] text-xs text-center">
                                                Unit
                                            </TableHead>
                                            <TableHead className="w-[12%] text-xs text-center">
                                                Qty
                                            </TableHead>
                                            <TableHead className="w-[13%] text-xs text-right">
                                                Rate
                                            </TableHead>
                                            <TableHead className="w-[13%] text-xs text-right">
                                                Amount
                                            </TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {categoryItems.map((item, index) => {
                                            const amount = item.quantity * (item.rate ?? 0);
                                            return (
                                                <TableRow key={item.id}>
                                                    <TableCell className="text-xs text-center text-muted-foreground">
                                                        {index + 1}
                                                    </TableCell>
                                                    <TableCell className="text-sm">
                                                        <span className="line-clamp-2">
                                                            {item.description}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell className="text-sm text-center">
                                                        {item.uom}
                                                    </TableCell>
                                                    <TableCell className="text-sm text-center">
                                                        {item.quantity}
                                                    </TableCell>
                                                    <TableCell className="text-sm text-right">
                                                        {formatToIndianRupee(item.rate ?? 0)}
                                                    </TableCell>
                                                    <TableCell className="text-sm text-right font-medium">
                                                        {formatToIndianRupee(amount)}
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })}
                                    </TableBody>
                                    <TableFooter>
                                        <TableRow className="bg-gray-50/80">
                                            <TableCell
                                                colSpan={5}
                                                className="text-right text-sm font-medium"
                                            >
                                                Category Subtotal
                                            </TableCell>
                                            <TableCell className="text-right font-semibold text-sm">
                                                {formatToIndianRupee(categoryTotal)}
                                            </TableCell>
                                        </TableRow>
                                    </TableFooter>
                                </Table>
                            </AccordionContent>
                        </AccordionItem>
                    );
                })}
            </Accordion>

            {/* Totals Section */}
            <Card className="border-gray-200">
                <CardContent className="py-4 px-4">
                    <div className="space-y-3">
                        <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">
                                Subtotal (excl. GST):
                            </span>
                            <span className="font-medium">
                                {formatToIndianRupee(totalAmount)}
                            </span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">GST (18%):</span>
                            <span className="font-medium">
                                {formatToIndianRupee(gstAmount)}
                            </span>
                        </div>
                        <div className="border-t pt-3">
                            <div className="flex justify-between">
                                <span className="font-semibold">Grand Total (incl. GST):</span>
                                <span className="font-bold text-lg text-primary">
                                    {formatToIndianRupee(grandTotal)}
                                </span>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

export default ServiceItemsAccordion;
