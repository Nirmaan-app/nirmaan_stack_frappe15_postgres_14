import { useState } from "react";
import { useUserData } from "@/hooks/useUserData";
import { useBulkDownloadOperation } from "@/hooks/useBulkDownloadOperation";
import { BulkDocType, BulkDownloadScope } from "@/utils/bulkDownload/bulkDownloadTypes";
import { runDetails } from "@/utils/bulkDownload/bulkDownloadRun";

const METHOD = "nirmaan_stack.api.pdf_helper.bulk_download";

/** The doc type the server takes for each attachment kind (an invoice download sends its invoice kind). */
const ATTACHMENT_DOC_TYPE: Partial<Record<BulkDocType, string>> = {
    DC: "DC",
    MIR: "MIR",
    ClientInvoice: "Client Invoices",
    POPaymentVoucher: "PO Payment Vouchers",
    WOPaymentVoucher: "WO Payment Vouchers",
    MTC: "MTCs",
};

export type DownloadType = BulkDocType;

/** Quick Download ("download all") for one project or one vendor. */
export const useBulkPdfDownload = (scope: BulkDownloadScope) => {
    const { role } = useUserData();
    const isProjectManager = role === "Nirmaan Project Manager Profile";

    // The download this button follows (ADR 0047): its window, kept across a reload of the tab.
    const download = useBulkDownloadOperation({ storageKey: `bulk_pdf:${scope.kind}:${scope.id}` });
    const { run, working: showProgress } = download;

    // PO/WO rate-selection dialog (shared)
    const [showRateDialog, setShowRateDialog] = useState(false);
    const [rateDocType, setRateDocType] = useState<"PO" | "WO">("PO");
    const [withRate, setWithRate] = useState(true);

    // Invoice specific
    const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
    const [invoiceType, setInvoiceType] = useState<string>("All Invoices");

    const initiatePODownload = () => {
        setRateDocType("PO");
        setShowRateDialog(true);
        setWithRate(true);
    };

    const initiateWODownload = () => {
        setRateDocType("WO");
        setShowRateDialog(true);
        setWithRate(true);
    };

    const initiateInvoiceDownload = () => {
        setShowInvoiceDialog(true);
        setInvoiceType("All Invoices");
    };

    const handleBulkDownload = async (type: DownloadType, options?: { withRate?: boolean; invoiceType?: string }) => {
        if (type === "PO" || type === "WO") setShowRateDialog(false);
        if (type === "Invoice") setShowInvoiceDialog(false);

        const effectiveWithRate = isProjectManager ? false : !!options?.withRate;
        const invType = options?.invoiceType || invoiceType;
        const scopeArgs = { [scope.kind]: scope.id };
        const [endpoint, args]: [string, Record<string, unknown>] =
            type === "PO" ? ["download_all_pos", { with_rate: effectiveWithRate ? 1 : 0 }]
            : type === "WO" ? ["download_all_wos", { with_rate: effectiveWithRate ? 1 : 0 }]
            : type === "DN" ? ["download_all_dns", {}]
            : ["download_project_attachments", { doc_type: ATTACHMENT_DOC_TYPE[type] ?? invType }];

        // A refusal shows its reason in the progress window.
        await download.start(
            `${METHOD}.${endpoint}`,
            { ...scopeArgs, ...args },
            { type, details: runDetails(type, { withRate: effectiveWithRate, invoiceType: invType }) },
        );
    };

    return {
        loading: showProgress,
        showProgress,
        run,
        closeProgress: download.close,
        showRateDialog,
        setShowRateDialog,
        rateDocType,
        withRate,
        setWithRate,
        initiatePODownload,
        initiateWODownload,
        showInvoiceDialog,
        setShowInvoiceDialog,
        invoiceType,
        setInvoiceType,
        initiateInvoiceDownload,
        handleBulkDownload,
        cancelDownload: download.cancel,
    };
};
