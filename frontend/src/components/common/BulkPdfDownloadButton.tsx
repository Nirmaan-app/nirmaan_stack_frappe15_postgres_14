import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Download, FileDown, ExternalLink } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useBulkPdfDownload } from "@/hooks/useBulkPdfDownload";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radiogroup";
import { Label } from "@/components/ui/label";
import { useUserData } from "@/hooks/useUserData";
import { BulkDocType, BulkDownloadScope, INVOICE_SUB_TYPES, TYPE_INFO, invoiceSubTypesFor } from "@/utils/bulkDownload/bulkDownloadTypes";

interface BulkPdfDownloadButtonProps {
  scope: BulkDownloadScope;
  /** The types this scope and role may download (`allowedBulkTypes`), in menu order. */
  types: BulkDocType[];
}

export const BulkPdfDownloadButton = ({ scope, types }: BulkPdfDownloadButtonProps) => {
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
    rateDocType,
    initiatePODownload,
    initiateWODownload,
    showInvoiceDialog,
    setShowInvoiceDialog,
    invoiceType,
    setInvoiceType,
    initiateInvoiceDownload,
    handleBulkDownload,
    completedBatches,
    finalMergeToken,
    triggerDownload,
    stopProgress,
    cancelDownload
  } = useBulkPdfDownload(scope);

  // PO / WO ask about rates and invoices about their kind first; the rest start straight away.
  const onMenuClick: Record<BulkDocType, () => void> = {
    PO: initiatePODownload,
    WO: initiateWODownload,
    Invoice: initiateInvoiceDownload,
    DC: () => handleBulkDownload("DC", TYPE_INFO.DC.card),
    MIR: () => handleBulkDownload("MIR", TYPE_INFO.MIR.card),
    DN: () => handleBulkDownload("DN", TYPE_INFO.DN.card),
    ClientInvoice: () => handleBulkDownload("ClientInvoice", TYPE_INFO.ClientInvoice.card),
  };
  const invoiceChoices = INVOICE_SUB_TYPES.filter((c) => invoiceSubTypesFor(scope).includes(c.value));

  const rateLabel = rateDocType === "WO" ? "WOs" : "POs";
  const rateDocTypeLabel = rateDocType === "WO" ? "Work Orders" : "POs";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="w-full md:w-auto px-4 border-red-400 text-red-500 hover:bg-red-50 hover:text-red-600 transition-colors duration-200 flex items-center gap-2">
            <Download className="h-4 w-4" />
            <span className="font-semibold text-sm">{scope.kind === "vendor" ? "Vendor" : "Project"} Bulk Download</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 p-1">
          {types.map((type) => (
            <DropdownMenuItem key={type} onClick={onMenuClick[type]} className="cursor-pointer">
              <Download className="mr-2 h-4 w-4" />
              <span>{TYPE_INFO[type].menu}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* PO / WO Rate Selection Dialog (shared) */}
      <Dialog open={showRateDialog} onOpenChange={setShowRateDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Download {rateLabel}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <p className="text-sm text-muted-foreground">Select how you want to download the {rateDocTypeLabel} documents.</p>
            <div className="flex flex-col gap-2">
              <Button
                variant="outline"
                onClick={() => handleBulkDownload(rateDocType, rateLabel, { withRate: true })}
                disabled={isProjectManager}
                className="justify-start h-auto py-3 px-4"
              >
                <div className="flex flex-col items-start">
                  <span className="font-semibold">With Rate</span>
                  <span className="text-xs text-muted-foreground font-normal italic lowercase">Shows prices and totals in the {rateLabel.toLowerCase()}</span>
                  {isProjectManager && (
                    <span className="text-[10px] text-muted-foreground font-normal mt-1">Disabled for Project Managers</span>
                  )}
                </div>
              </Button>
              <Button
                variant="outline"
                onClick={() => handleBulkDownload(rateDocType, rateLabel, { withRate: false })}
                className="justify-start h-auto py-3 px-4"
              >
                <div className="flex flex-col items-start">
                  <span className="font-semibold">Without Rate</span>
                  <span className="text-xs text-muted-foreground font-normal italic lowercase">Hides prices and totals from the {rateLabel.toLowerCase()}</span>
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
              Select the type of invoices to download for this {scope.kind}.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <RadioGroup value={invoiceType} onValueChange={setInvoiceType} className="grid gap-2">
              {invoiceChoices.map(({ value, label }) => (
                <div key={value} className="flex items-center space-x-2">
                  <RadioGroupItem value={value} id={`quick-${value}`} />
                  <Label htmlFor={`quick-${value}`} className="cursor-pointer">{label}</Label>
                </div>
              ))}
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
      <Dialog open={showProgress} onOpenChange={(open) => !loading && stopProgress()}>
        <DialogContent
          className="sm:max-w-md [&>button]:hidden"
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{progress === 100 ? "Generation Complete" : "Generating Documents"}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col space-y-4 py-4">
            <div className="space-y-2">
              <div className="w-full bg-secondary h-2.5 rounded-full overflow-hidden">
                <div
                  className="bg-primary h-full transition-all duration-300 ease-in-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex justify-between items-center text-xs text-muted-foreground">
                <span>{progress}% - {progressMessage}</span>
              </div>
            </div>
            {loading && (
              <div className="flex items-center justify-between gap-3 border-t pt-3">
                <p className="text-xs text-muted-foreground">Wait for the file, or cancel to stop the download.</p>
                <Button variant="outline" size="sm" onClick={cancelDownload}>Cancel download</Button>
              </div>
            )}

            {/* {(progress === 100 || !loading) && (
                    <div className="pt-2 flex justify-end">
                        <Button 
                            className="w-full"
                            onClick={stopProgress}
                        >
                            Close and Finish
                        </Button>
                    </div>
                )} */}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
