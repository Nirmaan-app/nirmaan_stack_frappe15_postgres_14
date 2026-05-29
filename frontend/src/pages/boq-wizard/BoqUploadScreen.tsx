import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useFrappeGetDoc } from "frappe-react-sdk";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useBoqWizardStore } from "@/zustand/useBoqWizardStore";
import { BoqDropZone } from "./BoqDropZone";
import { BoqMasterPanel } from "./BoqMasterPanel";

interface ProjectDoc {
  name: string;
  project_name: string;
  customer?: string | null;
}

interface BoqUploadScreenProps {
  projectId: string;
}

/**
 * Two-pane upload screen (M1.4, M1.7):
 *   Left  — BoQ file drop zone (custom file-input, M1.65).
 *   Right — Master BoQ details panel: 6 fields (M1.17).
 *   Footer — Back-to-project + Continue (disabled in this slice; activation in 1b-ii-b).
 *
 * Renders in-place inside BoqPickerPage when ?project=<id> is present.
 * No new route added (routesConfig unchanged).
 */
export function BoqUploadScreen({ projectId }: BoqUploadScreenProps) {
  const navigate = useNavigate();

  const { data: project } = useFrappeGetDoc<ProjectDoc>("Projects", projectId);

  const { reset, setSelectedProject, setPanelValue } = useBoqWizardStore();

  // Reset transient store whenever the project changes, then register the project.
  // reset/setSelectedProject are stable Zustand action refs — omitted from deps intentionally.
  useEffect(() => {
    reset();
    setSelectedProject(projectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Pre-fill BoQ name from project title once the Frappe doc loads; leave unconfirmed
  // so the user sees the ✨ indicator and knows to verify it.
  // setPanelValue is a stable Zustand action ref — omitted from deps intentionally.
  useEffect(() => {
    if (project?.project_name) {
      setPanelValue("boqName", project.project_name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.project_name]);

  return (
    <div className="flex-1 space-y-6 max-w-4xl mx-auto pt-6 pb-10">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Upload BoQ</h1>
        {project?.project_name && (
          <p className="mt-1 text-sm text-muted-foreground">{project.project_name}</p>
        )}
      </div>

      {/* ── Two-pane body ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Left — drop zone */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">BoQ File</CardTitle>
          </CardHeader>
          <CardContent>
            <BoqDropZone />
          </CardContent>
        </Card>

        {/* Right — Master BoQ details */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Master BoQ Details</CardTitle>
          </CardHeader>
          <CardContent>
            <BoqMasterPanel
              projectName={project?.project_name ?? ""}
              customer={project?.customer}
            />
          </CardContent>
        </Card>
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-t border-border pt-4">
        <Button variant="ghost" onClick={() => navigate(`/projects/${projectId}`)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to project
        </Button>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              {/*
                Disabled buttons don't fire mouse events, so they can't trigger
                Tooltip on their own. The wrapping <span tabIndex={0}> lets the
                Tooltip fire on hover over the span.
              */}
              <span tabIndex={0}>
                <Button disabled>
                  Continue
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              Drop a file and confirm all required fields to continue
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}
