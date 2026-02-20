import { useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { WizardSteps, WizardStep } from "@/components/ui/wizard-steps";
import { FileDown, Wand2, LayoutList, CheckCircle2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BulkPdfDownloadButton } from "@/components/common/BulkPdfDownloadButton";
import { BulkDownloadStep1 } from "./BulkDownloadStep1";
import { POSteps, WOSteps, InvoiceSteps, DCSteps, MIRSteps, DNSteps } from "./steps";
import { useBulkDownloadWizard } from "./useBulkDownloadWizard";

interface BulkDownloadPageProps {
    projectId: string;
    projectName?: string;
}

const WIZARD_STEPS: WizardStep[] = [
    { key: "type", title: "Choose Type", shortTitle: "Type", icon: FileDown },
    { key: "select", title: "Selection and Download", shortTitle: "Select & Download", icon: LayoutList },
    { key: "done", title: "Done", shortTitle: "Done", icon: CheckCircle2 },
];

export const BulkDownloadPage = ({ projectId, projectName }: BulkDownloadPageProps) => {
    const {
        step,
        docType,
        selectedIds,
        toggleId,
        selectAll,
        deselectAll,
        selectMultipleCriticalTaskPOs,
        goToStep2,
        goBack,
        resetToTypeSelection,
        downloadedCount,
        downloadedLabel,
        // PO
        poList,
        posLoading,
        vendorOptions,
        poVendorFilter,
        toggleVendor,
        poDateRange,
        handlePoDateRange,
        clearPoFilters,
        withRate,
        setWithRate,
        poStatuses,
        itemCounts,
        // WO
        woList,
        wosLoading,
        // Invoice
        invoiceSubType,
        setInvoiceSubType,
        filteredInvoiceItems,
        // DC / MIR
        dcItems,
        mirItems,
        attachmentsLoading,
        // Critical tasks
        criticalTasks,
        // Download/progress
        loading,
        progress,
        progressMessage,
        showProgress,
        setShowProgress,
        handleDownload,
    } = useBulkDownloadWizard(projectId, projectName);

    // Compute invoice list reactively so it re-renders when subType changes
    const invoiceItems = useMemo(() => filteredInvoiceItems(invoiceSubType), [filteredInvoiceItems, invoiceSubType]);

    const currentWizardStep = step === 1 ? 0 : step === 2 ? 1 : 2;

    const sharedProps = {
        selectedIds,
        onToggle: toggleId,
        onSelectAll: selectAll,
        onDeselectAll: deselectAll,
        onBack: goBack,
        onDownload: handleDownload,
        loading,
    };

    return (
        <div className="flex flex-col gap-8">
            {/* Quick Bulk Download */}
            <div className="rounded-xl border bg-card p-6 shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                    <FileDown className="h-5 w-5 text-primary" />
                    <h3 className="text-lg font-semibold">Quick Download</h3>
                </div>
                <p className="text-sm text-muted-foreground mb-4">
                    Download all documents for this project at once.
                </p>
                <BulkPdfDownloadButton projectId={projectId} projectName={projectName} />
            </div>

            <div className="flex items-center gap-3">
                <Separator className="flex-1" />
                <span className="text-xs text-muted-foreground font-medium uppercase tracking-widest">or use the wizard</span>
                <Separator className="flex-1" />
            </div>

            {/* Selective Wizard */}
            <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
                <div className="px-6 pt-6 pb-2">
                    <div className="flex items-center gap-2 mb-1">
                        <Wand2 className="h-5 w-5 text-primary" />
                        <h3 className="text-lg font-semibold">Selective Download</h3>
                    </div>
                    <p className="text-sm text-muted-foreground">
                        Choose specific documents and download only what you need.
                    </p>
                </div>

                <WizardSteps
                    steps={WIZARD_STEPS}
                    currentStep={currentWizardStep}
                    className="border-y bg-muted/20"
                />

                <div className="p-6">
                    {step === 1 && (
                        <BulkDownloadStep1 onSelect={goToStep2} counts={itemCounts} />
                    )}

                    {step === 2 && docType === "PO" && (
                        <POSteps
                            {...sharedProps}
                            items={poList}
                            isLoading={posLoading}
                            withRate={withRate}
                            onWithRateChange={setWithRate}
                            vendorOptions={vendorOptions}
                            poVendorFilter={poVendorFilter}
                            onToggleVendor={toggleVendor}
                            poDateRange={poDateRange}
                            onPoDateRange={handlePoDateRange}
                            onClearPoFilters={clearPoFilters}
                            criticalTasks={criticalTasks}
                            onSelectMultipleCriticalTaskPOs={selectMultipleCriticalTaskPOs}
                            poStatuses={poStatuses}
                        />
                    )}

                    {step === 2 && docType === "WO" && (
                        <WOSteps
                            {...sharedProps}
                            items={woList}
                            isLoading={wosLoading}
                        />
                    )}

                    {step === 2 && docType === "Invoice" && (
                        <InvoiceSteps
                            {...sharedProps}
                            items={invoiceItems}
                            isLoading={attachmentsLoading}
                            invoiceSubType={invoiceSubType}
                            onInvoiceSubTypeChange={setInvoiceSubType}
                        />
                    )}

                    {step === 2 && docType === "DC" && (
                        <DCSteps
                            {...sharedProps}
                            items={dcItems}
                            isLoading={attachmentsLoading}
                        />
                    )}

                    {step === 2 && docType === "MIR" && (
                        <MIRSteps
                            {...sharedProps}
                            items={mirItems}
                            isLoading={attachmentsLoading}
                        />
                    )}

                    {step === 2 && docType === "DN" && (
                        <DNSteps
                            {...sharedProps}
                            items={poList}
                            isLoading={posLoading}
                            vendorOptions={vendorOptions}
                            poVendorFilter={poVendorFilter}
                            onToggleVendor={toggleVendor}
                            poDateRange={poDateRange}
                            onPoDateRange={handlePoDateRange}
                            onClearPoFilters={clearPoFilters}
                            criticalTasks={criticalTasks}
                            onSelectMultipleCriticalTaskPOs={selectMultipleCriticalTaskPOs}
                        />
                    )}

                    {/* Step 3: Success */}
                    {step === 3 && (
                        <div className="flex flex-col items-center justify-center gap-6 py-12">
                            <div className="relative">
                                <div className="absolute inset-0 bg-green-400/20 rounded-full blur-xl animate-pulse" />
                                <div className="relative bg-green-100 rounded-full p-4">
                                    <CheckCircle2 className="h-12 w-12 text-green-600" />
                                </div>
                            </div>
                            <div className="text-center space-y-2">
                                <h2 className="text-2xl font-bold tracking-tight">Download Complete!</h2>
                                <p className="text-muted-foreground">
                                    {downloadedCount} {downloadedLabel} {downloadedCount === 1 ? "has" : "have"} been downloaded successfully.
                                </p>
                            </div>
                            <Button
                                variant="outline"
                                size="lg"
                                onClick={resetToTypeSelection}
                                className="mt-2 gap-2"
                            >
                                <RotateCcw className="h-4 w-4" />
                                Download Another Type
                            </Button>
                        </div>
                    )}
                </div>
            </div>

            {/* Progress Dialog */}
            <Dialog open={showProgress} onOpenChange={(open) => !loading && setShowProgress(open)}>
                <DialogContent
                    className="sm:max-w-md [&>button]:hidden"
                    onPointerDownOutside={(e) => e.preventDefault()}
                    onEscapeKeyDown={(e) => e.preventDefault()}
                >
                    <DialogHeader>
                        <DialogTitle>Generating PDF</DialogTitle>
                        <DialogDescription>Please wait while we gather and merge your documents.</DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col items-center space-y-4 py-4">
                        <div className="w-full bg-secondary h-4 rounded-full overflow-hidden">
                            <div
                                className="bg-primary h-full transition-all duration-300 ease-in-out"
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                        <p className="text-sm text-muted-foreground">{progress}% — {progressMessage}</p>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default BulkDownloadPage;
