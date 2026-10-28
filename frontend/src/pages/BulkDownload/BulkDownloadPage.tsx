import { useMemo } from "react";
import { Separator } from "@/components/ui/separator";
import { WizardSteps, WizardStep } from "@/components/ui/wizard-steps";
import { FileDown, Wand2, LayoutList, CheckCircle2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { BulkPdfDownloadButton } from "@/components/common/BulkPdfDownloadButton";
import { BulkDownloadProgressDialog } from "@/components/common/BulkDownloadProgressDialog";
import { BulkDownloadStep1 } from "./BulkDownloadStep1";
import { BulkDownloadActions } from "./BulkDownloadActions";
import { POSteps, WOSteps, InvoiceSteps, DCSteps, MIRSteps, DNSteps, MTCSteps, ClientInvoiceSteps, PaymentVoucherSteps, PorterInvoiceSteps } from "./steps";
import { useBulkDownloadWizard } from "./useBulkDownloadWizard";
import { useUserData } from "@/hooks/useUserData";
import { BulkDownloadScope, TYPE_INFO, allowedBulkTypes, bulkTableLimits, invoiceSubTypesFor, isOverSelectionLimit } from "@/utils/bulkDownload/bulkDownloadTypes";

interface BulkDownloadPageProps {
    /** The project tab passes its project, the vendor tab its vendor (with `vendorType`), and
     *  Reports > Bulk Download the "all" scope (every project the user may read). */
    scope: BulkDownloadScope;
}

/**
 * The step bar, shorter on desktop only: less padding, 28px circles, a tighter circle → label gap. Set from here
 * because `components/ui/wizard-steps.tsx` is a shared file that is never hand-edited, so every other wizard keeps
 * its size; `lg:` leaves the phone and tablet views (already compact) exactly as they are.
 */
const COMPACT_STEP_BAR = [
    "border-y bg-muted/20",
    "lg:[&>div]:py-1.5",
    "lg:[&_button]:gap-1",
    "lg:[&_button>div]:h-7 lg:[&_button>div]:w-7 lg:[&_button>div]:text-xs",
].join(" ");

const WIZARD_STEPS: WizardStep[] = [
    { key: "type", title: "Choose Type", shortTitle: "Type", icon: FileDown },
    { key: "select", title: "Selection and Download", shortTitle: "Select & Download", icon: LayoutList },
    { key: "done", title: "Done", shortTitle: "Done", icon: CheckCircle2 },
];

export const BulkDownloadPage = ({ scope }: BulkDownloadPageProps) => {
    const { role } = useUserData();
    const { kind, vendorType } = scope;
    const types = useMemo(() => allowedBulkTypes({ kind, vendorType }, role), [kind, vendorType, role]);
    const invoiceSubTypes = useMemo(() => invoiceSubTypesFor({ kind, vendorType }), [kind, vendorType]);

    const {
        step,
        docType,
        selectedIds,
        selectAll,
        selectMultipleCriticalTaskPOs,
        goToStep2,
        goBack,
        resetToTypeSelection,
        downloadedCount,
        downloadedLabel,
        // Data arrays (each step's full eligible list -- the step's table does the filtering)
        poList,
        posLoading,
        woList,
        wosLoading,
        dnList,
        invoicesLoading,
        dcItems,
        mirItems,
        poDeliveryDocsLoading,
        criticalTasks,
        dnCriticalTasks,
        projectInvoiceItems,
        projectInvoicesLoading,
        poVoucherPayments,
        poVouchersLoading,
        woVoucherPayments,
        woVouchersLoading,
        mtcItems,
        mtcsLoading,
        porterInvoices,
        porterInvoicesLoading,
        withRate,
        setWithRate,

        // General
        itemCounts,
        invoiceSubType,
        setInvoiceSubType,
        filteredInvoiceItems,

        // Download/progress
        loading,
        run,
        closeProgress,
        handleDownload,
        cancelDownload,
    } = useBulkDownloadWizard(scope, types);

    const currentWizardStep = step === 1 ? 0 : step === 2 ? 1 : 2;

    // The all scope has no Quick Download (it would be every document of every project) and no
    // card counts (each would load a company-wide list); its tables page and cap the selection.
    const isAll = scope.kind === "all";
    const limits = useMemo(() => bulkTableLimits(scope.kind), [scope.kind]);
    const tableLimits = useMemo(() => ({ pageSize: limits.pageSize }), [limits]);
    const overLimit = isOverSelectionLimit(selectedIds.length, limits);

    const sharedProps = {
        selectedIds,
        onSelectAll: selectAll,
        tableLimits,
    };

    // The selection step's one Back / Download row: at the top on Reports > Bulk Download, at the
    // bottom on the project and vendor tabs (owner, 2026-10-28).
    const actions = (placement: "top" | "bottom") => docType && (
        <BulkDownloadActions
            count={selectedIds.length}
            plural={TYPE_INFO[docType].short}
            loading={loading}
            overLimit={overLimit}
            maxSelect={limits.maxSelect}
            placement={placement}
            onBack={goBack}
            onDownload={handleDownload}
        />
    );

    return (
        <div className="flex flex-col gap-6">
            {/* Quick Bulk Download */}
            {!isAll && (
                <>
                    <div className="rounded-xl border-gray-200 border bg-white p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                            <div className="h-12 w-12 rounded-lg bg-red-50 flex items-center justify-center shrink-0">
                                <FileDown className="h-6 w-6 text-red-500" />
                            </div>
                            <div>
                                <h3 className="text-base font-bold text-gray-900 leading-tight">Quick Download</h3>
                                <p className="text-sm text-gray-500 mt-1">
                                    Download all documents for this {scope.kind} at once.
                                </p>
                            </div>
                        </div>
                        <div className="shrink-0">
                            <BulkPdfDownloadButton scope={scope} types={types} />
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <Separator className="flex-1" />
                        <span className="text-xs text-muted-foreground font-medium uppercase tracking-widest">or use the wizard</span>
                        <Separator className="flex-1" />
                    </div>
                </>
            )}

            {/* Selective Wizard */}
            <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
                {/* Header and step bar: same layout, less height (owner, 2026-10-28) */}
                <div className="px-6 py-1.5">
                    <div className="flex justify-center items-center gap-2 mb-0.5">
                        <Wand2 className="h-4 w-4 text-primary" />
                        <h3 className="text-base font-semibold">What would you like to download?</h3>
                    </div>
                    <p className="text-center text-xs text-muted-foreground">
                        Choose a document type. You'll select specific items in the next step.
                    </p>
                </div>
                {/* <div className="text-center space-y-1">
                <h2 className="text-2xl font-bold tracking-tight">What would you like to download?</h2>
                <p className="text-muted-foreground text-sm">
                    Choose a document type. You'll select specific items in the next step.
                </p>
            </div> */}


                <WizardSteps
                    steps={WIZARD_STEPS}
                    currentStep={currentWizardStep}
                    className={COMPACT_STEP_BAR}
                />

                <div className="p-6">
                    {step === 2 && isAll && actions("top")}

                    {step === 1 && (
                        <BulkDownloadStep1 onSelect={goToStep2} types={types} counts={isAll ? undefined : itemCounts} />
                    )}

                    {step === 2 && docType === "PO" && (
                        <POSteps
                            {...sharedProps}
                            items={poList}
                            isLoading={posLoading}
                            withRate={withRate}
                            onWithRateChange={setWithRate}
                            criticalTasks={criticalTasks}
                            onSelectMultipleCriticalTaskPOs={selectMultipleCriticalTaskPOs}
                            scopeKind={scope.kind}
                        />
                    )}

                    {step === 2 && docType === "WO" && (
                        <WOSteps
                            {...sharedProps}
                            items={woList}
                            isLoading={wosLoading}
                            withRate={withRate}
                            onWithRateChange={setWithRate}
                            scopeKind={scope.kind}
                        />
                    )}

                    {step === 2 && docType === "Invoice" && (
                        <InvoiceSteps
                            {...sharedProps}
                            items={filteredInvoiceItems(invoiceSubType)}
                            isLoading={invoicesLoading}
                            invoiceSubType={invoiceSubType}
                            onInvoiceSubTypeChange={setInvoiceSubType}
                            subTypes={invoiceSubTypes}
                            scopeKind={scope.kind}
                        />
                    )}

                    {step === 2 && docType === "DC" && (
                        <DCSteps {...sharedProps} items={dcItems} isLoading={poDeliveryDocsLoading} scopeKind={scope.kind} />
                    )}

                    {step === 2 && docType === "MIR" && (
                        <MIRSteps {...sharedProps} items={mirItems} isLoading={poDeliveryDocsLoading} scopeKind={scope.kind} />
                    )}

                    {step === 2 && docType === "ClientInvoice" && scope.kind !== "vendor" && (
                        <ClientInvoiceSteps {...sharedProps} items={projectInvoiceItems} isLoading={projectInvoicesLoading} scopeKind={scope.kind} />
                    )}

                    {step === 2 && docType === "DN" && (
                        <DNSteps
                            {...sharedProps}
                            items={dnList}
                            isLoading={posLoading}
                            criticalTasks={dnCriticalTasks}
                            onSelectMultipleCriticalTaskPOs={selectMultipleCriticalTaskPOs}
                            scopeKind={scope.kind}
                        />
                    )}

                    {step === 2 && docType === "MTC" && (
                        <MTCSteps {...sharedProps} items={mtcItems} isLoading={mtcsLoading} scopeKind={scope.kind} />
                    )}

                    {step === 2 && docType === "POPaymentVoucher" && (
                        <PaymentVoucherSteps
                            {...sharedProps}
                            kind="PO"
                            items={poVoucherPayments}
                            isLoading={poVouchersLoading}
                            scopeKind={scope.kind}
                        />
                    )}

                    {step === 2 && docType === "WOPaymentVoucher" && (
                        <PaymentVoucherSteps
                            {...sharedProps}
                            kind="WO"
                            items={woVoucherPayments}
                            isLoading={woVouchersLoading}
                            scopeKind={scope.kind}
                        />
                    )}

                    {step === 2 && docType === "PorterInvoice" && isAll && (
                        <PorterInvoiceSteps {...sharedProps} items={porterInvoices} isLoading={porterInvoicesLoading} />
                    )}

                    {step === 2 && !isAll && actions("bottom")}

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

            <BulkDownloadProgressDialog run={run} scopeName={scope.name} onCancel={cancelDownload} onClose={closeProgress} />
        </div>
    );
};

export default BulkDownloadPage;
