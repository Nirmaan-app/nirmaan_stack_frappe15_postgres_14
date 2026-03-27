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
    project_name: string;
    months: Record<string, MonthlyGST>;
}

export const useProjectGSTData = () => {
    // 1. Fetch Projects
    const projectsOptions = useMemo(() => ({
        fields: ["name", "project_name"] as (keyof Projects)[],
        limit: 0,
        orderBy: { field: "project_name", order: "asc" } as const
    }), []);

    const { data: projects, isLoading: isLoadingProjects } = useFrappeGetDocList<Projects>("Projects", projectsOptions);

    // 2. Fetch Vendor Invoices (Approved)
    const vendorInvoicesOptions = useMemo(() => ({
        filters: [["status", "=", "Approved"]] as any,
        fields: ["project", "invoice_date", "invoice_amount"] as (keyof VendorInvoice)[],
        limit: 0
    }), []);

    const { data: vendorInvoices, isLoading: isLoadingVendorInvoices } = useFrappeGetDocList<VendorInvoice>("Vendor Invoices", vendorInvoicesOptions);

    // 3. Fetch Project Invoices (Submitted)
    const projectInvoicesOptions = useMemo(() => ({

        fields: ["project", "invoice_date", "amount"] as (keyof ProjectInvoice)[],
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

        for (let i = 5; i >= 0; i--) {
            const date = subMonths(new Date(), i);
            result.push({
                name: format(date, "MMM yyyy"),
                id: format(date, "yyyy-MM"),
                bg: backgroundColors[5 - i]
            });
        }
        return result;
    }, []);

    // 5. Transform and Aggregate Data
    const reportData = useMemo(() => {
        if (!projects) return [];

        return projects.map((project) => {
            const monthlyData: Record<string, MonthlyGST> = {};

            months.forEach((month) => {
                const monthStart = startOfMonth(parseISO(`${month.id}-01`));
                const monthEnd = endOfMonth(monthStart);

                // Filter Vendor Invoices for this project and month
                const projectVendorInvoices = (vendorInvoices || []).filter((vi) =>
                    vi.project === project.name &&
                    isWithinInterval(parseISO(vi.invoice_date), { start: monthStart, end: monthEnd })
                );

                const vendorTotalIncl = projectVendorInvoices.reduce((sum, vi) => sum + parseNumber(vi.invoice_amount), 0);
                const vendorTotalExcl = vendorTotalIncl / 1.18;
                const vendorTotalGst = vendorTotalIncl - vendorTotalExcl;

                // Filter Project Invoices for this project and month
                const projectClientInvoices = (projectInvoices || []).filter((pi) =>
                    pi.project === project.name &&
                    isWithinInterval(parseISO(pi.invoice_date), { start: monthStart, end: monthEnd })
                );

                const clientTotalIncl = projectClientInvoices.reduce((sum, pi) => sum + parseNumber(pi.amount), 0);
                const clientTotalExcl = clientTotalIncl / 1.18;
                const clientTotalGst = clientTotalIncl - clientTotalExcl;

                monthlyData[month.name] = {
                    vendor: { incl: vendorTotalIncl, excl: vendorTotalExcl, gst: vendorTotalGst },
                    client: { incl: clientTotalIncl, excl: clientTotalExcl, gst: clientTotalGst },
                    gstPay: vendorTotalGst - clientTotalGst
                };
            });

            return {
                project_name: project.project_name || project.name,
                months: monthlyData
            } as ProjectGSTRow;
        });
    }, [projects, vendorInvoices, projectInvoices, months]);

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
                gstPay: vGst - cGst
            };
        });

        return result;
    }, [reportData, months]);

    return {
        months,
        reportData,
        totals,
        isLoading: isLoadingProjects || isLoadingVendorInvoices || isLoadingProjectInvoices
    };
};
