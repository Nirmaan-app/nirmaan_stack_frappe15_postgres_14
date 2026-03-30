import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useFrappeGetDoc, useFrappePostCall } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";
import { ArrowLeft, Pencil, Check } from "lucide-react";
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
}

interface StatusOverview {
  drawing: {
    total: number;
    status_counts: Record<string, number>;
    excluded_not_applicable?: number;
  } | null;
  dpr: { last_updated: string } | null;
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

  const { call: fetchTasks, loading: tasksLoading } = useFrappePostCall(
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

  useEffect(() => {
    loadTasks();
    loadOverview();
  }, [projectId]);

  // Compute progress
  const allTasks = Object.values(tasks).flat();
  const totalTasks = allTasks.length;
  const completedTasks = allTasks.filter((t) => t.status === "Done").length;
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
      case "Done":
        return (
          <span className="inline-flex min-w-[84px] items-center justify-center gap-1 rounded-md bg-green-50 border border-green-100 px-2 py-1 text-xs font-medium text-green-600">
            <Check className="h-3 w-3" />
            Done
          </span>
        );
      case "Not Done":
        return (
          <span className="inline-flex min-w-[84px] items-center justify-center rounded-md bg-red-50 border border-red-100 px-2 py-1 text-xs font-bold text-red-600">
            Not Done
          </span>
        );
      default:
        return (
          <span className="inline-flex min-w-[84px] items-center justify-center rounded-md bg-gray-50 border border-gray-200 px-2 py-1 text-xs font-medium text-gray-400">
            ---
          </span>
        );
    }
  };

  if (projectLoading || (tasksLoading && !tasksLoaded)) {
    return (
      <div className="flex justify-center items-center h-[60vh]">
        <TailSpin width={40} height={40} color="#dc2626" />
      </div>
    );
  }

  return (
    <div className="flex-1 md:space-y-4">
      {/* Header */}
      <div className="flex items-center gap-1 mb-4">
        <ArrowLeft
          className="h-5 w-5 cursor-pointer text-gray-500 hover:text-gray-700"
          onClick={() => navigate("/pmo-dashboard")}
        />
        <span className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          PMO DASHBOARD
        </span>
      </div>

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
                      colSpan={5}
                      className="pb-2 pt-4 text-xs font-bold uppercase tracking-wider text-red-500"
                    >
                      {cat}
                      </TableCell>
                  </TableRow>
                  {/* Task Rows */}
                  {(tasks[cat] || []).map((task) => (
                    <TableRow key={task.name} className="hover:bg-white">
                      <TableCell className="text-sm text-gray-900">
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${
                              task.status === "Done"
                                ? "bg-green-500"
                                : task.status === "Not Done"
                                  ? "bg-red-500"
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
                  ))}
                </React.Fragment>
              ))}
              {categoryOrder.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
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
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-4">STATUS OVERVIEW</h2>

        <div className="rounded-lg border border-gray-100 bg-slate-50/50 px-6 py-4">
          <div className="flex flex-col md:flex-row md:items-center gap-8 md:gap-16">
            {/* Drawing */}
            <div>
              <h3 className="text-xs font-bold text-slate-500 uppercase mb-2">
                Drawing
              </h3>
              {statusOverview?.drawing ? (
                <div className="inline-flex rounded-lg border border-gray-200 bg-white overflow-hidden shadow-sm">
                  {(() => {
                    const statusCounts = statusOverview.drawing!.status_counts || {};
                    const orderedBaseStatuses = [
                      "Not Started",
                      "Submitted",
                      "In Progress",
                      "Approved",
                    ];
                    const extraStatuses = Object.keys(statusCounts).filter(
                      (status) => !orderedBaseStatuses.includes(status)
                    );
                    const statusesToRender = [...orderedBaseStatuses, ...extraStatuses];
                    const total = statusOverview.drawing!.total;

                    return statusesToRender.map((status, index) => {
                      const count = statusCounts[status] || 0;

                      let colorClasses = "bg-white text-gray-600";
                      if (status === "Not Started") {
                        colorClasses = "bg-white text-gray-500";
                      } else if (status === "Submitted") {
                        colorClasses = "bg-green-50 text-green-700";
                      } else if (status === "In Progress") {
                        colorClasses = "bg-blue-50 text-blue-700";
                      } else if (status === "Approved") {
                        colorClasses = "bg-emerald-100 text-emerald-800";
                      }

                      return (
                        <span
                          key={status}
                          className={`text-[10px] sm:text-[11px] font-medium px-2.5 py-1 flex items-center justify-center ${colorClasses} ${
                            index !== statusesToRender.length - 1 ? "border-r border-gray-200" : ""
                          }`}
                        >
                          {status}: {count}/{total}
                        </span>
                      );
                    });
                  })()}
                </div>
              ) : (
                <p className="text-xs text-gray-400">No design tracker data</p>
              )}
            </div>

            {/* DPR Status */}
            <div>
              <h3 className="text-xs font-bold text-slate-500 uppercase mb-2">
                DPR Status
              </h3>
              {statusOverview?.dpr ? (
                <span className="inline-block bg-white text-[11px] font-medium text-gray-500 px-2.5 py-1 rounded-lg border border-gray-200 shadow-sm">
                  Last Updated: {formatDate(statusOverview.dpr.last_updated)}
                </span>
              ) : (
                <p className="text-xs text-gray-400">No DPR data</p>
              )}
            </div>

            {/* Inventory Status */}
            <div>
              <h3 className="text-xs font-bold text-slate-500 uppercase mb-2">
                Inventory Status
              </h3>
              {statusOverview?.inventory ? (
                <span className="inline-block bg-white text-[11px] font-medium text-gray-500 px-2.5 py-1 rounded-lg border border-gray-200 shadow-sm">
                  Last Updated: {formatDate(statusOverview.inventory.last_updated)}
                </span>
              ) : (
                <p className="text-xs text-gray-400">No inventory data</p>
              )}
            </div>
          </div>
        </div>
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
