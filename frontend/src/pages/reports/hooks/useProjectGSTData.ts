import { useFrappeGetDocList } from "frappe-react-sdk";
import { useMemo } from "react";
import { Projects } from "@/types/NirmaanStack/Projects";
import { VendorInvoice } from "@/types/NirmaanStack/VendorInvoice";
import { ProjectInvoice } from "@/types/NirmaanStack/ProjectInvoice";
import { format, parseISO, subMonths, startOfMonth, endOfMonth, isWithinInterval } from "date-fns";
import { parseNumber } from "@/utils/parseNumber";

export interface GSTMetric {
    incl: number;
    excl: number;
    gst: number;
}

export interface MonthlyGST {
    vendor: GSTMetric;
    client: GSTMetric;
    gstPay: number;
}

export interface ProjectGSTRow {
    project_id: string;
    project_name: string;
    months: Record<string, MonthlyGST>;
}

export const useProjectGSTData = (selectedGST?: string) => {
    // 1. Fetch Projects
    const projectsOptions = useMemo(() => ({
        fields: ["name", "project_name"] as (keyof Projects)[],
        limit: 0,
        orderBy: { field: "creation", order: "desc" } as const
    }), []);

    const { data: projects, isLoading: isLoadingProjects } = useFrappeGetDocList<Projects>("Projects", projectsOptions);

    // 2. Fetch Vendor Invoices (Approved)
    const vendorInvoicesOptions = useMemo(() => ({
        filters: [["status", "=", "Approved"]] as any,
        fields: ["project", "invoice_date", "invoice_amount", "document_type", "document_name"] as (keyof VendorInvoice)[],
        limit: 0
    }), []);

    const { data: vendorInvoices, isLoading: isLoadingVendorInvoices } = useFrappeGetDocList<VendorInvoice>("Vendor Invoices", vendorInvoicesOptions);

    // 2.1 Fetch Procurement Orders for GST Mapping
    const poOptions = useMemo(() => ({
        fields: ["name", "project_gst", "amount", "total_amount"] as any,
        limit: 0
    }), []);
    const { data: procurementOrders, isLoading: isLoadingPOs } = useFrappeGetDocList<any>("Procurement Orders", poOptions);

    // 2.2 Fetch Service Requests for GST Mapping
    const srOptions = useMemo(() => ({
        fields: ["name", "project_gst"] as any,
        limit: 0
    }), []);
    const { data: serviceRequests, isLoading: isLoadingSRs } = useFrappeGetDocList<any>("Service Requests", srOptions);

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

    // 3. Fetch Project Invoices (Submitted)
    const projectInvoicesOptions = useMemo(() => ({

        fields: ["project", "invoice_date", "amount", "project_gst"] as (keyof ProjectInvoice)[],
        limit: 0
    }), []);

    const { data: projectInvoices, isLoading: isLoadingProjectInvoices } = useFrappeGetDocList<ProjectInvoice>("Project Invoices", projectInvoicesOptions);

    // 4. Generate last 6 months for columns
    const months = useMemo(() => {
        const result = [];
        const backgroundColors = [
            "bg-blue-50",
            "bg-slate-50",
            "bg-emerald-50",
            "bg-purple-50",
            "bg-amber-50",
            "bg-rose-50"
        ];

        for (let i = 0; i <= 5; i++) {
            const date = subMonths(new Date(), i);
            result.push({
                name: format(date, "MMM yyyy"),
                id: format(date, "yyyy-MM"),
                bg: backgroundColors[i]
            });
        }
        return result;
    }, []);

    // 5. Transform and Aggregate Data
    const reportData = useMemo(() => {
        if (!projects) return [];

        // Pre-filter invoices by GST to reduce work in the main loop
        const filteredVendorInvoices = (vendorInvoices || []).filter(vi => {
            if (!selectedGST || selectedGST === "all") return true;
            const sourceGst = vi.document_type === "Procurement Orders"
                ? poGstMap[vi.document_name]
                : (vi.document_type === "Service Requests" ? srGstMap[vi.document_name] : null);
            return sourceGst === selectedGST;
        });

        const filteredProjectInvoices = (projectInvoices || []).filter(pi => {
            if (!selectedGST || selectedGST === "all") return true;
            return pi.project_gst === selectedGST;
        });

        const documentRatioMap: Record<string, number> = {};
        const calculateRatio = (doc: any) => {
            const amt = parseNumber(doc.amount);
            const total = parseNumber(doc.total_amount);
            if (amt > 0 && total > 0) {
                return total / amt;
            }
            return 1.18; // Default to 18%
        };

        // Only POs have explicit ratio fields, SRs will naturally fallback to 1.18 in the map lookup
        (procurementOrders || []).forEach(po => {
            if (po.name) documentRatioMap[po.name] = calculateRatio(po);
        });

        // Pre-group invoices by project and month for O(1) lookup
        const vendorGroups: Record<string, Record<string, VendorInvoice[]>> = {};
        filteredVendorInvoices.forEach(vi => {
            if (!vi.project || !vi.invoice_date) return;
            const monthId = vi.invoice_date.substring(0, 7); // "yyyy-MM"
            if (!vendorGroups[vi.project]) vendorGroups[vi.project] = {};
            if (!vendorGroups[vi.project][monthId]) vendorGroups[vi.project][monthId] = [];
            vendorGroups[vi.project][monthId].push(vi);
        });

        const projectGroups: Record<string, Record<string, ProjectInvoice[]>> = {};
        filteredProjectInvoices.forEach(pi => {
            if (!pi.project || !pi.invoice_date) return;
            const monthId = pi.invoice_date.substring(0, 7); // "yyyy-MM"
            if (!projectGroups[pi.project]) projectGroups[pi.project] = {};
            if (!projectGroups[pi.project][monthId]) projectGroups[pi.project][monthId] = [];
            projectGroups[pi.project][monthId].push(pi);
        });

        const rows = projects.map((project) => {
            const monthlyData: Record<string, MonthlyGST> = {};
            let hasAnyValue = false;

            months.forEach((month) => {
                const monthVendorInvoices = vendorGroups[project.name]?.[month.id] || [];
                const monthClientInvoices = projectGroups[project.name]?.[month.id] || [];

                let vendorTotalIncl = 0;
                let vendorTotalExcl = 0;

                monthVendorInvoices.forEach(vi => {
                    const viAmt = parseNumber(vi.invoice_amount);
                    const ratio = vi.document_name ? (documentRatioMap[vi.document_name] || 1.18) : 1.18;
                    vendorTotalIncl += viAmt;
                    vendorTotalExcl += (viAmt / ratio);
                });

                // Round before subtracting to prevent 1-rupee visual discrepancies
                vendorTotalIncl = Math.round(vendorTotalIncl);
                vendorTotalExcl = Math.round(vendorTotalExcl);
                const vendorTotalGst = vendorTotalIncl - vendorTotalExcl;

                let clientTotalIncl = monthClientInvoices.reduce((sum, pi) => sum + parseNumber(pi.amount), 0);
                let clientTotalExcl = clientTotalIncl / 1.18;

                // Round before subtracting
                clientTotalIncl = Math.round(clientTotalIncl);
                clientTotalExcl = Math.round(clientTotalExcl);
                const clientTotalGst = clientTotalIncl - clientTotalExcl;

                if (vendorTotalIncl > 0 || clientTotalIncl > 0) {
                    hasAnyValue = true;
                }

                monthlyData[month.name] = {
                    vendor: { incl: vendorTotalIncl, excl: vendorTotalExcl, gst: vendorTotalGst },
                    client: { incl: clientTotalIncl, excl: clientTotalExcl, gst: clientTotalGst },
                    gstPay: clientTotalGst - vendorTotalGst
                };
            });

            return {
                project_id: project.name,
                project_name: project.project_name || project.name,
                months: monthlyData,
                hasAnyValue
            } as ProjectGSTRow & { hasAnyValue: boolean };
        }).filter(row => row.hasAnyValue);
        
        return rows.map(({ hasAnyValue, ...rest }) => rest as ProjectGSTRow);
    }, [projects, vendorInvoices, projectInvoices, months, selectedGST, poGstMap, srGstMap, procurementOrders, serviceRequests]);

    // 6. Calculate Totals for Footer
    const totals = useMemo(() => {
        const result: Record<string, MonthlyGST> = {};

        months.forEach((month) => {
            let vIncl = 0, vExcl = 0, vGst = 0;
            let cIncl = 0, cExcl = 0, cGst = 0;

            reportData.forEach((row) => {
                const mData = row.months[month.name];
                vIncl += mData.vendor.incl;
                vExcl += mData.vendor.excl;
                vGst += mData.vendor.gst;
                cIncl += mData.client.incl;
                cExcl += mData.client.excl;
                cGst += mData.client.gst;
            });

            result[month.name] = {
                vendor: { incl: vIncl, excl: vExcl, gst: vGst },
                client: { incl: cIncl, excl: cExcl, gst: cGst },
                gstPay: cGst - vGst
            };
        });

        return result;
    }, [reportData, months]);

    return {
        months,
        reportData,
        totals,
        isLoading: isLoadingProjects || isLoadingVendorInvoices || isLoadingProjectInvoices || isLoadingPOs || isLoadingSRs
    };
};
