import { useFrappeGetDocList } from "frappe-react-sdk";
import { useMemo } from "react";
import { VendorInvoice } from "@/types/NirmaanStack/VendorInvoice";
import { ProjectInvoice } from "@/types/NirmaanStack/ProjectInvoice";
import { parseNumber } from "@/utils/parseNumber";

export interface GSTInvoiceDetail {
    name: string;
    project: string; // ID
    project_name: string; // Readable Name
    project_gst: string; // ID (GSTIN)
    project_gst_display: string; // Readable Name
    invoice_date: string;
    invoice_type: "PO Invoice" | "SR Invoice" | "Project Invoice";
    vendor?: string; // ID
    vendor_name: string; // Readable Name
    base_amount: number;
    gst_amount: number;
    gst_percentage: number;
    total_amount: number;
    attachment?: string;
    document_name?: string;
    document_type?: string;
}

export const useProjectGSTDetailsData = () => {
    // 1. Fetch Vendor Invoices (Approved) 
    const vendorInvoicesOptions = useMemo(() => ({
        filters: [
            ["status", "=", "Approved"]
        ] as any,
        fields: ["name", "project", "invoice_date", "invoice_amount", "document_type", "document_name", "vendor", "invoice_attachment"] as (keyof VendorInvoice)[],
        limit: 0
    }), []);

    const { data: vendorInvoices, isLoading: isLoadingVendorInvoices } = useFrappeGetDocList<VendorInvoice>("Vendor Invoices", vendorInvoicesOptions);

    // 2. Fetch Project Invoices
    const projectInvoicesOptions = useMemo(() => ({
        fields: ["name", "project", "invoice_date", "amount", "project_gst", "attachment"] as (keyof ProjectInvoice)[],
        limit: 0
    }), []);

    const { data: projectInvoices, isLoading: isLoadingProjectInvoices } = useFrappeGetDocList<ProjectInvoice>("Project Invoices", projectInvoicesOptions);

    // 3. Fetch POs/SRs for GST Mapping
    const poOptions = useMemo(() => ({
        fields: ["name", "project_gst", "amount", "total_amount"] as any,
        limit: 0
    }), []);
    const { data: procurementOrders, isLoading: isLoadingPOs } = useFrappeGetDocList<any>("Procurement Orders", poOptions);

    // `gst` is required so each SR-linked Vendor Invoice can be assigned the correct
    // GST ratio (1.18 if sr.gst === "true", else 1.0). Without it, non-GST SR
    // invoices are incorrectly treated as if they carried 18% GST.
    const srOptions = useMemo(() => ({
        fields: ["name", "project_gst", "gst"] as any,
        limit: 0
    }), []);
    const { data: serviceRequests, isLoading: isLoadingSRs } = useFrappeGetDocList<any>("Service Requests", srOptions);

    // 4. Fetch Names/Cities Mapping
    const projectMetadataOptions = useMemo(() => ({
        fields: ["name", "project_name"] as any,
        limit: 0
    }), []);
    const { data: projects, isLoading: isLoadingProjectMeta } = useFrappeGetDocList<any>("Projects", projectMetadataOptions);

    const gstMetadataOptions = useMemo(() => ({
        fields: ["name", "gst_name", "state"] as any,
        limit: 0
    }), []);
    const { data: gstMeta, isLoading: isLoadingGSTMeta } = useFrappeGetDocList<any>("Project GST", gstMetadataOptions);

    const vendorMetadataOptions = useMemo(() => ({
        fields: ["name", "vendor_name"] as any,
        limit: 0
    }), []);
    const { data: vendors, isLoading: isLoadingVendorMeta } = useFrappeGetDocList<any>("Vendors", vendorMetadataOptions);

    const attachmentMetadataOptions = useMemo(() => ({
        fields: ["name", "attachment"] as any,
        limit: 0
    }), []);
    const { data: attachments, isLoading: isLoadingAttachmentMeta } = useFrappeGetDocList<any>("Nirmaan Attachments", attachmentMetadataOptions);

    const projectNameMap = useMemo(() => {
        const map: Record<string, string> = {};
        (projects || []).forEach(p => {
            if (p.name && p.project_name) map[p.name] = p.project_name;
        });
        return map;
    }, [projects]);

    const gstNameMap = useMemo(() => {
        const map: Record<string, string> = {};
        (gstMeta || []).forEach(g => {
            if (g.name) {
                map[g.name] = g.state || g.gst_name || g.name;
            }
        });
        return map;
    }, [gstMeta]);

    const vendorNameMap = useMemo(() => {
        const map: Record<string, string> = {};
        (vendors || []).forEach(v => {
            if (v.name && v.vendor_name) map[v.name] = v.vendor_name;
        });
        return map;
    }, [vendors]);

    const attachmentMap = useMemo(() => {
        const map: Record<string, string> = {};
        (attachments || []).forEach(a => {
            if (a.name && a.attachment) map[a.name] = a.attachment;
        });
        return map;
    }, [attachments]);

    const poGstMap = useMemo(() => {
        const map: Record<string, string> = {};
        (procurementOrders || []).forEach(po => {
            if (po.name && po.project_gst) map[po.name] = po.project_gst;
        });
        return map;
    }, [procurementOrders]);

    const srGstMap = useMemo(() => {
        const map: Record<string, string> = {};
        (serviceRequests || []).forEach(sr => {
            if (sr.name && sr.project_gst) map[sr.name] = sr.project_gst;
        });
        return map;
    }, [serviceRequests]);

    // SR-name → GST ratio: 1.18 if SR has GST enabled, else 1.0 (no GST to strip)
    const srRatioMap = useMemo(() => {
        const map: Record<string, number> = {};
        (serviceRequests || []).forEach(sr => {
            if (sr.name) map[sr.name] = sr.gst === "true" ? 1.18 : 1.0;
        });
        return map;
    }, [serviceRequests]);

    // 5. Normalize and Combine Data
    const combinedData = useMemo(() => {
        const documentRatioMap: Record<string, number> = {};
        const calculateRatio = (doc: any) => {
            const amt = parseNumber(doc.amount);
            const total = parseNumber(doc.total_amount);
            if (amt > 0 && total > 0) {
                return total / amt;
            }
            return 1.18;
        };

        (procurementOrders || []).forEach(po => {
            if (po.name) documentRatioMap[po.name] = calculateRatio(po);
        });

        const normalizedVendor = (vendorInvoices || []).map(vi => {
            const viAmt = parseNumber(vi.invoice_amount);
            // PO Invoice → use computed ratio from PO.total_amount/amount.
            // SR Invoice → use 1.18 / 1.0 from srRatioMap based on sr.gst.
            let ratio = 1.18;
            if (vi.document_name) {
                if (vi.document_type === "Procurement Orders") {
                    ratio = documentRatioMap[vi.document_name] || 1.18;
                } else if (vi.document_type === "Service Requests") {
                    ratio = srRatioMap[vi.document_name] || 1.18;
                }
            }
            const totalIncl = viAmt;
            const totalExcl = viAmt / ratio;
            const gstAmt = totalIncl - totalExcl;

            const gstID = vi.document_type === "Procurement Orders" 
                ? poGstMap[vi.document_name] 
                : (vi.document_type === "Service Requests" ? srGstMap[vi.document_name] : "");

            return {
                name: vi.name,
                project: vi.project,
                project_name: (vi.project && projectNameMap[vi.project]) || vi.project || "Unknown Project",
                project_gst: gstID || "Unknown",
                project_gst_display: (gstID && gstNameMap[gstID]) || gstID || "Unknown Location",
                invoice_date: vi.invoice_date,
                invoice_type: vi.document_type === "Procurement Orders" ? "PO Invoice" : "SR Invoice",
                vendor: vi.vendor,
                vendor_name: (vi.vendor && vendorNameMap[vi.vendor]) || vi.vendor || "N/A",
                base_amount: totalExcl,
                gst_amount: gstAmt,
                gst_percentage: totalExcl > 0 ? (gstAmt / totalExcl) * 100 : 18,
                total_amount: totalIncl,
                attachment: vi.invoice_attachment ? (attachmentMap[vi.invoice_attachment] || vi.invoice_attachment) : undefined,
                document_name: vi.document_name,
                document_type: vi.document_type
            } as GSTInvoiceDetail;
        });

        const normalizedProject = (projectInvoices || []).map(pi => {
            const totalIncl = parseNumber(pi.amount);
            const totalExcl = totalIncl / 1.18;
            const gstAmt = totalIncl - totalExcl;

            return {
                name: pi.name,
                project: pi.project,
                project_name: (pi.project && projectNameMap[pi.project]) || pi.project || "Unknown Project",
                project_gst: pi.project_gst || "Unknown",
                project_gst_display: (pi.project_gst && gstNameMap[pi.project_gst]) || pi.project_gst || "Unknown Location",
                invoice_date: pi.invoice_date,
                invoice_type: "Project Invoice",
                vendor: "N/A", // Project invoices are to the client, but for consistency in a vendor column
                vendor_name: "N/A",
                base_amount: totalExcl,
                gst_amount: gstAmt,
                gst_percentage: totalExcl > 0 ? (gstAmt / totalExcl) * 100 : 18,
                total_amount: totalIncl,
                attachment: pi.attachment,
                document_name: pi.name,
                document_type: "Project Invoice"
            } as GSTInvoiceDetail;
        });

        return [...normalizedVendor, ...normalizedProject].sort((a, b) => new Date(b.invoice_date).getTime() - new Date(a.invoice_date).getTime());
    }, [vendorInvoices, projectInvoices, poGstMap, srGstMap, srRatioMap, procurementOrders, projectNameMap, gstNameMap, vendorNameMap, attachmentMap]);

    return {
        combinedData,
        isLoading: isLoadingVendorInvoices || isLoadingProjectInvoices || isLoadingPOs || isLoadingSRs || isLoadingProjectMeta || isLoadingGSTMeta || isLoadingVendorMeta || isLoadingAttachmentMeta
    };
};
