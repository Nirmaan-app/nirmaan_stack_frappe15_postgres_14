import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Download, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useBulkPdfDownload } from "@/hooks/useBulkPdfDownload";

interface BulkPdfDownloadButtonProps {
  projectId: string;
  projectName?: string;
}

export const BulkPdfDownloadButton = ({ projectId, projectName }: BulkPdfDownloadButtonProps) => {
  const {
    loading,
    showProgress,
    setShowProgress,
    progress,
    progressMessage,
    showRateDialog,
    setShowRateDialog,
    withRate,
    setWithRate,
    initiatePODownload,
    handleDownload,
    showInvoiceDialog,
    setShowInvoiceDialog,
    invoiceType,
    setInvoiceType,
    initiateInvoiceDownload,
    handleInvoiceDownload
  } = useBulkPdfDownload(projectId, projectName);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="flex items-center justify-between w-48 gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Bulk PDF"} 
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-48" align="end">
          <DropdownMenuItem onClick={initiatePODownload} className="cursor-pointer">
            <Download className="mr-2 h-4 w-4" />
            <span>Download All POs</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleDownload("WO", "Work Orders")} className="cursor-pointer">
            <Download className="mr-2 h-4 w-4" />
            <span>Download All WOs</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={initiateInvoiceDownload} className="cursor-pointer">
            <Download className="mr-2 h-4 w-4" />
            <span>Download All Invoices</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Rate Selection Dialog */}
      <Dialog open={showRateDialog} onOpenChange={setShowRateDialog}>
        <DialogContent className="sm:max-w-sm">
            <DialogHeader>
                <DialogTitle>Select PO Format</DialogTitle>
                <DialogDescription>
                    Choose whether to include rates in the downloaded Procurement Orders.
                </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col space-y-4 py-4">
                <div className="flex items-center space-x-2">
                    <input 
                        type="radio" 
                        id="withDetails" 
                        name="rateOption" 
                        checked={withRate === true} 
                        onChange={() => setWithRate(true)}
                        className="accent-primary h-4 w-4"
                    />
                    <label htmlFor="withDetails" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                        With Rate (PO Details)
                    </label>
                </div>
                <div className="flex items-center space-x-2">
                     <input 
                        type="radio" 
                        id="withoutRate" 
                        name="rateOption" 
                        checked={withRate === false} 
                        onChange={() => setWithRate(false)} 
                        className="accent-primary h-4 w-4"
                    />
                    <label htmlFor="withoutRate" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                        Without Rate
                    </label>
                </div>
                <Button onClick={() => handleDownload("PO", "Procurement Orders", withRate)} className="w-full mt-4">
                    Generate PDF
                </Button>
            </div>
        </DialogContent>
      </Dialog>

      {/* Invoice Selection Dialog */}
      <Dialog open={showInvoiceDialog} onOpenChange={setShowInvoiceDialog}>
        <DialogContent className="sm:max-w-sm">
            <DialogHeader>
                <DialogTitle>Select Invoice Type</DialogTitle>
                <DialogDescription>
                    Choose which invoices to download.
                </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col space-y-4 py-4">
                {["PO Invoices", "WO Invoices", "All Invoices"].map((type) => (
                    <div key={type} className="flex items-center space-x-2">
                        <input
                            type="radio"
                            id={type}
                            name="invoiceType"
                            checked={invoiceType === type}
                            onChange={() => setInvoiceType(type)}
                            className="accent-primary h-4 w-4"
                        />
                         <label htmlFor={type} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                            {type}
                        </label>
                    </div>
                 ))}
                <Button onClick={handleInvoiceDownload} className="w-full mt-4">
                    Generate Invoices PDF
                </Button>
            </div>
        </DialogContent>
      </Dialog>

      {/* Progress Dialog */}
      <Dialog open={showProgress} onOpenChange={setShowProgress}>
        <DialogContent className="sm:max-w-md">
            <DialogHeader>
            <DialogTitle>Generating PDF</DialogTitle>
            <DialogDescription>
                Please wait while we gather and merge your documents.
            </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col items-center justify-center space-y-4 py-4">
                <div className="w-full bg-secondary h-4 rounded-full overflow-hidden">
                <div 
                    className="bg-primary h-full transition-all duration-300 ease-in-out" 
                    style={{ width: `${progress}%` }}
                />
                </div>
                <p className="text-sm text-muted-foreground">{progress}% - {progressMessage}</p>
            </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
