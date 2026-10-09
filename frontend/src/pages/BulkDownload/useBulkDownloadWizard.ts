import { useState, useContext, useCallback, useMemo, useEffect, useRef } from "react";
import { useToast } from "@/components/ui/use-toast";
import { FrappeContext, FrappeConfig, useFrappeGetCall, useFrappeGetDocList } from "frappe-react-sdk";
import { useUserData } from "@/hooks/useUserData";
import { useProjectPOTaskLinks } from "@/pages/projects/data/critical-po/useCriticalPOQueries";
import { attachLinkedPOs } from "@/pages/projects/CriticalPOTasks/utils";
import { BulkDocType, BulkDownloadScope, InvoiceSubType, TYPE_INFO, compareMtcs } from "@/utils/bulkDownload/bulkDownloadTypes";
import { cancelBulkDownload, listenForDownload, newDownloadId } from "@/utils/bulkDownload/bulkDownloadEvents";

export type { BulkDocType, InvoiceSubType };

/** Vendor scope only: the facet column is the project, not the vendor. */
interface ProjectFields {
    project?: string;
    project_name?: string;
}

export interface POItem extends ProjectFields {
    name: string;
    vendor_name?: string;
    vendor?: string;
    status?: string;
    amount?: number;
    total_amount?: number;
    creation?: string;
    latest_delivery_date?: string;
}

import { VendorInvoice as BaseVendorInvoice } from "@/types/NirmaanStack/VendorInvoice";
export interface VendorInvoice extends BaseVendorInvoice {
    vendor_name?: string;
    project_name?: string;
}

import { PODeliveryDocuments as BasePODeliveryDocuments } from "@/types/NirmaanStack/PODeliveryDocuments";
export interface PODeliveryDocuments extends BasePODeliveryDocuments {
    vendor_name?: string;
    project_name?: string;
    dc_date?: string;
}

import { ProjectInvoice as BaseProjectInvoice } from "@/types/NirmaanStack/ProjectInvoice";
export interface ProjectInvoice extends BaseProjectInvoice {
    company_name?: string;
}

export interface WOItem extends ProjectFields {
    name: string;
    vendor?: string;
    vendor_name?: string;
    status?: string;
    total_amount?: number;
    creation?: string;
}
/** A paid Work Order payment; only one with `voucher_attachment` can be downloaded. */
export interface PaymentVoucherRow extends ProjectFields {
    name: string;
    document_name?: string;
    vendor?: string;
    vendor_name?: string;
    amount?: number;
    utr?: string;
    payment_date?: string;
    voucher_attachment?: string;
    creation?: string;
}

import type { MaterialTestCertificate } from "@/types/NirmaanStack/MaterialTestCertificate";
/** One Material Test Certificate (one row per certificate, like a DC); its id is a key only, never shown. */
export type MTCRow = MaterialTestCertificate;

export interface NirmaanAttachmentStub {
    name: string;
    attachment_type?: string;
    associated_docname?: string;
}

export interface CriticalPOTask {
    name: string;
    item_name: string;
    critical_po_category?: string;
    /** POs linked to this task (Critical PO Task Child Table), attached client-side. */
    linked_pos?: string[];
}

/**
 * The wizard for one project or one vendor. `types` is `allowedBulkTypes(scope, role)`: the
 * payment-voucher and MTC lists are only fetched where their card is offered.
 */
export const useBulkDownloadWizard = (scope: BulkDownloadScope, types: BulkDocType[]) => {
    const { kind, id } = scope;
    const isProject = kind === "project";
    const scopeFilter: [string, "=", string] = [kind, "=", id];
    const scopeKey = id ? `${kind}-${id}` : null;
    // The facet column of a vendor's tables is the project (a project's tables show the vendor).
    const projectFields = isProject ? [] : ["project", "project.project_name"];

    const { toast } = useToast();
    const { socket } = useContext(FrappeContext) as FrappeConfig;
    const { role } = useUserData();
    const isProjectManager = role === "Nirmaan Project Manager Profile";

    const [step, setStep] = useState<1 | 2 | 3>(1);
    const [docType, setDocType] = useState<BulkDocType | null>(null);
    const [downloadedCount, setDownloadedCount] = useState(0);
    const [downloadedLabel, setDownloadedLabel] = useState("");
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [withRate, setWithRate] = useState(true);
    const [invoiceSubType, setInvoiceSubTypeState] = useState<InvoiceSubType>("All Invoices");

    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [progressMessage, setProgressMessage] = useState("");
    const [showProgress, setShowProgress] = useState(false);

    const [downloadToken, setDownloadToken] = useState<{ token: string, filename: string } | null>(null);

    // The download this wizard started: its id, and the function that removes its listeners.
    const activeIdRef = useRef<string | null>(null);
    const unlistenRef = useRef<(() => void) | null>(null);
    const detach = useCallback(() => {
        unlistenRef.current?.();
        unlistenRef.current = null;
        activeIdRef.current = null;
    }, []);

    // Leaving the page mid-download stops the job too: nobody would receive the file.
    useEffect(() => () => {
        const activeId = activeIdRef.current;
        unlistenRef.current?.();
        if (activeId) cancelBulkDownload(activeId);
    }, []);

    const { data: poList = [], isLoading: posLoading } = useFrappeGetDocList<POItem>(
        "Procurement Orders",
        {
            fields: ["name", "vendor_name", "vendor", "status", "amount", "total_amount", "creation", "latest_delivery_date", ...(isProject ? [] : (["project", "project_name"] as const))],
            filters: [scopeFilter, ["status", "not in", ["Merged", "Inactive", "Cancelled"]]],
            limit: 0,
            orderBy: { field: "creation", order: "asc" },
        },
        scopeKey && `bulk-po-${scopeKey}`
    );

    const { data: woList = [], isLoading: wosLoading } = useFrappeGetDocList<WOItem>(
        "Service Requests",
        {
            fields: ["name", "vendor", "vendor.vendor_name" as any, "status", "total_amount", "creation", ...projectFields as any[]],
            filters: [scopeFilter, ["status", "=", "Approved"]],
            limit: 0,
            orderBy: { field: "`tabService Requests`.creation", order: "asc" },
        },
        scopeKey && `bulk-wo-${scopeKey}`
    );

    const { data: vendorInvoices = [], isLoading: invoicesLoading } = useFrappeGetDocList<VendorInvoice>(
        "Vendor Invoices",
        {
            fields: ["name", "vendor", "vendor.vendor_name" as any, "document_type", "document_name", "invoice_no", "invoice_date", "invoice_amount", "invoice_attachment", ...projectFields as any[]],
            filters: [scopeFilter, ["status", "=", "Approved"]],
            limit: 0,
            orderBy: { field: "`tabVendor Invoices`.creation", order: "asc" },
        },
        scopeKey && `bulk-vi-${scopeKey}`
    );

    // PO-only by design: the Bulk Download wizard's UX (vendor facet, vendor_name
    // subtitle, parent search) is built for PO-parented PDDs. Since
    // `PO Delivery Documents` is polymorphic (PO + ITM share the table), an
    // unfiltered fetch would mix in ITM rows that show as anonymous entries.
    // Filter on `parent_doctype = "Procurement Orders"` — backfill patch
    // populates this field for every legacy PO PDD, and the create API stamps
    // it on every new row. ITM bulk download, if needed later, is a separate flow.
    const { data: poDeliveryDocs = [], isLoading: poDeliveryDocsLoading } = useFrappeGetDocList<PODeliveryDocuments>(
        "PO Delivery Documents",
        {
            fields: ["name", "vendor", "vendor.vendor_name" as any, "type", "parent_docname", "procurement_order", "creation", "nirmaan_attachment", "dc_date", "reference_number", "dc_reference", ...projectFields as any[]],
            filters: [
                scopeFilter,
                ["parent_doctype", "=", "Procurement Orders"],
            ],
            limit: 0,
            orderBy: { field: "`tabPO Delivery Documents`.dc_date", order: "asc" },
        },
        scopeKey && `bulk-podd-${scopeKey}`
    );

    const { data: projectInvoices = [], isLoading: projectInvoicesLoading } = useFrappeGetDocList<ProjectInvoice>(
        "Project Invoices",
        {
            fields: ["name", "customer", "customer.company_name" as any, "invoice_no", "invoice_date", "amount", "attachment", "creation"],
            filters: [scopeFilter],
            limit: 0,
            orderBy: { field: "`tabProject Invoices`.invoice_date", order: "asc" },
        },
        // Project Invoices carry no vendor.
        isProject && scopeKey ? `bulk-pi-${scopeKey}` : null
    );

    const { data: rawCriticalTasks, isLoading: criticalTasksListLoading } = useFrappeGetDocList<CriticalPOTask>(
        "Critical PO Tasks",
        {
            fields: ["name", "item_name", "critical_po_category"],
            filters: [scopeFilter],
            limit: 0,
            orderBy: { field: "creation", order: "desc" },
        },
        // Critical PO Tasks exist only inside a project.
        isProject && scopeKey ? `bulk-critical-${scopeKey}` : null
    );

    // Which POs each task has comes from the Critical PO Task Child Table.
    const { taskPOMap, isLoading: criticalLinksLoading } = useProjectPOTaskLinks(isProject ? id : "", isProject && !!id);
    const criticalTasks = useMemo(
        () => attachLinkedPOs(rawCriticalTasks, taskPOMap) ?? [],
        [rawCriticalTasks, taskPOMap]
    );
    const criticalTasksLoading = criticalTasksListLoading || criticalLinksLoading;

    const { data: voucherPayments = [], isLoading: voucherPaymentsLoading } = useFrappeGetDocList<PaymentVoucherRow>(
        "Project Payments",
        {
            fields: ["name", "document_name", "project", "project.project_name" as any, "vendor", "vendor.vendor_name" as any, "amount", "utr", "payment_date", "voucher_attachment", "creation"],
            filters: [scopeFilter, ["document_type", "=", "Service Requests"], ["status", "=", "Paid"]],
            limit: 0,
            orderBy: { field: "`tabProject Payments`.payment_date", order: "asc" },
        },
        // Waits out the role's "Loading" placeholder, which would otherwise fetch it for a PM too.
        types.includes("PaymentVoucher") && role !== "Loading" && scopeKey ? `bulk-pay-${scopeKey}` : null
    );

    // One row per certificate, through the MTC module's own read (`get_mtcs`), which applies the MTC
    // page's project rule: a PM / PL sees only their assigned projects.
    const { data: mtcData, isLoading: mtcsLoading } = useFrappeGetCall<{ message: MTCRow[] }>(
        "nirmaan_stack.api.material_test_certificates.mtc_api.get_mtcs",
        { [kind]: id },
        types.includes("MTC") && scopeKey ? `bulk-mtc-${scopeKey}` : null,
        { revalidateOnFocus: false }
    );
    // Oldest certificate first, undated ones last -- the order the merged PDF holds them in.
    const mtcItems = useMemo(
        () => [...(mtcData?.message ?? [])].filter((m) => !!m.attachment).sort(compareMtcs),
        [mtcData]
    );

    // Every step filters inside its own selection table (facet + date column filters), so the hook
    // hands each step its full ELIGIBLE list: DN = POs that have deliveries; the attachment types =
    // rows that actually carry a file to merge.
    const dnList = useMemo(() => poList.filter(p => ["Delivered", "Partially Delivered"].includes(p.status!)), [poList]);
    const invoiceItems = useMemo(() => vendorInvoices.filter(v => !!v.invoice_attachment), [vendorInvoices]);
    const dcItems = useMemo(() => poDeliveryDocs.filter(d => d.type === "Delivery Challan" && !!d.nirmaan_attachment), [poDeliveryDocs]);
    const mirItems = useMemo(() => poDeliveryDocs.filter(d => d.type === "Material Inspection Report" && !!d.nirmaan_attachment), [poDeliveryDocs]);
    const projectInvoiceItems = useMemo(() => projectInvoices.filter(p => !!p.attachment), [projectInvoices]);
    const voucherCount = useMemo(() => voucherPayments.filter(p => !!p.voucher_attachment).length, [voucherPayments]);

    const filteredInvoiceItems = useCallback((sub: InvoiceSubType) => {
        if (sub === "PO Invoices") return invoiceItems.filter(i => i.document_type === "Procurement Orders");
        if (sub === "WO Invoices") return invoiceItems.filter(i => i.document_type === "Service Requests");
        return invoiceItems;
    }, [invoiceItems]);

    const itemCounts = useMemo(() => ({
        PO: poList.length, WO: woList.length, Invoice: invoiceItems.length,
        DC: dcItems.length, MIR: mirItems.length, DN: dnList.length,
        MTC: mtcItems.length, ClientInvoice: projectInvoiceItems.length, PaymentVoucher: voucherCount,
    }), [poList, woList, invoiceItems, dcItems, mirItems, dnList, mtcItems, projectInvoiceItems, voucherCount]);

    const goToStep2 = useCallback((t: BulkDocType) => { setDocType(t); setSelectedIds([]); setStep(2); }, []);
    const goBack = useCallback(() => { setStep(1); setDocType(null); setSelectedIds([]); }, []);
    const resetToTypeSelection = useCallback(() => { detach(); setStep(1); setDocType(null); setSelectedIds([]); setDownloadedCount(0); setDownloadedLabel(""); setDownloadToken(null); }, [detach]);

    // Switching invoice type swaps the list under the table, so the selection goes with it -- a
    // download must never carry an invoice the current type hides.
    const setInvoiceSubType = useCallback((t: InvoiceSubType) => { setInvoiceSubTypeState(t); setSelectedIds([]); }, []);

    const toggleId = useCallback((id: string) => setSelectedIds(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]), []);
    const selectAll = useCallback((ids: string[]) => setSelectedIds(ids), []);
    const deselectAll = useCallback(() => setSelectedIds([]), []);

    const selectMultipleCriticalTaskPOs = useCallback((taskNames: string[]) => {
        const all = new Set<string>();
        taskNames.forEach(n => (criticalTasks.find(t => t.name === n)?.linked_pos ?? []).forEach(p => all.add(p)));
        setSelectedIds(poList.filter(p => all.has(p.name)).map(p => p.name));
    }, [criticalTasks, poList]);

    const triggerDownload = useCallback((token: string, filename: string) => {
        const url = `/api/method/nirmaan_stack.api.pdf_helper.bulk_download.fetch_temp_file?token=${token}&filename=${encodeURIComponent(filename)}`;
        const a = document.createElement("a"); a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }, []);

    const handleDownload = async () => {
        if (loading) return;
        if (!selectedIds.length) { toast({ title: "No items selected", variant: "destructive" }); return; }
        const label = TYPE_INFO[docType!].short;

        try {
            setLoading(true); setShowProgress(true); setProgress(0); setProgressMessage(`Preparing ${label}...`);
            setDownloadToken(null);

            detach();
            const downloadId = newDownloadId();
            activeIdRef.current = downloadId;
            if (socket) {
                unlistenRef.current = listenForDownload(socket, downloadId, {
                    onProgress: (d) => {
                        if (d.progress !== undefined) setProgress(d.progress);
                        if (d.message) setProgressMessage(d.message);
                    },
                    onReady: (data) => setDownloadToken(data),
                    onFailed: (d) => { toast({ title: "Failed", description: d.message, variant: "destructive" }); stopProgress(); },
                });
            }

            const formData = new FormData(); formData.append(kind, id); formData.append("download_id", downloadId);
            let endpoint = "";

            switch (docType) {
                case "PO":
                    endpoint = "/api/method/nirmaan_stack.api.pdf_helper.bulk_download.download_selected_pos";
                    formData.append("names", JSON.stringify(selectedIds));
                    formData.append("with_rate", (isProjectManager ? false : withRate) ? "1" : "0");
                    break;
                case "WO":
                    endpoint = "/api/method/nirmaan_stack.api.pdf_helper.bulk_download.download_selected_wos";
                    formData.append("names", JSON.stringify(selectedIds));
                    formData.append("with_rate", (isProjectManager ? false : withRate) ? "1" : "0");
                    break;
                case "DN":
                    endpoint = "/api/method/nirmaan_stack.api.pdf_helper.bulk_download.download_selected_dns";
                    formData.append("names", JSON.stringify(selectedIds));
                    break;
                case "Invoice":
                    endpoint = "/api/method/nirmaan_stack.api.pdf_helper.bulk_download.download_selected_attachments";
                    formData.append("attachment_names", JSON.stringify(filteredInvoiceItems(invoiceSubType).filter(i => selectedIds.includes(i.name)).map(i => i.invoice_attachment!)));
                    formData.append("doc_type", invoiceSubType);
                    break;
                case "DC":
                case "MIR":
                    endpoint = "/api/method/nirmaan_stack.api.pdf_helper.bulk_download.download_selected_attachments";
                    formData.append("attachment_names", JSON.stringify((docType === "DC" ? dcItems : mirItems).filter(d => selectedIds.includes(d.name)).map(d => d.nirmaan_attachment!)));
                    formData.append("doc_type", docType);
                    break;
                case "ClientInvoice":
                    endpoint = "/api/method/nirmaan_stack.api.pdf_helper.bulk_download.download_selected_attachments";
                    formData.append("attachment_names", JSON.stringify(projectInvoiceItems.filter(p => selectedIds.includes(p.name)).map(p => p.attachment!)));
                    formData.append("doc_type", "Client Invoices");
                    break;
                case "MTC":
                    // MTC names, not file URLs: the server reads each certificate back itself.
                    endpoint = "/api/method/nirmaan_stack.api.pdf_helper.bulk_download.download_selected_mtcs";
                    formData.append("names", JSON.stringify(selectedIds));
                    break;
                case "PaymentVoucher":
                    // Payment names, not file URLs: the server reads each voucher back itself.
                    endpoint = "/api/method/nirmaan_stack.api.pdf_helper.bulk_download.download_selected_payment_vouchers";
                    formData.append("names", JSON.stringify(selectedIds));
                    break;
            }

            const res = await fetch(endpoint, { method: "POST", headers: { "X-Frappe-CSRF-Token": (window as any).csrf_token || "" }, body: formData });
            if (!res.ok) throw new Error((await res.json())?.message || "Internal error");
            toast({ title: "Started", description: "Worker is processing your request." });
        } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); detach(); setLoading(false); setShowProgress(false); }
    };

    const stopProgress = useCallback(() => {
        setLoading(false); setShowProgress(false);
        detach();
        if (progress === 100) { setDownloadedCount(selectedIds.length || 1); setDownloadedLabel(docType === "PaymentVoucher" ? "Payment Voucher" : docType || "batch"); setStep(3); }
    }, [detach, progress, selectedIds, docType]);

    /** The progress window's Cancel: close it, stop the job, and stay on the selection (it is kept). */
    const cancelDownload = useCallback(() => {
        const activeId = activeIdRef.current;
        detach();
        setLoading(false); setShowProgress(false); setDownloadToken(null);
        if (activeId) cancelBulkDownload(activeId);
        toast({ title: "Download cancelled" });
    }, [detach, toast]);

    // Full Auto-Completion Logic
    useEffect(() => {
        if (!loading) return;
        if (downloadToken) {
            triggerDownload(downloadToken.token, downloadToken.filename);
            stopProgress();
        }
    }, [downloadToken, loading, triggerDownload, stopProgress]);

    return {
        step, docType, selectedIds, toggleId, selectAll, deselectAll, selectMultipleCriticalTaskPOs, goToStep2, goBack, resetToTypeSelection,
        downloadedCount, downloadedLabel, poList, posLoading, woList, wosLoading, dnList,
        invoicesLoading, dcItems, mirItems, poDeliveryDocsLoading, criticalTasks, criticalTasksLoading,
        withRate, setWithRate, itemCounts, invoiceSubType, setInvoiceSubType, filteredInvoiceItems,
        loading, progress, progressMessage, showProgress, setShowProgress, handleDownload,
        downloadToken,
        triggerDownload,
        stopProgress,
        cancelDownload,
        projectInvoiceItems,
        projectInvoicesLoading,
        voucherPayments,
        voucherPaymentsLoading,
        mtcItems,
        mtcsLoading,
    };
};
