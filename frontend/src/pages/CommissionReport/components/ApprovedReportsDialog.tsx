// Dialog opened from the "Bulk Approved Reports" header button on the tracker details page.
// Lists the Submitted (approved, awaiting client-signature) Field reports, lets the user pick
// any subset, and exports them as ONE merged PDF.
//
// ASYNC by design (does NOT block the site for other users): Export enqueues a background job
// (nirmaan_stack.api.commission_report.bulk_download_reports.enqueue_commission_reports) that
// renders + merges on the `long` queue, streams progress over Socket.IO, and hands back a
// temp-file token we download via the shared bulk_download.fetch_temp_file endpoint.
// (Vendor reports and non-Submitted tasks are intentionally out of scope.)

import React, { useContext, useMemo, useRef, useState } from 'react';
import { FrappeContext, FrappeConfig } from 'frappe-react-sdk';
import { Loader2, Download } from 'lucide-react';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from '@/components/ui/use-toast';

import type { CommissionReportTask } from '../types';
import { masterMapKey, type MasterTaskInfo } from './FillReportButton';

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    trackerId: string;
    projectName?: string;
    /** Submitted + Field reports available to export (already scoped by the page). */
    reports: CommissionReportTask[];
    masterMap: Map<string, MasterTaskInfo>;
}

// Safety net: if the job never emits a terminal event (worker died before publish),
// stop showing the spinner after this long. The server-side lock has its own TTL.
const EXPORT_TIMEOUT_MS = 5 * 60 * 1000;

export const ApprovedReportsDialog: React.FC<Props> = ({
    open, onOpenChange, trackerId, projectName, reports, masterMap,
}) => {
    const { socket } = useContext(FrappeContext) as FrappeConfig;

    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [categoryFilter, setCategoryFilter] = useState<string>('all');
    const [exporting, setExporting] = useState(false);
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // The job_id of the export THIS dialog started; events not matching it are ignored so a
    // second open dialog never reacts to our progress/ready (F4).
    const activeJobRef = useRef<string | null>(null);

    const clearSafetyTimeout = () => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
    };

    const resetRun = () => {
        clearSafetyTimeout();
        activeJobRef.current = null;
        setExporting(false);
        setProgress(null);
    };

    // Clear a pending safety timer if the dialog unmounts mid-export (F3) — otherwise it
    // fires ~5 min later and calls setState/toast on an unmounted component.
    React.useEffect(() => () => clearSafetyTimeout(), []);

    // (Re)arm the "no events at all" safety net. Re-armed on every progress tick, so a large
    // job (60, 100, … reports) that keeps reporting progress NEVER falsely times out — only a
    // genuinely stuck job (no event for EXPORT_TIMEOUT_MS) trips it.
    const armSafetyTimeout = () => {
        clearSafetyTimeout();
        timeoutRef.current = setTimeout(() => {
            toast({ title: 'Still working…', description: 'This is taking longer than expected. Please try again.', variant: 'destructive' });
            resetRun();
        }, EXPORT_TIMEOUT_MS);
    };

    const triggerDownload = (token: string, filename: string) => {
        const url = `/api/method/nirmaan_stack.api.pdf_helper.bulk_download.fetch_temp_file?token=${token}&filename=${encodeURIComponent(filename)}`;
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', filename);
        document.body.appendChild(link);
        link.click();
        link.remove();
    };

    // Fresh state each time the dialog opens.
    React.useEffect(() => {
        if (open) {
            setSelected(new Set());
            setCategoryFilter('all');
            resetRun();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // Socket listeners live while the dialog is open. The job is user-targeted server-side,
    // so we only ever receive our own events.
    React.useEffect(() => {
        if (!socket || !open) return;

        // Ignore events from an export this dialog didn't start (F4). If job_id is absent
        // (older payload), fall through and handle it.
        const isMine = (d: { job_id?: string }) => !d.job_id || d.job_id === activeJobRef.current;

        const onProgress = (d: { job_id?: string; done: number; total: number }) => {
            if (!isMine(d)) return;
            setProgress({ done: d.done, total: d.total });
            armSafetyTimeout(); // keep-alive: a progress tick means the job is running
        };

        const onReady = (d: { job_id?: string; token: string; filename: string; rendered?: number; failed?: number; total?: number }) => {
            if (!isMine(d)) return;
            triggerDownload(d.token, d.filename);
            const failed = d.failed ?? 0;
            toast(
                failed > 0
                    ? { title: 'Exported with issues', description: `${d.rendered ?? '?'} of ${d.total ?? '?'} report(s) downloaded; ${failed} could not be generated.`, variant: 'destructive' }
                    : { title: 'Exported', description: 'Your merged PDF is downloading.', variant: 'success' },
            );
            resetRun();
            onOpenChange(false);
        };

        const onFailed = (d: { job_id?: string; message?: string }) => {
            if (!isMine(d)) return;
            toast({ title: 'Failed', description: d?.message || 'Could not generate the reports.', variant: 'destructive' });
            resetRun();
        };

        socket.on('commission_bulk_progress', onProgress);
        socket.on('commission_bulk_ready', onReady);
        socket.on('commission_bulk_failed', onFailed);
        return () => {
            socket.off('commission_bulk_progress', onProgress);
            socket.off('commission_bulk_ready', onReady);
            socket.off('commission_bulk_failed', onFailed);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [socket, open]);

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
        if (selected.size === 0) return;
        setExporting(true);
        // Don't seed progress with selected.size — the backend re-gates and streams the
        // authoritative total on the first tick (F5); the button shows a spinner until then.
        try {
            const tasks = reports
                .filter((r) => selected.has(r.name))
                .map((r) => {
                    const info = masterMap.get(masterMapKey(r.commission_category, r.task_name));
                    return { name: r.name, landscape: !!info?.isLandscape };
                });

            const res = await fetch(
                '/api/method/nirmaan_stack.api.commission_report.bulk_download_reports.enqueue_commission_reports',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Frappe-CSRF-Token': (window as any).csrf_token || '',
                    },
                    body: JSON.stringify({ tracker: trackerId, tasks }),
                },
            );
            if (!res.ok) {
                // Surface the server message (e.g. "already in progress", size cap).
                let msg = 'Failed to start the export.';
                try {
                    const j = await res.json();
                    if (j?._server_messages) msg = JSON.parse(JSON.parse(j._server_messages)[0]).message || msg;
                } catch { /* keep default */ }
                throw new Error(msg);
            }
            // Remember which job is ours so we only react to its events (F4).
            const j = await res.json();
            activeJobRef.current = j?.message?.job_id ?? null;
            // Enqueued: wait for the commission_bulk_* events (re-armed on each progress tick).
            armSafetyTimeout();
        } catch (e: any) {
            toast({ title: 'Error', description: e?.message || 'Failed to start the export.', variant: 'destructive' });
            resetRun();
        }
    };

    // Block closing while a job is in flight (keeps the socket listener alive for the download).
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
                            <div className="flex items-center gap-2">
                                <span className="shrink-0 text-[11px] font-medium text-gray-500">Category:</span>
                                <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
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
                        {exporting ? 'Preparing…' : `Export${selected.size > 0 ? ` (${selected.size})` : ''}`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
