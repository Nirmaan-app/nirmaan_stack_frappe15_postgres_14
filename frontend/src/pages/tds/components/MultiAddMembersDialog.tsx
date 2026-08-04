import React, { useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { useFrappeGetCall } from "frappe-react-sdk";

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
    /**
     * ADR-0004: the group this SKU currently belongs to, if any. Membership is
     * N:1, so staging an already-linked item MOVES it out of that group. Carried
     * on the staged row so the warning survives from pick to commit.
     */
    linkedGroupName?: string;
    /** That group's ID — names alone are not unique enough to identify a group. */
    linkedGroupId?: string;
}

export interface MultiAddMembersDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The TDS Item's Work Package — scopes the picker to its Items SKUs. */
    workPackage: string;
    /**
     * This TDS Item's display name — the DESTINATION shown in the move
     * confirmation. Without it the confirmation can only say what an item is
     * taken FROM, which reads as pure loss and is what made the first version
     * of that copy confusing.
     */
    groupName?: string;
    /** Item ids already members of the group — excluded from the picker. */
    existingItems: string[];
    /** Parent persists the staged ids; the dialog just returns them. */
    onCommit: (newItemIds: string[]) => Promise<void> | void;
}

/** "Y Strainer (TDS-ITEM-00351)" — kept identical to AddTDSItemWizard's groupRef;
 *  these two pickers must read the same or one of them starts lying. */
const groupRef = (name?: string, id?: string) =>
    name ? (id ? `${name} (${id})` : name) : id || "";

export const MultiAddMembersDialog: React.FC<MultiAddMembersDialogProps> = ({
    open,
    onOpenChange,
    workPackage,
    groupName,
    existingItems,
    onCommit,
}) => {
    const [staged, setStaged] = useState<StagedRow[]>([]);
    const [committing, setCommitting] = useState(false);
    // Last-stop confirmation when the commit would TAKE members from other groups.
    const [showMoveConfirm, setShowMoveConfirm] = useState(false);

    // `itemOptionsForWP` lists every Items SKU under the Work Package across all
    // its categories (we pass no `selectedCategory`) — exactly the cross-category
    // member picker we need.
    const { itemOptionsForWP } = useTDSItemOptions({ selectedWP: workPackage });

    // Reset staging whenever the dialog closes.
    useEffect(() => {
        if (!open) {
            setStaged([]);
            setCommitting(false);
            setShowMoveConfirm(false);
        }
    }, [open]);

    // ADR-0004: current linkage for every SKU in this Work Package, fetched ONCE
    // (batched, not per option) so each picker row can show whether adding it
    // would MOVE it out of another group. "No silent member theft" — and this is
    // the surface where it would otherwise be silent, because the picker does not
    // filter out items that already belong somewhere.
    const { data: linkageData } = useFrappeGetCall<{
        message: Record<string, { linked_tds_item: string; group_name: string }>;
    }>(
        "nirmaan_stack.api.tds.linking.get_items_linkage",
        { work_package: workPackage },
        open && workPackage ? `tds_linkage_for_wp_${workPackage}` : null
    );

    const linkageByItem = linkageData?.message || {};

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
                linkedGroupName: linkageByItem[item.value]?.group_name || "",
                linkedGroupId: linkageByItem[item.value]?.linked_tds_item || "",
            }));
    }, [itemOptionsForWP, existingItems, staged, linkageByItem]);

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
                linkedGroupName: opt.linkedGroupName || "",
                linkedGroupId: opt.linkedGroupId || "",
            },
        ]);
    };

    const handleRemove = (value: string) => {
        setStaged((prev) => prev.filter((s) => s.value !== value));
    };

    // Same exposure as the create wizard: an already-linked SKU is MOVED, not
    // copied, and the write leaves no audit trail. Confirm before taking members
    // from other groups. Kept in step with AddTDSItemWizard's move confirmation.
    const movingRows = useMemo(() => staged.filter((s) => s.linkedGroupName), [staged]);
    const destGroupName = groupName?.trim() || "this TDS Item";
    // One mover => there is a single source to name. Several => sources differ,
    // so the sentence stays general and the per-row from -> to list carries it.
    const singleFromGroup =
        movingRows.length === 1
            ? groupRef(movingRows[0].linkedGroupName, movingRows[0].linkedGroupId)
            : "";

    const handleCommit = async () => {
        if (staged.length === 0) return;
        if (movingRows.length > 0) {
            setShowMoveConfirm(true);
            return;
        }
        await performCommit();
    };

    const confirmAndCommit = async () => {
        setShowMoveConfirm(false);
        await performCommit();
    };

    const performCommit = async () => {
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
                                    {/* ADR-0004: N:1 membership — adding this MOVES it. */}
                                    {option.linkedGroupName && (
                                        <span className="text-amber-600 ml-1 text-xs">
                                            · linked to {groupRef(option.linkedGroupName, option.linkedGroupId)}
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
                                        {/* The move warning has to survive from pick to
                                            commit — this is the last screen before it. */}
                                        {s.linkedGroupName && (
                                            <span className="text-xs text-amber-600 truncate">
                                                will move out of {groupRef(s.linkedGroupName, s.linkedGroupId)}
                                            </span>
                                        )}
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

            {/* Move confirmation — sibling of DialogContent so it portals above
                this dialog. Mirrors AddTDSItemWizard's; keep the two in step. */}
            <AlertDialog open={showMoveConfirm} onOpenChange={setShowMoveConfirm}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {movingRows.length} item{movingRows.length === 1 ? "" : "s"} will change TDS Item
                        </AlertDialogTitle>
                        {/* Say what CONTINUING does, in one line, naming the destination. */}
                        <AlertDialogDescription>
                            If you continue, {movingRows.length === 1 ? "this item is" : "these items are"}{" "}
                            removed from{" "}
                            <span className="font-semibold text-red-600">
                                {singleFromGroup || "their current TDS Item"}
                            </span>{" "}
                            and added to{" "}
                            <span className="font-semibold text-green-700">{destGroupName}</span>
                            . An item can belong to only one TDS Item.
                        </AlertDialogDescription>
                    </AlertDialogHeader>

                    <div className="max-h-[240px] overflow-y-auto rounded-lg border divide-y">
                        {movingRows.map((s) => (
                            <div key={s.value} className="px-3 py-2 text-sm">
                                <div className="font-medium truncate">{s.label}</div>
                                <div className="flex items-center gap-1.5 text-xs mt-0.5">
                                    <span className="text-red-600 truncate">
                                        {groupRef(s.linkedGroupName, s.linkedGroupId)}
                                    </span>
                                    <span className="text-gray-400 shrink-0">→</span>
                                    <span className="font-medium text-green-700 truncate">
                                        {destGroupName}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>

                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={committing}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(e) => {
                                e.preventDefault();
                                confirmAndCommit();
                            }}
                            disabled={committing}
                            className="bg-[#dc2626] hover:bg-[#b91c1c]"
                        >
                            {committing
                                ? "Adding..."
                                : `Yes, move ${movingRows.length === 1 ? "it" : "them"}`}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Dialog>
    );
};

export default MultiAddMembersDialog;
