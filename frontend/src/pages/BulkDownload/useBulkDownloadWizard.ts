import { useState, useContext, useCallback, useMemo } from "react";
import { useToast } from "@/components/ui/use-toast";
import { FrappeContext, FrappeConfig, useFrappeGetDocList } from "frappe-react-sdk";
import { DateRange } from "react-day-picker";

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

export interface WOItem {
    name: string;
    vendor?: string;
    status?: string;
    creation?: string;
}

export interface AttachmentItem {
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

    // PO filters
    const [poVendorFilter, setPoVendorFilter] = useState<string[]>([]);
    const [poDateRange, setPoDateRange] = useState<DateRange | undefined>();

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
            fields: ["name", "vendor", "status", "creation"],
            filters: [["project", "=", projectId], ["status", "=", "Approved"]],
            limit: 0,
            orderBy: { field: "creation", order: "desc" },
        },
        projectId ? `bulk-wo-${projectId}` : null
    );

    const { data: allAttachments = [], isLoading: attachmentsLoading } = useFrappeGetDocList<AttachmentItem>(
        "Nirmaan Attachments",
        {
            fields: ["name", "attachment_type", "associated_docname"],
            filters: [
                ["project", "=", projectId],
                ["attachment_type", "in", ["po invoice", "sr invoice", "po delivery challan", "material inspection report"]],
            ],
            limit: 0,
            orderBy: { field: "creation", order: "desc" },
        },
        projectId ? `bulk-att-${projectId}` : null
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

    // Vendor options from PO list
    const vendorOptions = useMemo(() => {
        const map = new Map<string, string>();
        poList.forEach((po) => {
            if (po.vendor) map.set(po.vendor, po.vendor_name || po.vendor);
        });
        return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
    }, [poList]);

    // Filtered PO list (vendor + date)
    const filteredPoList = useMemo(() => {
        let list = poList;
        if (poVendorFilter.length > 0) {
            list = list.filter((po) => po.vendor && poVendorFilter.includes(po.vendor));
        }
        if (poDateRange?.from) {
            list = list.filter((po) => {
                if (!po.creation) return false;
                const d = new Date(po.creation.split(" ")[0]);
                if (poDateRange.from && d < poDateRange.from) return false;
                if (poDateRange.to) {
                    const to = new Date(poDateRange.to); to.setHours(23, 59, 59, 999);
                    if (d > to) return false;
                }
                return true;
            });
        }
        return list;
    }, [poList, poVendorFilter, poDateRange]);

    const invoiceItems = useMemo(() => allAttachments.filter(
        (a) => a.attachment_type === "po invoice" || a.attachment_type === "sr invoice"
    ), [allAttachments]);

    const filteredInvoiceItems = useCallback((subType: InvoiceSubType) => {
        if (subType === "PO Invoices") return invoiceItems.filter((a) => a.attachment_type === "po invoice");
        if (subType === "WO Invoices") return invoiceItems.filter((a) => a.attachment_type === "sr invoice");
        return invoiceItems;
    }, [invoiceItems]);

    const dcItems = useMemo(() => allAttachments.filter((a) => a.attachment_type === "po delivery challan"), [allAttachments]);
    const mirItems = useMemo(() => allAttachments.filter((a) => a.attachment_type === "material inspection report"), [allAttachments]);

    // Item counts for Step 1 badges
    const itemCounts = useMemo<Partial<Record<BulkDocType, number>>>(() => ({
        PO: poList.length,
        WO: woList.length,
        Invoice: invoiceItems.length,
        DC: dcItems.length,
        MIR: mirItems.length,
        DN: poList.length, // DNs come from POs
    }), [poList, woList, invoiceItems, dcItems, mirItems]);

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
        setPoVendorFilter((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]);
    }, []);

    const handlePoDateRange = useCallback((days: number | "All" | "custom", range?: DateRange) => {
        if (days === "All") setPoDateRange(undefined);
        else if (days === "custom" && range) setPoDateRange(range);
    }, []);

    const clearPoFilters = useCallback(() => {
        setPoVendorFilter([]);
        setPoDateRange(undefined);
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
                case "Invoice":
                case "DC":
                case "MIR": {
                    const subTypeParam = docType === "Invoice" ? encodeURIComponent(invoiceSubType) : docType;
                    endpoint = `/api/method/nirmaan_stack.api.pdf_helper.bulk_download.download_selected_attachments?project=${projectId}&attachment_names=${namesParam}&doc_type=${subTypeParam}`;
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
        step,
        docType,
        // Selection
        selectedIds,
        toggleId,
        selectAll,
        deselectAll,
        selectMultipleCriticalTaskPOs,
        // Navigation
        goToStep2,
        goBack,
        resetToTypeSelection,
        // Download success
        downloadedCount,
        downloadedLabel,
        // PO
        poList: filteredPoList,
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
        // Counts for Step 1 badges
        itemCounts,
        // WO
        woList,
        wosLoading,
        // Invoices
        invoiceSubType,
        setInvoiceSubType,
        filteredInvoiceItems,
        // DC
        dcItems,
        // MIR
        mirItems,
        // Attachments loading
        attachmentsLoading,
        // Critical tasks
        criticalTasks,
        criticalTasksLoading,
        // Progress/download
        loading,
        progress,
        progressMessage,
        showProgress,
        setShowProgress,
        handleDownload,
    };
};
