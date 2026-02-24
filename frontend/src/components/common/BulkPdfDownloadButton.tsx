import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Download, FileDown } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useBulkPdfDownload } from "@/hooks/useBulkPdfDownload";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radiogroup";
import { Label } from "@/components/ui/label";
import { useUserData } from "@/hooks/useUserData";

interface BulkPdfDownloadButtonProps {
  projectId: string;
  projectName?: string;
}

export const BulkPdfDownloadButton = ({ projectId, projectName }: BulkPdfDownloadButtonProps) => {
  const { role } = useUserData();
  const isProjectManager = role === "Nirmaan Project Manager Profile";

  const {
    loading,
    showProgress,
    setShowProgress,
    progress,
    progressMessage,
    showRateDialog,
    setShowRateDialog,
    initiatePODownload,
    showInvoiceDialog,
    setShowInvoiceDialog,
    invoiceType,
    setInvoiceType,
    initiateInvoiceDownload,
    handleBulkDownload
  } = useBulkPdfDownload(projectId, projectName);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="w-full md:w-64 justify-between border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800 transition-colors duration-200">
            <div className="flex items-center gap-2">
              <FileDown className="h-4 w-4" />
              <span className="font-semibold">Project Bulk Download</span>
            </div>
            <ChevronDown className="h-4 w-4 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 p-1">
          <DropdownMenuItem onClick={initiatePODownload} className="cursor-pointer">
            <Download className="mr-2 h-4 w-4" />
            <span>Download All POs</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleBulkDownload("WO", "Work Orders")} className="cursor-pointer">
            <Download className="mr-2 h-4 w-4" />
            <span>Download All WOs</span>
          </DropdownMenuItem>
          {!isProjectManager && (
            <DropdownMenuItem onClick={initiateInvoiceDownload} className="cursor-pointer">
              <Download className="mr-2 h-4 w-4" />
              <span>Download All Invoices</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => handleBulkDownload("DC", "Delivery Challans")} className="cursor-pointer">
            <Download className="mr-2 h-4 w-4" />
            <span>Download All DCs</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleBulkDownload("MIR", "Material Inspection Reports")} className="cursor-pointer">
            <Download className="mr-2 h-4 w-4" />
            <span>Download All MIRs</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleBulkDownload("DN", "Delivery Notes")} className="cursor-pointer">
            <Download className="mr-2 h-4 w-4" />
            <span>Download All DNs</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* PO Rate Selection Dialog */}
      <Dialog open={showRateDialog} onOpenChange={setShowRateDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Download POs</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <p className="text-sm text-muted-foreground">Select how you want to download the PO documents.</p>
            <div className="flex flex-col gap-2">
              <Button 
                variant="outline" 
                onClick={() => handleBulkDownload("PO", "POs", { withRate: true })}
                className="justify-start h-auto py-3 px-4"
              >
                <div className="flex flex-col items-start">
                  <span className="font-semibold">With Rate</span>
                  <span className="text-xs text-muted-foreground font-normal italic lowercase">Shows prices and totals in the POs</span>
                </div>
              </Button>
              <Button 
                variant="outline"
                onClick={() => handleBulkDownload("PO", "POs", { withRate: false })}
                className="justify-start h-auto py-3 px-4"
              >
                <div className="flex flex-col items-start">
                  <span className="font-semibold">Without Rate</span>
                  <span className="text-xs text-muted-foreground font-normal italic lowercase">Hides prices and totals from the POs</span>
                </div>
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Invoice Selection Dialog */}
      <Dialog open={showInvoiceDialog} onOpenChange={setShowInvoiceDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Download All Invoices</DialogTitle>
            <DialogDescription>
              Select the type of invoices to download for this project.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <RadioGroup value={invoiceType} onValueChange={setInvoiceType} className="grid gap-2">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="PO Invoices" id="po-inv" />
                <Label htmlFor="po-inv" className="cursor-pointer">PO Invoices</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="WO Invoices" id="wo-inv" />
                <Label htmlFor="wo-inv" className="cursor-pointer">WO Invoices (SR)</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="All Invoices" id="all-inv" />
                <Label htmlFor="all-inv" className="cursor-pointer">All Invoices</Label>
              </div>
            </RadioGroup>
            <Button 
              className="mt-4" 
              onClick={() => handleBulkDownload("Invoice", "Invoices")}
            >
              Generate Invoices PDF
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Progress Dialog */}
      <Dialog open={showProgress} onOpenChange={(open) => !loading && setShowProgress(open)}>
        <DialogContent 
            className="sm:max-w-md [&>button]:hidden"
            onPointerDownOutside={(e) => e.preventDefault()}
            onEscapeKeyDown={(e) => e.preventDefault()}
        >
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
