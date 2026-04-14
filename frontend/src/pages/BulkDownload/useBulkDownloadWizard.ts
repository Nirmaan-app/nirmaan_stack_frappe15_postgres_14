import { useState, useContext, useCallback, useMemo, useEffect } from "react";
import { useToast } from "@/components/ui/use-toast";
import { FrappeContext, FrappeConfig, useFrappeGetDocList } from "frappe-react-sdk";
import { DateFilterValue } from "@/components/ui/standalone-date-filter";
import { subDays, subMonths, subYears, startOfWeek, startOfMonth, startOfQuarter, startOfYear, isAfter, isBefore, isEqual, isWithinInterval } from "date-fns";
import { useUserData } from "@/hooks/useUserData";

export type BulkDocType = "PO" | "WO" | "Invoice" | "DC" | "MIR" | "DN";
export type InvoiceSubType = "PO Invoices" | "WO Invoices" | "All Invoices";

export interface POItem {
    name: string;
    vendor_name?: string;
    vendor?: string;
    status?: string;
    amount?: number;
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

export interface WOItem {
    name: string;
    vendor?: string;
    vendor_name?: string;
    status?: string;
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
    associated_pos?: string; // JSON: { pos: string[] }
}

function parseAssociatedPOs(raw?: string): string[] {
    if (!raw) return [];
    try {
        const p = typeof raw === "string" ? JSON.parse(raw) : raw;
        return Array.isArray(p?.pos) ? p.pos : [];
    } catch { return []; }
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
    const [invoiceSubType, setInvoiceSubType] = useState<InvoiceSubType>("All Invoices");
    const [commonVendorFilter, setCommonVendorFilter] = useState<string[]>([]);
    const [commonDateFilter, setCommonDateFilter] = useState<DateFilterValue | undefined>();
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState<string[]>([]);

    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [progressMessage, setProgressMessage] = useState("");
    const [showProgress, setShowProgress] = useState(false);

    const [downloadToken, setDownloadToken] = useState<{ token: string, filename: string } | null>(null);

    const toggleVendor = useCallback((v: string) => {
        setCommonVendorFilter((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]);
    }, []);

    const toggleStatus = useCallback((s: string) => {
        setStatusFilter((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);
    }, []);

    const clearFilters = useCallback(() => {
        setCommonVendorFilter([]);
        setCommonDateFilter(undefined);
        setSearchQuery("");
        setStatusFilter([]);
    }, []);

    const { data: poList = [], isLoading: posLoading } = useFrappeGetDocList<POItem>(
        "Procurement Orders",
        {
            fields: ["name", "vendor_name", "vendor", "status", "amount", "creation", "latest_delivery_date"],
            filters: [["project", "=", projectId], ["status", "not in", ["Merged", "Inactive", "Cancelled"]]],
            limit: 0,
            orderBy: { field: "creation", order: "asc" },
        },
        projectId ? `bulk-po-${projectId}` : null
    );

    const { data: woList = [], isLoading: wosLoading } = useFrappeGetDocList<WOItem>(
        "Service Requests",
        {
            fields: ["name", "vendor", "vendor.vendor_name" as any, "status", "creation"],
            filters: [["project", "=", projectId], ["status", "=", "Approved"]],
            limit: 0,
            orderBy: { field: "`tabService Requests`.creation", order: "asc" },
        },
        projectId ? `bulk-wo-${projectId}` : null
    );

    const { data: vendorInvoices = [], isLoading: invoicesLoading } = useFrappeGetDocList<VendorInvoice>(
        "Vendor Invoices",
        {
            fields: ["name", "vendor", "vendor.vendor_name" as any, "document_type", "document_name", "invoice_no", "invoice_date", "invoice_attachment"],
            filters: [["project", "=", projectId], ["status", "=", "Approved"]],
            limit: 0,
            orderBy: { field: "`tabVendor Invoices`.creation", order: "asc" },
        },
        projectId ? `bulk-vi-${projectId}` : null
    );

    const { data: poDeliveryDocs = [], isLoading: poDeliveryDocsLoading } = useFrappeGetDocList<PODeliveryDocuments>(
        "PO Delivery Documents",
        {
            fields: ["name", "vendor", "vendor.vendor_name" as any, "type", "procurement_order", "creation", "nirmaan_attachment", "dc_date"],
            filters: [["project", "=", projectId]],
            limit: 0,
            orderBy: { field: "`tabPO Delivery Documents`.dc_date", order: "asc" },
        },
        projectId ? `bulk-podd-${projectId}` : null
    );

    const { data: criticalTasks = [], isLoading: criticalTasksLoading } = useFrappeGetDocList<CriticalPOTask>(
        "Critical PO Tasks",
        {
            fields: ["name", "item_name", "critical_po_category", "associated_pos"],
            filters: [["project", "=", projectId]],
            limit: 0,
            orderBy: { field: "creation", order: "desc" },
        },
        projectId ? `bulk-critical-${projectId}` : null
    );

    const allVendorOptions = useMemo(() => {
        const map = new Map<string, string>();
        poList.forEach(p => p.vendor && map.set(p.vendor, p.vendor_name || p.vendor));
        woList.forEach(w => w.vendor && map.set(w.vendor, w.vendor_name || w.vendor));
        vendorInvoices.forEach(v => v.vendor && map.set(v.vendor, v.vendor_name || v.vendor));
        poDeliveryDocs.forEach(d => d.vendor && map.set(d.vendor, d.vendor_name || d.vendor));
        return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
    }, [poList, woList, vendorInvoices, poDeliveryDocs]);

    const activeVendorOptions = useMemo(() => {
        if (!docType) return allVendorOptions;
        const avail = new Set<string>();
        if (docType === "PO" || docType === "DN") poList.forEach(p => avail.add(p.vendor!));
        if (docType === "WO") woList.forEach(w => avail.add(w.vendor!));
        if (docType === "Invoice") vendorInvoices.forEach(v => avail.add(v.vendor!));
        if (docType === "DC" || docType === "MIR") poDeliveryDocs.forEach(d => avail.add(d.vendor!));
        return allVendorOptions.filter(o => avail.has(o.value));
    }, [docType, allVendorOptions, poList, woList, vendorInvoices, poDeliveryDocs]);

    const isDateMatchingFilter = (dateStr: string, filter: DateFilterValue | undefined): boolean => {
        if (!filter || !filter.value) return true;
        const d = new Date(dateStr.split(" ")[0]); d.setHours(0, 0, 0, 0);
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const { operator, value } = filter;
        if (operator === "Between" && Array.isArray(value)) {
            const start = new Date(value[0]); start.setHours(0, 0, 0, 0);
            const end = new Date(value[1]); end.setHours(23, 59, 59, 999);
            return isWithinInterval(d, { start, end });
        }
        if (operator === "<=") return isBefore(d, new Date(value as string)) || isEqual(d, new Date(value as string));
        if (operator === ">=") return isAfter(d, new Date(value as string)) || isEqual(d, new Date(value as string));
        if (operator === "Is") return d.getTime() === new Date(value as string).getTime();
        if (operator === "Timespan") {
            switch (value) {
                case "today": return d.getTime() === today.getTime();
                case "yesterday": return d.getTime() === subDays(today, 1).getTime();
                case "last 7 days": return isWithinInterval(d, { start: subDays(today, 7), end: today });
                case "this month": return isWithinInterval(d, { start: startOfMonth(today), end: today });
                default: return true;
            }
        }
        return true;
    };

    const filteredPoList = useMemo(() => {
        let l = poList;
        if (commonVendorFilter.length) l = l.filter(p => commonVendorFilter.includes(p.vendor!));
        if (commonDateFilter) l = l.filter(p => p.creation && isDateMatchingFilter(p.creation, commonDateFilter));
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            l = l.filter(p => p.name.toLowerCase().includes(q) || (p.vendor_name && p.vendor_name.toLowerCase().includes(q)) || (p.vendor && p.vendor.toLowerCase().includes(q)));
        }
        return l;
    }, [poList, commonVendorFilter, commonDateFilter, searchQuery]);

    const filteredDnList = useMemo(() => {
        let l = poList.filter(p => ["Delivered", "Partially Delivered"].includes(p.status!));
        if (commonVendorFilter.length) l = l.filter(p => commonVendorFilter.includes(p.vendor!));
        if (commonDateFilter) l = l.filter(p => isDateMatchingFilter(p.latest_delivery_date || p.creation!, commonDateFilter));
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            l = l.filter(p => p.name.toLowerCase().includes(q) || (p.vendor_name && p.vendor_name.toLowerCase().includes(q)) || (p.vendor && p.vendor.toLowerCase().includes(q)));
        }
        return l;
    }, [poList, commonVendorFilter, commonDateFilter, searchQuery]);

    const filteredWoList = useMemo(() => {
        let l = woList;
        if (commonVendorFilter.length) l = l.filter(w => commonVendorFilter.includes(w.vendor!));
        if (commonDateFilter) l = l.filter(w => w.creation && isDateMatchingFilter(w.creation, commonDateFilter));
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            l = l.filter(w => w.name.toLowerCase().includes(q) || (w.vendor_name && w.vendor_name.toLowerCase().includes(q)) || (w.vendor && w.vendor.toLowerCase().includes(q)));
        }
        return l;
    }, [woList, commonVendorFilter, commonDateFilter, searchQuery]);

    const filteredInvoiceItemsBase = useMemo(() => {
        let l = vendorInvoices.filter(v => !!v.invoice_attachment);
        if (commonVendorFilter.length) l = l.filter(v => commonVendorFilter.includes(v.vendor!));
        if (commonDateFilter) l = l.filter(v => isDateMatchingFilter(v.invoice_date || v.creation!, commonDateFilter));
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            l = l.filter(v => v.name.toLowerCase().includes(q) || v.invoice_no?.toLowerCase().includes(q) || (v.vendor_name && v.vendor_name.toLowerCase().includes(q)) || (v.vendor && v.vendor.toLowerCase().includes(q)));
        }
        return l;
    }, [vendorInvoices, commonVendorFilter, commonDateFilter, searchQuery]);

    const filteredInvoiceItems = useCallback((sub: InvoiceSubType) => {
        if (sub === "PO Invoices") return filteredInvoiceItemsBase.filter(i => i.document_type === "Procurement Orders");
        if (sub === "WO Invoices") return filteredInvoiceItemsBase.filter(i => i.document_type === "Service Requests");
        return filteredInvoiceItemsBase;
    }, [filteredInvoiceItemsBase]);

    const filteredPoDeliveryDocItems = useMemo(() => {
        let l = poDeliveryDocs.filter(d => !!d.nirmaan_attachment);
        if (commonVendorFilter.length) l = l.filter(d => commonVendorFilter.includes(d.vendor!));
        if (commonDateFilter) l = l.filter(d => isDateMatchingFilter(d.dc_date || d.creation!, commonDateFilter));
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            l = l.filter(d => d.name.toLowerCase().includes(q) || d.procurement_order?.toLowerCase().includes(q) || (d.vendor_name && d.vendor_name.toLowerCase().includes(q)) || (d.vendor && d.vendor.toLowerCase().includes(q)));
        }
        return l;
    }, [poDeliveryDocs, commonVendorFilter, commonDateFilter, searchQuery]);

    const dcItems = useMemo(() => filteredPoDeliveryDocItems.filter(d => d.type === "Delivery Challan"), [filteredPoDeliveryDocItems]);
    const mirItems = useMemo(() => filteredPoDeliveryDocItems.filter(d => d.type === "Material Inspection Report"), [filteredPoDeliveryDocItems]);

    const itemCounts = useMemo(() => ({
        PO: poList.length, WO: woList.length, Invoice: vendorInvoices.filter(v => v.invoice_attachment).length,
        DC: poDeliveryDocs.filter(d => d.type === "Delivery Challan" && d.nirmaan_attachment).length,
        MIR: poDeliveryDocs.filter(d => d.type === "Material Inspection Report" && d.nirmaan_attachment).length,
        DN: poList.filter(p => ["Delivered", "Partially Delivered"].includes(p.status!)).length,
    }), [poList, woList, vendorInvoices, poDeliveryDocs]);

    const poStatuses = useMemo(() => Array.from(new Set(poList.map(p => p.status!).filter(Boolean))).sort(), [poList]);

    const goToStep2 = useCallback((t: BulkDocType) => { clearFilters(); setDocType(t); setSelectedIds([]); setStep(2); }, [clearFilters]);
    const goBack = useCallback(() => { setStep(1); setDocType(null); setSelectedIds([]); clearFilters(); }, [clearFilters]);
    const resetToTypeSelection = useCallback(() => { setStep(1); setDocType(null); setSelectedIds([]); setDownloadedCount(0); setDownloadedLabel(""); setDownloadToken(null); clearFilters(); }, [clearFilters]);

    const toggleId = useCallback((id: string) => setSelectedIds(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]), []);
    const selectAll = useCallback((ids: string[]) => setSelectedIds(ids), []);
    const deselectAll = useCallback(() => setSelectedIds([]), []);

    // Selection Reset Effect (Option B): Reset selection when filters change
    useEffect(() => {
        setSelectedIds([]);
    }, [commonVendorFilter, commonDateFilter, searchQuery, statusFilter]);

    const selectMultipleCriticalTaskPOs = useCallback((taskNames: string[]) => {
        const all = new Set<string>();
        taskNames.forEach(n => parseAssociatedPOs(criticalTasks.find(t => t.name === n)?.associated_pos).forEach(p => all.add(p)));
        setSelectedIds(poList.filter(p => all.has(p.name)).map(p => p.name));
    }, [criticalTasks, poList]);

    const triggerDownload = useCallback((token: string, filename: string) => {
        const url = `/api/method/nirmaan_stack.api.pdf_helper.bulk_download.fetch_temp_file?token=${token}&filename=${encodeURIComponent(filename)}`;
        const a = document.createElement("a"); a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }, []);

    const handleDownload = async () => {
        if (!selectedIds.length) { toast({ title: "No items selected", variant: "destructive" }); return; }
        const labelMap: Record<BulkDocType, string> = { PO: "POs", WO: "WOs", Invoice: "Invoices", DC: "DCs", MIR: "MIRs", DN: "DNs" };
        const label = labelMap[docType!];

        try {
            setLoading(true); setShowProgress(true); setProgress(0); setProgressMessage(`Preparing ${label}...`);
            setDownloadToken(null);

            if (socket) {
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
                    break;
                case "DN":
                    endpoint = "/api/method/nirmaan_stack.api.pdf_helper.bulk_download.download_selected_dns";
                    formData.append("names", JSON.stringify(selectedIds));
                    break;
                case "Invoice":
                    endpoint = "/api/method/nirmaan_stack.api.pdf_helper.bulk_download.download_selected_attachments";
                    formData.append("attachment_names", JSON.stringify(filteredInvoiceItemsBase.filter(i => selectedIds.includes(i.name)).map(i => i.invoice_attachment!)));
                    formData.append("doc_type", invoiceSubType);
                    break;
                case "DC":
                case "MIR":
                    endpoint = "/api/method/nirmaan_stack.api.pdf_helper.bulk_download.download_selected_attachments";
                    formData.append("attachment_names", JSON.stringify(filteredPoDeliveryDocItems.filter(d => selectedIds.includes(d.name)).map(d => d.nirmaan_attachment!)));
                    formData.append("doc_type", docType);
                    break;
            }

            const res = await fetch(endpoint, { method: "POST", headers: { "X-Frappe-CSRF-Token": (window as any).csrf_token || "" }, body: formData });
            if (!res.ok) throw new Error((await res.json())?.message || "Internal error");
            toast({ title: "Started", description: "Worker is processing your request." });
        } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); setLoading(false); setShowProgress(false); }
    };

    const stopProgress = useCallback(() => {
        setLoading(false); setShowProgress(false);
        if (socket) { ["bulk_download_progress", "bulk_download_all_ready", "bulk_download_failed"].forEach(e => socket.off(e)); }
        if (progress === 100) { setDownloadedCount(selectedIds.length || 1); setDownloadedLabel(docType || "batch"); setStep(3); }
    }, [socket, progress, selectedIds, docType]);

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
        downloadedCount, downloadedLabel, poList: filteredPoList, posLoading, woList: filteredWoList, wosLoading, dnList: filteredDnList,
        invoiceItems: filteredInvoiceItemsBase, invoicesLoading, dcItems, mirItems, poDeliveryDocsLoading, criticalTasks, criticalTasksLoading,
        vendorOptions: activeVendorOptions, commonVendorFilter, toggleVendor, commonDateFilter, setCommonDateFilter, clearFilters,
        withRate, setWithRate, poStatuses, itemCounts, invoiceSubType, setInvoiceSubType, filteredInvoiceItems,
        loading, progress, progressMessage, showProgress, setShowProgress, handleDownload,
        downloadToken,
        triggerDownload,
        stopProgress,

        // Filtered Lists for UI summaries
        filteredPoList,
        filteredWoList,
        filteredDnList,
        filteredInvoiceItemsBase,
        filteredPoDeliveryDocItems,
        searchQuery,
        setSearchQuery,
        statusFilter,
        toggleStatus,
    };
};
