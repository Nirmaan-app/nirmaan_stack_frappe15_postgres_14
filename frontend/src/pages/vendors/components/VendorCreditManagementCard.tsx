import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { FilePenLine, CheckCircle2, ShieldAlert, ChevronsUpDown, ChevronDown, Wallet, TrendingDown, TrendingUp } from "lucide-react";
import { useFrappeUpdateDoc } from 'frappe-react-sdk';
import { toast } from "@/components/ui/use-toast";
import { Vendors } from '@/types/NirmaanStack/Vendors';
import { useUserData } from '@/hooks/useUserData';
import formatToIndianRupee from '@/utils/FormatPrice';
import { cn } from '@/lib/utils';
import { EditCreditLimitDialog } from './EditCreditLimitDialog';
import { VendorCreditLedgerTable } from './VendorCreditLedgerTable';

const vendorStatuses = [
    { value: "Active" as const, label: "Active", color: "text-green-600", bgColor: "bg-green-50 text-green-700 border-green-200", icon: CheckCircle2 },
    { value: "On-Hold" as const, label: "On-Hold", color: "text-amber-600", bgColor: "bg-amber-50 text-amber-700 border-amber-200", icon: ShieldAlert },
];

interface VendorCreditManagementCardProps {
    vendor: Vendors;
    mutateVendor: () => void;
}

export const VendorCreditManagementCard: React.FC<VendorCreditManagementCardProps> = ({ vendor, mutateVendor }) => {
    const { role } = useUserData();
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
    const [popoverOpen, setPopoverOpen] = useState(false);
    const [pendingStatus, setPendingStatus] = useState<"Active" | "On-Hold" | null>(null);
    const [ledgerOpen, setLedgerOpen] = useState(false);

    const { updateDoc, loading: statusLoading } = useFrappeUpdateDoc();

    const canEdit = role === "Nirmaan Admin Profile";

    const currentStatus = vendorStatuses.find((s) => s.value === vendor.vendor_status) || vendorStatuses[0];

    const handleStatusChange = (value: "Active" | "On-Hold") => {
        if (value === vendor.vendor_status) {
            setPopoverOpen(false);
            return;
        }
        setPendingStatus(value);
        setPopoverOpen(false);
    };

    const confirmStatusChange = async () => {
        if (!pendingStatus) return;
        try {
            await updateDoc("Vendors", vendor.name, { vendor_status: pendingStatus });
            toast({ title: "Success", description: `Vendor status updated to ${pendingStatus}` });
            mutateVendor();
        } catch {
            toast({ title: "Error", description: "Failed to update vendor status", variant: "destructive" });
        } finally {
            setPendingStatus(null);
        }
    };

    const availableCredit = vendor.available_credit ?? 0;
    const creditLimit = vendor.credit_limit ?? 0;
    const creditUsed = vendor.credit_used ?? 0;
    const usagePercent = creditLimit > 0 ? Math.min((creditUsed / creditLimit) * 100, 100) : 0;

    return (
        <>
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-primary flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Wallet className="h-4 w-4" />
                            Credit Management
                        </div>
                        {canEdit && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setIsEditDialogOpen(true)}
                                className="flex items-center gap-1.5 text-xs"
                            >
                                <FilePenLine className="w-3 h-3" />
                                Edit Limit
                            </Button>
                        )}
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                    {/* Status Row */}
                    <div className="flex items-center gap-3">
                        <span className="text-xs font-medium text-muted-foreground">Status</span>
                        {canEdit ? (
                            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="outline"
                                        role="combobox"
                                        size="sm"
                                        className="h-7 gap-1.5 px-2.5"
                                        disabled={statusLoading}
                                    >
                                        <div className={`flex items-center gap-1.5 ${currentStatus.color}`}>
                                            {React.createElement(currentStatus.icon, { className: "h-3.5 w-3.5" })}
                                            <span className="text-xs font-medium">{currentStatus.label}</span>
                                        </div>
                                        <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-36 p-0">
                                    <Command>
                                        <CommandList>
                                            <CommandGroup>
                                                {vendorStatuses.map((s) => (
                                                    <CommandItem
                                                        key={s.value}
                                                        value={s.value}
                                                        onSelect={() => handleStatusChange(s.value)}
                                                    >
                                                        <div className={`flex items-center gap-2 ${s.color}`}>
                                                            {React.createElement(s.icon, { className: "h-3.5 w-3.5" })}
                                                            <span className="text-xs">{s.label}</span>
                                                        </div>
                                                    </CommandItem>
                                                ))}
                                            </CommandGroup>
                                        </CommandList>
                                    </Command>
                                </PopoverContent>
                            </Popover>
                        ) : (
                            <Badge variant="outline" className={cn("text-xs gap-1", currentStatus.bgColor)}>
                                {React.createElement(currentStatus.icon, { className: "h-3 w-3" })}
                                {currentStatus.label}
                            </Badge>
                        )}
                    </div>

                    {/* Credit Metrics Grid */}
                    <div className="grid grid-cols-3 gap-3">
                        <div className="rounded-lg border bg-muted/30 p-3">
                            <div className="flex items-center gap-1.5 mb-1">
                                <Wallet className="h-3 w-3 text-muted-foreground" />
                                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Limit</span>
                            </div>
                            <p className="text-sm font-semibold text-foreground tabular-nums">
                                {formatToIndianRupee(creditLimit)}
                            </p>
                        </div>
                        <div className="rounded-lg border bg-muted/30 p-3">
                            <div className="flex items-center gap-1.5 mb-1">
                                <TrendingUp className="h-3 w-3 text-muted-foreground" />
                                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Used</span>
                            </div>
                            <p className="text-sm font-semibold text-foreground tabular-nums">
                                {formatToIndianRupee(creditUsed)}
                            </p>
                        </div>
                        <div className={cn(
                            "rounded-lg border p-3",
                            availableCredit > 0 ? "bg-green-50/50 border-green-200" : "bg-red-50/50 border-red-200"
                        )}>
                            <div className="flex items-center gap-1.5 mb-1">
                                <TrendingDown className={cn("h-3 w-3", availableCredit > 0 ? "text-green-600" : "text-red-600")} />
                                <span className={cn(
                                    "text-[11px] font-medium uppercase tracking-wide",
                                    availableCredit > 0 ? "text-green-600" : "text-red-600"
                                )}>Available</span>
                            </div>
                            <p className={cn("text-sm font-semibold tabular-nums", availableCredit > 0 ? "text-green-700" : "text-red-700")}>
                                {formatToIndianRupee(availableCredit)}
                            </p>
                        </div>
                    </div>

                    {/* Usage Progress Bar */}
                    <div className="space-y-1.5">
                        <div className="flex justify-between items-center">
                            <span className="text-[11px] text-muted-foreground">Credit utilization</span>
                            <span className={cn(
                                "text-[11px] font-medium tabular-nums",
                                usagePercent >= 100 ? "text-red-600" : usagePercent >= 80 ? "text-amber-600" : "text-muted-foreground"
                            )}>
                                {usagePercent.toFixed(0)}%
                            </span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                                className={cn(
                                    "h-full rounded-full transition-all duration-500",
                                    usagePercent >= 100 ? "bg-red-500" : usagePercent >= 80 ? "bg-amber-500" : "bg-green-500"
                                )}
                                style={{ width: `${Math.min(usagePercent, 100)}%` }}
                            />
                        </div>
                    </div>

                    {/* Collapsible Ledger */}
                    {vendor.credit_ledger && vendor.credit_ledger.length > 0 && (
                        <Collapsible open={ledgerOpen} onOpenChange={setLedgerOpen}>
                            <CollapsibleTrigger asChild>
                                <Button variant="ghost" size="sm" className="w-full flex items-center justify-between text-muted-foreground hover:text-foreground -mx-1">
                                    <span className="text-xs">Credit Ledger ({vendor.credit_ledger.length} entries)</span>
                                    <ChevronDown className={cn("h-4 w-4 transition-transform duration-200", ledgerOpen && "rotate-180")} />
                                </Button>
                            </CollapsibleTrigger>
                            <CollapsibleContent className="pt-2">
                                <VendorCreditLedgerTable ledgerEntries={vendor.credit_ledger} />
                            </CollapsibleContent>
                        </Collapsible>
                    )}
                </CardContent>
            </Card>

            {/* Status Change Confirmation */}
            <AlertDialog open={!!pendingStatus} onOpenChange={(open) => { if (!open) setPendingStatus(null); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Confirm Status Change</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to change the vendor status from <strong>{vendor.vendor_status || "Active"}</strong> to <strong>{pendingStatus}</strong>?
                            {pendingStatus === "On-Hold" && (
                                <span className="block mt-2 text-amber-600 font-medium">
                                    This will block dispatch and pre-dispatch payment operations for this vendor.
                                </span>
                            )}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={statusLoading}>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmStatusChange} disabled={statusLoading}>
                            {statusLoading ? "Updating..." : "Confirm"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Edit Credit Limit Dialog */}
            <EditCreditLimitDialog
                open={isEditDialogOpen}
                onOpenChange={setIsEditDialogOpen}
                vendorId={vendor.name}
                currentLimit={vendor.credit_limit ?? 0}
                onSuccess={() => {
                    mutateVendor();
                    setIsEditDialogOpen(false);
                }}
            />

        </>
    );
};

export default VendorCreditManagementCard;
