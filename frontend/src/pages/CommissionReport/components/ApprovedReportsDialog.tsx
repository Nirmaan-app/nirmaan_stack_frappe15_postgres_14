// Dialog opened from the "Bulk Approved Reports" header button on the tracker details page.
// Lists the Submitted (approved, awaiting client-signature) Field reports, lets the user pick
// any subset, and exports them as ONE merged PDF.
//
// The export is a background operation (ADR 0047, #1664): Export starts
// nirmaan_stack.api.commission_report.bulk_download_reports.start_commission_reports, which renders + merges on
// the `long` queue; the shared hook follows the operation's own status record (so another export's file never
// reaches this dialog, and a dropped socket or a reload still ends in the file) and the PDF is collected by
// operation id, which only the user who started it can do.
// (Vendor reports and non-Submitted tasks are intentionally out of scope.)

import React, { useMemo, useState } from 'react';
import { Loader2, Download } from 'lucide-react';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from '@/components/ui/use-toast';
import { collectResultFile, useBackgroundOperation } from '@/hooks/useBackgroundOperation';
import { parseResultFile } from '@/utils/backgroundOps/operationFollower';
import { commissionExportOf, commissionExportOutcome } from '@/utils/commissionBulkExport';
import { saveUrlAs } from '@/utils/saveUrlAs';

import type { CommissionReportTask } from '../types';
import { masterMapKey, type MasterTaskInfo } from './FillReportButton';

const START_METHOD = 'nirmaan_stack.api.commission_report.bulk_download_reports.start_commission_reports';

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    trackerId: string;
    projectName?: string;
    /** Submitted + Field reports available to export (already scoped by the page). */
    reports: CommissionReportTask[];
    masterMap: Map<string, MasterTaskInfo>;
}

export const ApprovedReportsDialog: React.FC<Props> = ({
    open, onOpenChange, trackerId, reports, masterMap,
}) => {
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [categoryFilter, setCategoryFilter] = useState<string>('all');

    const op = useBackgroundOperation({
        storageKey: `commission_bulk:${trackerId}`,
        onFinished: async (result, _context, opId) => {
            try {
                const blobUrl = window.URL.createObjectURL(await collectResultFile(opId));
                saveUrlAs(blobUrl, parseResultFile(result)?.filename ?? 'Commission_Reports.pdf');
                window.URL.revokeObjectURL(blobUrl);
            } catch (e) {
                toast({ title: 'Failed', description: e instanceof Error ? e.message : 'Could not download the PDF.', variant: 'destructive' });
                op.reset();
                return;
            }
            toast(commissionExportOutcome(result));
            op.reset();
            onOpenChange(false);
        },
        onFailed: (ended) => {
            toast({ title: 'Failed', description: ended.error, variant: 'destructive' });
            op.reset();
        },
    });
    const { exporting, queued, progress } = commissionExportOf(op.view);

    // Fresh selection each time the dialog opens (an export in flight keeps going).
    React.useEffect(() => {
        if (open) {
            setSelected(new Set());
            setCategoryFilter('all');
        }
    }, [open]);

    // Distinct categories present (for the filter chips), with counts.
    const categories = useMemo(() => {
        const counts = new Map<string, number>();
        for (const r of reports) counts.set(r.commission_category, (counts.get(r.commission_category) || 0) + 1);
        return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    }, [reports]);

    const visibleReports = categoryFilter === 'all'
        ? reports
        : reports.filter((r) => r.commission_category === categoryFilter);

    // Select-all is scoped to the CURRENT filter view; selection itself persists across filters
    // (by report name), so Export always sends every ticked report whatever category chip is active.
    const allVisibleSelected = visibleReports.length > 0 && visibleReports.every((r) => selected.has(r.name));

    const toggle = (name: string) =>
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(name)) next.delete(name);
            else next.add(name);
            return next;
        });

    const toggleAllVisible = () =>
        setSelected((prev) => {
            const next = new Set(prev);
            if (allVisibleSelected) visibleReports.forEach((r) => next.delete(r.name));
            else visibleReports.forEach((r) => next.add(r.name));
            return next;
        });

    const handleExport = async () => {
        if (selected.size === 0 || exporting) return;
        // The server re-gates the selection and reports the authoritative total once it starts.
        const tasks = reports
            .filter((r) => selected.has(r.name))
            .map((r) => {
                const info = masterMap.get(masterMapKey(r.commission_category, r.task_name));
                return { name: r.name, landscape: !!info?.isLandscape };
            });
        await op.start(START_METHOD, { tracker: trackerId, tasks });
    };

    // Block closing while an export is in flight, so its outcome shows here.
    const handleOpenChange = (o: boolean) => {
        if (!o && exporting) return;
        onOpenChange(o);
    };

    const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Approved Reports</DialogTitle>
                </DialogHeader>

                {reports.length === 0 ? (
                    <div className="py-10 text-center text-sm text-gray-500">
                        No approved reports yet. A report appears here once its Field task is{' '}
                        <span className="font-medium text-gray-700">Submitted</span> (approved, awaiting client signature).
                    </div>
                ) : (
                    <div className="space-y-2">
                        {/* Category filter chips (mirrors the reference dialog's package filters) */}
                        {categories.length > 1 && (
                            <div className="flex items-start gap-2">
                                <span className="shrink-0 pt-0.5 text-[11px] font-medium text-gray-500">Category:</span>
                                <div className="flex flex-wrap items-center gap-1.5">
                                <button
                                    type="button"
                                    onClick={() => setCategoryFilter('all')}
                                    disabled={exporting}
                                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap transition-colors cursor-pointer ${categoryFilter === 'all' ? 'bg-red-600 text-white border-red-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
                                >
                                    All ({reports.length})
                                </button>
                                {categories.map(([cat, n]) => (
                                    <button
                                        key={cat}
                                        type="button"
                                        onClick={() => setCategoryFilter(cat)}
                                        disabled={exporting}
                                        className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap transition-colors cursor-pointer ${categoryFilter === cat ? 'bg-red-600 text-white border-red-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
                                    >
                                        {cat} ({n})
                                    </button>
                                ))}
                                </div>
                            </div>
                        )}

                        <div className="flex items-center justify-between gap-2 px-1 pb-2 border-b">
                            <span className="text-[11px] text-gray-400">
                                Admin-approved (Submitted) reports only
                            </span>
                            <label htmlFor="approved-all" className="flex items-center gap-2 text-xs font-medium text-gray-600 cursor-pointer">
                                Select all ({visibleReports.length})
                                <Checkbox id="approved-all" checked={allVisibleSelected} onCheckedChange={toggleAllVisible} disabled={exporting} />
                            </label>
                        </div>
                        <div className="max-h-[50vh] overflow-y-auto pr-1 space-y-1">
                            {visibleReports.map((r) => (
                                <label
                                    key={r.name}
                                    className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-gray-50 cursor-pointer"
                                >
                                    <Checkbox
                                        checked={selected.has(r.name)}
                                        onCheckedChange={() => toggle(r.name)}
                                        disabled={exporting}
                                    />
                                    <div className="min-w-0">
                                        <div className="text-sm font-medium truncate">{r.task_name}</div>
                                        <div className="text-[11px] text-gray-500 truncate">{r.commission_category}</div>
                                    </div>
                                </label>
                            ))}
                        </div>
                    </div>
                )}

                {queued && (
                    <div className="px-1 pt-1 text-[11px] text-gray-500">Waiting in the queue… it starts on its own.</div>
                )}
                {exporting && progress && (
                    <div className="px-1 pt-1">
                        <div className="flex justify-between text-[11px] text-gray-500 mb-1">
                            <span>Preparing your PDF…</span>
                            <span className="tabular-nums">{progress.done} / {progress.total}</span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
                            <div className="h-full bg-blue-600 transition-all duration-300" style={{ width: `${pct}%` }} />
                        </div>
                    </div>
                )}

                <DialogFooter>
                    <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={exporting}>
                        Cancel
                    </Button>
                    <Button size="sm" className="gap-1" onClick={handleExport} disabled={selected.size === 0 || exporting}>
                        {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                        {queued ? 'Queued…' : exporting ? 'Preparing…' : `Export${selected.size > 0 ? ` (${selected.size})` : ''}`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
