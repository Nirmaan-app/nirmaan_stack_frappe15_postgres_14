import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useFrappeGetDoc, useFrappeGetDocList } from "frappe-react-sdk";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, FileSpreadsheet, FolderPlus, Layers } from "lucide-react";
import { TenderingProjectForm } from "@/pages/projects/tendering/TenderingProjectForm";
import { BoqUploadScreen } from "./BoqUploadScreen";
import { TemplateCreateFlow } from "./TemplateCreateFlow";

const BoqPickerPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preSelectedId = searchParams.get("project") ?? "";

  const [selectedProjectId, setSelectedProjectId] = useState<string>(preSelectedId);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  // A2: on the project-scoped screen (?project=<id>) the user first picks a creation MODE; the
  // mode's details panel is NOT rendered until chosen. "choose" = the two-option chooser,
  // "upload" = the upload two-pane, "template" = the create-from-template form. Template creation
  // lives ONLY here now -- the bare /upload-boq page no longer offers it (A2 requirement E1).
  const [projectMode, setProjectMode] = useState<"choose" | "upload" | "template">("choose");

  // Keep the dropdown in sync + reset the mode chooser when the URL project param changes
  // (back/forward navigation, or a new ?project=).
  useEffect(() => {
    setSelectedProjectId(preSelectedId);
    setProjectMode("choose");
  }, [preSelectedId]);

  // Project list for the bare picker. This hook MUST run unconditionally and BEFORE the
  // preSelectedId early-return below (Rules of Hooks) -- the SAME BoqPickerPage instance
  // re-renders with preSelectedId flipping "" -> id on the Continue SPA transition; a hook
  // after the early return would change the hook count (React #300). swrKey null disables the
  // fetch when a project is preselected (sdk gotcha) so we never load a list we won't render.
  const { data: projects, isLoading } = useFrappeGetDocList(
    "Projects",
    {
      fields: ["name", "project_name"],
      filters: [["status", "!=", "Tendering"]],
      limit: 1000,
      orderBy: { field: "project_name", order: "asc" },
    },
    preSelectedId ? null : undefined
  );

  // A2: project name for the mode-chooser header -- only fetched when a project is preselected
  // (swrKey null disables it otherwise; #frappe_get_doc gotcha -- 3rd arg is the swrKey).
  const { data: preProject } = useFrappeGetDoc<{ name: string; project_name: string }>(
    "Projects",
    preSelectedId,
    preSelectedId ? undefined : null
  );
  const preProjectName = preProject?.project_name ?? preSelectedId;

  // ── Project-scoped screen (?project=<id>): mode chooser -> upload | template ──
  if (preSelectedId) {
    if (projectMode === "upload") {
      return (
        <BoqUploadScreen
          projectId={preSelectedId}
          onBack={() => setProjectMode("choose")}
        />
      );
    }
    if (projectMode === "template") {
      return (
        <TemplateCreateFlow
          projectId={preSelectedId}
          onBack={() => setProjectMode("choose")}
        />
      );
    }
    // mode === "choose": the two-option chooser. NO details panel until a mode is picked (A2).
    return (
      <div className="flex-1 space-y-6 max-w-3xl mx-auto pt-8 pb-10">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">New BoQ</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            For <span className="font-medium text-foreground">{preProjectName}</span>. Choose how
            you&apos;d like to create this Bill of Quantities.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setProjectMode("upload")}
            className="group flex flex-col items-start gap-3 rounded-lg border border-border bg-card p-5 text-left transition-colors hover:border-primary hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground transition-colors group-hover:border-primary group-hover:text-primary">
              <FileSpreadsheet className="h-4 w-4" />
            </span>
            <span className="text-sm font-semibold text-foreground">Upload a BoQ</span>
            <span className="text-xs leading-relaxed text-muted-foreground">
              Drop an .xlsx / .xlsm workbook, then configure, parse and review it.
            </span>
          </button>

          <button
            type="button"
            onClick={() => setProjectMode("template")}
            className="group flex flex-col items-start gap-3 rounded-lg border border-border bg-card p-5 text-left transition-colors hover:border-primary hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground transition-colors group-hover:border-primary group-hover:text-primary">
              <Layers className="h-4 w-4" />
            </span>
            <span className="text-sm font-semibold text-foreground">Create from Template</span>
            <span className="text-xs leading-relaxed text-muted-foreground">
              Start from the master template — pick sheets, then enter quantities.
            </span>
          </button>
        </div>

        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/projects/${preSelectedId}`)}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to project
          </Button>
        </div>
      </div>
    );
  }

  const handleContinue = () => {
    if (!selectedProjectId) return;
    navigate(`/upload-boq?project=${selectedProjectId}`);
  };

  const handleCreated = (newProjectId: string) => {
    setCreateDialogOpen(false);
    setSelectedProjectId(newProjectId);
    navigate(`/upload-boq?project=${newProjectId}`);
  };

  // ── Bare page (/upload-boq, no project): project chooser + tendering create ───
  return (
    <div className="flex-1 space-y-6 max-w-lg mx-auto pt-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Upload BoQ</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Choose a project to attach its Bill of Quantities.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Select project</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select
            value={selectedProjectId}
            onValueChange={setSelectedProjectId}
            disabled={isLoading}
          >
            <SelectTrigger className="w-full">
              <SelectValue
                placeholder={isLoading ? "Loading projects…" : "Choose a project"}
              />
            </SelectTrigger>
            <SelectContent>
              {projects?.map((p) => (
                <SelectItem key={p.name} value={p.name}>
                  {p.project_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            className="w-full"
            disabled={!selectedProjectId}
            onClick={handleContinue}
          >
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Continue
          </Button>
        </CardContent>
      </Card>

      <Button
        variant="outline"
        className="w-full"
        onClick={() => setCreateDialogOpen(true)}
      >
        <FolderPlus className="mr-2 h-4 w-4" />
        Create new Tendering project
      </Button>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Tendering Project</DialogTitle>
          </DialogHeader>
          <TenderingProjectForm
            embedded
            onCreated={handleCreated}
            onCancel={() => setCreateDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default BoqPickerPage;
// React Router v6 lazy() requires a named Component export.
export { BoqPickerPage as Component };
