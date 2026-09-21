import React from "react";
import { AlertCircle, Layers, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import formatToIndianRupee from "@/utils/FormatPrice";
import { ServiceItemType } from "../schema";
import { VALIDATION_MESSAGES } from "../constants";
import { IndexedServiceItem, isCustomServiceItem } from "../utils";

interface SelectedServiceItemsTableProps {
    /** Every added line, approved and custom together, grouped by package. */
    groups: Array<[string, IndexedServiceItem[]]>;
    onUpdate: (index: number, field: keyof ServiceItemType, value: ServiceItemType[keyof ServiceItemType]) => void;
    onDeleteItem: (id: string) => void;
    onDeletePackage: (pkg: string) => void;
    /** Whether the row at `index` failed validation on `field` (only after a submit attempt). */
    hasError: (index: number, field: "quantity" | "rate") => boolean;
}

const headClass = "text-[10px] font-bold tracking-wider text-slate-500 py-3";
const errorBorder = "border-red-500 ring-1 ring-red-500/10";
const okBorder = "border-slate-200 focus:border-primary/50 focus:ring-1 focus:ring-primary/10";

/**
 * The one list of added lines, shared by both service types. A custom line keeps
 * its description and unit editable and is tagged "Custom"; an approved line shows
 * the rate-card description, unit and standard rate read-only. Quantity and rate
 * are editable on both.
 */
export const SelectedServiceItemsTable: React.FC<SelectedServiceItemsTableProps> = ({
    groups,
    onUpdate,
    onDeleteItem,
    onDeletePackage,
    hasError,
}) => {
    if (groups.length === 0) {
        return (
            <div className="border border-dashed rounded-xl p-12 text-center bg-slate-50/50">
                <AlertCircle className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                <p className="text-sm font-medium text-slate-500">{VALIDATION_MESSAGES.itemsRequired}</p>
                <p className="text-xs text-slate-400 mt-2 max-w-[240px] mx-auto">
                    Pick a package above, then add approved or custom services.
                </p>
            </div>
        );
    }

    return (
        <div className="border rounded-xl overflow-hidden shadow-sm bg-white border-slate-200">
            <Table>
                <TableHeader>
                    <TableRow className="bg-slate-50/80 border-b border-slate-100 uppercase tracking-tighter">
                        <TableHead className={`${headClass} w-[45%] px-4`}>Service Item & Specs</TableHead>
                        <TableHead className={`${headClass} w-[10%] text-center`}>Unit</TableHead>
                        <TableHead className={`${headClass} w-[10%] text-center`}>Qty</TableHead>
                        <TableHead className={`${headClass} w-[12%] text-center`}>Std Rate</TableHead>
                        <TableHead className={`${headClass} w-[15%] text-center`}>Rate</TableHead>
                        <TableHead className={`${headClass} w-[8%] text-center px-4`}>Actions</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {groups.map(([pkg, rows]) => (
                        <React.Fragment key={pkg}>
                            <TableRow className="bg-slate-50/50 border-y border-slate-100/50">
                                <TableCell colSpan={6} className="py-2 px-4">
                                    <div className="flex items-center gap-2.5">
                                        <div className="bg-primary/10 text-primary p-1.5 rounded-md shadow-sm border border-primary/20">
                                            <Layers className="h-3.5 w-3.5" />
                                        </div>
                                        <span className="text-sm font-bold text-slate-800 tracking-tight">{pkg}</span>
                                        <Badge variant="secondary" className="text-[10px] font-semibold text-slate-500 py-0 bg-slate-100 border-none shadow-none">
                                            {rows.length} {rows.length === 1 ? "Item" : "Items"}
                                        </Badge>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            title={`Remove all services from ${pkg}`}
                                            className="h-6 w-6 p-0 text-red-400 hover:text-red-600 hover:bg-red-50 ml-1"
                                            onClick={() => onDeletePackage(pkg)}
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>

                            {rows.map(({ index, item }) => {
                                const isCustom = isCustomServiceItem(item);
                                return (
                                    <TableRow key={item.id} className="hover:bg-slate-50/30 border-b border-slate-50 last:border-0">
                                        <TableCell className="text-sm py-2.5 px-4">
                                            {isCustom ? (
                                                <div className="flex flex-col gap-1 ml-1">
                                                    <Textarea
                                                        value={item.description}
                                                        onChange={(e) => onUpdate(index, "description", e.target.value)}
                                                        className="min-h-[56px] text-sm font-medium border-slate-200 resize-y"
                                                        placeholder="Service description"
                                                    />
                                                    <span className="text-[10px] uppercase tracking-wider text-primary/70 font-bold">Custom</span>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col gap-0.5 ml-1">
                                                    <span className="font-semibold text-slate-900 leading-tight">
                                                        {item.description.split("\n")[0]}
                                                    </span>
                                                    {item.description.includes("\n") && (
                                                        <span className="text-xs text-slate-500 line-clamp-2 leading-relaxed italic opacity-80">
                                                            {item.description.split("\n").slice(1).join("\n")}
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-sm text-center py-2.5">
                                            {isCustom ? (
                                                <Input
                                                    value={item.uom}
                                                    onChange={(e) => onUpdate(index, "uom", e.target.value)}
                                                    className="h-9 text-center text-xs bg-white border-slate-200 max-w-[80px] mx-auto"
                                                    placeholder="Unit"
                                                />
                                            ) : (
                                                <Badge variant="outline" className="text-[11px] text-slate-500 font-normal border-slate-200 bg-white/50">
                                                    {item.uom}
                                                </Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-sm p-1 py-2.5 text-center">
                                            <div className="max-w-[70px] mx-auto">
                                                <Input
                                                    type="number"
                                                    min={0}
                                                    step="any"
                                                    value={item.quantity || ""}
                                                    onChange={(e) => {
                                                        const v = parseFloat(e.target.value);
                                                        onUpdate(index, "quantity", isNaN(v) || v < 0 ? 0 : v);
                                                    }}
                                                    onKeyDown={(e) => {
                                                        if (e.key === "-" || e.key === "e") e.preventDefault();
                                                    }}
                                                    className={`h-9 text-center text-xs bg-white transition-all shadow-none ${hasError(index, "quantity") ? errorBorder : okBorder}`}
                                                    placeholder="0"
                                                />
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-sm text-center py-2.5">
                                            <span className="text-[11px] font-semibold text-slate-500 bg-slate-50/80 px-2 py-1.5 rounded border border-slate-100">
                                                {isCustom ? "N/A" : formatToIndianRupee(item.standard_rate)}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-sm p-1 py-2.5">
                                            <div className="relative max-w-[100px] mx-auto">
                                                <span className={`absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-medium tracking-tighter ${hasError(index, "rate") ? "text-red-400" : "text-slate-400"}`}>
                                                    ₹
                                                </span>
                                                <Input
                                                    type="number"
                                                    step="any"
                                                    value={item.rate || ""}
                                                    onChange={(e) => onUpdate(index, "rate", parseFloat(e.target.value) || 0)}
                                                    className={`h-9 pl-5 text-center text-xs bg-white font-semibold transition-all shadow-none ${hasError(index, "rate") ? errorBorder : okBorder}`}
                                                    placeholder="0.00"
                                                />
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-center py-2.5 px-4">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="h-8 w-8 p-0 text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                                onClick={() => onDeleteItem(item.id)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </React.Fragment>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
};

export default SelectedServiceItemsTable;
