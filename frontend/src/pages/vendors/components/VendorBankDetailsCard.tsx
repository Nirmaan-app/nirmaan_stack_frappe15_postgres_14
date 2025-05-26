import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FilePenLine } from "lucide-react";
import { Vendors } from '@/types/NirmaanStack/Vendors';
import { EditBankDetailsDialog } from './EditBankDetailsDialog';

interface VendorBankDetailsCardProps {
    vendor?: Vendors;
    mutateVendor: () => void; // To refresh vendor data after update
}

export const VendorBankDetailsCard: React.FC<VendorBankDetailsCardProps> = ({ vendor, mutateVendor }) => {
    const [isDialogOpen, setIsDialogOpen] = useState(false);

    if (!vendor) return null;

    return (
        <>
            <Card>
                <CardHeader>
                    <CardTitle className="text-primary flex items-center justify-between">
                        Account Details
                        <Button variant="outline" size="sm" onClick={() => setIsDialogOpen(true)} className="flex items-center gap-1 border-primary text-primary hover:bg-primary/5">
                            Edit <FilePenLine className="w-3.5 h-3.5" />
                        </Button>
                    </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                    <InfoItem label="Account Holder Name" value={vendor.account_name} />
                    <InfoItem label="Account Number" value={vendor.account_number ? String(vendor.account_number).replace(/.(?=.{4})/g, 'x') : undefined} /> {/* Masked */}
                    <InfoItem label="IFSC Code" value={vendor.ifsc} />
                    <InfoItem label="Bank Name" value={vendor.bank_name} />
                    <InfoItem label="Branch" value={vendor.bank_branch} />
                </CardContent>
            </Card>
            {vendor && (
                <EditBankDetailsDialog
                    isOpen={isDialogOpen}
                    onOpenChange={setIsDialogOpen}
                    vendor={vendor}
                    onSuccess={() => {
                        mutateVendor(); // Re-fetch vendor data
                        setIsDialogOpen(false);
                    }}
                />
            )}
        </>
    );
};

// Helper for consistent display (can be moved to a shared utils/components)
const InfoItem: React.FC<{ label: string; value?: string | number | null }> = ({ label, value }) => (
    <div>
        <p className="text-xs font-medium text-primary">{label}</p>
        <p className="text-sm text-foreground font-medium">{value || "N/A"}</p>
    </div>
);