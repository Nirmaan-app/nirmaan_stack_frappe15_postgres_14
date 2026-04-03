import React, { useState, useEffect } from "react";
import { getUrlStringParam } from "@/hooks/useServerDataTable";
import { urlStateManager } from "@/utils/urlStateManager";
import { useProjectGSTData } from "../hooks/useProjectGSTData";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGstOptions } from "@/hooks/useGstOptions";
import { Button } from "@/components/ui/button";
import { Download, ExternalLink } from "lucide-react";
import { unparse } from "papaparse";

import { ProjectGSTReportDetails } from "./GSTReport/ProjectGSTReportDetails";

export const ProjectGSTReport: React.FC = () => {
    // Standard Project GST params consolidated for clarity
    const [selectedGST, setSelectedGST] = useState<string>(() => getUrlStringParam("pgst_gst", ""));
    const [selectedProject, setSelectedProject] = useState<{
        id: string,
        name: string,
        month?: string,
        invoiceType?: string[]
    } | null>(() => {
        const id = getUrlStringParam("pgst_project_id", null);
        const name = getUrlStringParam("pgst_project_name", null);
        if (id && name) {
            return {
                id,
                name,
                month: getUrlStringParam("pgst_month", null) || undefined,
                invoiceType: getUrlStringParam("pgst_types", null)?.split(",")
            };
        }
        return null;
    });

    const { months, reportData, totals, isLoading } = useProjectGSTData(selectedGST);
    const { gstOptions, isLoading: isLoadingGstOptions } = useGstOptions();

    // Declarative URL Synchronization (State -> URL)
    useEffect(() => {
        const syncMap: Record<string, string | null> = {
            "pgst_gst": selectedGST || null,
            "pgst_project_id": selectedProject?.id || null,
            "pgst_project_name": selectedProject?.name || null,
            "pgst_month": selectedProject?.month || null,
            "pgst_types": selectedProject?.invoiceType?.join(",") || null
        };
        Object.entries(syncMap).forEach(([key, val]) => urlStateManager.updateParam(key, val));
    }, [selectedGST, selectedProject]);

    // Browser navigation synchronization (URL -> State)
    useEffect(() => {
        const handleUrlChange = () => {
            const gst = getUrlStringParam("pgst_gst", "");
            const id = getUrlStringParam("pgst_project_id", null);
            const name = getUrlStringParam("pgst_project_name", null);

            setSelectedGST(gst);
            if (id && name) {
                setSelectedProject({
                    id,
                    name,
                    month: getUrlStringParam("pgst_month", null) || undefined,
                    invoiceType: getUrlStringParam("pgst_types", null)?.split(",")
                });
            } else {
                setSelectedProject(null);
            }
        };

        const unsubGst = urlStateManager.subscribe("pgst_gst", handleUrlChange);
        const unsubId = urlStateManager.subscribe("pgst_project_id", handleUrlChange);
        const unsubMonth = urlStateManager.subscribe("pgst_month", handleUrlChange);

        return () => {
            unsubGst();
            unsubId();
            unsubMonth();
        };
    }, []);

    if (isLoading || isLoadingGstOptions) {
        return <LoadingFallback />;
    }

    const formatCurrency = (val: number) => {
        return formatToRoundedIndianRupee(val);
    };

    const handleExportCSV = () => {
        const header1 = ["Project Name", ...months.flatMap(m => [m.name, "", "", "", "", "", ""])];
        const header2 = ["", ...months.flatMap(() => ["Vendor Invoices", "", "", "Client Invoices", "", "", "GST Payable"])];
        const header3 = ["", ...months.flatMap(() => ["Incl", "Excl", "GST", "Incl", "Excl", "GST", "CI-VI"])];

        const rows = reportData.map(row => [
            row.project_name,
            ...months.flatMap(m => {
                const d = row.months[m.name];
                return [d.vendor.incl, d.vendor.excl, d.vendor.gst, d.client.incl, d.client.excl, d.client.gst, d.gstPay];
            })
        ]);

        const totalRow = [
            "TOTAL",
            ...months.flatMap(m => {
                const t = totals[m.name];
                return [t.vendor.incl, t.vendor.excl, t.vendor.gst, t.client.incl, t.client.excl, t.client.gst, t.gstPay];
            })
        ];

        const csvData = [header1, header2, header3, ...rows, totalRow];
        const csv = unparse(csvData);
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", `Project_GST_Report_${selectedGST || "all"}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    if (selectedProject) {
        return (
            <ProjectGSTReportDetails
                projectId={selectedProject.id}
                projectName={selectedProject.name}
                initialGST={selectedGST}
                initialMonth={selectedProject.month}
                initialInvoiceType={selectedProject.invoiceType}
                onBack={() => setSelectedProject(null)}
            />
        );
    }

    return (
        <div className="p-4 bg-white min-h-screen">
            {/* Options Selection Row */}
            <div className="mb-4 flex items-end justify-between gap-4">
                <div className="w-64">
                    <label className="block text-xs font-medium text-slate-500 mb-1">Select Project GST</label>
                    <Select value={selectedGST} onValueChange={setSelectedGST}>
                        <SelectTrigger className="bg-white border-slate-200">
                            <SelectValue placeholder="All GST Locations" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All GST Locations</SelectItem>
                            {gstOptions.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>
                                    {opt.location || opt.value}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <Button
                    variant="outline"
                    onClick={handleExportCSV}
                    className="flex items-center gap-2 text-red-600 border-red-500 hover:bg-red-50"
                >
                    <Download className="w-4 h-4" />
                    Export CSV
                </Button>
            </div>

            {/* Main Table Container */}
            <div className="relative rounded-lg border border-slate-200 shadow-sm overflow-hidden bg-white">
                <div className="overflow-x-auto overflow-y-auto max-h-[80vh]">
                    <table className="w-full border-separate border-spacing-0 text-[11px]">
                        <thead>
                            {/* Level 1: Months */}
                            <tr className="sticky top-0 z-40 font-bold tracking-wider">
                                <th rowSpan={3} className="sticky left-0 top-0 z-[60] bg-slate-100 text-slate-900 px-4 py-3 text-left border-b border-r-2 border-slate-200 min-w-[200px] shadow-[2px_0_0_rgba(0,0,0,0.1)] transform translate-z-0">
                                    Project
                                </th>
                                {months.map((month) => (
                                    <th key={month.id} colSpan={7} className={`text-slate-900 p-2 text-center border-b border-r-2 border-slate-200 uppercase ${month.bg} transform translate-z-0`}>
                                        {month.name}
                                    </th>
                                ))}
                            </tr>
                            {/* Level 2: Invoice Types */}
                            <tr className="sticky top-[35px] z-30">
                                {months.map((month) => (
                                    <React.Fragment key={`${month.id}-types`}>
                                        <th colSpan={3} className={`text-slate-600 p-2 text-center font-semibold border-b border-r border-slate-100 ${month.bg} transform translate-z-0`}>
                                            Vendor Invoices
                                        </th>
                                        <th colSpan={3} className={`text-slate-600 p-2 text-center font-semibold border-b border-r border-slate-100 ${month.bg} transform translate-z-0`}>
                                            Client Invoices
                                        </th>
                                        <th className={`text-slate-900 p-2 text-center font-bold border-b border-r-2 border-slate-200 uppercase italic ${month.bg} transform translate-z-0`}>
                                            GST PAYABLE
                                        </th>
                                    </React.Fragment>
                                ))}
                            </tr>
                            {/* Level 3: Fields */}
                            <tr className="sticky top-[64px] z-20 text-[9px] uppercase tracking-tighter">
                                {months.map((month) => (
                                    <React.Fragment key={`${month.id}-fields`}>
                                        <th className={`text-slate-400 px-3 py-1 text-center font-medium border-b border-r border-slate-100/50 ${month.bg} transform translate-z-0`}>Incl</th>
                                        <th className={`text-slate-400 px-3 py-1 text-center font-medium border-b border-r border-slate-100/50 ${month.bg} transform translate-z-0`}>Excl</th>
                                        <th className={`text-blue-500 px-3 py-1 text-center font-bold border-b border-r-2 border-slate-100/50 ${month.bg} transform translate-z-0`}>GST</th>
                                        <th className={`text-slate-400 px-3 py-1 text-center font-medium border-b border-r border-slate-100/50 ${month.bg} transform translate-z-0`}>Incl</th>
                                        <th className={`text-slate-400 px-3 py-1 text-center font-medium border-b border-r border-slate-100/50 ${month.bg} transform translate-z-0`}>Excl</th>
                                        <th className={`text-emerald-500 px-3 py-1 text-center font-bold border-b border-r-2 border-slate-100/50 ${month.bg} transform translate-z-0`}>GST</th>
                                        <th className={`text-slate-900 px-3 py-1 text-center font-black border-b border-r-2 border-slate-100 ${month.bg} transform translate-z-0`}>CI -VI</th>
                                    </React.Fragment>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {reportData.map((row, idx) => {
                                const rowBg = idx % 2 === 0 ? "bg-white" : "bg-slate-50/60";
                                const projectBg = idx % 2 === 0 ? "bg-white" : "bg-white";
                                return (
                                    <tr key={row.project_name} className={`group hover:bg-blue-50/40 transition-colors ${rowBg}`}>
                                        <td className={`sticky left-0 z-10 px-4 py-3 font-semibold text-slate-800 border-b border-r-2 border-slate-200 shadow-[2px_0_0_rgba(0,0,0,0.03)] transition-colors transform translate-z-0 ${projectBg}`}>
                                            <button
                                                onClick={() => setSelectedProject({ id: row.project_id, name: row.project_name })}
                                                className="group inline-flex items-center gap-1.5 text-slate-800 hover:text-indigo-600 font-bold transition-all duration-200"
                                            >
                                                <span className="text-blue-600 group-hover:underline decoration-blue-300 underline-offset-4">{row.project_name}</span>
                                                <ExternalLink className="w-3 h-3 text-blue-500 group-hover:text-blue-700 transition-colors duration-200" />
                                            </button>
                                        </td>
                                        {months.map((month) => {
                                            const mData = row.months[month.name];
                                            return (
                                                <React.Fragment key={`${row.project_name}-${month.id}`}>
                                                    <td className={`px-3 py-2 text-right border-b border-r border-slate-100 tabular-nums ${month.bg} bg-opacity-10`}>
                                                        <button
                                                            disabled={mData.vendor.incl === 0}
                                                            onClick={() => setSelectedProject({ id: row.project_id, name: row.project_name, month: month.id, invoiceType: ["PO Invoice", "SR Invoice"] })}
                                                            className="group inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-slate-600 hover:text-indigo-600 hover:bg-indigo-50/80 transition-all duration-200 disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed font-medium"
                                                        >
                                                            <span>{formatCurrency(mData.vendor.incl)}</span>
                                                            <ExternalLink className="w-2.5 h-2.5 text-blue-400 group-hover:text-blue-600 transition-colors" />
                                                        </button>
                                                    </td>
                                                    <td className={`px-3 py-2 text-right text-slate-500 border-b border-r border-slate-100 tabular-nums font-light ${month.bg} bg-opacity-10`}>{formatCurrency(mData.vendor.excl)}</td>
                                                    <td className={`px-3 py-2 text-right text-blue-600/80 border-b border-r-2 border-slate-100 tabular-nums font-medium ${month.bg} bg-opacity-30`}>{formatCurrency(mData.vendor.gst)}</td>
                                                    <td className={`px-3 py-2 text-right border-b border-r border-slate-100 tabular-nums ${month.bg} bg-opacity-10`}>
                                                        <button
                                                            disabled={mData.client.incl === 0}
                                                            onClick={() => setSelectedProject({ id: row.project_id, name: row.project_name, month: month.id, invoiceType: ["Project Invoice"] })}
                                                            className="group inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-slate-600 hover:text-emerald-600 hover:bg-emerald-50/80 transition-all duration-200 disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed font-medium"
                                                        >
                                                            <span>{formatCurrency(mData.client.incl)}</span>
                                                            <ExternalLink className="w-2.5 h-2.5 text-blue-400 group-hover:text-blue-600 transition-colors" />
                                                        </button>
                                                    </td>
                                                    <td className={`px-3 py-2 text-right text-slate-500 border-b border-r border-slate-100 tabular-nums font-light ${month.bg} bg-opacity-10`}>{formatCurrency(mData.client.excl)}</td>
                                                    <td className={`px-3 py-2 text-right text-emerald-600/80 border-b border-r-2 border-slate-100 tabular-nums font-medium ${month.bg} bg-opacity-30`}>{formatCurrency(mData.client.gst)}</td>
                                                    <td className={`px-3 py-2 text-right font-bold text-slate-900 border-b border-r-2 border-slate-100 tabular-nums ${month.bg} bg-opacity-40`}>{formatCurrency(mData.gstPay)}</td>
                                                </React.Fragment>
                                            );
                                        })}
                                    </tr>
                                );
                            })}
                        </tbody>
                        <tfoot>
                            <tr className="sticky bottom-0 z-50 bg-slate-900 text-white font-bold transform translate-z-0">
                                <td className="sticky left-0 z-[60] bg-slate-900 px-4 py-3 border-r-2 border-slate-700 shadow-[2px_0_0_rgba(0,0,0,0.1)] transform translate-z-0">Total Project Total</td>
                                {months.map((month) => {
                                    const mTotal = totals[month.name];
                                    return (
                                        <React.Fragment key={`total-${month.id}`}>
                                            <td className="px-3 py-2 text-right border-r border-slate-700 bg-slate-900">{formatCurrency(mTotal.vendor.incl)}</td>
                                            <td className="px-3 py-2 text-right border-r border-slate-700 bg-slate-900 font-light opacity-70">{formatCurrency(mTotal.vendor.excl)}</td>
                                            <td className="px-3 py-2 text-right border-r-2 border-slate-700 bg-slate-900 text-blue-300">{formatCurrency(mTotal.vendor.gst)}</td>
                                            <td className="px-3 py-2 text-right border-r border-slate-700 bg-slate-900">{formatCurrency(mTotal.client.incl)}</td>
                                            <td className="px-3 py-2 text-right border-r border-slate-700 bg-slate-900 font-light opacity-70">{formatCurrency(mTotal.client.excl)}</td>
                                            <td className="px-3 py-2 text-right border-r-2 border-slate-700 bg-slate-900 text-emerald-300">{formatCurrency(mTotal.client.gst)}</td>
                                            <td className="px-3 py-2 text-right border-r-2 border-slate-700 bg-slate-900 font-black">{formatCurrency(mTotal.gstPay)}</td>
                                        </React.Fragment>
                                    );
                                })}
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default ProjectGSTReport;

