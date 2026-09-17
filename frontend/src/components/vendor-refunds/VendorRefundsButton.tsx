import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useVendorRefunds } from "./useVendorRefunds";
import { VendorRefundsTable } from "./VendorRefundsTable";

/**
 * "View Refunds" on a PO's or WO's Transaction Details: opens the refunds recorded against that
 * order. Fetches only once opened.
 */
export const VendorRefundsButton = ({
    documentType,
    documentName,
}: {
    documentType: "Procurement Orders" | "Service Requests";
    documentName?: string | null;
}) => {
    const [open, setOpen] = useState(false);
    const { refunds, error, isLoading } = useVendorRefunds(
        { documentType, documentName: documentName ?? "" },
        open
    );
    if (!documentName) return null;
    const noun = documentType === "Procurement Orders" ? "PO" : "WO";

    return (
        <>
            <Button
                type="button"
                variant="outline"
                className="h-8 border-primary px-2 text-xs font-normal text-primary"
                onClick={() => setOpen(true)}
            >
                View Refunds
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-3xl">
                    <DialogHeader>
                        <DialogTitle>Vendor Refunds — {documentName}</DialogTitle>
                    </DialogHeader>
                    {isLoading ? (
                        <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                        </p>
                    ) : error ? (
                        <AlertDestructive error={error} />
                    ) : !refunds?.length ? (
                        <p className="py-6 text-center text-sm text-muted-foreground">
                            No vendor refunds recorded against this {noun}.
                        </p>
                    ) : (
                        <div className="max-h-[60vh] overflow-auto">
                            <VendorRefundsTable refunds={refunds} />
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
};
