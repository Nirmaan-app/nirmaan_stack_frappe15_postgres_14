import { useMemo } from "react";
import { UseFormReturn } from "react-hook-form";
import {
    Store,
    Package,
    HardHat,
    Calculator,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import {
    SRFormValues,
    calculateTotal,
    groupItemsByCategory,
    getUniqueCategories,
} from "../schema";
import { PLACEHOLDERS } from "../constants";
import formatToIndianRupee from "@/utils/FormatPrice";

interface ReviewStepProps {
    form: UseFormReturn<SRFormValues>;
}

const GST_RATE = 0.18; // 18% GST

/**
 * ReviewStep - Step 3 of SR Wizard
 *
 * Shows a summary of all details before submission:
 * - Vendor info
 * - Items grouped by category
 * - Total amounts with GST calculation
 * - Optional comments field
 */
export const ReviewStep: React.FC<ReviewStepProps> = ({
    form,
}) => {
    const items = form.watch("items") || [];
    const vendor = form.watch("vendor");
    const comments = form.watch("comments");
    const projectGst = form.watch("project_gst");
    const project = form.watch("project");

    // Group items by category
    const groupedItems = useMemo(() => groupItemsByCategory(items), [items]);
    const uniqueCategories = useMemo(() => getUniqueCategories(items), [items]);

    // Calculate totals
    const totalAmount = calculateTotal(items);
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

    // Handle comments change
    const handleCommentsChange = (value: string) => {
        form.setValue("comments", value || null);
    };

    return (
        <div className="space-y-6">
            {/* Project Info */}
            {project && (
                <Card className="border-gray-200">
                    <CardHeader className="py-3 px-4 border-b bg-gray-50/50">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                            <HardHat className="h-4 w-4 text-amber-600" />
                            Project
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="py-3 px-4">
                        <div className="flex flex-wrap gap-4 text-sm">
                            <div>
                                <span className="text-muted-foreground">Name:</span>{" "}
                                <span className="font-medium">{project.name}</span>
                            </div>
                            {projectGst && (
                                <div>
                                    <span className="text-muted-foreground">Nirmaan GST for billing:</span>{" "}
                                    <span>{projectGst}</span>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Vendor Info Card */}
            {vendor && (
                <Card className="border-primary/20 bg-primary/5">
                    <CardHeader className="py-3 px-4 border-b border-primary/10">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                            <Store className="h-4 w-4 text-primary" />
                            Selected Vendor
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
                            {vendor.gst && (
                                <div>
                                    <span className="text-muted-foreground">Vendor GST:</span>{" "}
                                    <span>{vendor.gst}</span>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Items Grouped by Category */}
            <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-2">
                    <Package className="h-4 w-4" />
                    Service Items ({items.length} items in {uniqueCategories.length} categories)
                </Label>

                <Accordion
                    type="multiple"
                    defaultValue={uniqueCategories}
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
                                            <span className="text-xs text-muted-foreground bg-gray-200 px-2 py-0.5 rounded-full">
                                                {categoryItems.length} item{categoryItems.length !== 1 ? "s" : ""}
                                            </span>
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
                                                <TableHead className="w-[5%] text-xs text-center">#</TableHead>
                                                <TableHead className="w-[45%] text-xs">Description</TableHead>
                                                <TableHead className="w-[12%] text-xs text-center">Unit</TableHead>
                                                <TableHead className="w-[12%] text-xs text-center">Qty</TableHead>
                                                <TableHead className="w-[13%] text-xs text-right">Rate</TableHead>
                                                <TableHead className="w-[13%] text-xs text-right">Amount</TableHead>
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
                                                            <span className="line-clamp-2">{item.description}</span>
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
                                                <TableCell colSpan={5} className="text-right text-sm font-medium">
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
            </div>

            {/* Totals Section */}
            <Card className="border-gray-200">
                <CardHeader className="py-3 px-4 border-b bg-gray-50/50">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Calculator className="h-4 w-4" />
                        Total Summary
                    </CardTitle>
                </CardHeader>
                <CardContent className="py-4 px-4">
                    <div className="space-y-3">
                        <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Subtotal (excl. GST):</span>
                            <span className="font-medium">{formatToIndianRupee(totalAmount)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">GST (18%):</span>
                            <span className="font-medium">{formatToIndianRupee(gstAmount)}</span>
                        </div>
                        <div className="border-t pt-3">
                            <div className="flex justify-between">
                                <span className="font-semibold">Grand Total (incl. GST):</span>
                                <span className="font-bold text-xl text-primary">
                                    {formatToIndianRupee(grandTotal)}
                                </span>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Comments Section */}
            <div className="space-y-2">
                <Label htmlFor="comments" className="text-sm font-medium">
                    Comments (Optional)
                </Label>
                <Textarea
                    id="comments"
                    placeholder={PLACEHOLDERS.comments}
                    value={comments || ""}
                    onChange={(e) => handleCommentsChange(e.target.value)}
                    className="min-h-[100px]"
                />
                <p className="text-xs text-muted-foreground">
                    Add any additional notes or special instructions for this service request.
                </p>
            </div>

            {/* Info text before submission */}
            <div className="border-t pt-4 mt-6">
                <p className="text-sm text-muted-foreground text-center">
                    By submitting, this Work Order will be sent for approval.
                </p>
            </div>
        </div>
    );
};

export default ReviewStep;
