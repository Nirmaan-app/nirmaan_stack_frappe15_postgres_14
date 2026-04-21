import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useFrappeGetDoc, useFrappePostCall } from "frappe-react-sdk";
import { ArrowLeft, Pencil, Check, FileText, ExternalLink, Activity, LayoutDashboard, PenTool, BarChart2, PencilRuler, Download, Loader2 } from "lucide-react";
import { ProjectDetailSkeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/use-toast";
import { format } from "date-fns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import EditTaskModal from "./components/EditTaskModal";

interface TaskItem {
  name: string;
  task_name: string;
  category: string;
  status: string;
  expected_completion_date: string | null;
  completion_date: string | null;
  attachment: string | null;
}

interface StatusOverview {
  drawing: {
    tracker_id?: string;
    total: number;
    status_counts: Record<string, number>;
    excluded_not_applicable?: number;
    is_disabled?: boolean;
  } | null;
  dpr: { last_updated: string; zone?: string } | null;
  inventory: { last_updated: string } | null;
}

const initInFlight = new Map<string, Promise<void>>();

const ensureProjectTasksInitialized = async (
  projectId: string,
  cleanupTasks: (params: { project: string }) => Promise<any>,
  initTasks: (params: { project: string }) => Promise<any>
) => {
  const existingPromise = initInFlight.get(projectId);
  if (existingPromise) {
    await existingPromise;
    return;
  }

  const initPromise = (async () => {
    await cleanupTasks({ project: projectId });
    await initTasks({ project: projectId });
  })();

  initInFlight.set(projectId, initPromise);
  try {
    await initPromise;
  } finally {
    initInFlight.delete(projectId);
  }
};

const PMOProjectDetail: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  // Fetch project info
  const { data: project, isLoading: projectLoading } = useFrappeGetDoc(
    "Projects",
    projectId || ""
  );

  // Task data
  const [tasks, setTasks] = useState<Record<string, TaskItem[]>>({});
  const [categoryOrder, setCategoryOrder] = useState<string[]>([]);
  const [tasksLoaded, setTasksLoaded] = useState(false);

  // Status overview
  const [statusOverview, setStatusOverview] = useState<StatusOverview | null>(null);

  // Edit modal state
  const [editOpen, setEditOpen] = useState(false);
  const [editTask, setEditTask] = useState<TaskItem | null>(null);

  const { call: fetchTasks } = useFrappePostCall(
    "nirmaan_stack.api.pmo_dashboard.get_project_tasks"
  );
  const { call: initTasks } = useFrappePostCall(
    "nirmaan_stack.api.pmo_dashboard.initialize_project_tasks"
  );
  const { call: cleanupTasks } = useFrappePostCall(
    "nirmaan_stack.api.pmo_dashboard.cleanup_duplicate_tasks"
  );
  const { call: fetchOverview } = useFrappePostCall(
    "nirmaan_stack.api.pmo_dashboard.get_project_status_overview"
  );

  const loadTasks = async () => {
    if (!projectId) return;
    try {
      await ensureProjectTasksInitialized(projectId, cleanupTasks, initTasks);

      // Fetch tasks
      const res: any = await fetchTasks({ project: projectId });
      const data = res?.message;
      setTasks(data?.tasks || {});
      setCategoryOrder(data?.category_order || []);
      setTasksLoaded(true);
    } catch (err) {
      console.error("Error loading tasks:", err);
      setTasksLoaded(true);
    }
  };

  const loadOverview = async () => {
    if (!projectId) return;
    try {
      const res: any = await fetchOverview({ project: projectId });
      setStatusOverview(res?.message || null);
    } catch (err) {
      console.error("Error loading overview:", err);
    }
  };

  const handleNavigateToProjectMaterialUsage = () => {
    if (!projectId) return;
    const params = new URLSearchParams({ page: "projectmaterialusage" });
    navigate(`/projects/${projectId}?${params.toString()}`);
  };

  const handleNavigateToDesignTracker = () => {
    const trackerId = statusOverview?.drawing?.tracker_id;
    if (!trackerId) return;
    navigate(`/design-tracker/${trackerId}`);
  };

  const forceDownload = async (url: string, filename: string) => {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Download failed");
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error("Force Download Error:", error);
      throw error;
    }
  };

  const handleDownloadDrawing = async () => {
    const trackerId = statusOverview?.drawing?.tracker_id;
    if (!trackerId) return;

    const params = new URLSearchParams({
      doctype: "Project Design Tracker",
      name: trackerId,
      format: "Project Design Tracker",
      no_letterhead: "0",
      _lang: "en",
      phase: "All",
    });

    const downloadUrl = `/api/method/frappe.utils.print_format.download_pdf?${params.toString()}`;
    const now = new Date();
    const dateStr = format(now, "dd_MMM_yyyy");
    const projectNameClean = (project?.project_name || "Project").replace(/[^a-zA-Z0-9-_]/g, "_");
    const filename = `${projectNameClean}-AllPhases-${dateStr}-DesignTracker.pdf`;

    try {
      toast({ title: "Generating PDF...", description: "Please wait while we generate the report." });
      await forceDownload(downloadUrl, filename);
      toast({ title: "Success", description: "Report downloaded successfully.", variant: "success" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to download PDF.", variant: "destructive" });
    }
  };

  const handleDownloadDPR = async () => {
    if (!projectId || !statusOverview?.dpr?.last_updated) return;

    const dateStr = statusOverview.dpr.last_updated;
    const pdfUrl = `/api/method/nirmaan_stack.api.milestone.print_milestone_reports.get_merged_zone_reports_pdf?` +
      `project_id=${encodeURIComponent(projectId)}&` +
      `report_date=${dateStr}`;

    const projectNameClean = (project?.project_name || "Project").replace(/[^a-zA-Z0-9-_]/g, "_");
    const dStr = format(new Date(dateStr), "dd-MMM-yyyy");
    const filename = `${projectNameClean}-All_Zones-${dStr}_DPR.pdf`;

    try {
      toast({ title: "Generating PDF...", description: "Please wait while we generate the report." });
      await forceDownload(pdfUrl, filename);
      toast({ title: "Success", description: "Report downloaded successfully.", variant: "success" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to download PDF.", variant: "destructive" });
    }
  };

  useEffect(() => {
    loadTasks();
    loadOverview();
  }, [projectId]);

  // Compute progress
  const allTasks = Object.values(tasks).flat();
  const totalTasks = allTasks.length;
  const completedTasks = allTasks.filter((t) => t.status === "Approve by client").length;
  const pendingTasks = totalTasks - completedTasks;
  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const formatDate = (d: string | null) => {
    if (!d) return "---";
    try {
      const date = new Date(d);
      return date.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    } catch {
      return d;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "Approve by client":
        return (
          <span className="inline-flex min-w-[84px] items-center justify-center gap-1 rounded-md bg-green-50 border border-green-100 px-2 py-1 text-xs font-medium text-green-600">
            <Check className="h-3 w-3" />
            Approved
          </span>
        );
      case "Sent/Submision":
        return (
          <span className="inline-flex min-w-[84px] items-center justify-center rounded-md bg-blue-50 border border-blue-100 px-2 py-1 text-xs font-bold text-blue-600">
            Submitted
          </span>
        );
      case "WIP":
        return (
          <span className="inline-flex min-w-[84px] items-center justify-center rounded-md bg-orange-50 border border-orange-100 px-2 py-1 text-xs font-bold text-orange-600">
            WIP
          </span>
        );
      default:
        return (
          <span className="inline-flex min-w-[84px] items-center justify-center rounded-md bg-gray-50 border border-gray-200 px-2 py-1 text-xs font-medium text-gray-400">
            {status || "---"}
          </span>
        );
    }
  };

  if (projectLoading || !tasksLoaded) {
    return <ProjectDetailSkeleton />;
  }

  return (
    <div className="flex-1 md:space-y-4">
      {/* Header */}
      {/* <div className="flex items-center gap-1 mb-4">
        <ArrowLeft
          className="h-5 w-5 cursor-pointer text-gray-500 hover:text-gray-700"
          onClick={() => navigate("/pmo-dashboard")}
        />
        <span className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          Back
        </span>
      </div> */}

      {/* Project Info Card */}
      <div className="mb-6 overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="px-6 py-6">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">
              {project?.project_name || projectId}
            </h1>
            {project?.status && (
              <span className="rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-medium text-green-700">
                {project.status}
              </span>
            )}
          </div>
        </div>

        {/* Progress Stats */}
        <div className="border-t border-gray-200 bg-gray-50 px-6 py-3">
          <div className="flex items-center gap-8">

            {/* Total */}
            <div className="flex items-center gap-1">
              <span className="text-[12px] font-medium text-gray-500 uppercase font-roboto">
                Total Tasks:
              </span>
              <span className="text-[16px] font-medium text-gray-900 font-roboto">
                {totalTasks}
              </span>
            </div>

            {/* Completed */}
            <div className="flex items-center gap-1">
              <span className="text-[12px] font-medium text-gray-500 uppercase font-roboto">
                Completed:
              </span>
              <span className="text-[16px] font-medium text-green-600 font-roboto">
                {completedTasks}
              </span>
            </div>

            {/* Pending */}
            <div className="flex items-center gap-1">
              <span className="text-[12px] font-medium text-gray-500 uppercase font-roboto">
                Pending:
              </span>
              <span className="text-[16px] font-medium text-red-500 font-roboto">
                {pendingTasks}
              </span>
            </div>

            {/* Progress */}
            <div className="flex items-center gap-3 ml-auto w-[40%]">
              <span className="text-[12px] font-medium text-gray-500 uppercase font-roboto">
                Progress:
              </span>

              <span className="text-[16px] font-medium text-gray-900 font-roboto">
                {progress}%
              </span>

              <div className="h-1.5 w-full rounded-full bg-gray-200">
                <div
                  className="h-full rounded-full bg-blue-500 transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* Task Overview Table */}
      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-lg font-bold text-gray-900">TASK OVERVIEW</h2>

        <div className="overflow-hidden rounded-lg border border-gray-200">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50 hover:bg-gray-50">
                <TableHead className="text-xs font-semibold uppercase text-gray-500">
                  Task Name
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase text-gray-500">
                  Status
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase text-gray-500">
                  Expected Completion
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase text-gray-500">
                  Completion Date
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase text-gray-500">
                  Attachment
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase text-gray-500 text-right">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categoryOrder.map((cat) => (
                <React.Fragment key={cat}>
                  {/* Category Header Row */}
                  <TableRow className="bg-[#fffcfc] hover:bg-[#fffcfc]">
                    <TableCell
                      colSpan={6}
                      className="pb-2 pt-4 text-xs font-bold uppercase tracking-wider text-red-500"
                    >
                      {cat}
                    </TableCell>
                  </TableRow>
                  {/* Task Rows */}
                  {(tasks[cat] || []).map((task) => {
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const expectedDate = task.expected_completion_date ? new Date(task.expected_completion_date) : null;
                    if (expectedDate) expectedDate.setHours(0, 0, 0, 0);

                    const isOverdue = expectedDate && today > expectedDate;
                    const isWarningStatus = !task.status || task.status === "Not Defined" || task.status === "WIP";
                    const showBreachWarning = isOverdue && isWarningStatus;

                    return (
                      <TableRow 
                        key={task.name} 
                        className={`
                          ${showBreachWarning ? "bg-yellow-50 hover:bg-yellow-100" : "hover:bg-white"}
                          transition-colors
                        `}
                      >
                      <TableCell className="text-sm text-gray-900">
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${task.status === "Approve by client"
                              ? "bg-green-500"
                              : task.status === "Sent/Submision"
                                ? "bg-blue-500"
                                : task.status === "WIP"
                                  ? "bg-orange-500"
                                  : "bg-gray-300"
                              }`}
                          />
                          {task.task_name}
                        </div>
                      </TableCell>
                      <TableCell>{getStatusBadge(task.status)}</TableCell>
                      <TableCell className="text-sm text-gray-600">
                        {formatDate(task.expected_completion_date)}
                      </TableCell>
                      <TableCell className="text-sm text-gray-600">
                        {formatDate(task.completion_date)}
                      </TableCell>
                      <TableCell className="text-sm text-gray-600">
                        {task.attachment ? (
                          <a
                            href={task.attachment}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600 hover:text-blue-800 flex items-center gap-1"
                          >
                            <FileText className="h-4 w-4" />
                            View
                          </a>
                        ) : (
                          "---"
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <button
                          onClick={() => {
                            setEditTask(task);
                            setEditOpen(true);
                          }}
                          className="p-1 text-gray-400 hover:text-gray-600"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                </React.Fragment>
              ))}
              {categoryOrder.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-8 text-center text-sm text-gray-500"
                  >
                    No tasks configured. Please set up PMO Packages first.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Status Overview */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
          <div className="p-1.5 bg-red-50 text-red-500 rounded flex items-center justify-center">
            <BarChart2 className="w-4 h-4" />
          </div>
          <h2 className="text-[14px] font-bold text-gray-900 uppercase tracking-wide">STATUS OVERVIEW</h2>
        </div>

        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50/50">
              <TableHead className="text-xs font-medium text-slate-500 uppercase h-10 px-6 w-[35%]">
                TASK
              </TableHead>
              <TableHead className="text-xs font-medium text-slate-500 uppercase h-10 px-6 text-center">
                STATUS/ LAST UPDATED
              </TableHead>
              <TableHead className="text-xs font-medium text-slate-500 uppercase h-10 px-6 text-right w-[35%]">
                LINK
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* Drawing Row */}
            <TableRow className="hover:bg-slate-50/50">
              <TableCell className="px-6 py-3 w-[35%]">
                <div className="flex items-center gap-2">
                  <span className="text-red-500">
                    <PencilRuler className="w-4 h-4" />
                  </span>
                  <span className="text-sm text-gray-900 font-medium">Drawing</span>
                  {statusOverview?.drawing?.is_disabled ? (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200">Inactive</span>
                  ) : (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-200">Active</span>
                  )}
                </div>
              </TableCell>
              <TableCell className="px-6 py-3">
                <div className="flex justify-center">
                  {statusOverview?.drawing ? (
                    <div className="inline-flex flex-wrap gap-1.5 items-center justify-center">
                    {(() => {
                      const counts = statusOverview.drawing!.status_counts || {};
                      const total = statusOverview.drawing!.total;
                      const statuses = [
                        { label: "Not Started", key: "Not Started", classes: "bg-gray-100 text-gray-600" },
                        { label: "Submitted", key: "Submitted", classes: "bg-green-100 text-green-700" },
                        { label: "In Progress", key: "In Progress", classes: "bg-blue-50 text-blue-700" }
                      ];

                      return statuses.map((st) => (
                        <span key={st.key} className={`text-[11px] px-2 py-0.5 rounded font-medium ${st.classes}`}>
                          {st.label}: {counts[st.key] || 0}/{total}
                        </span>
                      ));
                    })()}
                  </div>
                ) : (
                  <span className="text-xs text-gray-400">No data</span>
                )}
                </div>
              </TableCell>
              <TableCell className="px-6 py-3 text-right w-[35%]">
                {statusOverview?.drawing?.tracker_id && (
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={handleNavigateToDesignTracker}
                      className="text-blue-500 hover:text-blue-700 p-1 inline-flex items-center justify-center border border-blue-200 rounded hover:bg-blue-50 transition-colors"
                      title="View Drawing Tracker"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </button>
                    <button
                      onClick={handleDownloadDrawing}
                      className="text-red-500 hover:text-red-700 p-1 inline-flex items-center justify-center border border-red-200 rounded hover:bg-red-50 transition-colors"
                      title="Download Drawing PDF"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </TableCell>
            </TableRow>

            {/* DPR Row */}
            <TableRow className="hover:bg-slate-50/50">
              <TableCell className="px-6 py-3 w-[35%]">
                <div className="flex items-center gap-2">
                  <span className="text-red-500">
                    <PencilRuler className="w-4 h-4" />
                  </span>
                  <span className="text-sm text-gray-900 font-medium">Daily Progress Report</span>
                  {project?.disabled_dpr === 1 ? (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200">Inactive</span>
                  ) : (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-200">Active</span>
                  )}
                </div>
              </TableCell>
              <TableCell className="px-6 py-3">
                <div className="flex justify-center">
                  {statusOverview?.dpr ? (
                    <span className="inline-flex items-center text-[11px] font-medium text-gray-600 px-3 py-1 rounded border border-gray-200 bg-white shadow-sm">
                      {formatDate(statusOverview.dpr.last_updated)}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400">No data</span>
                  )}
                </div>
              </TableCell>
              <TableCell className="px-6 py-3 text-right w-[35%]">
                {statusOverview?.dpr && (
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => {
                        const date = statusOverview.dpr?.last_updated;
                        const zone = statusOverview.dpr?.zone;
                        navigate(`/prs&milestones/milestone-report/daily-summary?report_date=${date}&project_id=${projectId}${zone ? `&zone=${zone}` : ""}`);
                      }}
                      className="text-blue-500 hover:text-blue-700 p-1 inline-flex items-center justify-center border border-blue-200 rounded hover:bg-blue-50 transition-colors"
                      title="View Daily Summary"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </button>
                    <button
                      onClick={handleDownloadDPR}
                      className="text-red-500 hover:text-red-700 p-1 inline-flex items-center justify-center border border-red-200 rounded hover:bg-red-50 transition-colors"
                      title="Download Daily Report PDF"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </TableCell>
            </TableRow>

            {/* Inventory Row */}
            <TableRow className="hover:bg-slate-50/50">
              <TableCell className="px-6 py-3 w-[35%]">
                <div className="flex items-center gap-2">
                  <span className="text-red-500">
                    <PencilRuler className="w-4 h-4" />
                  </span>
                  <span className="text-sm text-gray-900 font-medium">Inventory</span>
                  {project?.disabled_inventory === 1 ? (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200">Inactive</span>
                  ) : (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-200">Active</span>
                  )}
                </div>
              </TableCell>
              <TableCell className="px-6 py-3">
                <div className="flex justify-center">
                  {statusOverview?.inventory ? (
                    <span className="inline-flex items-center text-[11px] font-medium text-gray-600 px-3 py-1 rounded border border-gray-200 bg-white shadow-sm">
                      {formatDate(statusOverview.inventory.last_updated)}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400">No data</span>
                  )}
                </div>
              </TableCell>
              <TableCell className="px-6 py-3 text-right w-[35%]">
                {statusOverview?.inventory && (
                  <button
                    onClick={handleNavigateToProjectMaterialUsage}
                    className="text-blue-500 hover:text-blue-700 p-1 inline-flex items-center justify-center"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </button>
                )}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      {/* Edit Task Modal */}
      <EditTaskModal
        open={editOpen}
        onOpenChange={setEditOpen}
        task={editTask}
        onSuccess={loadTasks}
      />
    </div>
  );
};

export default PMOProjectDetail;
