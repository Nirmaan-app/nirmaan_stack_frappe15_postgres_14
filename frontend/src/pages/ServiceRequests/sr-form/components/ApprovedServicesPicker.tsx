import React from "react";
import { CirclePlus, ListChecks, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import formatToIndianRupee from "@/utils/FormatPrice";
import { WOServiceItem } from "../hooks/useSRFormData";

interface ApprovedServicesPickerProps {
    packageLabel: string;
    /** Rate-card services of the selected package that are not added yet. */
    items: WOServiceItem[];
    checked: Set<string>;
    onToggle: (itemName: string) => void;
    onToggleAll: (checkAll: boolean) => void;
    onAdd: () => void;
}

/** The rate-card checklist for the selected package (the "Approved Service" input area). */
export const ApprovedServicesPicker: React.FC<ApprovedServicesPickerProps> = ({
    packageLabel,
    items,
    checked,
    onToggle,
    onToggleAll,
    onAdd,
}) => {
    const title = (
        <Label className="text-sm font-medium flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-primary" />
            List of Approved Services · {packageLabel}
        </Label>
    );

    if (items.length === 0) {
        return (
            <div className="space-y-2">
                {title}
                <div className="border border-dashed rounded-lg p-8 text-center bg-white">
                    <Search className="h-7 w-7 text-slate-300 mx-auto mb-2" />
                    <p className="text-sm text-slate-400">Every rate-card service in this package is already added.</p>
                </div>
            </div>
        );
    }

    const allChecked = checked.size === items.length;

    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
                {title}
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 px-2 py-1 bg-slate-100 rounded border border-slate-200">
                        <Checkbox
                            id="approved-select-all"
                            checked={allChecked}
                            onCheckedChange={(value) => onToggleAll(value === true)}
                        />
                        <Label htmlFor="approved-select-all" className="text-[10px] font-bold text-slate-500 cursor-pointer uppercase">
                            {allChecked ? "Deselect All" : "Select All"}
                        </Label>
                    </div>
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                        {checked.size} / {items.length} selected
                    </span>
                </div>
            </div>

            <div className="border rounded-lg border-slate-200 bg-slate-50/50">
                <ScrollArea className="h-[240px] px-3 py-2">
                    <div className="space-y-1">
                        {items.map((item) => {
                            const isChecked = checked.has(item.name);
                            return (
                                <div
                                    key={item.name}
                                    className={`flex items-center justify-between gap-3 p-3 rounded-lg border transition-all cursor-pointer group ${isChecked
                                        ? "bg-primary/5 border-primary/20 shadow-sm"
                                        : "bg-white border-transparent hover:border-slate-200"
                                        }`}
                                    onClick={() => onToggle(item.name)}
                                >
                                    <div className="flex items-center gap-3 min-w-0">
                                        <Checkbox
                                            checked={isChecked}
                                            onCheckedChange={() => onToggle(item.name)}
                                            onClick={(e) => e.stopPropagation()}
                                            id={`approved-item-${item.name}`}
                                            className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                                        />
                                        <div className="space-y-0.5 min-w-0">
                                            <Label
                                                htmlFor={`approved-item-${item.name}`}
                                                onClick={(e) => e.stopPropagation()}
                                                className="text-sm font-medium cursor-pointer group-hover:text-primary transition-colors"
                                            >
                                                {item.item_name}
                                            </Label>
                                            <div className="text-xs text-muted-foreground">
                                                <span className="text-[10px] opacity-70">UNIT:</span> {item.unit || "--"}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <div className="text-sm font-semibold text-slate-900">
                                            {item.rate ? formatToIndianRupee(item.rate) : "N/A"}
                                        </div>
                                        <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-tighter">Std Rate</div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </ScrollArea>
                <div className="p-3 bg-white border-t rounded-b-lg flex justify-end">
                    <Button type="button" size="sm" disabled={checked.size === 0} onClick={onAdd} className="gap-2 shadow-sm">
                        <CirclePlus className="h-4 w-4" />
                        Add Selected Items ({checked.size})
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default ApprovedServicesPicker;
