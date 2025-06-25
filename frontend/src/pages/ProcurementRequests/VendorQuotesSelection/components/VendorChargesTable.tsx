import React, { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { RFQData, ChargeItem, VendorOption } from '../types';
import { AddVendorChargesDialog } from './AddVendorChargesDialog';
import QuantityQuoteInput from '@/components/helpers/QtyandQuoteInput';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CirclePlus, Trash2 } from 'lucide-react';
import { Label } from '@/components/ui/label';
import formatToIndianRupee from '@/utils/FormatPrice';
import { VendorHoverCard } from '@/components/helpers/vendor-hover-card'; // Import for consistency

interface VendorChargesTableProps {
    mode: 'edit' | 'view';
    isReadOnly?: boolean;
    vendors: VendorOption[];
    rfqData: RFQData;
    onAddCharges: (vendorId: string, chargesToAdd: { item_id: string; item_name: string }[]) => void;
    onUpdateCharge: (vendorId: string, chargeIndex: number, updatedCharge: ChargeItem) => void;
    onDeleteCharge: (vendorId: string, chargeIndex: number) => void;
    availableChargeTemplates: { item_id: string; item_name: string }[];
}

export const VendorChargesTable: React.FC<VendorChargesTableProps> = ({
    mode,
    isReadOnly,
    vendors,
    rfqData,
    onAddCharges,
    onUpdateCharge,
    onDeleteCharge,
    availableChargeTemplates
}) => {
    const [dialogOpenForVendor, setDialogOpenForVendor] = useState<string | null>(null);
    const chargesByVendor = rfqData.chargesByVendor || {};
    const numVendors = vendors.length;

    // Initial checks for rendering
    if (mode === 'view' && (!rfqData.chargesByVendor || Object.values(rfqData.chargesByVendor).every(c => c.length === 0))) {
        return null;
    }
    if (vendors.length === 0) {
        return null;
    }

    // This function finds the maximum number of charges for any single vendor.
    // This helps us render the correct number of rows.
    const maxCharges = Math.max(0, ...Object.values(chargesByVendor).map(charges => charges.length));

    // Create an array of indices [0, 1, 2, ..., maxCharges-1]
    const chargeRows = Array.from({ length: maxCharges }, (_, i) => i);


    return (
        <div className="min-w-[800px] mt-4">
            <h3 className="text-lg font-semibold mb-2 pl-1 text-gray-800">Additional Charges</h3>
            <div className="border rounded-lg shadow-sm overflow-x-auto">
                <Table>
                    {/* ======================= STRATEGY 1: Replicate the Column Structure ======================= */}
                    <colgroup>
                        <col style={{ width: '200px', minWidth: '200px' }} /> {/* Matches "Item Details" */}
                        <col style={{ width: '60px' }} />  {/* Spacer for "Qty" */}
                        <col style={{ width: '60px' }} />  {/* Spacer for "UOM" */}
                        <col style={{ width: '100px' }} /> {/* Spacer for "TAX" */}
                        
                        {/* Dynamically create a column for each vendor, matching the main table */}
                        {vendors.map(v => (
                            <col key={v.value} style={{ width: numVendors <= 3 ? 'auto' : '160px', minWidth: '160px' }} />
                        ))}
                        <col style={{ width: '120px' }} /> {/* Spacer for "Target Rate" */}
                    </colgroup>

                    <TableHeader>
                        <TableRow className="bg-muted/50 hover:bg-muted/50">
                            {/* This header is for the "Add Charges" button row */}
                            <TableHead className="font-medium text-gray-800 p-2">
                                {/* This cell can be used for a label if needed, or left empty */}
                            </TableHead>
                            
                            {/* --- SPACER HEADERS --- */}
                            <TableHead></TableHead>
                            <TableHead></TableHead>
                            <TableHead></TableHead>
                            
                            {/* --- VENDOR HEADERS with "Add Charges" buttons --- */}
                            {vendors.map(vendor => (
                                <TableHead key={vendor.value} className="p-2 text-center">
                                    {mode === 'edit' && !isReadOnly && (
                           
                                        <Button
                                            variant="outline"
                                            size="sm"
                                           className="w-full text-primary border-primary justify-start"
                                           style={{ maxWidth: '160px' }}
                                            onClick={() => setDialogOpenForVendor(vendor.value)}
                                        >
                                            <CirclePlus className="mr-2 h-4 w-4 flex-shrink-0" /> <small className="truncate">{vendor.label}</small>
                                        </Button> 
                                    )}
                                </TableHead>
                            ))}
                            <TableHead></TableHead> {/* Spacer for Target Rate */}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {/* ======================= STRATEGY 2: Render by Row, Not by Column ======================= */}
                        {chargeRows.length === 0 && mode === 'view' && (
                             <TableRow>
                                <TableCell colSpan={5 + numVendors} className="text-center text-muted-foreground py-4">No additional charges were added.</TableCell>
                            </TableRow>
                        )}
                        {chargeRows.map(chargeIndex => (
                            <TableRow key={chargeIndex}>
                                {/* --- SPACER CELLS to push vendor data to the correct columns --- */}
                                <TableCell></TableCell>
                                <TableCell></TableCell>
                                <TableCell></TableCell>
                                <TableCell></TableCell>
                                
                                {/* Map through each vendor to render a cell in this row */}
                                {vendors.map(vendor => {
                                    const charge = (chargesByVendor[vendor.value] || [])[chargeIndex];
                                    return (
                                        <TableCell key={vendor.value} className="p-1.5 align-top ">

                                           <div className='flex flex-col justify-center items-center'>
                                             {charge ? (
                                                // If a charge exists for this vendor at this index, render it
                                                <div className="min-w-[160px] max-w-[160px] border p-2 rounded-md text-left space-y-2 relative bg-card min-h-[100px]">
                                                    {mode === 'edit' && !isReadOnly && (
                                                        <Button variant="ghost" size="icon" className="absolute top-0 right-0 h-6 w-6 text-destructive hover:bg-destructive/10"
                                                            onClick={() => onDeleteCharge(vendor.value, chargeIndex)} title={`Remove ${charge.item_name}`}>
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    )}
                                                    <p className="font-semibold text-sm pr-6">{charge.item_name}</p>
                                                    <div className="flex gap-2 items-center">
                                                        <div className="w-24">
                                                            <Label className="text-xs">Rate</Label>
                                                            {mode === 'edit' && !isReadOnly ? (
                                                                <QuantityQuoteInput
                                                                    value={charge.quote}
                                                                    onChange={(val) => onUpdateCharge(vendor.value, chargeIndex, { ...charge, quote: Number(val) || 0 })}
                                                                />
                                                            ) : (
                                                                <p className="font-semibold text-sm h-9 flex items-center">{formatToIndianRupee(charge.quote)}</p>
                                                            )}
                                                        </div>
                                                        <div className="w-24">
                                                            <Label className="text-xs">Tax</Label>
                                                            <Select
                                                                value={String(charge.tax)}
                                                                onValueChange={(val) => onUpdateCharge(vendor.value, chargeIndex, { ...charge, tax: Number(val) || 0 })}
                                                                disabled={mode === 'view' || isReadOnly}
                                                            >
                                                                <SelectTrigger><SelectValue /></SelectTrigger>
                                                                <SelectContent>
                                                                    <SelectItem value="5">5 %</SelectItem>
                                                                    <SelectItem value="12">12 %</SelectItem>
                                                                    <SelectItem value="18">18 %</SelectItem>
                                                                    <SelectItem value="28">28 %</SelectItem>
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                    </div>
                                                </div>
                                            ) : (
                                                // If no charge exists, render an empty div to maintain row height
                                                <div className="min-h-[100px]"></div>
                                            )}
                                           </div>
                                        </TableCell>
                                    );
                                })}
                                {/* Final spacer for Target Rate column */}
                                 <TableCell></TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            {/* Dialog rendering logic (remains the same) */}
            {dialogOpenForVendor && (
                <AddVendorChargesDialog
                    isOpen={!!dialogOpenForVendor}
                    onClose={() => setDialogOpenForVendor(null)}
                    vendorName={vendors.find(v => v.value === dialogOpenForVendor)?.label || ''}
                    onAddCharges={(chargeTemplates) => {
                        onAddCharges(dialogOpenForVendor, chargeTemplates);
                        setDialogOpenForVendor(null);
                    }}
                    availableTemplates={availableChargeTemplates}
                    existingChargeItemIds={(chargesByVendor[dialogOpenForVendor] || []).map(c => c.item_id)}
                />
            )}
        </div>
    );
};
