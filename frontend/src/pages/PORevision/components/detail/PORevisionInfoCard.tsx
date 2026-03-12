import formatCurrency from "@/utils/FormatPrice";

interface PORevisionInfoCardProps {
    vendor?: string;
    project?: string;
    dispatched?: string;
    currentTotal?: number;
}

export default function PORevisionInfoCard({
    vendor = "N/A",
    project = "N/A",
    dispatched = "N/A",
    currentTotal = 0
}: PORevisionInfoCardProps) {
    return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-4 border-b w-full">
            <div className="flex flex-col">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Vendor</span>
                <span className="text-sm font-semibold truncate" title={vendor}>{vendor}</span>
            </div>
            <div className="flex flex-col">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Project</span>
                <span className="text-sm font-semibold truncate" title={project}>{project}</span>
            </div>
            <div className="flex flex-col">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Dispatched</span>
                <span className="text-sm font-semibold">{dispatched}</span>
            </div>
            <div className="flex flex-col">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Current Total</span>
                <span className="text-sm font-semibold text-slate-900">{formatCurrency(currentTotal)}</span>
            </div>
        </div>
    );
}
