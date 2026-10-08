// The Download TDS PDF dialog, shared by the project TDS page and Handover Documents.
//
// The user ticks Status and Packages as numbered checklists, in the order they should print, then the
// items. Every ordering rule lives in `utils/tdsRequestRules` (`pdfPrintOrder` and friends); this file
// only holds the ticks and draws them. The rows go to `onExport` already in print order.

import React, { useState, useMemo } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Ban, Check, FileDown, Eye, ExternalLink, Loader2, Search, X } from 'lucide-react';
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useUserData } from "@/hooks/useUserData";
import { ADMIN_PROFILE } from "@/constants/roles";
import type { TdsHistoryRow } from '../../data/tds/useTdsQueries';
import { TDSRepositoryData } from './SetupTDSRepositoryDialog';
import {
    PDF_STATUS,
    PDF_STATUSES,
    isPdfPreviewOnly,
    offersTickApprovedByAdmin,
    pdfPackagesFor,
    pdfPrintOrder,
    pdfSeedStatuses,
    pdfSeedTicks,
    pdfStatusOf,
    toggleTick,
    type PdfStatus,
    type PdfStatusGroup,
} from '@/utils/tdsRequestRules';

/** A row the dialog lists and exports. */
export type TdsExportItem = TdsHistoryRow;

/** How the caller should hand over the PDF it generates. */
export interface TdsExportOptions {
    /** A non-Admin ticked Pending: show the PDF in the preview, never download it. */
    previewOnly: boolean;
}

/**
 * The dialog reads its props once, when it mounts: the caller mounts a fresh one per open (a `key`
 * bumped by the handler that opens it, or rendering it only while open). Only the item ticks follow a
 * refetched `historyData`.
 */
interface TdsExportDialogProps {
    isOpen: boolean;
    onClose: () => void;
    /** The ticked rows, already in print order. */
    onExport: (selectedItems: TdsExportItem[], options: TdsExportOptions) => void;
    settings: TDSRepositoryData;
    historyData: TdsExportItem[];
    isExporting: boolean;
    /** The statuses ticked on open (`PDF_DEFAULT_STATUSES`): the TDS page and Handover differ. A
     *  status a saved tick's row needs is ticked too (`pdfSeedStatuses`). */
    defaultStatuses: readonly PdfStatus[];
    /** When given, a third footer button saves the ticks WITHOUT exporting. The Handover Documents tab
     *  passes it because its ticks decide what the handover binder carries, so they must be settable
     *  without downloading a PDF. Absent (the TDS page) = the two-button footer. */
    onSaveSelection?: (selectedItems: TdsExportItem[]) => Promise<void> | void;
    /** The item ticks saved last time (Handover's `form_data.selected`). Those on rows the dialog no
     *  longer offers, such as a row the client rejected since, are dropped (`pdfSeedTicks`). Absent (the
     *  TDS page) = every offered item ticked. */
    initialSelectedIds?: string[];
}

const STATUS_DOT: Record<PdfStatus, string> = {
    [PDF_STATUS.approvedByClient]: "bg-blue-600",
    [PDF_STATUS.approvedByAdmin]: "bg-green-600",
    [PDF_STATUS.pending]: "bg-yellow-600",
};

const STATUS_BAND: Record<PdfStatus, string> = {
    [PDF_STATUS.approvedByClient]: "bg-blue-50 border-blue-100 text-blue-900",
    [PDF_STATUS.approvedByAdmin]: "bg-green-50 border-green-100 text-green-900",
    [PDF_STATUS.pending]: "bg-yellow-50 border-yellow-100 text-yellow-900",
};

const ITEM_COLUMNS = 6;

// Mini stakeholder card for the dialog
const MiniStakeholderCard: React.FC<{ label: string; name: string; logo?: string | File | null; enabled: boolean }> = ({ label, name, logo, enabled }) => {
    const logoUrl = typeof logo === 'string' ? logo : null;

    return (
        <div className={cn(
            "flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200 transition-opacity",
            !enabled && "opacity-50"
        )}>
            <div className="w-10 h-10 bg-white rounded-md border border-gray-200 flex items-center justify-center overflow-hidden flex-shrink-0">
                {logoUrl ? (
                    <img src={logoUrl} alt={name} className="w-full h-full object-contain" />
                ) : (
                    <div className="w-full h-full bg-gray-100 flex items-center justify-center">
                         <span className="text-[10px] text-gray-400">No Logo</span>
                    </div>
                )}
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                    <p className="text-[10px] text-gray-500 uppercase font-medium">{label}</p>
                    <span className={cn(
                        "text-[8px] px-1.5 py-0.5 rounded-full font-bold uppercase",
                        enabled ? "bg-green-100 text-green-700 border border-green-200" : "bg-gray-200 text-gray-600 border border-gray-300"
                    )}>
                        {enabled ? 'Enabled' : 'Disabled'}
                    </span>
                </div>
                <p className="text-sm font-semibold text-gray-900 truncate">{name || '-'}</p>
            </div>
        </div>
    );
};

/** A numbered tick box: its print position when ticked, an empty box when not. */
const OrderBadge: React.FC<{ position: number | null }> = ({ position }) =>
    position ? (
        <span className="w-[22px] h-[22px] rounded-[5px] bg-red-600 text-white text-xs font-bold inline-flex items-center justify-center flex-shrink-0">
            {position}
        </span>
    ) : (
        <span className="w-[22px] h-[22px] rounded-[5px] border-[1.5px] border-gray-400 bg-white flex-shrink-0" />
    );

/** One choice of an ordered checklist (a status or a package). */
const OrderedOption: React.FC<{
    label: string;
    position: number | null;
    onToggle: () => void;
    dataAttrs: Record<string, string>;
    children: React.ReactNode;
}> = ({ label, position, onToggle, dataAttrs, children }) => (
    <label
        className="relative flex items-center gap-3 px-2 py-2 rounded-md cursor-pointer hover:bg-gray-50 focus-within:ring-2 focus-within:ring-red-600"
        data-tick={position ?? ""}
        {...dataAttrs}
    >
        <input type="checkbox" className="sr-only" aria-label={label} checked={position !== null} onChange={onToggle} />
        <OrderBadge position={position} />
        {children}
    </label>
);

const flattenRows = <T,>(groups: PdfStatusGroup<T>[]): T[] =>
    groups.flatMap(group => group.packages.flatMap(pkg => pkg.rows));

export const TdsExportDialog: React.FC<TdsExportDialogProps> = ({
    isOpen,
    onClose,
    onExport,
    settings,
    historyData,
    isExporting,
    defaultStatuses,
    onSaveSelection,
    initialSelectedIds,
}) => {
    const { role } = useUserData();
    const isAdmin = role === ADMIN_PROFILE;

    // Each mount (each open) starts from the caller's statuses, all packages and an empty search.
    const [tickedStatuses, setTickedStatuses] = useState<PdfStatus[]>(() =>
        pdfSeedStatuses(historyData, initialSelectedIds, defaultStatuses)
    );
    const [tickedPackages, setTickedPackages] = useState<string[]>([]);
    // Item ticks = the seed (`pdfSeedTicks`), then the user's own ticks and unticks on top. The seed is
    // derived, so a refetched list (the TDS page refetches on open) reseeds without losing the user's.
    const seededIds = useMemo(() => pdfSeedTicks(historyData, initialSelectedIds), [historyData, initialSelectedIds]);
    const [userTicks, setUserTicks] = useState<ReadonlyMap<string, boolean>>(() => new Map());
    const selectedIds = useMemo(
        () => new Set(historyData.map(row => row.name).filter(name => userTicks.get(name) ?? seededIds.has(name))),
        [historyData, userTicks, seededIds]
    );
    // Item-name search. A FIND-AND-TICK tool: it narrows what you SEE and what Select all acts on,
    // never what the PDF holds. The PDF follows the ticks.
    const [itemSearch, setItemSearch] = useState("");

    const statusCounts = useMemo(() => {
        const counts = new Map<PdfStatus, number>();
        for (const row of historyData) {
            const status = pdfStatusOf(row);
            if (status) counts.set(status, (counts.get(status) ?? 0) + 1);
        }
        return counts;
    }, [historyData]);

    const offeredPackages = useMemo(() => pdfPackagesFor(historyData, tickedStatuses), [historyData, tickedStatuses]);
    // A ticked package whose status was unticked drops out, and the rest renumber.
    const packageOrder = useMemo(
        () => tickedPackages.filter(pkg => offeredPackages.includes(pkg)),
        [tickedPackages, offeredPackages]
    );

    // What can print: the ticked statuses and packages, in print order. Search-blind.
    const groups = useMemo(
        () => pdfPrintOrder(historyData, tickedStatuses, packageOrder),
        [historyData, tickedStatuses, packageOrder]
    );
    const scopeRows = useMemo(() => flattenRows(groups), [groups]);
    const tickedRows = useMemo(() => scopeRows.filter(row => selectedIds.has(row.name)), [scopeRows, selectedIds]);

    // What the list shows: the same groups, minus what the search hides.
    const query = itemSearch.trim().toLowerCase();
    const visibleGroups = useMemo(() => {
        if (!query) return groups;
        return groups.map(group => ({
            ...group,
            packages: group.packages
                .map(pkg => ({ ...pkg, rows: pkg.rows.filter(row => (row.tds_item_name || "").toLowerCase().includes(query)) }))
                .filter(pkg => pkg.rows.length > 0),
        }));
    }, [groups, query]);
    const visibleRows = useMemo(() => flattenRows(visibleGroups), [visibleGroups]);

    const previewOnly = isPdfPreviewOnly(tickedStatuses, isAdmin);
    const allPackages = packageOrder.length === 0;
    const isAllSelected = visibleRows.length > 0 && visibleRows.every(row => selectedIds.has(row.name));

    const setTicks = (names: string[], ticked: boolean) =>
        setUserTicks(prev => new Map([...prev, ...names.map(name => [name, ticked] as const)]));

    const handleToggleItem = (itemName: string) => setTicks([itemName], !selectedIds.has(itemName));

    // Select all / Deselect all act on the items SHOWN, so "search a term, tick every match" works.
    const handleToggleAll = () => setTicks(visibleRows.map(row => row.name), !isAllSelected);

    const handleExport = () => {
        onExport(tickedRows, { previewOnly });
    };

    const [isSaving, setIsSaving] = useState(false);

    const handleSaveSelection = async () => {
        if (!onSaveSelection) return;
        setIsSaving(true);
        try {
            await onSaveSelection(tickedRows);
        } finally {
            setIsSaving(false);
        }
    };

    const emptyMessage = (): React.ReactNode => {
        if (offersTickApprovedByAdmin(historyData, tickedStatuses)) {
            return (
                <div className="flex flex-col items-center gap-3 text-center" data-testid="pdf-empty-client">
                    <p className="text-[15px] font-semibold text-gray-900">The client hasn't approved any items on this project yet</p>
                    <p className="text-sm text-gray-500 max-w-md">Tick {PDF_STATUS.approvedByAdmin} to put the Admin-approved items in the PDF.</p>
                    <Button
                        variant="outline"
                        className="border-red-600 text-red-700 hover:bg-red-50"
                        onClick={() => setTickedStatuses(prev => toggleTick(prev, PDF_STATUS.approvedByAdmin))}
                    >
                        Tick {PDF_STATUS.approvedByAdmin}
                    </Button>
                </div>
            );
        }
        if (statusCounts.size === 0) return "No items to export.";
        if (tickedStatuses.length === 0) return "Nothing ticked yet. Tick a status above.";
        if (query && scopeRows.length > 0) return `No item name matches "${itemSearch.trim()}".`;
        return "No items in the ticked statuses and packages.";
    };

    const summaryPackages = (group: PdfStatusGroup<TdsExportItem>): string => {
        const printed = group.packages.filter(pkg => pkg.rows.some(row => selectedIds.has(row.name)));
        if (printed.length) return printed.map(pkg => pkg.package).join(", ");
        if (group.packages.length) return "No items ticked";
        return allPackages ? "No items" : "No items in the ticked packages";
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
                <DialogHeader className="flex-shrink-0">
                    <DialogTitle className="text-lg font-semibold">Download TDS PDF</DialogTitle>
                    <DialogDescription className="text-sm text-gray-500">
                        Pick what goes in the PDF. The order you tick things in is the order they print in.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto">
                    {/* TDS Setup Section */}
                    <div className="mb-4 grid grid-cols-2 md:grid-cols-3 gap-3">
                        <MiniStakeholderCard label="Client" name={settings.client.name} logo={settings.client.logo} enabled={settings.client.enabled} />
                        <MiniStakeholderCard label="Project Manager" name={settings.projectManager.name} logo={settings.projectManager.logo} enabled={settings.projectManager.enabled} />
                        <MiniStakeholderCard label="Consultant" name={settings.consultant.name} logo={settings.consultant.logo} enabled={settings.consultant.enabled} />
                        <MiniStakeholderCard label="Architect" name={settings.architect.name} logo={settings.architect.logo} enabled={settings.architect.enabled} />
                        <MiniStakeholderCard label="GC Contractor" name={settings.gcContractor.name} logo={settings.gcContractor.logo} enabled={settings.gcContractor.enabled} />
                        <MiniStakeholderCard label="MEP Contractor" name={settings.mepContractor.name} logo={settings.mepContractor.logo} enabled={settings.mepContractor.enabled} />
                    </div>

                    {/* Status and Packages: numbered checklists, ticked in print order */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div role="group" aria-label="Status" className="border rounded-lg p-3.5 flex flex-col gap-2.5" data-testid="pdf-status-options">
                            <div className="flex justify-between items-baseline">
                                <h4 className="text-sm font-semibold">Status</h4>
                                <span className="text-xs text-gray-500">Tick in print order</span>
                            </div>
                            <div className="flex flex-col gap-0.5">
                                {PDF_STATUSES.map(status => {
                                    const index = tickedStatuses.indexOf(status);
                                    return (
                                        <OrderedOption
                                            key={status}
                                            label={status}
                                            position={index >= 0 ? index + 1 : null}
                                            onToggle={() => setTickedStatuses(prev => toggleTick(prev, status))}
                                            dataAttrs={{ "data-pdf-status": status }}
                                        >
                                            <span className={cn("w-2.5 h-2.5 rounded-full flex-shrink-0", STATUS_DOT[status])} />
                                            <span className="text-[13px] font-medium flex-grow">{status}</span>
                                            <span className="text-xs text-gray-500">{statusCounts.get(status) ?? 0} items</span>
                                        </OrderedOption>
                                    );
                                })}
                            </div>
                        </div>

                        <div role="group" aria-label="Packages" className="border rounded-lg p-3.5 flex flex-col gap-2.5" data-testid="pdf-package-options">
                            <div className="flex justify-between items-baseline">
                                <h4 className="text-sm font-semibold">Packages</h4>
                                {allPackages ? (
                                    <span className="text-xs font-medium text-gray-500">All packages</span>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => setTickedPackages([])}
                                        className="text-xs font-medium text-red-600 hover:text-red-700"
                                    >
                                        Clear, use all packages
                                    </button>
                                )}
                            </div>
                            {offeredPackages.length === 0 ? (
                                <p className="text-[13px] text-gray-500">Packages appear once a status with items is ticked.</p>
                            ) : (
                                <>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-0.5">
                                        {offeredPackages.map(pkg => {
                                            const index = packageOrder.indexOf(pkg);
                                            return (
                                                <OrderedOption
                                                    key={pkg}
                                                    label={pkg}
                                                    position={index >= 0 ? index + 1 : null}
                                                    onToggle={() => setTickedPackages(toggleTick(packageOrder, pkg))}
                                                    dataAttrs={{ "data-pdf-package": pkg }}
                                                >
                                                    <span className="text-[13px] font-medium flex-grow">{pkg}</span>
                                                </OrderedOption>
                                            );
                                        })}
                                    </div>
                                    <p className="text-xs text-gray-500">
                                        {allPackages
                                            ? "None ticked means every package, A to Z."
                                            : "Only the ticked packages print, in this order."}
                                    </p>
                                </>
                            )}
                        </div>
                    </div>

                    {/* The print order, as the PDF will have it */}
                    <div
                        className="mt-4 bg-gray-50 border border-dashed border-gray-300 rounded-lg px-3.5 py-3 flex flex-col gap-2"
                        data-testid="pdf-print-order"
                    >
                        <p className="text-xs font-semibold text-gray-700">The PDF will print in this order</p>
                        {groups.length === 0 ? (
                            <p className="text-[13px] text-gray-500">Nothing ticked yet. Tick a status above.</p>
                        ) : (
                            <ol className="flex flex-col gap-1.5">
                                {groups.map((group, index) => (
                                    <li key={group.status} className="flex items-start gap-2.5 text-[13px]" data-print-line={group.status}>
                                        <span className="w-5 h-5 rounded-full bg-red-600 text-white text-[11px] font-bold inline-flex items-center justify-center flex-shrink-0">
                                            {index + 1}
                                        </span>
                                        <span className="font-semibold w-40 flex-shrink-0">{group.status}</span>
                                        <span className="text-gray-600">{summaryPackages(group)}</span>
                                    </li>
                                ))}
                            </ol>
                        )}
                    </div>

                    {/* Items, grouped as they print */}
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                            <h3 className="text-sm font-semibold text-gray-900">Items</h3>
                            <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full" data-testid="pdf-ticked-count">
                                {tickedRows.length} of {scopeRows.length} ticked
                            </span>
                            <Button variant="outline" size="sm" onClick={handleToggleAll} disabled={visibleRows.length === 0}>
                                {isAllSelected ? 'Deselect all' : 'Select all'}
                            </Button>
                        </div>
                        <div className="relative w-full sm:w-72">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                            <Input
                                value={itemSearch}
                                onChange={(e) => setItemSearch(e.target.value)}
                                placeholder="Search item name..."
                                className="h-9 pl-8 pr-8"
                            />
                            {itemSearch && (
                                <button
                                    type="button"
                                    onClick={() => setItemSearch("")}
                                    title="Clear search"
                                    className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-gray-400 hover:text-gray-600"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>
                    </div>
                    {query && (
                        <p className="mt-1 text-xs text-muted-foreground">
                            showing {visibleRows.length} of {scopeRows.length} · Select all acts on these; the PDF follows the ticks
                        </p>
                    )}

                    <div className="mt-2.5">
                        {visibleRows.length === 0 ? (
                            <div className="border rounded-lg py-10 px-5 flex items-center justify-center text-gray-500 text-sm">
                                {emptyMessage()}
                            </div>
                        ) : (
                            <div className="border rounded-lg overflow-x-auto">
                                <table className="w-full text-sm" data-testid="pdf-items">
                                    <thead className="bg-gray-50 sticky top-0">
                                        <tr className="border-b">
                                            <th className="w-10 p-3"></th>
                                            <th className="text-left p-3 font-medium text-gray-600">Category</th>
                                            <th className="text-left p-3 font-medium text-gray-600">Item Name</th>
                                            <th className="text-left p-3 font-medium text-gray-600">Make</th>
                                            <th className="text-left p-3 font-medium text-gray-600">BOQ Ref</th>
                                            <th className="w-24 text-left p-3 font-medium text-gray-600">Attached Doc.</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {visibleGroups.map((group, index) => (
                                            <React.Fragment key={group.status}>
                                                <tr data-pdf-group={group.status}>
                                                    <td colSpan={ITEM_COLUMNS} className={cn("px-3 py-2 border-t", STATUS_BAND[group.status])}>
                                                        <div className="flex items-center gap-2">
                                                            <span className="w-[18px] h-[18px] rounded-full bg-red-600 text-white text-[10px] font-bold inline-flex items-center justify-center">
                                                                {index + 1}
                                                            </span>
                                                            <span className="font-semibold">{group.status}</span>
                                                        </div>
                                                    </td>
                                                </tr>
                                                {group.packages.map(pkg => (
                                                    <React.Fragment key={pkg.package}>
                                                        <tr data-pdf-group-package={pkg.package}>
                                                            <td colSpan={ITEM_COLUMNS} className="pl-10 pr-3 py-1.5 bg-red-50 border-t border-red-100 text-xs font-semibold text-red-900">
                                                                {pkg.package}
                                                            </td>
                                                        </tr>
                                                        {pkg.rows.map(item => (
                                                            <tr
                                                                key={item.name}
                                                                data-pdf-row={item.name}
                                                                className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer"
                                                                onClick={() => handleToggleItem(item.name)}
                                                            >
                                                                <td className="p-3" onClick={(e) => e.stopPropagation()}>
                                                                    <Checkbox
                                                                        aria-label="Include in PDF"
                                                                        checked={selectedIds.has(item.name)}
                                                                        onCheckedChange={() => handleToggleItem(item.name)}
                                                                        className="data-[state=checked]:bg-red-600 data-[state=checked]:border-red-600"
                                                                    />
                                                                </td>
                                                                <td className="p-3 text-gray-700">{item.tds_category || '-'}</td>
                                                                <td className="p-3 text-gray-900 font-medium">{item.tds_item_name || '-'}</td>
                                                                <td className="p-3 text-gray-700">{item.tds_make || '-'}</td>
                                                                <td className="p-3 text-gray-700">{item.tds_boq_line_item || '-'}</td>
                                                                <td className="p-3">
                                                                    {item.tds_attachment ? (
                                                                        <a
                                                                            href={item.tds_attachment}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                            onClick={(e) => e.stopPropagation()}
                                                                            className="text-gray-500 hover:text-red-600"
                                                                            aria-label="Open the attached datasheet"
                                                                        >
                                                                            <ExternalLink className="w-4 h-4" />
                                                                        </a>
                                                                    ) : (
                                                                        <span className="text-gray-300">-</span>
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </React.Fragment>
                                                ))}
                                            </React.Fragment>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>

                <DialogFooter className="flex-shrink-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-4 pt-4 border-t">
                    <p className="text-xs text-amber-800 sm:mr-auto" data-testid="pdf-preview-note">
                        {previewOnly ? "Pending is ticked, so you can preview this PDF but only an Admin can download it." : ""}
                    </p>
                    <div className="flex justify-end gap-3">
                        <Button
                            variant="outline"
                            onClick={onClose}
                            disabled={isExporting || isSaving}
                        >
                            <Ban className="w-4 h-4 mr-2" />
                            Cancel
                        </Button>
                        {/* A caller that offers Save selection (Handover, where it reads "Mark as Done") makes IT
                            the primary action: saving the ticks is the review that makes the document Done, and
                            the PDF is a utility beside it. Without it (the TDS page) the PDF button is primary. */}
                        <Button
                            onClick={handleExport}
                            disabled={tickedRows.length === 0 || isExporting}
                            variant={onSaveSelection ? "outline" : "default"}
                            className={cn(
                                !onSaveSelection && "bg-red-600 hover:bg-red-700 text-white",
                            )}
                        >
                            {isExporting ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    {previewOnly ? "Preparing..." : "Exporting..."}
                                </>
                            ) : previewOnly ? (
                                <>
                                    <Eye className="w-4 h-4 mr-2" />
                                    Preview PDF ({tickedRows.length})
                                </>
                            ) : (
                                <>
                                    <FileDown className="w-4 h-4 mr-2" />
                                    Download PDF ({tickedRows.length})
                                </>
                            )}
                        </Button>
                        {onSaveSelection && (
                            <Button
                                onClick={handleSaveSelection}
                                disabled={tickedRows.length === 0 || isExporting || isSaving}
                                className="bg-red-600 hover:bg-red-700 text-white"
                                title={
                                    tickedRows.length === 0
                                        ? "Tick at least one data sheet first"
                                        : "Save these ticks and mark this document Done"
                                }
                            >
                                {isSaving ? (
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                ) : (
                                    <Check className="w-4 h-4 mr-2" />
                                )}
                                Mark as Done
                            </Button>
                        )}
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
