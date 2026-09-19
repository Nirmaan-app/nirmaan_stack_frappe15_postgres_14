import { useState, useContext, useCallback, useMemo, useEffect } from "react";
import { useToast } from "@/components/ui/use-toast";
import { FrappeContext, FrappeConfig, useFrappeGetDocList } from "frappe-react-sdk";
import { useUserData } from "@/hooks/useUserData";
import { useProjectPOTaskLinks } from "@/pages/projects/data/critical-po/useCriticalPOQueries";
import { attachLinkedPOs } from "@/pages/projects/CriticalPOTasks/utils";

export type BulkDocType = "PO" | "WO" | "Invoice" | "DC" | "MIR" | "DN" | "ClientInvoice";
export type InvoiceSubType = "PO Invoices" | "WO Invoices" | "All Invoices";

const BULK_SOCKET_EVENTS = [
    "bulk_download_progress",
    "bulk_download_all_ready",
    "bulk_download_failed",
] as const;

export interface POItem {
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
}

import { PODeliveryDocuments as BasePODeliveryDocuments } from "@/types/NirmaanStack/PODeliveryDocuments";
export interface PODeliveryDocuments extends BasePODeliveryDocuments {
    vendor_name?: string;
    dc_date?: string;
}

import { ProjectInvoice as BaseProjectInvoice } from "@/types/NirmaanStack/ProjectInvoice";
export interface ProjectInvoice extends BaseProjectInvoice {
    company_name?: string;
}

export interface WOItem {
    name: string;
    vendor?: string;
    vendor_name?: string;
    status?: string;
    total_amount?: number;
    creation?: string;
}
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

export const useBulkDownloadWizard = (projectId: string, projectName?: string) => {
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

    const offAllListeners = useCallback(() => {
        if (!socket) return;
        BULK_SOCKET_EVENTS.forEach(e => socket.off(e));
    }, [socket]);

    useEffect(() => {
        return () => { offAllListeners(); };
    }, [offAllListeners]);

    const { data: poList = [], isLoading: posLoading } = useFrappeGetDocList<POItem>(
        "Procurement Orders",
        {
            fields: ["name", "vendor_name", "vendor", "status", "amount", "total_amount", "creation", "latest_delivery_date"],
            filters: [["project", "=", projectId], ["status", "not in", ["Merged", "Inactive", "Cancelled"]]],
            limit: 0,
            orderBy: { field: "creation", order: "asc" },
        },
        projectId ? `bulk-po-${projectId}` : null
    );

    const { data: woList = [], isLoading: wosLoading } = useFrappeGetDocList<WOItem>(
        "Service Requests",
        {
            fields: ["name", "vendor", "vendor.vendor_name" as any, "status", "total_amount", "creation"],
            filters: [["project", "=", projectId], ["status", "=", "Approved"]],
            limit: 0,
            orderBy: { field: "`tabService Requests`.creation", order: "asc" },
        },
        projectId ? `bulk-wo-${projectId}` : null
    );

    const { data: vendorInvoices = [], isLoading: invoicesLoading } = useFrappeGetDocList<VendorInvoice>(
        "Vendor Invoices",
        {
            fields: ["name", "vendor", "vendor.vendor_name" as any, "document_type", "document_name", "invoice_no", "invoice_date", "invoice_amount", "invoice_attachment"],
            filters: [["project", "=", projectId], ["status", "=", "Approved"]],
            limit: 0,
            orderBy: { field: "`tabVendor Invoices`.creation", order: "asc" },
        },
        projectId ? `bulk-vi-${projectId}` : null
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
            fields: ["name", "vendor", "vendor.vendor_name" as any, "type", "parent_docname", "procurement_order", "creation", "nirmaan_attachment", "dc_date", "reference_number", "dc_reference"],
            filters: [
                ["project", "=", projectId],
                ["parent_doctype", "=", "Procurement Orders"],
            ],
            limit: 0,
            orderBy: { field: "`tabPO Delivery Documents`.dc_date", order: "asc" },
        },
        projectId ? `bulk-podd-${projectId}` : null
    );

    const { data: projectInvoices = [], isLoading: projectInvoicesLoading } = useFrappeGetDocList<ProjectInvoice>(
        "Project Invoices",
        {
            fields: ["name", "customer", "customer.company_name" as any, "invoice_no", "invoice_date", "amount", "attachment", "creation"],
            filters: [["project", "=", projectId]],
            limit: 0,
            orderBy: { field: "`tabProject Invoices`.invoice_date", order: "asc" },
        },
        projectId ? `bulk-pi-${projectId}` : null
    );

    const { data: rawCriticalTasks, isLoading: criticalTasksListLoading } = useFrappeGetDocList<CriticalPOTask>(
        "Critical PO Tasks",
        {
            fields: ["name", "item_name", "critical_po_category"],
            filters: [["project", "=", projectId]],
            limit: 0,
            orderBy: { field: "creation", order: "desc" },
        },
        projectId ? `bulk-critical-${projectId}` : null
    );

    // Which POs each task has comes from the Critical PO Task Child Table.
    const { taskPOMap, isLoading: criticalLinksLoading } = useProjectPOTaskLinks(projectId || "", !!projectId);
    const criticalTasks = useMemo(
        () => attachLinkedPOs(rawCriticalTasks, taskPOMap) ?? [],
        [rawCriticalTasks, taskPOMap]
    );
    const criticalTasksLoading = criticalTasksListLoading || criticalLinksLoading;

    // Every step filters inside its own selection table (facet + date column filters), so the hook
    // hands each step its full ELIGIBLE list: DN = POs that have deliveries; the attachment types =
    // rows that actually carry a file to merge.
    const dnList = useMemo(() => poList.filter(p => ["Delivered", "Partially Delivered"].includes(p.status!)), [poList]);
    const invoiceItems = useMemo(() => vendorInvoices.filter(v => !!v.invoice_attachment), [vendorInvoices]);
    const dcItems = useMemo(() => poDeliveryDocs.filter(d => d.type === "Delivery Challan" && !!d.nirmaan_attachment), [poDeliveryDocs]);
    const mirItems = useMemo(() => poDeliveryDocs.filter(d => d.type === "Material Inspection Report" && !!d.nirmaan_attachment), [poDeliveryDocs]);
    const projectInvoiceItems = useMemo(() => projectInvoices.filter(p => !!p.attachment), [projectInvoices]);

    const filteredInvoiceItems = useCallback((sub: InvoiceSubType) => {
        if (sub === "PO Invoices") return invoiceItems.filter(i => i.document_type === "Procurement Orders");
        if (sub === "WO Invoices") return invoiceItems.filter(i => i.document_type === "Service Requests");
        return invoiceItems;
    }, [invoiceItems]);

    const itemCounts = useMemo(() => ({
        PO: poList.length, WO: woList.length, Invoice: invoiceItems.length,
        DC: dcItems.length, MIR: mirItems.length, DN: dnList.length,
        ClientInvoice: projectInvoiceItems.length,
    }), [poList, woList, invoiceItems, dcItems, mirItems, dnList, projectInvoiceItems]);

    const goToStep2 = useCallback((t: BulkDocType) => { setDocType(t); setSelectedIds([]); setStep(2); }, []);
    const goBack = useCallback(() => { setStep(1); setDocType(null); setSelectedIds([]); }, []);
    const resetToTypeSelection = useCallback(() => { offAllListeners(); setStep(1); setDocType(null); setSelectedIds([]); setDownloadedCount(0); setDownloadedLabel(""); setDownloadToken(null); }, [offAllListeners]);

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
        const labelMap: Record<BulkDocType, string> = { PO: "POs", WO: "WOs", Invoice: "Invoices", DC: "DCs", MIR: "MIRs", DN: "DNs", ClientInvoice: "Client Invoices" };
        const label = labelMap[docType!];

        try {
            setLoading(true); setShowProgress(true); setProgress(0); setProgressMessage(`Preparing ${label}...`);
            setDownloadToken(null);

            if (socket) {
                offAllListeners();
                socket.on("bulk_download_progress", (d: any) => {
                    if (d.progress !== undefined) {
                        setProgress(d.progress);
                        // If progress reached 100% and we only have one batch and no merge yet,
                        // it might be a single-batch job. We'll handle it in batch_ready or here.
                    }
                    if (d.message) setProgressMessage(d.message);
                });

                socket.on("bulk_download_all_ready", (data: any) => {
                    setDownloadToken(data);
                });
                socket.on("bulk_download_failed", (d: any) => { toast({ title: "Failed", description: d.message, variant: "destructive" }); stopProgress(); });
            }

            const formData = new FormData(); formData.append("project", projectId);
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
            }

            const res = await fetch(endpoint, { method: "POST", headers: { "X-Frappe-CSRF-Token": (window as any).csrf_token || "" }, body: formData });
            if (!res.ok) throw new Error((await res.json())?.message || "Internal error");
            toast({ title: "Started", description: "Worker is processing your request." });
        } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); setLoading(false); setShowProgress(false); }
    };

    const stopProgress = useCallback(() => {
        setLoading(false); setShowProgress(false);
        offAllListeners();
        if (progress === 100) { setDownloadedCount(selectedIds.length || 1); setDownloadedLabel(docType || "batch"); setStep(3); }
    }, [offAllListeners, progress, selectedIds, docType]);

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
        projectInvoiceItems,
        projectInvoicesLoading,
    };
};
