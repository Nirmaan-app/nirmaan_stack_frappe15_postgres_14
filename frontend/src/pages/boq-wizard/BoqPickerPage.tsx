import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useFrappeGetDocList, useFrappeGetDoc } from "frappe-react-sdk";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileSpreadsheet, FolderPlus } from "lucide-react";
import { TenderingProjectForm } from "@/pages/projects/tendering/TenderingProjectForm";
import { useBoqWizardStore } from "@/zustand/useBoqWizardStore";
import { BoqUploadScreen } from "./BoqUploadScreen";
import { TemplateCreateFlow } from "./TemplateCreateFlow";

type ProjectMode = "upload" | "template";

const BoqPickerPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preSelectedId = searchParams.get("project") ?? "";

  const [selectedProjectId, setSelectedProjectId] = useState<string>(preSelectedId);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  // ADR-0013 D2: on the project-scoped screen (?project=<id>) the creation mode is a PERSISTENT
  // top-of-screen toggle -- the chosen sub-component renders inline BELOW it on ONE screen (no
  // full-screen chooser gate). Default "upload". Template creation lives ONLY here (A2 req E1).
  const [projectMode, setProjectMode] = useState<ProjectMode>("upload");
  // Dirty-guard plumbing: templateDirty is reported up by TemplateCreateFlow (upload dirtiness is
  // read imperatively from the store); pendingMode holds the target while the confirm is open.
  const [templateDirty, setTemplateDirty] = useState(false);
  const [pendingMode, setPendingMode] = useState<ProjectMode | null>(null);

  // Reset to the default mode when the URL project param changes (back/forward, or a new
  // ?project=).
  useEffect(() => {
    setSelectedProjectId(preSelectedId);
    setProjectMode("upload");
    setTemplateDirty(false);
  }, [preSelectedId]);

  // Projects list for the bare-page dropdown. Disabled on the scoped screen (swrKey null) so we
  // don't load 1000 rows just to read one project name. Both hooks below MUST run unconditionally
  // and BEFORE the preSelectedId early-return (Rules of Hooks) -- the SAME BoqPickerPage instance
  // re-renders with preSelectedId flipping "" -> id on the Continue SPA transition; a hook after
  // the early return would change the hook count (React #300).
  const { data: projects, isLoading } = useFrappeGetDocList(
    "Projects",
    {
      fields: ["name", "project_name"],
      filters: [["status", "!=", "Tendering"]],
      limit: 1000,
      orderBy: { field: "project_name", order: "asc" },
    },
    preSelectedId ? null : undefined,
  );
  // Single project doc for the scoped-screen header name. SWR-shares the identical fetch the
  // mounted child (BoqUploadScreen / TemplateCreateFlow) already makes, so no extra request.
  const { data: scopedProject } = useFrappeGetDoc(
    "Projects",
    preSelectedId,
    preSelectedId ? undefined : null,
  );

  // ── Project-scoped screen (?project=<id>): one-screen mode toggle ──
  if (preSelectedId) {
    const scopedProjectName = scopedProject?.project_name ?? "";

    // Switch modes, but confirm first if the mode being LEFT has in-progress work. Upload
    // dirtiness is read imperatively from the store (no parent subscription); template dirtiness
    // is the flag TemplateCreateFlow reports via onDirtyChange.
    const requestSwitch = (target: ProjectMode) => {
      if (target === projectMode) return;
      let currentDirty = templateDirty;
      if (projectMode === "upload") {
        const st = useBoqWizardStore.getState();
        currentDirty = st.droppedFile !== null || st.uploadStatus !== "idle";
      }
      if (currentDirty) {
        setPendingMode(target);
      } else {
        setProjectMode(target);
        setTemplateDirty(false);
      }
    };

    const confirmSwitch = () => {
      if (pendingMode) {
        setProjectMode(pendingMode);
        setTemplateDirty(false);
      }
      setPendingMode(null);
    };

    return (
      <div className="flex-1 space-y-6 max-w-4xl mx-auto pt-6 pb-10">
        {/* Shared header (the host owns the one header for both modes) */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">New BoQ</h1>
          {scopedProjectName && (
            <p className="mt-1 text-sm text-muted-foreground">{scopedProjectName}</p>
          )}
        </div>

        {/* Persistent mode toggle (segmented, styled like the Single/Multi area toggle) */}
        <div className="inline-flex rounded-md border border-input p-0.5">
          <button
            type="button"
            onClick={() => requestSwitch("upload")}
            className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
              projectMode === "upload"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Upload a BoQ
          </button>
          <button
            type="button"
            onClick={() => requestSwitch("template")}
            className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
              projectMode === "template"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Create from Template
          </button>
        </div>

        {/* Active sub-component -- only the chosen one is mounted (preserves each mode's
            store-reset + socket lifecycle). NO onBack -> footer Back navigates to the project. */}
        {projectMode === "upload" ? (
          <BoqUploadScreen projectId={preSelectedId} embedded />
        ) : (
          <TemplateCreateFlow
            projectId={preSelectedId}
            embedded
            onDirtyChange={setTemplateDirty}
          />
        )}

        {/* Dirty-guard confirm before discarding in-progress work on a mode switch */}
        <AlertDialog
          open={pendingMode !== null}
          onOpenChange={(open) => {
            if (!open) setPendingMode(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Discard current work?</AlertDialogTitle>
              <AlertDialogDescription>
                You&apos;ve started{" "}
                {projectMode === "upload"
                  ? "uploading a BoQ"
                  : "creating a BoQ from the template"}
                . Switching will discard what you&apos;ve entered so far.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep editing</AlertDialogCancel>
              <AlertDialogAction onClick={confirmSwitch}>
                Discard and switch
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
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
