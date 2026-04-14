/**
 * Shared base component for the item selection list used in all step files.
 * Pixel-perfect v2: bordered cards, green accents, red selection state.
 */
import { useState, useMemo } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TailSpin } from "react-loader-spinner";
import { format } from "date-fns";

export interface BaseItem {
    name: string;
    subtitle?: string;
    rightLabel?: string;
    status?: string;
    dateStr?: string;
}

interface BaseItemListProps {
    items: BaseItem[];
    isLoading: boolean;
    selectedIds: string[];
    onToggle: (id: string) => void;
    emptyMessage?: string;
    /** Called when empty + filters active */
    onClearFilters?: () => void;
}

export function formatCreationDate(creation?: string): string {
    if (!creation) return "";
    try {
        return format(new Date(creation.split(" ")[0]), "dd MMM yyyy");
    } catch {
        return creation.split(" ")[0];
    }
}



export const BaseItemList = ({
    items,
    isLoading,
    selectedIds,
    onToggle,
    emptyMessage = "No items found.",
    onClearFilters,
}: BaseItemListProps) => {
    return (
        <div className="flex flex-col gap-0">
            {/* List */}
            {isLoading ? (
                <div className="flex items-center justify-center h-48 border rounded-xl">
                    <TailSpin color="red" width={32} height={32} />
                </div>
            ) : items.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 border rounded-xl text-muted-foreground gap-2">
                    <p className="text-sm">{emptyMessage}</p>
                    {onClearFilters && (
                        <Button variant="link" size="sm" className="text-xs" onClick={onClearFilters}>
                            Clear filters
                        </Button>
                    )}
                </div>
            ) : (
                <div className="space-y-2 max-h-[45vh] overflow-y-auto pr-1">
                    {items.map((item) => {
                        const isSelected = selectedIds.includes(item.name);


                        return (
                            <div
                                key={item.name}
                                onClick={() => onToggle(item.name)}
                                className={`
                                    relative flex items-center gap-3 px-4 py-3 rounded-lg border cursor-pointer
                                    transition-all duration-150
                                    ${isSelected
                                        ? "border-red-400 bg-red-50/60 shadow-sm"
                                        : "border-gray-200 hover:border-gray-300 hover:bg-muted/30"
                                    }

                                `}
                            >
                                <Checkbox
                                    checked={isSelected}
                                    onCheckedChange={() => {}}
                                    className={`pointer-events-none ${isSelected ? "data-[state=checked]:bg-red-500 data-[state=checked]:border-red-500" : ""}`}
                                />
                                <div className="flex flex-1 items-center justify-between min-w-0 gap-2">
                                    <div className="min-w-0">
                                        <p className="font-semibold text-sm truncate">{item.name}</p>
                                        {item.subtitle && (
                                            <p className="text-xs text-muted-foreground truncate">{item.subtitle}</p>
                                        )}
                                        {item.dateStr && (
                                            <p className="text-[11px] text-muted-foreground/70 mt-0.5">{item.dateStr}</p>
                                        )}
                                    </div>
                                    <div className="flex flex-col items-end gap-1 shrink-0">
                                        {item.rightLabel && (
                                            <span className={`text-sm font-semibold ${isSelected ? "text-red-600" : "text-red-500"}`}>
                                                {item.rightLabel}
                                            </span>
                                        )}
                                        {item.status && (
                                            <Badge
                                                variant="outline"
                                                className="text-[11px] py-0.5 px-2 h-auto font-medium border-gray-300"
                                            >
                                                {item.status}
                                            </Badge>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
