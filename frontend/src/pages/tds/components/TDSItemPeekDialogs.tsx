// src/pages/tds/components/TDSItemPeekDialogs.tsx
//
// Read-only QUICK-PEEK dialogs for the TDS Items master table. The master page
// (rewritten separately) wires these to the clickable "Linked Item SKU" and
// "Repository Entries" count chips: clicking a count opens the matching dialog,
// which lazily fetches and lists those rows WITHOUT navigating away.
//
// Both dialogs are strictly read-only (no edit/delete). Each offers an
// "Open TDS Item →" escape hatch that navigates to the item detail page.
//
// frappe-react-sdk gotcha: the 3rd arg to useFrappeGetDocList / useFrappeGetCall
// is the swrKey, NOT an options object. Conditional fetch is done via
// `cond ? <key> : null` (null = skip fetch) — never `{ enabled }`.
//
// Linked SKUs come from a CUSTOM endpoint (get_tds_item_members), NOT get_list
// on "TDS Items Child Table": that istable doctype has no DocPerm rows, so the
// permission-aware get_list raises PermissionError for non-superusers. The
// Repository-entries peek reads "TDS Repository" (a normal doctype) directly.

import React from "react";
import { useNavigate } from "react-router-dom";
import { useFrappeGetDocList, useFrappeGetCall } from "frappe-react-sdk";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { StatusBadge, AttachmentCell } from "./cells";

// ─── Shared types ────────────────────────────────────────────────────────────
export interface TDSItemPeekDialogProps {
    open: boolean;
    onOpenChange: (o: boolean) => void;
    tdsItemId: string;
    tdsItemName: string;
}

// ─── Shared table-shell styling (House table style) ──────────────────────────
const THEAD_CLS =
    "bg-slate-50/70 border-b text-xs font-semibold text-gray-500 uppercase tracking-wider";
const TH_CLS = "px-4 py-2 text-left";
const TD_CLS = "px-4 py-2 text-sm";
const ROW_CLS = "border-b last:border-b-0 hover:bg-slate-50/50";

// A small slate chip used for the "Make" column.
const SlateChip: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700">
        {children}
    </span>
);

// ─── LinkedSKUsPeekDialog ─────────────────────────────────────────────────────
// Lists the member item SKUs for a TDS Item (rows live in the
// "TDS Items Child Table" doctype, filtered by parent = tdsItemId).
export const LinkedSKUsPeekDialog: React.FC<TDSItemPeekDialogProps> = ({
    open,
    onOpenChange,
    tdsItemId,
    tdsItemName,
}) => {
    const navigate = useNavigate();

    const { data, isLoading } = useFrappeGetCall<{
        message: { item: string; item_name: string; category: string }[];
    }>(
        "nirmaan_stack.api.tds.members.get_tds_item_members",
        { tds_item: tdsItemId },
        open && tdsItemId ? `tds_item_members_${tdsItemId}` : null
    );

    const rows = data?.message ?? [];

    const openItem = () => {
        navigate(`/tds-repository/item/${tdsItemId}`);
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[640px]">
                <DialogHeader>
                    <DialogTitle>
                        {tdsItemName} · Linked Item SKUs ({rows.length})
                    </DialogTitle>
                </DialogHeader>

                <div className="max-h-[60vh] overflow-y-auto">
                    {isLoading ? (
                        <div className="py-8 text-center text-sm text-slate-500">
                            Loading…
                        </div>
                    ) : rows.length === 0 ? (
                        <div className="py-8 text-center text-sm text-slate-500">
                            No member items — this is a custom item.
                        </div>
                    ) : (
                        <table className="w-full border-collapse">
                            <thead className={THEAD_CLS}>
                                <tr>
                                    <th className={TH_CLS}>Item Code</th>
                                    <th className={TH_CLS}>Item Name</th>
                                    <th className={TH_CLS}>Category</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row: any) => (
                                    <tr key={row.item} className={ROW_CLS}>
                                        <td className={`${TD_CLS} font-mono text-xs`}>
                                            {row.item}
                                        </td>
                                        <td className={TD_CLS}>{row.item_name}</td>
                                        <td className={TD_CLS}>{row.category}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Close
                    </Button>
                    <Button onClick={openItem}>Open TDS Item →</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

// ─── RepositoryEntriesPeekDialog ──────────────────────────────────────────────
// Lists the datasheet records for a TDS Item (rows live in the "TDS Repository"
// doctype, filtered by tds_item = tdsItemId).
export const RepositoryEntriesPeekDialog: React.FC<TDSItemPeekDialogProps> = ({
    open,
    onOpenChange,
    tdsItemId,
    tdsItemName,
}) => {
    const navigate = useNavigate();

    const { data, isLoading } = useFrappeGetDocList(
        "TDS Repository",
        {
            filters: [["tds_item", "=", tdsItemId ?? ""]],
            fields: ["name", "make", "status", "tds_attachment"],
            limit: 0,
        },
        open && tdsItemId ? undefined : null
    );

    const rows = data ?? [];

    const openItem = () => {
        navigate(`/tds-repository/item/${tdsItemId}`);
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[640px]">
                <DialogHeader>
                    <DialogTitle>
                        {tdsItemName} · Repository Entries ({rows.length})
                    </DialogTitle>
                </DialogHeader>

                <div className="max-h-[60vh] overflow-y-auto">
                    {isLoading ? (
                        <div className="py-8 text-center text-sm text-slate-500">
                            Loading…
                        </div>
                    ) : rows.length === 0 ? (
                        <div className="py-8 text-center text-sm text-slate-500">
                            No entries yet.
                        </div>
                    ) : (
                        <table className="w-full border-collapse">
                            <thead className={THEAD_CLS}>
                                <tr>
                                    <th className={TH_CLS}>Make</th>
                                    <th className={TH_CLS}>Status</th>
                                    <th className={TH_CLS}>Datasheet</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row: any) => (
                                    <tr key={row.name} className={ROW_CLS}>
                                        <td className={TD_CLS}>
                                            <SlateChip>{row.make}</SlateChip>
                                        </td>
                                        <td className={TD_CLS}>
                                            <StatusBadge status={row.status} />
                                        </td>
                                        <td className={TD_CLS}>
                                            <AttachmentCell url={row.tds_attachment} />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Close
                    </Button>
                    <Button onClick={openItem}>Open TDS Item →</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default { LinkedSKUsPeekDialog, RepositoryEntriesPeekDialog };
