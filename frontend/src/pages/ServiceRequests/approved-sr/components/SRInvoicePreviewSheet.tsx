import React, { useRef } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";
import { useReactToPrint } from 'react-to-print';
import { ServiceRequests } from '@/types/NirmaanStack/ServiceRequests';
import { Projects } from '@/types/NirmaanStack/Projects';
import { Customers } from '@/types/NirmaanStack/Customers';
// Import your SR Tax Invoice Jinja-like component or build the HTML string here
// For simplicity, let's assume you have a component that takes data and renders the HTML structure
// In a real enterprise app, this might be a more complex HTML generator or use a templating engine client-side
// if not relying solely on Frappe's server-side print format.
// Since we are using Frappe's server-side print format, this sheet will be simple.

interface SRInvoicePreviewSheetProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    srDoc: ServiceRequests | undefined;
    // If you pass user-entered dialog data for print params:
    printParams?: Record<string, string>;
}

// This component is now simpler: it just triggers the /printview URL
export const SRInvoicePreviewSheet: React.FC<SRInvoicePreviewSheetProps> = ({
    isOpen,
    onOpenChange,
    srDoc,
    printParams = {}, // For Delivery Note, Terms, etc.
}) => {
    const handleActualPrint = () => {
        if (!srDoc) return;
        const baseP = {
            doctype: "Service Requests",
            name: srDoc.name,
            format: "SR Invoice", // Your print format name
            no_letterhead: "1",
            _lang: "en",
        };
        const allParams = { ...baseP, ...printParams };
        const queryString = new URLSearchParams(allParams).toString();
        // @ts-ignore
        const fullUrl = frappe.urllib.get_full_url(`/printview?${queryString}`);
        window.open(fullUrl, "_blank");
        onOpenChange(false); // Close sheet after opening print view
    };


    return (
        <Sheet open={isOpen} onOpenChange={onOpenChange}>
            <SheetContent className="md:min-w-[450px] sm:min-w-[380px]">
                <SheetHeader>
                    <SheetTitle>Invoice Preview & Print Options</SheetTitle>
                    <SheetDescription>
                        The invoice will be generated using the "SR Invoice" format.
                        Ensure all necessary details are saved on the Service Request.
                        Any details entered in a prior dialog will be used.
                    </SheetDescription>
                </SheetHeader>
                <div className="py-6 flex flex-col items-center">
                    <p className="text-sm text-muted-foreground mb-4">
                        Click below to open the print preview in a new tab.
                        You can then print or save as PDF from your browser.
                    </p>
                    <Button onClick={handleActualPrint} disabled={!srDoc}>
                        <Printer className="mr-2 h-4 w-4" />
                        Open Print Preview
                    </Button>
                </div>
            </SheetContent>
        </Sheet>
    );
};