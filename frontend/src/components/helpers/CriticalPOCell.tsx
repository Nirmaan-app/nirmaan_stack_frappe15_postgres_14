import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle } from "lucide-react";
import { formatDate } from "@/utils/FormatDate";
import { CriticalPOTask } from "@/types/NirmaanStack/CriticalPOTasks";

/** Build display label for a Critical PO task: "ItemName (SubCategory)" or just "ItemName" */
export const criticalPOLabel = (t: { item_name: string; sub_category?: string }) =>
    t.sub_category ? `${t.item_name} (${t.sub_category})` : t.item_name;

export const CriticalPOCell = ({ tasks }: { tasks: CriticalPOTask[] }) => {
    if (!tasks || tasks.length === 0) {
        return <span className="text-gray-300 text-xs">—</span>;
    }

    return (
        <div className="flex flex-col gap-1">
            {tasks.map((task) => (
                <Tooltip key={task.name}>
                    <TooltipTrigger asChild>
                        <span
                            className={`
                                inline-flex items-center gap-1.5
                                px-2 py-0.5 rounded-md text-xs font-medium
                                bg-gradient-to-r from-red-50 to-amber-50
                                border border-red-200/60
                                text-slate-700
                                shadow-sm shadow-red-100/50
                                cursor-default
                            `}
                        >
                            <span className="relative flex h-2 w-2 shrink-0">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                            </span>
                            <span className="truncate max-w-[120px]">
                                {task.item_name}{task.sub_category ? ` (${task.sub_category})` : ""}
                            </span>
                        </span>
                    </TooltipTrigger>
                    <TooltipContent
                        side="bottom"
                        className="bg-slate-900 text-white border-slate-800 shadow-xl"
                    >
                        <div className="space-y-1.5 text-xs py-0.5">
                            <div className="flex items-center gap-1.5 text-red-400 font-semibold">
                                <AlertTriangle className="w-3 h-3" />
                                Critical PO Task
                            </div>
                            <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-slate-300">
                                <span className="text-slate-500">Category</span>
                                <span>{task.critical_po_category}</span>
                                {task.sub_category && (
                                    <>
                                        <span className="text-slate-500">Sub-category</span>
                                        <span>{task.sub_category}</span>
                                    </>
                                )}
                                <span className="text-slate-500">Deadline</span>
                                <span className="text-amber-400">{formatDate(task.po_release_date)}</span>
                                <span className="text-slate-500">Status</span>
                                <span>{task.status}</span>
                            </div>
                        </div>
                    </TooltipContent>
                </Tooltip>
            ))}
        </div>
    );
};
