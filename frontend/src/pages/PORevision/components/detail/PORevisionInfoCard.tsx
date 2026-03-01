import formatCurrency from "@/utils/FormatPrice";

interface PORevisionInfoCardProps {
    vendor?: string;
    project?: string;
    workPackage?: string;
    dispatched?: string;
    currentTotal?: number;
}

export default function PORevisionInfoCard({
    vendor = "N/A",
    project = "N/A",
    workPackage = "N/A",
    dispatched = "N/A",
    currentTotal = 0
}: PORevisionInfoCardProps) {
    return (
        <div className="flex flex-wrap items-center gap-8 py-4 border-b">
            <div className="flex flex-col">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Vendor</span>
                <span className="text-sm font-semibold">{vendor}</span>
            </div>
            <div className="flex flex-col">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Project</span>
                <span className="text-sm font-semibold">{project}</span>
            </div>
            <div className="flex flex-col">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Package</span>
                <span className="text-sm font-semibold">{workPackage}</span>
            </div>
            <div className="flex flex-col">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Dispatched</span>
                <span className="text-sm font-semibold">{dispatched}</span>
            </div>
            <div className="flex flex-col ml-8">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Current Total</span>
                <span className="text-sm font-semibold text-slate-900">{formatCurrency(currentTotal)}</span>
            </div>
        </div>
    );
}
