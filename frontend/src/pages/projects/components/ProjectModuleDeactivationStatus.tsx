import React, { useMemo, useState } from "react";
import {
  ShieldAlert,
  Loader2,
  FileStack,
  Package,
  PenTool,
  ClipboardCheck,
  LayoutDashboard,
  ExternalLink,
  Settings,
  Circle,
  Activity
} from "lucide-react";
import { Projects } from "@/types/NirmaanStack/Projects";
import { useFrappeGetDoc, useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import { formatDate } from "@/utils/FormatDate";
import { useNavigate } from "react-router-dom";
import { useUserData } from "@/hooks/useUserData";

import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";

interface ProjectModuleDeactivationStatusProps {
  projectId: string;
  projectStatus: string;
}

export const ProjectModuleDeactivationStatus: React.FC<ProjectModuleDeactivationStatusProps> = ({ projectId, projectStatus }) => {
  const navigate = useNavigate();
  const { role, user_id } = useUserData();

  const isAdminOrPMO = useMemo(() => {
    return user_id === "Administrator" || role === "Nirmaan Admin Profile" || role === "Nirmaan PMO Executive Profile";
  }, [role, user_id]);

  // --- Fetching Project details for DPR and Inventory status ---
  const { data: projectData, mutate: projectMutate } = useFrappeGetDoc<Projects>("Projects", projectId, projectId ? `project-deactivation-info-${projectId}-${projectStatus}` : null);

  // --- Fetching Design Tracker status ---
  const { data: designTrackers, mutate: designMutate } = useFrappeGetDocList("Project Design Tracker", {
    fields: ["hide_design_tracker"],
    filters: [["project", "=", projectId]],
    limit: 1
  }, projectId ? `design-tracker-status-${projectId}-${projectStatus}` : null);

  // --- Fetching Commission Report status ---
  const { data: commissionReports, mutate: commissionMutate } = useFrappeGetDocList("Project Commission Report", {
    fields: ["hide_commission_report"],
    filters: [["project", "=", projectId]],
    limit: 1
  }, projectId ? `commission-report-status-${projectId}-${projectStatus}` : null);

  const { call: enableModule } = useFrappePostCall("nirmaan_stack.api.projects.module_controls.enable_module");
  const { call: disableModule } = useFrappePostCall("nirmaan_stack.api.projects.module_controls.disable_module");

  const [confirmDialog, setConfirmDialog] = useState(false);
  const [selectedModule, setSelectedModule] = useState<{ type: string; label: string; shortLabel: string; state: string; route?: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const isDPRDisabled = projectData?.disabled_dpr === 1;
  const isInventoryDisabled = projectData?.disabled_inventory === 1;
  const isDesignDisabled = designTrackers?.[0]?.hide_design_tracker === 1;
  const isCommissionDisabled = commissionReports?.[0]?.hide_commission_report === 1;

  const moduleStatuses = useMemo(() => {
    const modules = [];

    // 1. DPR
    if (isDPRDisabled) {
      modules.push({
        type: "dpr",
        icon: FileStack,
        state: "disabled",
        label: "DPR",
        statusLabel: "Inactive",
        shortLabel: "DPR",
        date: projectData?.disabled_dpr_date ? formatDate(projectData.disabled_dpr_date) : undefined
      });
    } else {
      modules.push({ type: "dpr", icon: FileStack, state: "enabled", label: "DPR", statusLabel: "Active", shortLabel: "DPR" });
    }

    // 2. Inventory
    if (isInventoryDisabled) {
      modules.push({
        type: "inventory",
        icon: Package,
        state: "disabled",
        label: "Inventory",
        statusLabel: "Inactive",
        shortLabel: "Inventory",
        date: projectData?.disabled_inventory_date ? formatDate(projectData.disabled_inventory_date) : undefined
      });
    } else {
      modules.push({ type: "inventory", icon: Package, state: "enabled", label: "Inventory", statusLabel: "Active", shortLabel: "Inventory" });
    }

    // 3. Design Tracker
    const dtRoute = `/projects/${projectId}?page=designtracker`;
    if (isDesignDisabled) {
      modules.push({ type: "design_tracker", icon: PenTool, state: "disabled", label: "Design Tracker", statusLabel: "Inactive", shortLabel: "Design Tracker" });
    } else if (!designTrackers || designTrackers.length === 0) {
      modules.push({ type: "design_tracker", icon: PenTool, state: "not_setup", label: "Design Tracker", statusLabel: "Not Setup", shortLabel: "Design Tracker", route: isAdminOrPMO ? dtRoute : undefined });
    } else {
      modules.push({ type: "design_tracker", icon: PenTool, state: "enabled", label: "Design Tracker", statusLabel: "Active", shortLabel: "Design Tracker" });
    }

    // 4. Commission Report
    if (isCommissionDisabled) {
      modules.push({ type: "commission_report", icon: ClipboardCheck, state: "disabled", label: "Commission Report", statusLabel: "Inactive", shortLabel: "Commission Report" });
    } else if (!commissionReports || commissionReports.length === 0) {
      modules.push({ type: "commission_report", icon: ClipboardCheck, state: "not_setup", label: "Commission Report", statusLabel: "Not Setup", shortLabel: "Commission Report", route: isAdminOrPMO ? "/commission-tracker?tab=project" : undefined });
    } else {
      modules.push({ type: "commission_report", icon: ClipboardCheck, state: "enabled", label: "Commission Report", statusLabel: "Active", shortLabel: "Commission Report" });
    }

    // 5. PMO Dashboard
    if (projectData?.disabled_pmo === 1) {
      modules.push({ type: "pmo", icon: LayoutDashboard, state: "disabled", label: "PMO Dashboard", statusLabel: "Inactive", shortLabel: "PMO Dashboard" });
    } else {
      modules.push({ type: "pmo", icon: LayoutDashboard, state: "enabled", label: "PMO Dashboard", statusLabel: "Active", shortLabel: "PMO Dashboard" });
    }

    return modules;
  }, [isDPRDisabled, isInventoryDisabled, isDesignDisabled, isCommissionDisabled, projectData, designTrackers, commissionReports, projectId, isAdminOrPMO]);

  const handleModuleAction = async (action: "enable" | "disable") => {
    if (!selectedModule || !projectId) return;

    setIsProcessing(true);
    try {
      if (action === "enable") {
        await enableModule({
          project: projectId,
          module_type: selectedModule.type
        });
      } else {
        await disableModule({
          project: projectId,
          module_type: selectedModule.type
        });
      }

      toast({
        title: "Success",
        description: `${selectedModule.shortLabel} module has been ${action === "enable" ? "re-enabled" : "deactivated"}.`,
        variant: "success",
      });

      // Refresh all relevant data
      await projectMutate();
      await designMutate();
      await commissionMutate();

      setConfirmDialog(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || `Failed to ${action} module.`,
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
      setSelectedModule(null);
    }
  };

  if (moduleStatuses.length === 0) return null;

  const getVariantStyles = (state: string) => {
    switch (state) {
      case "enabled":
        return "bg-emerald-50 border-emerald-200 text-emerald-950 hover:bg-emerald-100 hover:border-emerald-300";
      case "disabled":
        return "bg-red-50 border-red-200 text-red-950 hover:bg-red-100 hover:border-red-300";
      case "not_setup":
        return "bg-amber-50 border-amber-200 text-amber-950 hover:bg-amber-100 hover:border-amber-300";
      default:
        return "bg-white/80 border-slate-200 text-slate-950";
    }
  };

  return (
    <div className="flex items-center gap-2.5 py-4 px-3 mb-3 border-slate-200 bg-white/60 backdrop-blur-sm rounded-lg border-[1px] shadow-sm animate-in fade-in slide-in-from-top-1 duration-300">
      <div className="flex items-center gap-1.5 pr-1.5 border-r border-slate-200">
        <Activity className="h-4 w-4 text-indigo-600 animate-pulse" /> Module Status:
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {moduleStatuses.map((m) => {
          const isClickable = (isAdminOrPMO && (m.state === "enabled" || m.state === "disabled")) || (m.type === "commission_report" && m.state === "not_setup") || !!m.route;

          return (
            <div key={`${m.type}-${m.state}`} className="flex items-center">
              <Badge
                variant="outline"
                onClick={() => {
                  if (isAdminOrPMO && (m.state === "disabled" || m.state === "enabled")) {
                    setSelectedModule({ type: m.type, label: m.label, shortLabel: m.shortLabel, state: m.state, route: m.route });
                    setConfirmDialog(true);
                  } else if (m.type === "commission_report" && m.state === "not_setup") {
                    setSelectedModule({ type: m.type, label: m.label, shortLabel: m.shortLabel, state: m.state, route: m.route });
                    setConfirmDialog(true);
                  } else if (m.route) {
                    navigate(m.route);
                  }
                }}
                className={`
                flex items-center gap-1.5 text-[10px] h-6 px-2 transition-all duration-200
                select-none rounded-md border shadow-sm
                ${isClickable ? "cursor-pointer hover:bg-slate-100 hover:shadow-md" : "cursor-default"}
                ${getVariantStyles(m.state)}
              `}
                title={isClickable ? `${isAdminOrPMO ? "Click to manage" : "Click to view"} ${m.label} (${m.statusLabel})` : `${m.label} (${m.statusLabel})`}
              >
              <m.icon className="h-3 w-3" />
              <span className="font-semibold text-slate-700">{m.label}</span>
              <div className="flex items-center gap-1.5 ml-1 border-l border-black/10 pl-1.5">
                <div className={`h-1.5 w-1.5 rounded-full ${m.state === "enabled" ? "bg-emerald-500 animate-pulse" :
                  m.state === "disabled" ? "bg-red-500" : "bg-amber-500"
                  }`} />
                <span className="text-[9px] font-bold opacity-80">
                  {m.state === "enabled" ? "Active" : m.state === "disabled" ? "InActive" : "Not Set"}
                </span>
                {m.date && (
                  <span className="text-[9px] font-black opacity-60">({m.date})</span>
                )}
                {isAdminOrPMO ? (
                  <Settings className="h-2 w-2 ml-0.5 opacity-40" />
                ) : m.route ? (
                  <ExternalLink className="h-2 w-2 ml-0.5 opacity-40" />
                ) : null}
              </div>
            </Badge>
          </div>
        );
      })}
      </div>

      <Dialog open={confirmDialog} onOpenChange={setConfirmDialog}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>
              {selectedModule?.state === "not_setup" ? "Create Module" : `Manage ${selectedModule?.shortLabel} Module`}
            </DialogTitle>
            <DialogDescription>
              {selectedModule?.state === "disabled"
                ? `Are you sure you want to re-enable the ${selectedModule?.shortLabel} module for this project?`
                : selectedModule?.state === "not_setup"
                  ? "When the Project status is changed from any state to Handover, a Commission Report will be generated as part of the transition. However, this is permitted only after the Design Tracker has been Created."
                  : `Are you sure you want to deactivate the ${selectedModule?.shortLabel} module?`
              }
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end sm:gap-2 mt-4">
            {selectedModule?.state !== "not_setup" && (
              <Button variant="outline" onClick={() => setConfirmDialog(false)} disabled={isProcessing}>
                Cancel
              </Button>
            )}

            {selectedModule?.state === "disabled" ? (
              <Button onClick={() => handleModuleAction("enable")} disabled={isProcessing}>
                {isProcessing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Enabling...
                  </>
                ) : (
                  "Confirm Enable"
                )}
              </Button>
            ) : selectedModule?.state === "not_setup" ? (
              // Just show info, no buttons as per user request
              null
            ) : (
              <Button variant="destructive" onClick={() => handleModuleAction("disable")} disabled={isProcessing}>
                {isProcessing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Disabling...
                  </>
                ) : (
                  "Disable Module"
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
