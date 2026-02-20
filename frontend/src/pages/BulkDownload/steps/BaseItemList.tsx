/**
 * Shared base component for the item selection list used in all step files.
 */
import { useState, useMemo } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TailSpin } from "react-loader-spinner";
import { CheckSquare, Square, Search, X } from "lucide-react";
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
    /** Slot rendered above the list (e.g. filter bar) */
    filtersSlot?: React.ReactNode;
    /** Called when empty + filters active */
    onClearFilters?: () => void;
    /** Hide the built-in search (default false) */
    hideSearch?: boolean;
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
    filtersSlot,
    onClearFilters,
    hideSearch = false,
}: BaseItemListProps) => {
    const [search, setSearch] = useState("");

    const filtered = useMemo(() => {
        if (!search.trim()) return items;
        const q = search.toLowerCase();
        return items.filter(
            (i) =>
                i.name.toLowerCase().includes(q) ||
                (i.subtitle && i.subtitle.toLowerCase().includes(q)) ||
                (i.status && i.status.toLowerCase().includes(q))
        );
    }, [items, search]);

    const allSelected = filtered.length > 0 && filtered.every((i) => selectedIds.includes(i.name));

    const handleSelectAll = () => filtered.forEach((i) => { if (!selectedIds.includes(i.name)) onToggle(i.name); });
    const handleDeselectAll = () => filtered.filter((i) => selectedIds.includes(i.name)).forEach((i) => onToggle(i.name));

    return (
        <div className="flex flex-col gap-2">
            {/* Top row: filters slot + search + Select All */}
            <div className="flex flex-wrap items-center gap-2 justify-between">
                <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
                    {filtersSlot}
                    {/* {!hideSearch && (
                        <div className="relative w-full max-w-[220px]">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                            <Input
                                placeholder="Search..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="h-8 pl-8 pr-7 text-xs"
                            />
                            {search && (
                                <button
                                    onClick={() => setSearch("")}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            )}
                        </div>
                    )} */}
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs shrink-0"
                    onClick={allSelected ? handleDeselectAll : handleSelectAll}
                    disabled={filtered.length === 0}
                >
                    {allSelected
                        ? <><Square className="h-3 w-3 mr-1" />Deselect All</>
                        : <><CheckSquare className="h-3 w-3 mr-1" />Select All</>}
                </Button>
            </div>

            {/* Count */}
            <p className="text-xs text-muted-foreground">
                {selectedIds.length} of {filtered.length} selected
                {/* {search && filtered.length !== items.length && (
                    <span className="ml-1">
                        (showing {filtered.length} of {items.length})
                    </span>
                )} */}
            </p>

            {/* List */}
            <div className="border rounded-md overflow-hidden">
                {isLoading ? (
                    <div className="flex items-center justify-center h-48">
                        <TailSpin color="red" width={32} height={32} />
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
                        <p className="text-sm">
                            {/* {search ? `No results for "${search}"` : emptyMessage} */}
                            {emptyMessage}
                        </p>
                        {/* {search ? (
                            <Button variant="link" size="sm" className="text-xs" onClick={() => setSearch("")}>
                                Clear search
                            </Button>
                        ) :  */}
                        {onClearFilters ? (
                            <Button variant="link" size="sm" className="text-xs" onClick={onClearFilters}>
                                Clear filters
                            </Button>
                        ) : null}
                    </div>
                ) : (
                    <div className="divide-y max-h-[45vh] overflow-y-auto">
                        {filtered.map((item) => {
                            const isSelected = selectedIds.includes(item.name);
                            return (
                                <div
                                    key={item.name}
                                    onClick={() => onToggle(item.name)}
                                    className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-muted/50 ${isSelected ? "bg-primary/5" : ""}`}
                                >
                                    <Checkbox
                                        checked={isSelected}
                                        onCheckedChange={() => onToggle(item.name)}
                                        onClick={(e) => e.stopPropagation()}
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
                                                <span className="text-xs font-medium text-primary">{item.rightLabel}</span>
                                            )}
                                            {item.status && (
                                                <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4">
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
        </div>
    );
};
