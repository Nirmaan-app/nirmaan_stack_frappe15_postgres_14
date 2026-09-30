// HOD Tracker: every project that has started a handover, one card each.
//
// A card opens that project's own detail page, `/hod-tracker/:projectId` -- the Design Tracker's shape,
// not a redirect into the Project page. That detail mounts the very same `HandoverDocumentsTab` the
// project page mounts, so nothing about HOD is duplicated: two screens that both answer "how far has
// this handover got" is exactly how they end up disagreeing.
//
// The numbers come from `api/hod/tracker.get_hod_trackers`, a single GROUP BY, and are the SAME ones
// the tab shows (`services/hod/checklist.counts`): `needed` is the switched-on documents and
// `completed` the YES count among them. NA rows stay IN the denominator, as they do on the tab.

import { useFrappeGetCall } from "frappe-react-sdk";
import { ArrowUpRight, CheckCircle2, Search } from "lucide-react";
import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { ProjectStatusBadge } from "@/components/common/ProjectStatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ProgressCircle } from "@/components/ui/ProgressCircle";

interface HodTrackerSystem {
  hod_system: string;
  label: string;
  work_package: string | null;
  completed: number;
  no: number;
  na: number;
  off: number;
  needed: number;
}

interface HodTrackerProject {
  project: string;
  project_name: string;
  status_of_project: string;
  systems: HodTrackerSystem[];
  completed: number;
  needed: number;
  na: number;
  last_activity: string | null;
}

const pct = (completed: number, needed: number): number =>
  needed > 0 ? Math.round((completed / needed) * 100) : 0;

/** Red under 26%, amber to 75%, green above -- the Design Tracker card's ladder, so the two trackers
 *  read the same way at a glance. */
const progressColor = (value: number): string => {
  if (value >= 76) return "text-green-600";
  if (value >= 26) return "text-yellow-500";
  return "text-red-600";
};

const SystemRow: React.FC<{ system: HodTrackerSystem }> = ({ system }) => {
  const value = pct(system.completed, system.needed);
  const done = system.needed > 0 && system.completed === system.needed;
  return (
    <div className="flex items-center gap-2">
      <span
        className="flex-1 truncate text-[11px] font-medium text-gray-700"
        title={system.label}
      >
        {system.label}
      </span>
      <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-gray-200">
        <div
          className={`h-full rounded-full ${done ? "bg-green-500" : "bg-primary/70"}`}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="w-12 shrink-0 text-right text-[11px] font-bold tabular-nums text-gray-600">
        {system.completed}/{system.needed}
      </span>
      {done ? (
        <CheckCircle2 className="h-3 w-3 shrink-0 text-green-500" />
      ) : (
        <span className="h-3 w-3 shrink-0" />
      )}
    </div>
  );
};

const HodTrackerCard: React.FC<{
  tracker: HodTrackerProject;
  onClick: () => void;
}> = ({ tracker, onClick }) => {
  const value = pct(tracker.completed, tracker.needed);
  return (
    <Card
      className="group flex h-full cursor-pointer flex-col border border-gray-200 bg-white transition-all duration-200 hover:border-primary/40 hover:shadow-md"
      onClick={onClick}
    >
      <CardHeader className="space-y-0 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-1 flex-wrap items-center gap-1.5">
            <CardTitle
              className="line-clamp-2 text-base font-semibold leading-snug text-gray-900"
              title={tracker.project_name}
            >
              {tracker.project_name}
            </CardTitle>
            <ProjectStatusBadge status={tracker.status_of_project} />
          </div>
          <ProgressCircle
            value={value}
            className={`size-12 flex-shrink-0 ${progressColor(value)}`}
            textSizeClassName="text-[10px]"
          />
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col justify-between pb-4 pt-0">
        <div className="space-y-1.5">
          {tracker.systems.map((s) => (
            <SystemRow key={s.hod_system} system={s} />
          ))}
        </div>

        <div className="mt-3 border-t border-gray-100 pt-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-gray-500">
              {tracker.systems.length}{" "}
              {tracker.systems.length === 1 ? "system" : "systems"}
              {tracker.na > 0 ? ` · ${tracker.na} NA` : ""}
            </span>
            <div className="flex items-center gap-1 text-xs font-medium text-primary">
              <span>View Details</span>
              <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export const HodTrackerList: React.FC = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const { data, isLoading, error } = useFrappeGetCall<{
    message: HodTrackerProject[];
  }>("nirmaan_stack.api.hod.tracker.get_hod_trackers", {}, "hod-tracker-list");

  const trackers = useMemo<HodTrackerProject[]>(
    () => (Array.isArray(data?.message) ? data!.message : []),
    [data],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return trackers;
    return trackers.filter(
      (t) =>
        t.project_name.toLowerCase().includes(term) ||
        t.project.toLowerCase().includes(term) ||
        t.systems.some((s) => s.label.toLowerCase().includes(term)),
    );
  }, [trackers, search]);

  if (isLoading) return <LoadingFallback />;
  if (error) return <AlertDestructive error={error} />;

  return (
    <div className="flex-1 space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold tracking-tight">
          HOD Tracker
          <span className="ml-2 text-sm font-normal text-gray-500">
            {filtered.length} {filtered.length === 1 ? "project" : "projects"}
          </span>
        </h2>
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            className="pl-8"
            placeholder="Search by project or system..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-md border border-dashed border-gray-300 py-16 text-center">
          <p className="text-sm text-gray-500">
            {trackers.length === 0
              ? "No project has started a handover yet."
              : "No project matches this search."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((t) => (
            <HodTrackerCard
              key={t.project}
              tracker={t}
              onClick={() => navigate(`/hod-tracker/${t.project}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default HodTrackerList;
