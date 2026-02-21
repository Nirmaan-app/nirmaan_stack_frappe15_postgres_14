import { useState, useContext, useCallback, useMemo } from "react";
import { useToast } from "@/components/ui/use-toast";
import { FrappeContext, FrappeConfig, useFrappeGetDocList } from "frappe-react-sdk";
import { DateFilterValue } from "@/components/ui/standalone-date-filter";
import { subDays, subMonths, subYears, startOfWeek, startOfMonth, startOfQuarter, startOfYear, isAfter, isBefore, isEqual, isWithinInterval } from "date-fns";

export type BulkDocType = "PO" | "WO" | "Invoice" | "DC" | "MIR" | "DN";
export type InvoiceSubType = "PO Invoices" | "WO Invoices" | "All Invoices";

export interface POItem {
    name: string;
    vendor_name?: string;
    vendor?: string;
    status?: string;
    amount?: number;
    creation?: string;
}

import { VendorInvoice } from "@/types/NirmaanStack/VendorInvoice";
import { PODeliveryDocuments } from "@/types/NirmaanStack/PODeliveryDocuments";

export interface WOItem {
    name: string;
    vendor?: string;
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

    // Step 1 = type selection, Step 2 = select + download, Step 3 = success
    const [step, setStep] = useState<1 | 2 | 3>(1);
    const [docType, setDocType] = useState<BulkDocType | null>(null);

    // Download success state
    const [downloadedCount, setDownloadedCount] = useState(0);
    const [downloadedLabel, setDownloadedLabel] = useState("");

    // Shared selection state
    const [selectedIds, setSelectedIds] = useState<string[]>([]);

    // PO-specific options
    const [withRate, setWithRate] = useState(true);

    // Invoice-specific options
    const [invoiceSubType, setInvoiceSubType] = useState<InvoiceSubType>("All Invoices");

    // Common filters
    const [commonVendorFilter, setCommonVendorFilter] = useState<string[]>([]);
    const [commonDateFilter, setCommonDateFilter] = useState<DateFilterValue | undefined>();

    // Progress/loading
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [progressMessage, setProgressMessage] = useState("");
    const [showProgress, setShowProgress] = useState(false);

    // ── Data ──────────────────────────────────────────────────────────────────

    const { data: poList = [], isLoading: posLoading } = useFrappeGetDocList<POItem>(
        "Procurement Orders",
        {
            fields: ["name", "vendor_name", "vendor", "status", "amount", "creation"],
            filters: [
                ["project", "=", projectId],
                ["status", "not in", ["Merged", "Inactive", "PO Amendment", "Cancelled"]],
            ],
            limit: 0,
            orderBy: { field: "creation", order: "desc" },
        },
        projectId ? `bulk-po-${projectId}` : null
    );

    const { data: woList = [], isLoading: wosLoading } = useFrappeGetDocList<WOItem>(
        "Service Requests",
        {
            fields: ["name", "vendor", "vendor.vendor_name", "status", "creation"],
            filters: [["project", "=", projectId], ["status", "=", "Approved"]],
            limit: 0,
            orderBy: { field: "`tabService Requests`.creation", order: "desc" },
        },
        projectId ? `bulk-wo-${projectId}` : null
    );

    const { data: vendorInvoices = [], isLoading: invoicesLoading } = useFrappeGetDocList<VendorInvoice>(
        "Vendor Invoices",
        {
            fields: ["name", "vendor", "vendor.vendor_name", "document_type", "document_name", "invoice_no", "invoice_date", "invoice_attachment"],
            filters: [
                ["project", "=", projectId],
                ["status", "=", "Approved"],
            ],
            limit: 0,
            orderBy: { field: "`tabVendor Invoices`.creation", order: "desc" },
        },
        projectId ? `bulk-vi-${projectId}` : null
    );

    const { data: poDeliveryDocs = [], isLoading: poDeliveryDocsLoading } = useFrappeGetDocList<PODeliveryDocuments>(
        "PO Delivery Documents",
        {
            fields: ["name", "vendor", "vendor.vendor_name", "type", "procurement_order", "creation", "nirmaan_attachment"],
            filters: [
                ["project", "=", projectId],
            ],
            limit: 0,
            orderBy: { field: "`tabPO Delivery Documents`.creation", order: "desc" },
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

    // ── Derived lists ─────────────────────────────────────────────────────────

    // Helper: Map all doc items to a unified Vendor list for the filter
    const allVendorOptions = useMemo(() => {
        const map = new Map<string, string>();
        
        // Add PO vendors
        poList.forEach((po) => {
            if (po.vendor) map.set(po.vendor, po.vendor_name || po.vendor);
        });

        // Add WO vendors
        woList.forEach((wo) => {
            if (wo.vendor) map.set(wo.vendor, wo.vendor_name || wo.vendor);
        });

        // Add Invoice vendors
        vendorInvoices.forEach((vi) => {
            if (vi.vendor) map.set(vi.vendor, vi.vendor_name || vi.vendor);
        });

        // Add DC/MIR vendors
        poDeliveryDocs.forEach((doc) => {
            if (doc.vendor) map.set(doc.vendor, doc.vendor_name || doc.vendor);
        });

        return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
    }, [poList, woList, vendorInvoices, poDeliveryDocs]);

    const activeVendorOptions = useMemo(() => {
        if (!docType) return allVendorOptions; // Fallback if no specific docType
        
        const availableVendors = new Set<string>();

        switch (docType) {
            case "PO":
            case "DN":
                poList.forEach(po => po.vendor && availableVendors.add(po.vendor));
                break;
            case "WO":
                woList.forEach(wo => wo.vendor && availableVendors.add(wo.vendor));
                break;
            case "Invoice":
                vendorInvoices.forEach(vi => !!vi.invoice_attachment && vi.vendor && availableVendors.add(vi.vendor));
                break;
            case "DC":
                poDeliveryDocs.forEach(d => !!d.nirmaan_attachment && d.type === "Delivery Challan" && d.vendor && availableVendors.add(d.vendor));
                break;
            case "MIR":
                poDeliveryDocs.forEach(d => !!d.nirmaan_attachment && d.type === "Material Inspection Report" && d.vendor && availableVendors.add(d.vendor));
                break;
        }

        return allVendorOptions.filter(opt => availableVendors.has(opt.value));
    }, [docType, allVendorOptions, poList, woList, vendorInvoices, poDeliveryDocs]);

    // Helper to evaluate date filter logic
    const isDateMatchingFilter = (dateStr: string, filter: DateFilterValue | undefined): boolean => {
        if (!filter || !filter.value) return true;
        const d = new Date(dateStr.split(" ")[0]);
        d.setHours(0, 0, 0, 0);

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const { operator, value } = filter;

        if (operator === "Between" && Array.isArray(value)) {
            const [fromStr, toStr] = value;
            const from = new Date(fromStr); from.setHours(0, 0, 0, 0);
            const to = new Date(toStr); to.setHours(23, 59, 59, 999);
            return isWithinInterval(d, { start: from, end: to });
        }

        if (operator === "<=" && typeof value === "string") {
            const target = new Date(value); target.setHours(23, 59, 59, 999);
            return isBefore(d, target) || isEqual(d, target);
        }

        if (operator === ">=" && typeof value === "string") {
            const target = new Date(value); target.setHours(0, 0, 0, 0);
            return isAfter(d, target) || isEqual(d, target);
        }

        if (operator === "Is" && typeof value === "string") {
            const target = new Date(value); target.setHours(0, 0, 0, 0);
            return d.getTime() === target.getTime();
        }

        if (operator === "Timespan" && typeof value === "string") {
            switch (value) {
                case "today": return d.getTime() === today.getTime();
                case "yesterday": return d.getTime() === subDays(today, 1).getTime();
                case "last week": return isWithinInterval(d, { start: subDays(startOfWeek(today), 7), end: subDays(startOfWeek(today), 1) });
                case "last month": return isWithinInterval(d, { start: startOfMonth(subMonths(today, 1)), end: subDays(startOfMonth(today), 1) });
                case "last quarter": return isWithinInterval(d, { start: startOfQuarter(subMonths(today, 3)), end: subDays(startOfQuarter(today), 1) });
                case "last 6 months": return isWithinInterval(d, { start: startOfMonth(subMonths(today, 6)), end: today });
                case "last year": return isWithinInterval(d, { start: startOfYear(subYears(today, 1)), end: subDays(startOfYear(today), 1) });
                case "last 7 days": return isWithinInterval(d, { start: subDays(today, 7), end: today });
                case "last 14 days": return isWithinInterval(d, { start: subDays(today, 14), end: today });
                case "last 30 days": return isWithinInterval(d, { start: subDays(today, 30), end: today });
                case "last 90 days": return isWithinInterval(d, { start: subDays(today, 90), end: today });
                case "this week": return isWithinInterval(d, { start: startOfWeek(today), end: today });
                case "this month": return isWithinInterval(d, { start: startOfMonth(today), end: today });
                case "this quarter": return isWithinInterval(d, { start: startOfQuarter(today), end: today });
                case "this year": return isWithinInterval(d, { start: startOfYear(today), end: today });
                default: return true;
            }
        }

        return true;
    };

    // Filtered PO list
    const filteredPoList = useMemo(() => {
        let list = poList;
        if (commonVendorFilter.length > 0) {
            list = list.filter((po) => po.vendor && commonVendorFilter.includes(po.vendor));
        }
        if (commonDateFilter) {
            list = list.filter((po) => {
                if (!po.creation) return false;
                return isDateMatchingFilter(po.creation, commonDateFilter);
            });
        }
        return list;
    }, [poList, commonVendorFilter, commonDateFilter]);

    // Filtered DN list (Only Delivered and Partially Delivered POs)
    const filteredDnList = useMemo(() => {
        return filteredPoList.filter(po => po.status === "Delivered" || po.status === "Partially Delivered");
    }, [filteredPoList]);

    // Filtered WO list
    const filteredWoList = useMemo(() => {
        let list = woList;
        if (commonVendorFilter.length > 0) {
            list = list.filter((wo) => wo.vendor && commonVendorFilter.includes(wo.vendor));
        }
        if (commonDateFilter) {
            list = list.filter((wo) => {
                if (!wo.creation) return false;
                return isDateMatchingFilter(wo.creation, commonDateFilter);
            });
        }
        return list;
    }, [woList, commonVendorFilter, commonDateFilter]);

    // Invoices list mapping
    const invoiceItems = useMemo(() => {
        let list = vendorInvoices.filter(vi => !!vi.invoice_attachment); // strictly require valid attachment
        
        if (commonVendorFilter.length > 0) {
            list = list.filter(vi => vi.vendor && commonVendorFilter.includes(vi.vendor));
        }
        
        if (commonDateFilter) {
            list = list.filter((vi) => {
                const dateStr = vi.invoice_date || vi.creation; // Fallback to creation if no invoice_date
                if (!dateStr) return false;
                return isDateMatchingFilter(dateStr, commonDateFilter);
            });
        }
        
        return list;
    }, [vendorInvoices, commonVendorFilter, commonDateFilter]);

    const filteredInvoiceItems = useCallback((subType: InvoiceSubType) => {
        if (subType === "PO Invoices") return invoiceItems.filter((a) => a.document_type === "Procurement Orders");
        if (subType === "WO Invoices") return invoiceItems.filter((a) => a.document_type === "Service Requests");
        return invoiceItems;
    }, [invoiceItems]);

    // DC and MIR mapping
    const poDeliveryDocItems = useMemo(() => {
        let list = poDeliveryDocs.filter(d => !!d.nirmaan_attachment); // strictly require attachment
        
        if (commonVendorFilter.length > 0) {
            list = list.filter(d => d.vendor && commonVendorFilter.includes(d.vendor));
        }
        
        if (commonDateFilter) {
            list = list.filter((d) => {
                if (!d.creation) return false; // Usually PODD date is tracking 'creation' or 'dc_date'
                return isDateMatchingFilter(d.creation, commonDateFilter);
            });
        }
        
        return list;
    }, [poDeliveryDocs, commonVendorFilter, commonDateFilter]);

    const dcItems = useMemo(() => poDeliveryDocItems.filter(d => d.type === "Delivery Challan"), [poDeliveryDocItems]);
    const mirItems = useMemo(() => poDeliveryDocItems.filter(d => d.type === "Material Inspection Report"), [poDeliveryDocItems]);

    // Item counts for Step 1 badges (using un-filtered lengths for the base counts on type selection)
    const itemCounts = useMemo<Partial<Record<BulkDocType, number>>>(() => ({
        PO: poList.length,
        WO: woList.length,
        Invoice: vendorInvoices.filter(vi => !!vi.invoice_attachment).length,
        DC: poDeliveryDocs.filter(d => !!d.nirmaan_attachment && d.type === "Delivery Challan").length,
        MIR: poDeliveryDocs.filter(d => !!d.nirmaan_attachment && d.type === "Material Inspection Report").length,
        DN: poList.filter(po => po.status === "Delivered" || po.status === "Partially Delivered").length,
    }), [poList, woList, vendorInvoices, poDeliveryDocs]);

    // Unique PO statuses for filter chips
    const poStatuses = useMemo(() => {
        const set = new Set<string>();
        poList.forEach((po) => { if (po.status) set.add(po.status); });
        return Array.from(set).sort();
    }, [poList]);

    // ── Navigation ────────────────────────────────────────────────────────────

    const goToStep2 = useCallback((type: BulkDocType) => {
        setDocType(type);
        setSelectedIds([]);
        setStep(2);
    }, []);

    const goBack = useCallback(() => {
        setStep(1);
        setDocType(null);
        setSelectedIds([]);
    }, []);

    const resetToTypeSelection = useCallback(() => {
        setStep(1);
        setDocType(null);
        setSelectedIds([]);
        setDownloadedCount(0);
        setDownloadedLabel("");
    }, []);

    // ── Selection ─────────────────────────────────────────────────────────────

    const selectAll = useCallback((ids: string[]) => setSelectedIds(ids), []);
    const deselectAll = useCallback(() => setSelectedIds([]), []);
    const toggleId = useCallback((id: string) => {
        setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
    }, []);

    // Select POs linked to multiple critical tasks (union)
    const selectMultipleCriticalTaskPOs = useCallback((taskNames: string[]) => {
        if (taskNames.length === 0) { setSelectedIds([]); return; }
        const all = new Set<string>();
        taskNames.forEach((name) => {
            const task = criticalTasks.find((t) => t.name === name);
            parseAssociatedPOs(task?.associated_pos).forEach((po) => all.add(po));
        });
        const valid = poList.filter((po) => all.has(po.name)).map((po) => po.name);
        setSelectedIds(valid);
    }, [criticalTasks, poList]);

    // ── PO Filters ────────────────────────────────────────────────────────────

    const toggleVendor = useCallback((v: string) => {
        setCommonVendorFilter((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]);
    }, []);

    const clearFilters = useCallback(() => {
        setCommonVendorFilter([]);
        setCommonDateFilter(undefined);
    }, []);

    // ── Download ──────────────────────────────────────────────────────────────

    const handleDownload = async () => {
        if (!selectedIds.length) {
            toast({ title: "No items selected", description: "Please select at least one item.", variant: "destructive" });
            return;
        }
        const labelMap: Record<BulkDocType, string> = {
            PO: "POs", WO: "WOs", Invoice: "Invoices", DC: "Delivery Challans", MIR: "MIRs", DN: "Delivery Notes",
        };
        const label = labelMap[docType!];

        try {
            setLoading(true);
            setShowProgress(true);
            setProgress(0);
            setProgressMessage(`Starting ${label} download...`);

            if (socket) {
                socket.on("bulk_download_progress", (data: any) => {
                    if (data.progress) setProgress(data.progress);
                    if (data.message) setProgressMessage(data.message);
                });
            }

            const namesParam = encodeURIComponent(JSON.stringify(selectedIds));
            let endpoint = "";
            let fileName = "";

            let resolvedIds = [...selectedIds];

            switch (docType) {
                case "PO": {
                    endpoint = `/api/method/nirmaan_stack.api.pdf_helper.bulk_download.download_selected_pos?project=${projectId}&names=${namesParam}&with_rate=${withRate ? 1 : 0}`;
                    fileName = `${projectName || projectId}_Selected_POs_${withRate ? "With" : "Without"}_Rate.pdf`;
                    break;
                }
                case "WO":
                    endpoint = `/api/method/nirmaan_stack.api.pdf_helper.bulk_download.download_selected_wos?project=${projectId}&names=${namesParam}`;
                    fileName = `${projectName || projectId}_Selected_WOs.pdf`;
                    break;
                case "DN":
                    endpoint = `/api/method/nirmaan_stack.api.pdf_helper.bulk_download.download_selected_dns?project=${projectId}&names=${namesParam}`;
                    fileName = `${projectName || projectId}_Selected_DNs.pdf`;
                    break;
                case "Invoice": {
                    // Map Vendor Invoices back to their Nirmaan Attachment ID
                    resolvedIds = invoiceItems
                                    .filter(vi => selectedIds.includes(vi.name) && !!vi.invoice_attachment)
                                    .map(vi => vi.invoice_attachment!);
                    const subTypeParam = encodeURIComponent(invoiceSubType);
                    const resolvedNamesParam = encodeURIComponent(JSON.stringify(resolvedIds));
                    endpoint = `/api/method/nirmaan_stack.api.pdf_helper.bulk_download.download_selected_attachments?project=${projectId}&attachment_names=${resolvedNamesParam}&doc_type=${subTypeParam}`;
                    fileName = `${projectName || projectId}_Selected_${label.replace(/ /g, "_")}.pdf`;
                    break;
                }
                case "DC":
                case "MIR": {
                    // Map PO Delivery Documents back to their Nirmaan Attachment ID
                    resolvedIds = poDeliveryDocItems
                                    .filter(d => selectedIds.includes(d.name) && !!d.nirmaan_attachment)
                                    .map(d => d.nirmaan_attachment!);
                    const resolvedNamesParam = encodeURIComponent(JSON.stringify(resolvedIds));
                    endpoint = `/api/method/nirmaan_stack.api.pdf_helper.bulk_download.download_selected_attachments?project=${projectId}&attachment_names=${resolvedNamesParam}&doc_type=${docType}`;
                    fileName = `${projectName || projectId}_Selected_${label.replace(/ /g, "_")}.pdf`;
                    break;
                }
            }

            const response = await fetch(endpoint);
            const ct = response.headers.get("content-type");

            if (ct?.includes("application/json")) {
                const err = await response.json();
                let msg = err.message || "Failed to generate PDF";
                try { msg = JSON.parse(JSON.parse(err._server_messages)[0]).message || msg; } catch (_) {}
                throw new Error(msg);
            }
            if (!response.ok) throw new Error(`Failed to generate PDF (Status: ${response.status})`);

            const blob = await response.blob();
            if (blob.size === 0) throw new Error("Generated PDF is empty.");

            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = fileName;
            document.body.appendChild(a); a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);

            setDownloadedCount(selectedIds.length);
            setDownloadedLabel(label);
            setStep(3);
            toast({ title: "Success", description: `${label} downloaded successfully.`, variant: "success" });
        } catch (error: any) {
            toast({ title: "Download Failed", description: error.message, variant: "destructive" });
        } finally {
            setLoading(false);
            setShowProgress(false);
            if (socket) socket.off("bulk_download_progress");
        }
    };

    return {
        // Core states
        step,
        docType,
        selectedIds,
        // Selection bindings
        toggleId,
        selectAll,
        deselectAll,
        selectMultipleCriticalTaskPOs,
        // Nav bindings
        goToStep2,
        goBack,
        resetToTypeSelection,
        // Download state
        downloadedCount,
        downloadedLabel,
        loading,
        progress,
        progressMessage,
        showProgress,
        setShowProgress,
        handleDownload,
        
        // Data arrays
        poList: filteredPoList,
        posLoading,
        woList: filteredWoList,
        wosLoading,
        dnList: filteredDnList,
        invoiceItems,
        invoicesLoading,
        dcItems,
        mirItems,
        poDeliveryDocsLoading,
        criticalTasks,
        criticalTasksLoading,
        
        // Filters & Derived State
        vendorOptions: activeVendorOptions,
        commonVendorFilter,
        setCommonVendorFilter,
        toggleVendor,
        commonDateFilter,
        setCommonDateFilter,
        clearFilters,
        withRate,
        setWithRate,
        poStatuses,
        
        itemCounts,
        invoiceSubType,
        setInvoiceSubType,
        filteredInvoiceItems,
    };
};
