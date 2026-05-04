import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { toast } from '@/components/ui/use-toast';
import { useUserData } from '@/hooks/useUserData';
import { cn } from '@/lib/utils';
import { formatDate, formatToLocalDateTimeString } from '@/utils/FormatDate';
import { TailSpin } from 'react-loader-spinner';
import {
  CalendarCheck2,
  CalendarDays,
  CalendarPlus,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  Info,
  Loader2,
  Pencil,
} from 'lucide-react';
import { unparse } from 'papaparse';
import { useFrappeUpdateDoc } from 'frappe-react-sdk';
import {
  NUM_WEEK_SLOTS,
  SchedulerHeaderGroup,
  SchedulerMilestoneRow,
  useProjectScheduler,
} from '../hooks/useProjectScheduler';

const toInputDate = (d: Date): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const startOfUtcDay = (d: Date) =>
  Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
const daysBetweenUTC = (from: Date, to: Date) =>
  Math.floor((startOfUtcDay(to) - startOfUtcDay(from)) / (1000 * 60 * 60 * 24));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Mirrors useTargetProgress: same anchor math + linear interpolation between
// adjacent weekly anchors. Keeps Scheduler and Milestones Summary in sync.
const interpolatedProgress = (
  m: SchedulerMilestoneRow,
  date: Date,
  projectStart: Date,
  totalDays: number,
): { value: number; bucket: number } => {
  if (totalDays <= 0) return { value: 0, bucket: -1 };
  const k = totalDays / 63;
  const anchorDays = Array.from({ length: 10 }, (_, i) => i * 7 * k);
  const elapsedDays = clamp(daysBetweenUTC(projectStart, date), 0, totalDays);

  let bucket = NUM_WEEK_SLOTS - 1;
  for (let i = 0; i < NUM_WEEK_SLOTS; i++) {
    if (elapsedDays <= anchorDays[i + 1]) {
      bucket = i;
      break;
    }
  }
  const anchorLow = anchorDays[bucket];
  const anchorHigh = anchorDays[bucket + 1];
  const span = anchorHigh - anchorLow;
  const frac = span > 0 ? (elapsedDays - anchorLow) / span : 0;

  // bucket 0 spans week_0(=0) → week_1, bucket 1 spans week_1 → week_2, etc.
  const lowerW = bucket === 0 ? 0 : m.weeks[bucket - 1] ?? 0;
  const upperW = m.weeks[bucket] ?? 0;
  const value = clamp(lowerW + (upperW - lowerW) * frac, 0, 100);
  return { value, bucket };
};

interface ProjectSchedulerProps {
  projectId: string | null | undefined;
  className?: string;
}

const HEADER_PALETTE = [
  'bg-sky-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-violet-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-lime-500',
  'bg-orange-500',
  'bg-fuchsia-500',
];

const colorForHeader = (idx: number) => HEADER_PALETTE[idx % HEADER_PALETTE.length];

export const ProjectScheduler: React.FC<ProjectSchedulerProps> = ({ projectId, className }) => {
  const {
    projectData,
    projectStartDate,
    projectEndDate,
    projectDurationDays,
    weekSlotDays,
    weekSlotBoundaries,
    groups,
    isLoading,
    error,
    mutateProject,
  } = useProjectScheduler(projectId);

  const { role, user_id } = useUserData();
  const canEditDates = user_id === 'Administrator' || role === 'Nirmaan Admin Profile';

  const { updateDoc, loading: savingDates } = useFrappeUpdateDoc();

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [editOpen, setEditOpen] = useState(false);
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  useEffect(() => {
    if (editOpen && projectStartDate && projectEndDate) {
      setEditStart(toInputDate(projectStartDate));
      setEditEnd(toInputDate(projectEndDate));
    }
  }, [editOpen, projectStartDate, projectEndDate]);

  const handleSaveDates = useCallback(async () => {
    if (!projectId || !editStart || !editEnd) return;
    const start = new Date(editStart);
    const end = new Date(editEnd);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      toast({ title: 'Invalid date', variant: 'destructive' });
      return;
    }
    if (end < start) {
      toast({
        title: 'End date must be on or after start date',
        variant: 'destructive',
      });
      return;
    }
    try {
      await updateDoc('Projects', projectId, {
        project_start_date: formatToLocalDateTimeString(start),
        project_end_date: formatToLocalDateTimeString(end),
      });
      await mutateProject();
      toast({
        title: 'Project dates updated',
        description: `${formatDate(start)} → ${formatDate(end)}`,
        variant: 'success',
      });
      setEditOpen(false);
    } catch (e: any) {
      toast({
        title: 'Failed to update dates',
        description: e?.message || 'Please try again.',
        variant: 'destructive',
      });
    }
  }, [projectId, editStart, editEnd, updateDoc, mutateProject]);

  const toggleHeader = (header: string) =>
    setExpanded((p) => ({ ...p, [header]: !(p[header] ?? true) }));
  const isOpen = (header: string) => expanded[header] ?? true;

  const totalMilestones = useMemo(
    () => groups.reduce((sum, g) => sum + g.milestones.length, 0),
    [groups],
  );

  const selectedDateObj = useMemo(
    () => (selectedDate ? new Date(selectedDate) : null),
    [selectedDate],
  );

  // Bucket ("falls in Wn") matches useTargetProgress: pick first i where
  // elapsed ≤ anchorDays[i+1].
  const selectedBucketIdx = useMemo(() => {
    if (!selectedDateObj || !projectStartDate || projectDurationDays <= 0) return -1;
    const k = projectDurationDays / 63;
    const anchorDays = Array.from({ length: 10 }, (_, i) => i * 7 * k);
    const elapsedDays = clamp(
      daysBetweenUTC(projectStartDate, selectedDateObj),
      0,
      projectDurationDays,
    );
    for (let i = 0; i < NUM_WEEK_SLOTS; i++) {
      if (elapsedDays <= anchorDays[i + 1]) return i;
    }
    return NUM_WEEK_SLOTS - 1;
  }, [selectedDateObj, projectStartDate, projectDurationDays]);

  const markerLeftPct = useMemo(() => {
    if (!selectedDateObj || !projectStartDate || projectDurationDays <= 0) return null;
    const elapsedDays = daysBetweenUTC(projectStartDate, selectedDateObj);
    const pct = (elapsedDays / projectDurationDays) * 100;
    if (pct < 0 || pct > 100) return null;
    return pct;
  }, [selectedDateObj, projectStartDate, projectDurationDays]);

  const handleDownloadPdf = useCallback(async () => {
    if (!projectId || !projectStartDate || !projectEndDate) return;
    setDownloadingPdf(true);
    try {
      const dayMs = 1000 * 60 * 60 * 24;
      const payload = {
        groups: groups.map((g) => ({
          header: g.header,
          earliest_start: g.earliestStart ? toInputDate(g.earliestStart) : null,
          latest_end: g.latestEnd ? toInputDate(g.latestEnd) : null,
          duration_days:
            g.earliestStart && g.latestEnd
              ? Math.round((g.latestEnd.getTime() - g.earliestStart.getTime()) / dayMs) + 1
              : null,
          milestones: g.milestones.map((m) => ({
            name: m.work_milestone_name,
            start_date: m.startDate ? toInputDate(m.startDate) : null,
            end_date: m.endDate ? toInputDate(m.endDate) : null,
            duration_days: m.firstWeekIdx !== -1 ? m.durationDays : null,
          })),
        })),
      };

      const res = await fetch(
        '/api/method/nirmaan_stack.api.milestone.print_dpr_target.print_dpr_target_pdf',
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Frappe-CSRF-Token': (window as any).csrf_token || '',
          },
          body: new URLSearchParams({
            project_id: projectId,
            payload: JSON.stringify(payload),
          }).toString(),
        },
      );

      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const safeName = (projectData?.project_name || projectId).replace(/[^a-z0-9]+/gi, '_');
      link.href = url;
      link.download = `${safeName}_DPR_Project_Target.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({
        title: 'Download Complete',
        description: 'DPR Project Target PDF saved.',
        variant: 'success',
      });
    } catch (e: any) {
      toast({
        title: 'Failed to download PDF',
        description: e?.message || 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setDownloadingPdf(false);
    }
  }, [projectId, projectStartDate, projectEndDate, groups, projectData]);

  // const handleExportCsv = useCallback(() => {
  //   if (!projectStartDate || !projectEndDate) return;
  //
  //   const rows: (string | number)[][] = [];
  //   const projectLabel =
  //     projectData?.project_name || projectData?.name || projectId || 'Project';
  //
  //   // 4-column layout: titles start in column 1.
  //   rows.push([`Project: ${projectLabel}`, '', '', '']);
  //   rows.push(['Start Date', formatDate(projectStartDate), '', '']);
  //   rows.push(['End Date', formatDate(projectEndDate), '', '']);
  //   rows.push(['Duration', `${projectDurationDays} days`, '', '']);
  //   rows.push(['', '', '', '']);
  //
  //   groups.forEach((group) => {
  //     const headerRange =
  //       group.earliestStart && group.latestEnd
  //         ? ` (${formatDate(group.earliestStart)} - ${formatDate(group.latestEnd)})`
  //         : '';
  //     rows.push([`${group.header}${headerRange}`, '', '', '']);
  //     rows.push(['Milestone', 'Start', 'End', 'Duration (Days)']);
  //     if (group.milestones.length === 0) {
  //       rows.push(['(No milestones)', '', '', '']);
  //     } else {
  //       group.milestones.forEach((m) => {
  //         rows.push([
  //           m.work_milestone_name,
  //           m.startDate ? formatDate(m.startDate) : '',
  //           m.endDate ? formatDate(m.endDate) : '',
  //           m.firstWeekIdx !== -1 ? m.durationDays : '',
  //         ]);
  //       });
  //     }
  //     rows.push(['', '', '', '']);
  //   });
  //
  //   const csv = unparse(rows);
  //   const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  //   const url = URL.createObjectURL(blob);
  //   const link = document.createElement('a');
  //   const safeName = String(projectLabel).replace(/[^a-z0-9]+/gi, '_');
  //   link.href = url;
  //   link.setAttribute('download', `${safeName}_scheduler.csv`);
  //   document.body.appendChild(link);
  //   link.click();
  //   document.body.removeChild(link);
  //   URL.revokeObjectURL(url);
  // }, [projectData, projectId, projectStartDate, projectEndDate, projectDurationDays, groups]);

  const completionStats = useMemo(() => {
    if (!selectedDateObj || !projectStartDate || projectDurationDays <= 0) return null;
    let completed = 0;
    let scheduled = 0;
    groups.forEach((g) => {
      g.milestones.forEach((m) => {
        if (m.firstWeekIdx === -1) return;
        scheduled += 1;
        const { value } = interpolatedProgress(
          m,
          selectedDateObj,
          projectStartDate,
          projectDurationDays,
        );
        if (value >= 100) completed += 1;
      });
    });
    return { completed, scheduled };
  }, [groups, selectedDateObj, projectStartDate, projectDurationDays]);

  if (!projectId) return null;

  if (isLoading) {
    return (
      <Card className={className}>
        <CardContent className="flex items-center justify-center h-40">
          <TailSpin color="#dc2626" height={36} width={36} />
        </CardContent>
      </Card>
    );
  }

  if (error || !projectData) {
    return (
      <Card className={className}>
        <CardContent className="py-6 text-sm text-red-600">
          Failed to load project scheduler.
        </CardContent>
      </Card>
    );
  }

  if (!projectStartDate || !projectEndDate || projectDurationDays <= 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="text-lg">Project Scheduler</CardTitle>
        </CardHeader>
        <CardContent className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-3">
          <Info className="w-4 h-4 mt-0.5" />
          <span>
            Project Start Date and End Date must be set on this project to render the scheduler.
          </span>
        </CardContent>
      </Card>
    );
  }

  const totalWeeks = Math.max(1, Math.ceil(projectDurationDays / 7));

  return (
    <TooltipProvider delayDuration={120}>
      <Card className={cn('min-w-0 overflow-hidden', className)}>
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <CalendarDays className="w-5 h-5 text-red-600 shrink-0" />
              <span className="text-lg truncate">Project Scheduler</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="font-normal">
                {groups.length} headers · {totalMilestones} milestones
              </Badge>
              {/* EDIT DATES button moved into the date cards as a small pencil icon */}
              {/* EXPORT CSV — hidden for now
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportCsv}
                disabled={groups.length === 0}
                className="h-8"
              >
                <Download className="w-3.5 h-3.5 sm:mr-1.5" />
                <span className="hidden sm:inline">Export CSV</span>
              </Button>
              */}
              <Button
                size="sm"
                onClick={handleDownloadPdf}
                disabled={downloadingPdf || groups.length === 0}
                title="Download PDF"
                aria-label="Download PDF"
                className="h-8 bg-red-600 hover:bg-red-700 text-white"
              >
                {downloadingPdf ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1 sm:mr-1.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5 mr-1 sm:mr-1.5" />
                )}
                <span className="sm:hidden">PDF</span>
                <span className="hidden sm:inline">Download PDF</span>
              </Button>
            </div>
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <SummaryStat
              label="Project Start Date"
              value={formatDate(projectStartDate)}
              icon={<CalendarPlus className="w-4 h-4" />}
              accent="from-sky-50 to-white border-sky-200"
              iconBg="bg-sky-100 text-sky-700"
              onEdit={canEditDates ? () => setEditOpen(true) : undefined}
            />
            <SummaryStat
              label="Project End Date"
              value={formatDate(projectEndDate)}
              icon={<CalendarCheck2 className="w-4 h-4" />}
              accent="from-rose-50 to-white border-rose-200"
              iconBg="bg-rose-100 text-rose-700"
              onEdit={canEditDates ? () => setEditOpen(true) : undefined}
            />
            <SummaryStat
              label="Duration"
              value={`${projectDurationDays} days`}
              hint={`~${totalWeeks} weeks`}
              icon={<Clock className="w-4 h-4" />}
              accent="from-emerald-50 to-white border-emerald-200"
              iconBg="bg-emerald-100 text-emerald-700"
            />
          </div>

          {/* <div className="flex flex-col md:flex-row md:items-center gap-3 bg-blue-50/40 border border-blue-100 rounded-md px-3 py-2">
          <label className="text-xs font-medium text-gray-700 flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-blue-600" />
            Check status as of:
          </label>
          <input
            type="date"
            value={selectedDate}
            min={toInputDate(projectStartDate)}
            max={toInputDate(projectEndDate)}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="border rounded-md px-2 py-1 text-sm bg-white"
          />
          {selectedDate && (
            <button
              type="button"
              onClick={() => setSelectedDate('')}
              className="text-xs text-gray-500 hover:text-gray-800 underline"
            >
              Clear
            </button>
          )}
          {selectedBucketIdx >= 0 && completionStats && (
            <div className="md:ml-auto text-xs flex items-center gap-2">
              <Badge className="bg-green-100 text-green-800 hover:bg-green-200 border-green-200">
                {completionStats.completed} / {completionStats.scheduled} milestones at 100%
              </Badge>
              <span className="text-gray-500">
                falls in <span className="font-medium text-gray-700">Slot {selectedBucketIdx + 1}</span>
              </span>
            </div>
          )}
        </div> */}

          <div className="border rounded-lg overflow-hidden md:overflow-x-auto">
            <div className="hidden md:grid grid-cols-[minmax(260px,1fr)_140px_140px_110px] bg-gray-50 border-b text-[11px] font-medium text-gray-600 uppercase tracking-wide">
              <div className="px-3 py-2">Work Header / Milestone</div>
              <div className="px-3 py-2 hidden md:block">Start Date</div>
              <div className="px-3 py-2 hidden md:block">End Date</div>
              <div className="px-3 py-2 hidden md:block">Duration</div>
              {/* SLOT HEADER — hidden for now
            <div className="grid border-l" style={{ gridTemplateColumns: `repeat(${NUM_WEEK_SLOTS}, minmax(0, 1fr))` }}>
              {Array.from({ length: NUM_WEEK_SLOTS }, (_, i) => {
                const slotStart = weekSlotBoundaries[i];
                const nextBoundary = weekSlotBoundaries[i + 1];
                const slotEnd =
                  nextBoundary
                    ? new Date(nextBoundary.getTime() - 24 * 60 * 60 * 1000)
                    : null;
                return (
                  <div
                    key={i}
                    className={cn(
                      'px-1 py-2 text-center border-r last:border-r-0 text-gray-600',
                    )}
                    title={
                      slotStart && slotEnd
                        ? `${formatDate(slotStart)} → ${formatDate(slotEnd)}`
                        : undefined
                    }
                  >
                    <div>Slot {i + 1}</div>
                    <div className="text-[10px] font-normal text-gray-400 normal-case tracking-normal leading-tight">
                      {slotStart ? formatDate(slotStart) : ''}
                    </div>
                    <div className="text-[10px] font-normal text-gray-400 normal-case tracking-normal leading-tight">
                      {slotEnd ? `to ${formatDate(slotEnd)}` : ''}
                    </div>
                  </div>
                );
              })}
            </div>
            */}
            </div>

            {groups.length === 0 ? (
              <div className="p-6 text-sm text-gray-500 text-center">
                No work headers enabled for this project.
              </div>
            ) : (
              <div className="divide-y">
                {groups.map((group, gIdx) => (
                  <SchedulerGroupRow
                    key={group.header}
                    group={group}
                    open={isOpen(group.header)}
                    onToggle={() => toggleHeader(group.header)}
                    barColor={colorForHeader(gIdx)}
                    selectedDateObj={selectedDateObj}
                    projectStartDate={projectStartDate}
                    projectDurationDays={projectDurationDays}
                    markerLeftPct={markerLeftPct}
                  />
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Project Dates</DialogTitle>
            <DialogDescription className="text-xs">
              Updates the project's Start Date and End Date. All milestone timeline
              calculations will recompute against the new range.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-700">Start Date</label>
              <Input
                type="date"
                value={editStart}
                max={editEnd || undefined}
                onChange={(e) => setEditStart(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-700">End Date</label>
              <Input
                type="date"
                value={editEnd}
                min={editStart || undefined}
                onChange={(e) => setEditEnd(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={savingDates}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveDates}
              disabled={savingDates || !editStart || !editEnd}
            >
              {savingDates ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
};

interface SummaryStatProps {
  label: string;
  value: string;
  hint?: string;
  icon?: React.ReactNode;
  accent?: string;
  iconBg?: string;
  onEdit?: () => void;
}

const SummaryStat: React.FC<SummaryStatProps> = ({
  label,
  value,
  hint,
  icon,
  accent = 'from-gray-50 to-white border-gray-200',
  iconBg = 'bg-gray-100 text-gray-700',
  onEdit,
}) => (
  <div
    className={cn(
      'relative flex items-center gap-2.5 rounded-lg border bg-gradient-to-br px-3 py-1.5 shadow-sm',
      accent,
    )}
  >
    {icon && (
      <div className={cn('flex items-center justify-center w-7 h-7 rounded-md shrink-0', iconBg)}>
        {icon}
      </div>
    )}
    <div className="min-w-0 flex-1">
      <div className="text-[9px] uppercase tracking-wider text-gray-500 font-medium leading-tight">
        {label}
      </div>
      <div className="text-sm font-bold text-gray-900 leading-tight truncate">{value}</div>
      {hint && <div className="text-[10px] text-gray-500 leading-tight">{hint}</div>}
    </div>
    {onEdit && (
      <button
        type="button"
        onClick={onEdit}
        className="absolute top-1 right-1 p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-white/70"
        title="Edit project dates"
        aria-label="Edit project dates"
      >
        <Pencil className="w-3 h-3" />
      </button>
    )}
  </div>
);

interface SchedulerGroupRowProps {
  group: SchedulerHeaderGroup;
  open: boolean;
  onToggle: () => void;
  barColor: string;
  selectedDateObj: Date | null;
  projectStartDate: Date | null;
  projectDurationDays: number;
  markerLeftPct: number | null;
}

const SchedulerGroupRow: React.FC<SchedulerGroupRowProps> = ({
  group,
  open,
  onToggle,
  barColor,
  selectedDateObj,
  projectStartDate,
  projectDurationDays,
  markerLeftPct,
}) => {
  const startLabel = group.earliestStart ? formatDate(group.earliestStart) : '—';
  const endLabel = group.latestEnd ? formatDate(group.latestEnd) : '—';
  const groupDurationDays =
    group.earliestStart && group.latestEnd
      ? Math.round(
        (group.latestEnd.getTime() - group.earliestStart.getTime()) /
        (1000 * 60 * 60 * 24),
      ) + 1
      : null;

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="w-full grid grid-cols-1 md:grid-cols-[minmax(260px,1fr)_140px_140px_110px] items-center bg-gray-50/60 hover:bg-gray-100 text-left"
      >
        <div className="px-3 py-2 font-semibold text-gray-800">
          <div className="flex items-center gap-2">
            {open ? (
              <ChevronDown className="w-4 h-4 text-gray-500" />
            ) : (
              <ChevronRight className="w-4 h-4 text-gray-500" />
            )}
            <span className={cn('w-2 h-2 rounded-full', barColor)} />
            <span className="truncate">{group.header}</span>
            <Badge variant="secondary" className="text-[10px] font-normal shrink-0">
              {group.milestones.length}
            </Badge>
          </div>
          <div className="md:hidden mt-1 pl-6 text-[11px] font-normal text-gray-500">
            {startLabel} → {endLabel}
            {groupDurationDays !== null && (
              <span className="ml-2 text-gray-400">· {groupDurationDays} days</span>
            )}
          </div>
        </div>
        <div className="px-3 py-2 text-xs text-gray-600 hidden md:block">{startLabel}</div>
        <div className="px-3 py-2 text-xs text-gray-600 hidden md:block">{endLabel}</div>
        <div className="px-3 py-2 text-xs text-gray-600 hidden md:block">
          {groupDurationDays !== null ? `${groupDurationDays} days` : '—'}
        </div>
        {/* HEADER WEIGHTAGE — hidden along with slot column
        <div className="px-3 py-2 text-[11px] text-gray-500 border-l">
          Header Weightage: <span className="font-medium text-gray-700">{group.weightage}</span>
        </div>
        */}
      </button>

      {open && (
        <div>
          {group.milestones.length === 0 ? (
            <div className="px-6 py-3 text-xs text-gray-500">No milestones defined.</div>
          ) : (
            group.milestones.map((m) => {
              const progress =
                selectedDateObj && projectStartDate && projectDurationDays > 0
                  ? interpolatedProgress(m, selectedDateObj, projectStartDate, projectDurationDays)
                    .value
                  : null;
              const done = progress !== null && progress >= 100;
              const rowBg =
                progress === null
                  ? ''
                  : done
                    ? 'bg-green-50/70'
                    : progress > 0
                      ? 'bg-amber-50/40'
                      : '';

              return (
                <div
                  key={m.name}
                  className={cn(
                    'grid grid-cols-1 md:grid-cols-[minmax(260px,1fr)_140px_140px_110px] items-center border-t hover:bg-gray-50/40',
                    rowBg,
                  )}
                >
                  <div className="px-3 py-2 pl-6 md:pl-9 text-sm text-gray-700">
                    <div className="flex items-center gap-2">
                      <span className="truncate">{m.work_milestone_name}</span>
                      {progress !== null && m.firstWeekIdx !== -1 && (
                        <Badge
                          className={cn(
                            'text-[10px] font-medium border shrink-0',
                            done
                              ? 'bg-green-100 text-green-800 border-green-200 hover:bg-green-200'
                              : progress > 0
                                ? 'bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-200'
                                : 'bg-gray-100 text-gray-600 border-gray-200',
                          )}
                        >
                          {done ? '✓ 100%' : `${Math.round(progress)}%`}
                        </Badge>
                      )}
                    </div>
                    {m.firstWeekIdx !== -1 && m.startDate && m.endDate && (
                      <div className="md:hidden mt-1 text-[11px] text-gray-500">
                        {formatDate(m.startDate)} → {formatDate(m.endDate)}
                        <span className="ml-2 text-gray-400">· {m.durationDays} day{m.durationDays === 1 ? '' : 's'}</span>
                      </div>
                    )}
                    {m.firstWeekIdx === -1 && (
                      <div className="md:hidden mt-1 text-[11px] italic text-gray-400">
                        Not scheduled
                      </div>
                    )}
                  </div>
                  <div className="px-3 py-2 text-xs text-gray-600 hidden md:block">
                    {m.startDate ? (
                      formatDate(m.startDate)
                    ) : (
                      <span className="italic text-gray-400">—</span>
                    )}
                  </div>
                  <div className="px-3 py-2 text-xs text-gray-600 hidden md:block">
                    {m.endDate ? (
                      formatDate(m.endDate)
                    ) : (
                      <span className="italic text-gray-400">—</span>
                    )}
                  </div>
                  <div className="px-3 py-2 text-xs text-gray-600 hidden md:block">
                    {m.firstWeekIdx !== -1
                      ? `${m.durationDays} day${m.durationDays === 1 ? '' : 's'}`
                      : '—'}
                  </div>
                  {/* SLOT BAR — hidden for now
                  <div className="border-l">
                    <SchedulerBar
                      milestone={m}
                      barColor={barColor}
                      markerLeftPct={markerLeftPct}
                      selectedDateObj={selectedDateObj}
                    />
                  </div>
                  */}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

interface SchedulerBarProps {
  milestone: SchedulerMilestoneRow;
  barColor: string;
  markerLeftPct: number | null;
  selectedDateObj: Date | null;
}

const SchedulerBar: React.FC<SchedulerBarProps> = ({
  milestone,
  barColor,
  markerLeftPct,
  selectedDateObj,
}) => {
  const { firstWeekIdx, lastWeekIdx, weeks, weightage, startDate, endDate, durationDays } =
    milestone;

  return (
    <div
      className="relative grid h-14"
      style={{ gridTemplateColumns: `repeat(${NUM_WEEK_SLOTS}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: NUM_WEEK_SLOTS }, (_, i) => (
        <div key={i} className="border-r last:border-r-0" />
      ))}

      {firstWeekIdx !== -1 &&
        weeks.map((val, i) => {
          if (val <= 0) return null;
          const prev = i > 0 ? weeks[i - 1] : 0;
          const isReached100 = val >= 100 && prev < 100;
          return (
            <Tooltip key={`tgt-${i}`}>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    'absolute top-0 -translate-x-1/2 text-[9px] font-semibold leading-tight px-1 rounded-sm border cursor-help z-20',
                    isReached100
                      ? 'bg-green-100 text-green-800 border-green-300'
                      : 'bg-white text-gray-700 border-gray-200',
                  )}
                  style={{ left: `${((i + 0.5) / NUM_WEEK_SLOTS) * 100}%` }}
                >
                  {val}%
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                <div className="font-semibold">Slot {i + 1} target</div>
                <div>Cumulative: {val}%</div>
                {prev > 0 && val > prev && (
                  <div className="text-gray-300">+{val - prev}% this slot</div>
                )}
              </TooltipContent>
            </Tooltip>
          );
        })}

      {firstWeekIdx !== -1 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={cn(
                'absolute top-5 bottom-2 rounded-md flex items-center justify-end px-2 text-[10px] font-medium text-white shadow-sm cursor-help',
                barColor,
              )}
              style={{
                left: `${(firstWeekIdx / NUM_WEEK_SLOTS) * 100}%`,
                width: `${((lastWeekIdx - firstWeekIdx + 1) / NUM_WEEK_SLOTS) * 100}%`,
              }}
            >
              {weeks[lastWeekIdx]}%
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs space-y-0.5">
            <div className="font-semibold pb-1.5 mb-1.5 border-b-2 border-white/70">
              {milestone.work_milestone_name}
            </div>
            {startDate && <div>Start: <span className="font-medium">{formatDate(startDate)}</span></div>}
            {endDate && <div>End: <span className="font-medium">{formatDate(endDate)}</span></div>}
            <div>Duration: {durationDays} day{durationDays === 1 ? '' : 's'}</div>
            <div>Weightage: {weightage}</div>
            <div>Cumulative target: {weeks[lastWeekIdx]}%</div>
          </TooltipContent>
        </Tooltip>
      )}

      {markerLeftPct !== null && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className="absolute top-0 bottom-0 w-px bg-blue-600/70 z-10 cursor-help"
              style={{ left: `${markerLeftPct}%` }}
            />
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            {selectedDateObj ? `As of ${formatDate(selectedDateObj)}` : ''}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
};

export default ProjectScheduler;
