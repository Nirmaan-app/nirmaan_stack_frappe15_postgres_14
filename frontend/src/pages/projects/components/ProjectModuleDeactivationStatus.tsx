import React, { useMemo } from "react";
import { ShieldAlert } from "lucide-react";
import { Projects } from "@/types/NirmaanStack/Projects";
import { useFrappeGetDoc, useFrappeGetDocList } from "frappe-react-sdk";
import { formatDate } from "@/utils/FormatDate";
import { useNavigate } from "react-router-dom";
import { useUserData } from "@/hooks/useUserData";

import { Badge } from "@/components/ui/badge";

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
  const { data: projectData } = useFrappeGetDoc<Projects>("Projects", projectId, projectId ? `project-deactivation-info-${projectId}-${projectStatus}` : null);

  // --- Fetching Design Tracker status ---
  const { data: designTrackers } = useFrappeGetDocList("Project Design Tracker", {
    fields: ["hide_design_tracker"],
    filters: [["project", "=", projectId]],
    limit: 1
  }, projectId ? `design-tracker-status-${projectId}-${projectStatus}` : null);

  // --- Fetching Commission Report status ---
  const { data: commissionReports } = useFrappeGetDocList("Project Commission Report", {
    fields: ["hide_commission_report"],
    filters: [["project", "=", projectId]],
    limit: 1
  }, projectId ? `commission-report-status-${projectId}-${projectStatus}` : null);

  const isDPRDisabled = projectData?.disabled_dpr === 1;
  const isInventoryDisabled = projectData?.disabled_inventory === 1;
  const isDesignDisabled = designTrackers?.[0]?.hide_design_tracker === 1;
  const isCommissionDisabled = commissionReports?.[0]?.hide_commission_report === 1;

  const haltedModules = useMemo(() => {
    const modules = [];
    if (isDPRDisabled) {
      modules.push({ label: "DPR Created disabled from", date: projectData?.disabled_dpr_date ? formatDate(projectData.disabled_dpr_date) : undefined });
    }
    if (isInventoryDisabled) {
      modules.push({ label: "Inventory update disabled from", date: projectData?.disabled_inventory_date ? formatDate(projectData.disabled_inventory_date) : undefined });
    }
    if (isDesignDisabled) modules.push({ label: "Design Tracker", route: "/design-tracker?tab=project" });
    if (isCommissionDisabled) modules.push({ label: "Commission Report", route: "/commission-tracker?tab=project" });
    if (projectData?.disabled_pmo === 1) modules.push({ label: "PMO Dashboard disabled", route: "/pmo-dashboard" });
    return modules;
  }, [isDPRDisabled, isInventoryDisabled, isDesignDisabled, isCommissionDisabled, projectData]);

  if (haltedModules.length === 0) return null;

  return (
    <div className="flex items-center gap-3 py-2.5 px-4 mb-3 border-amber-200 bg-amber-50/50 rounded-lg border-[1.5px] animate-in fade-in slide-in-from-top-1 duration-300">
      <ShieldAlert className="h-4.5 w-4.5 text-amber-600 shrink-0" />
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-bold text-amber-900 uppercase tracking-tight">Modules Disabled:</span>
        <div className="flex items-center gap-1.5 flex-wrap">
          {haltedModules.map((m, idx) => (
            <div key={m.label} className="flex items-center">
              <Badge 
                variant="outline" 
                onClick={() => {
                   if (isAdminOrPMO && m.route) {
                     navigate(m.route);
                   }
                }}
                className={`bg-white/80 border-amber-200 text-[11px] h-6 px-2 text-amber-950 hover:bg-white/80 transition-none shadow-sm ${isAdminOrPMO && m.route ? "cursor-pointer hover:border-amber-400 hover:bg-white" : ""}`}
              >
                {m.label}
                {m.date && (
                  <span className="ml-1.5 text-red-600 font-bold tracking-tight">({m.date})</span>
                )}
              </Badge>
              {idx < haltedModules.length - 1 && (
                <span className="text-amber-300 mx-1 font-bold select-none">•</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
