import React, { useMemo } from "react";
import { UseFormReturn } from "react-hook-form";
import { Store, AlertCircle, Calculator, CirclePlus, Layers } from "lucide-react";
import ReactSelect from "react-select";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { VendorSheet } from "@/pages/ProcurementRequests/VendorQuotesSelection/components/VendorSheet";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { SRFormValues, calculateTotal, VendorRefType } from "../schema";
import { PLACEHOLDERS, VALIDATION_MESSAGES } from "../constants";
import formatToIndianRupee from "@/utils/FormatPrice";
import { getSelectStyles } from "@/config/selectTheme";

interface VendorOptionInput {
    value: string;
    label: string;
    city?: string;
    state?: string;
    vendor_type?: string;
    gst?: string;
}

interface StepProps {
    form: UseFormReturn<SRFormValues>;
    vendors: VendorOptionInput[];
    isLoading?: boolean;
}

interface VendorOption {
    value: string;
    label: string;
    city?: string | null;
    state?: string | null;
    gst?: string | null;
}

/**
 * VendorRatesStep - Step 2 of SR Wizard
 *
 * Allows user to:
 * - Select a service vendor
 * - Set rates for each service item
 * - View calculated amounts
 */
export const VendorRatesStep: React.FC<StepProps> = ({
    form,
    vendors,
    isLoading,
}) => {
    const [isVendorSheetOpen, setIsVendorSheetOpen] = useState(false);
    const items = form.watch("items") || [];
    const selectedVendor = form.watch("vendor");

    // Vendors are already in react-select option format from useSRFormData
    const vendorOptions: VendorOption[] = useMemo(() => {
        return vendors?.map((v) => ({
            value: v.value,
            label: v.label,
            city: v.city,
            state: v.state,
            gst: v.gst,
        })) || [];
    }, [vendors]);

    // Get current selected vendor option for react-select
    const selectedVendorOption = useMemo(() => {
        if (!selectedVendor) return null;
        return vendorOptions.find((v) => v.value === selectedVendor.id) || null;
    }, [selectedVendor, vendorOptions]);

    // Handle vendor selection
    const handleVendorChange = (option: VendorOption | null) => {
        if (option) {
            const vendorRef: VendorRefType = {
                id: option.value,
                name: option.label,
                city: option.city,
                state: option.state,
                gst: option.gst,
            };
            form.setValue("vendor", vendorRef, { shouldValidate: true });
        } else {
            form.setValue("vendor", null, { shouldValidate: true });
        }
    };

    // Handle rate change for an item
    const handleRateChange = (itemId: string, rate: number) => {
        const updatedItems = items.map((item) =>
            item.id === itemId ? { ...item, rate } : item
        );
        form.setValue("items", updatedItems, { shouldValidate: true });
    };

    // Calculate totals
    const totalAmount = calculateTotal(items);

    // Check if all items have rates (can be negative but not 0 or undefined)
    const allItemsHaveRates = items.every((item) => item.rate !== undefined && item.rate !== 0);

    // Group items by category (Package)
    const groupedItemsByPackage = useMemo(() => {
        const groups: Record<string, Array<{ originalIndex: number; data: typeof items[0] }>> = {};
        items.forEach((item, index) => {
            if (!groups[item.category]) {
                groups[item.category] = [];
            }
            groups[item.category].push({ originalIndex: index, data: item });
        });
        return groups;
    }, [items]);

    // Custom components for react-select
    const CustomSingleValue = ({ data }: { data: VendorOption }) => (
        <div className="flex items-center gap-2">
            <Store className="h-4 w-4 text-primary" />
            <span className="font-medium">{data.label}</span>
            {(data.city || data.state) && (
                <span className="text-muted-foreground text-sm">
                    ({data.city}{data.city && data.state ? ", " : ""}{data.state})
                </span>
            )}
        </div>
    );

    const CustomOption = (props: any) => {
        const { data, innerRef, innerProps, isFocused, isSelected } = props;
        return (
            <div
                ref={innerRef}
                {...innerProps}
                className={`px-3 py-2 cursor-pointer transition-colors ${
                    isSelected
                        ? "bg-primary text-primary-foreground"
                        : isFocused
                        ? "bg-gray-100"
                        : ""
                }`}
            >
                <div className="font-medium text-sm">{data.label}</div>
                {(data.city || data.state) && (
                    <div className={`text-xs ${isSelected ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                        {data.city}{data.city && data.state ? ", " : ""}{data.state}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="space-y-6">
            <VendorSheet isOpen={isVendorSheetOpen} onClose={() => setIsVendorSheetOpen(false)} service={true} />

            {/* Vendor Selection Header with Add Button */}
            <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">
                    Select Vendor <span className="text-red-500">*</span>
                </Label>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground hidden sm:inline">Not seeing your vendor?</span>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-primary hover:text-primary hover:bg-primary/5 flex items-center gap-1.5"
                        onClick={() => setIsVendorSheetOpen(true)}
                        title="Add New Vendor"
                    >
                        <CirclePlus className="h-4 w-4" />
                        <span className="text-xs font-semibold">New Vendor</span>
                    </Button>
                </div>
            </div>

            {/* Vendor Selection */}
            <div className="space-y-2 mt-[-1rem]"> {/* Pull closer to custom header */}
                <ReactSelect
                    value={selectedVendorOption}
                    options={vendorOptions}
                    onChange={handleVendorChange}
                    components={{
                        SingleValue: CustomSingleValue,
                        Option: CustomOption,
                    }}
                    placeholder={PLACEHOLDERS.searchVendor}
                    isClearable
                    isLoading={isLoading}
                    styles={getSelectStyles<VendorOption>()}
                    classNamePrefix="react-select"
                />
                {form.formState.errors.vendor && (
                    <p className="text-sm text-red-500 flex items-center gap-1">
                        <AlertCircle className="h-4 w-4" />
                        {VALIDATION_MESSAGES.vendorRequired}
                    </p>
                )}
            </div>

            {/* Selected Vendor Info Card */}
            {selectedVendor && (
                <Card className="border-primary/20 bg-primary/5">
                    <CardHeader className="py-3 px-4">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                            <Store className="h-4 w-4" />
                            Selected Vendor
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="py-2 px-4">
                        <div className="flex flex-wrap gap-4 text-sm">
                            <div>
                                <span className="text-muted-foreground">Name:</span>{" "}
                                <span className="font-medium">{selectedVendor.name}</span>
                            </div>
                            {selectedVendor.city && (
                                <div>
                                    <span className="text-muted-foreground">City:</span>{" "}
                                    <span>{selectedVendor.city}</span>
                                </div>
                            )}
                            {selectedVendor.state && (
                                <div>
                                    <span className="text-muted-foreground">State:</span>{" "}
                                    <span>{selectedVendor.state}</span>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Rate Entry Table */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">Set Rates for Items</Label>
                    {!allItemsHaveRates && items.length > 0 && (
                        <span className="text-xs text-amber-600 flex items-center gap-1">
                            <AlertCircle className="h-3 w-3" />
                            {VALIDATION_MESSAGES.ratesRequired}
                        </span>
                    )}
                </div>

                {items.length > 0 ? (
                    <div className="border rounded-xl overflow-hidden shadow-sm bg-white border-slate-200">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-gray-50/80 border-b border-slate-100 uppercase tracking-tighter">
                                    <TableHead className="w-[40%] text-[10px] font-extrabold py-3 px-4 text-slate-500">Item Details & Specs</TableHead>
                                    <TableHead className="w-[10%] text-[10px] font-extrabold text-center py-3 text-slate-500">Unit</TableHead>
                                    <TableHead className="w-[10%] text-[10px] font-extrabold text-center py-3 text-slate-500">Qty</TableHead>
                                    <TableHead className="w-[12%] text-[10px] font-extrabold text-center py-3 text-slate-500">Std Rate</TableHead>
                                    <TableHead className="w-[13%] text-[10px] font-extrabold text-center py-3 text-slate-500">Rate</TableHead>
                                    <TableHead className="w-[15%] text-[10px] font-extrabold text-right py-3 pr-4 text-slate-500">Amount</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {Object.entries(groupedItemsByPackage).map(([pkg, pkgItems]) => (
                                    <React.Fragment key={pkg}>
                                        {/* Package Separator Row - Only shown if more than one package exists */}
                                        {Object.keys(groupedItemsByPackage).length > 1 && (
                                            <TableRow className="bg-slate-50/50 border-y border-slate-100/50">
                                                <TableCell colSpan={6} className="py-2 px-4 shadow-sm">
                                                    <div className="flex items-center gap-2">
                                                        <div className="bg-primary/10 text-primary p-1 rounded shadow-sm">
                                                            <Layers className="h-3.5 w-3.5" />
                                                        </div>
                                                        <span className="text-[10px] font-extrabold text-slate-700 uppercase tracking-widest">
                                                            Package: {pkg}
                                                        </span>
                                                        <Badge variant="secondary" className="text-[9px] font-medium text-slate-400 py-0 h-4 bg-slate-100/50 hover:bg-slate-100 shadow-none">
                                                            {pkgItems.length} {pkgItems.length === 1 ? "Item" : "Items"}
                                                        </Badge>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        )}

                                        {/* Item Rows */}
                                        {pkgItems.map(({ originalIndex, data: item }, pkgIdx) => {
                                            const amount = item.quantity * (item.rate ?? 0);
                                            return (
                                                <TableRow key={item.id} className="hover:bg-slate-50/30 border-b border-slate-50 last:border-0 last:bg-transparent group/row">
                                                    <TableCell className="text-sm py-2.5 px-4">
                                                        <div className="flex flex-col gap-0.5 ml-1">
                                                            <span className="font-semibold text-slate-900 leading-tight transition-colors">
                                                                {item.description.split('\n')[0]}
                                                            </span>
                                                                {item.description.includes('\n') && (
                                                                    <span className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed italic opacity-80">
                                                                        {item.description.split('\n').slice(1).join('\n')}
                                                                    </span>
                                                                )}
                                                            </div>
                                                    </TableCell>
                                                    <TableCell className="text-sm text-center py-2.5">
                                                        <Badge variant="secondary" className="bg-slate-100/80 text-slate-600 font-normal py-0.5 border-slate-200 shadow-none">
                                                            {item.uom}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="text-sm text-center font-bold text-slate-900 py-2.5">
                                                        {item.quantity}
                                                    </TableCell>
                                                    <TableCell className="text-sm text-center py-2.5">
                                                        <span className="text-[11px] font-semibold text-slate-500 bg-slate-50/80 px-2 py-1.5 rounded border border-slate-100">
                                                            {item.standard_rate !== undefined && item.standard_rate !== null 
                                                                ? formatToIndianRupee(item.standard_rate) 
                                                                : "N/A"}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell className="text-sm p-1 py-2.5">
                                                        <div className="relative group/rate max-w-[120px] mx-auto">
                                                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 font-medium">₹</span>
                                                            <input
                                                                type="number"
                                                                step="any"
                                                                placeholder="0.00"
                                                                value={item.rate || ""}
                                                                onChange={(e) =>
                                                                    handleRateChange(
                                                                        item.id,
                                                                        parseFloat(e.target.value) || 0
                                                                    )
                                                                }
                                                                className={`h-9 w-full pl-5 pr-2 text-center text-xs bg-white font-bold transition-all border rounded outline-none shadow-none ${
                                                                    form.formState.submitCount > 0 && (form.formState.errors.items as any)?.[originalIndex]?.rate 
                                                                    ? "border-red-500 ring-1 ring-red-500/10" 
                                                                    : "border-slate-200 focus:border-primary/50 focus:ring-1 focus:ring-primary/10"
                                                                }`}
                                                                onKeyDown={(e) => {
                                                                    if (e.key === "e") {
                                                                        e.preventDefault();
                                                                    }
                                                                }}
                                                            />
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-sm text-right font-extrabold text-slate-900 py-2.5 pr-4">
                                                        {amount !== 0 ? formatToIndianRupee(amount) : "--"}
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })}
                                    </React.Fragment>
                                ))}
                            </TableBody>
                            <TableFooter>
                                <TableRow className="bg-slate-50/80 border-t-2 border-slate-200/50">
                                    <TableCell colSpan={5} className="text-right font-bold text-slate-500 uppercase tracking-widest text-[10px] py-5">
                                        Total Service Amount (All Packages)
                                    </TableCell>
                                    <TableCell className="text-right font-bold text-primary text-xl py-5 pr-4 shadow-sm">
                                        {formatToIndianRupee(calculateTotal(items))}
                                    </TableCell>
                                </TableRow>
                            </TableFooter>
                        </Table>
                    </div>
                ) : (
                    <div className="border rounded-lg p-8 text-center bg-gray-50/50">
                        <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">
                            No items added yet
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                            Go back to Step 1 to add service items
                        </p>
                    </div>
                )}
            </div>

            {/* Summary Card */}
            {items.length > 0 && (
                <Card className="border-gray-200">
                    <CardHeader className="py-3 px-4 border-b bg-gray-50/50">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                            <Calculator className="h-4 w-4" />
                            Summary
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="py-4 px-4">
                        <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Total Items:</span>
                                <span className="font-medium">{items.length}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Items with Rate:</span>
                                <span className="font-medium">
                                    {items.filter((i) => (i.rate ?? 0) !== 0).length} / {items.length}
                                </span>
                            </div>
                            <div className="border-t pt-2 mt-2">
                                <div className="flex justify-between items-center">
                                    <span className="font-semibold">Total Amount:</span>
                                    <div className="text-right">
                                        <span className="font-bold text-lg text-primary block">
                                            {formatToIndianRupee(totalAmount)}
                                        </span>
                                        {totalAmount <= 0 && allItemsHaveRates && (
                                            <span className="text-[10px] text-red-500 font-medium flex items-center justify-end gap-1 mt-0.5">
                                                <AlertCircle className="h-2.5 w-2.5" />
                                                Total must be greater than zero
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
};

export default VendorRatesStep;
