import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useBulkPdfDownload } from "@/hooks/useBulkPdfDownload";
import { BulkDownloadProgressDialog } from "@/components/common/BulkDownloadProgressDialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radiogroup";
import { Label } from "@/components/ui/label";
import { useUserData } from "@/hooks/useUserData";
import { BulkDocType, BulkDownloadScope, INVOICE_SUB_TYPES, TYPE_INFO, invoiceSubTypesFor, menuGroups } from "@/utils/bulkDownload/bulkDownloadTypes";
import { TYPE_STYLE } from "@/utils/bulkDownload/bulkDownloadStyle";

/** The items that ask one more question before starting: say which, so the dialog is no surprise. */
const MENU_HINT: Partial<Record<BulkDocType, string>> = {
  PO: "with / without rate",
  WO: "with / without rate",
  Invoice: "PO / WO / all",
};

interface BulkPdfDownloadButtonProps {
  scope: BulkDownloadScope;
  /** The types this scope and role may download (`allowedBulkTypes`); the menu groups them. */
  types: BulkDocType[];
}

export const BulkPdfDownloadButton = ({ scope, types }: BulkPdfDownloadButtonProps) => {
  const { role } = useUserData();
  const isProjectManager = role === "Nirmaan Project Manager Profile";

  const {
    run,
    closeProgress,
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
    MTC: () => handleBulkDownload("MTC", TYPE_INFO.MTC.card),
    ClientInvoice: () => handleBulkDownload("ClientInvoice", TYPE_INFO.ClientInvoice.card),
    POPaymentVoucher: () => handleBulkDownload("POPaymentVoucher", TYPE_INFO.POPaymentVoucher.card),
    WOPaymentVoucher: () => handleBulkDownload("WOPaymentVoucher", TYPE_INFO.WOPaymentVoucher.card),
  };
  const invoiceChoices = INVOICE_SUB_TYPES.filter((c) => invoiceSubTypesFor(scope).includes(c.value));

  const rateLabel = rateDocType === "WO" ? "WOs" : "POs";
  const rateDocTypeLabel = rateDocType === "WO" ? "Work Orders" : "POs";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {/* Open = pressed: the fill and the flipped chevron tie the button to its menu. */}
          <Button
            variant="outline"
            className="group w-full md:w-auto px-4 gap-2 border-red-400 text-red-600 hover:bg-red-50 hover:text-red-700 data-[state=open]:border-red-500 data-[state=open]:bg-red-50 data-[state=open]:text-red-700 transition-colors duration-200"
          >
            <Download className="h-4 w-4" />
            <span className="font-semibold text-sm">{scope.kind === "vendor" ? "Vendor" : "Project"} Bulk Download</span>
            <ChevronDown className="h-4 w-4 opacity-70 transition-transform duration-200 group-data-[state=open]:rotate-180" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={6}
          className="w-80 min-w-[var(--radix-dropdown-menu-trigger-width)] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto p-0"
        >
          <div className="border-b bg-muted/40 px-3 py-2.5">
            <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Download all{scope.name ? ` · ${scope.name}` : ""}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">One merged PDF per document type</p>
          </div>
          <div className="p-1">
            {menuGroups(types).map((group, i) => (
              <DropdownMenuGroup key={group.label}>
                {i > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </DropdownMenuLabel>
                {group.types.map((type) => {
                  const { icon: Icon, iconBg, iconColor } = TYPE_STYLE[type];
                  return (
                    <DropdownMenuItem key={type} onClick={onMenuClick[type]} className="group cursor-pointer gap-2.5 px-2 py-1.5">
                      <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors", iconBg)}>
                        <Icon className={cn("h-4 w-4", iconColor)} />
                      </span>
                      <span className="flex-1 truncate text-sm">{TYPE_INFO[type].card}</span>
                      {MENU_HINT[type] && <span className="shrink-0 text-[11px] text-muted-foreground">{MENU_HINT[type]}</span>}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuGroup>
            ))}
          </div>
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

      <BulkDownloadProgressDialog run={run} scopeName={scope.name} onCancel={cancelDownload} onClose={closeProgress} />
    </>
  );
};
