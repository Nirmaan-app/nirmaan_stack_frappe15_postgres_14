import { useMemo } from "react";
import { UseFormReturn } from "react-hook-form";
import { Store, AlertCircle, Calculator } from "lucide-react";
import ReactSelect from "react-select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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

    // Check if all items have rates
    const allItemsHaveRates = items.every((item) => (item.rate ?? 0) > 0);

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
            {/* Vendor Selection */}
            <div className="space-y-2">
                <Label className="text-sm font-medium">
                    Select Vendor <span className="text-red-500">*</span>
                </Label>
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
                    <div className="border rounded-lg overflow-hidden">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-gray-50">
                                    <TableHead className="w-[25%] text-xs">Category</TableHead>
                                    <TableHead className="w-[30%] text-xs">Description</TableHead>
                                    <TableHead className="w-[10%] text-xs text-center">Unit</TableHead>
                                    <TableHead className="w-[10%] text-xs text-center">Qty</TableHead>
                                    <TableHead className="w-[12%] text-xs text-center">Rate</TableHead>
                                    <TableHead className="w-[13%] text-xs text-right">Amount</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {items.map((item, index) => {
                                    const amount = item.quantity * (item.rate ?? 0);
                                    return (
                                        <TableRow key={item.id}>
                                            <TableCell className="text-sm">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs text-muted-foreground">
                                                        {String(index + 1).padStart(2, "0")}
                                                    </span>
                                                    <span className="font-medium">{item.category}</span>
                                                </div>
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
                                            <TableCell className="text-sm">
                                                <Input
                                                    type="number"
                                                    min={0}
                                                    step="any"
                                                    placeholder={PLACEHOLDERS.rate}
                                                    value={item.rate || ""}
                                                    onChange={(e) =>
                                                        handleRateChange(
                                                            item.id,
                                                            parseFloat(e.target.value) || 0
                                                        )
                                                    }
                                                    className="h-8 text-sm text-center"
                                                    onKeyDown={(e) => {
                                                        if (e.key === "-" || e.key === "e") {
                                                            e.preventDefault();
                                                        }
                                                    }}
                                                />
                                            </TableCell>
                                            <TableCell className="text-sm text-right font-medium">
                                                {amount > 0 ? formatToIndianRupee(amount) : "--"}
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                            <TableFooter>
                                <TableRow className="bg-gray-50">
                                    <TableCell colSpan={5} className="text-right font-semibold">
                                        Total Amount
                                    </TableCell>
                                    <TableCell className="text-right font-bold text-primary">
                                        {formatToIndianRupee(totalAmount)}
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
                                    {items.filter((i) => (i.rate ?? 0) > 0).length} / {items.length}
                                </span>
                            </div>
                            <div className="border-t pt-2 mt-2">
                                <div className="flex justify-between">
                                    <span className="font-semibold">Total Amount:</span>
                                    <span className="font-bold text-lg text-primary">
                                        {formatToIndianRupee(totalAmount)}
                                    </span>
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
