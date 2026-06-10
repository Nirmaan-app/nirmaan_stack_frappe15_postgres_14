import React, { useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FuzzySearchSelect } from "@/components/ui/fuzzy-search-select";
import { useTDSItemOptions } from "../hooks/useTDSItemOptions";

// ─────────────────────────────────────────────────────────────────────────────
// Why this exists: on the TDS Item detail page, admins attach catalog Items-master
// SKUs to a TDS Item group. The old UX was an inline single-select that committed
// one SKU per save. This dialog lets the admin search, STAGE multiple SKUs, then
// commit them all in a single save — the parent (detail page) owns persistence and
// only receives the staged item ids via `onCommit`. Replaces the inline picker.
// Mirrors the AddTDSItemWizard "Members" step for visual + interaction consistency.
// ─────────────────────────────────────────────────────────────────────────────

// react-select portal styles so the menu escapes the Dialog's overflow/stacking.
// pointerEvents:"auto" is REQUIRED — Radix Dialog sets pointer-events:none on
// document.body; a menu portaled there inherits it and swallows mouse clicks, so
// we re-enable them on the portal or the options are unclickable.
const PORTAL_SELECT_STYLES = {
    menuPortal: (base: any) => ({ ...base, zIndex: 9999, pointerEvents: "auto" }),
    control: (base: any) => ({ ...base, minHeight: "40px", borderRadius: "8px", borderColor: "#e5e7eb" }),
};

// A SKU staged in the dialog before commit.
interface StagedRow {
    /** Items-master row name — the value returned to the parent via onCommit. */
    value: string;
    /** item_name for display. */
    label: string;
    /** category row name. */
    category: string;
    /** human-readable category name for display. */
    categoryName: string;
}

export interface MultiAddMembersDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The TDS Item's Work Package — scopes the picker to its Items SKUs. */
    workPackage: string;
    /** Item ids already members of the group — excluded from the picker. */
    existingItems: string[];
    /** Parent persists the staged ids; the dialog just returns them. */
    onCommit: (newItemIds: string[]) => Promise<void> | void;
}

export const MultiAddMembersDialog: React.FC<MultiAddMembersDialogProps> = ({
    open,
    onOpenChange,
    workPackage,
    existingItems,
    onCommit,
}) => {
    const [staged, setStaged] = useState<StagedRow[]>([]);
    const [committing, setCommitting] = useState(false);

    // `itemOptionsForWP` lists every Items SKU under the Work Package across all
    // its categories (we pass no `selectedCategory`) — exactly the cross-category
    // member picker we need.
    const { itemOptionsForWP } = useTDSItemOptions({ selectedWP: workPackage });

    // Reset staging whenever the dialog closes.
    useEffect(() => {
        if (!open) {
            setStaged([]);
            setCommitting(false);
        }
    }, [open]);

    // Picker options = WP items minus existing members minus already-staged ids.
    // Annotate showCategory when the same item_name appears under multiple
    // categories so we can disambiguate in the option label (mirrors the wizard).
    const pickerOptions = useMemo(() => {
        const excluded = new Set<string>([
            ...existingItems,
            ...staged.map((s) => s.value),
        ]);
        const nameCounts = new Map<string, number>();
        itemOptionsForWP.forEach((item) => {
            nameCounts.set(item.label, (nameCounts.get(item.label) || 0) + 1);
        });
        return itemOptionsForWP
            .filter((item) => !excluded.has(item.value))
            .map((item) => ({
                label: item.label,
                value: item.value,
                category: item.category,
                categoryName: item.categoryName,
                showCategory: (nameCounts.get(item.label) || 0) > 1,
            }));
    }, [itemOptionsForWP, existingItems, staged]);

    const handleStage = (opt: any) => {
        if (!opt?.value) return;
        // Guard against double-add (options already filter staged ids, but defend
        // against rapid selection / stale state).
        if (staged.some((s) => s.value === opt.value)) return;
        setStaged((prev) => [
            ...prev,
            {
                value: opt.value,
                label: opt.label,
                category: opt.category,
                categoryName: opt.categoryName,
            },
        ]);
    };

    const handleRemove = (value: string) => {
        setStaged((prev) => prev.filter((s) => s.value !== value));
    };

    const handleCommit = async () => {
        if (staged.length === 0) return;
        try {
            setCommitting(true);
            await onCommit(staged.map((s) => s.value));
            setStaged([]);
            onOpenChange(false);
        } finally {
            setCommitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[560px]">
                <DialogHeader>
                    <DialogTitle>Add Member Items</DialogTitle>
                    <DialogDescription>Items under {workPackage}</DialogDescription>
                </DialogHeader>

                <div className="space-y-3 max-h-[70vh] overflow-y-auto">
                    <div>
                        <p className="text-xs text-muted-foreground mb-1.5">
                            Search any item under this Work Package and stage it. All staged
                            items are added together when you save.
                        </p>
                        <FuzzySearchSelect
                            allOptions={pickerOptions}
                            tokenSearchConfig={{
                                searchFields: ["label", "categoryName", "value"],
                                minSearchLength: 1,
                                partialMatch: true,
                                minTokenLength: 1,
                                fieldWeights: { label: 2.0, categoryName: 1.0, value: 1.0 },
                                minTokenMatches: 1,
                            }}
                            value={null}
                            onChange={handleStage as any}
                            placeholder="Search item to add..."
                            classNamePrefix="react-select"
                            isDisabled={!workPackage}
                            controlShouldRenderValue={false}
                            menuPortalTarget={document.body}
                            menuPosition="fixed"
                            styles={PORTAL_SELECT_STYLES}
                            formatOptionLabel={(option: any) => (
                                <span>
                                    {option.label}
                                    {option.showCategory && option.categoryName && (
                                        <span className="text-blue-600 ml-1">
                                            ({option.categoryName})
                                        </span>
                                    )}
                                </span>
                            )}
                        />
                    </div>

                    {/* Staging table */}
                    <div className="border rounded-lg overflow-hidden">
                        <div className="grid grid-cols-[1fr_1fr_auto] gap-2 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-600">
                            <span>Item</span>
                            <span>Category</span>
                            <span className="text-right pr-1">
                                {staged.length} staged
                            </span>
                        </div>
                        {staged.length === 0 ? (
                            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                                No items staged yet.
                            </div>
                        ) : (
                            staged.map((s) => (
                                <div
                                    key={s.value}
                                    className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center px-3 py-2 border-t text-sm"
                                >
                                    <div className="flex flex-col min-w-0">
                                        <span className="font-medium truncate">{s.label}</span>
                                        <span className="text-xs text-gray-400 font-mono truncate">
                                            {s.value}
                                        </span>
                                    </div>
                                    <span className="text-gray-600 truncate">{s.categoryName}</span>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50 justify-self-end"
                                        onClick={() => handleRemove(s.value)}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={committing}
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        disabled={staged.length === 0 || committing}
                        onClick={handleCommit}
                        style={{ backgroundColor: "#dc2626" }}
                        className="text-white hover:!bg-[#b91c1c]"
                    >
                        {committing ? "Adding..." : `Add ${staged.length} item(s)`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default MultiAddMembersDialog;
