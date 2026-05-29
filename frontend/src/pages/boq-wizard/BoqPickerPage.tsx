import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useFrappeGetDocList } from "frappe-react-sdk";
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
import { FileSpreadsheet, FolderPlus } from "lucide-react";
import { TenderingProjectForm } from "@/pages/projects/tendering/TenderingProjectForm";

const BoqPickerPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preSelectedId = searchParams.get("project") ?? "";

  const [selectedProjectId, setSelectedProjectId] = useState<string>(preSelectedId);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  // Keep dropdown in sync when URL param changes (back/forward navigation).
  useEffect(() => {
    setSelectedProjectId(preSelectedId);
  }, [preSelectedId]);

  const { data: projects, isLoading } = useFrappeGetDocList("Projects", {
    fields: ["name", "project_name"],
    filters: [["status", "!=", "Tendering"]],
    limit: 1000,
    orderBy: { field: "project_name", order: "asc" },
  });

  const handleContinue = () => {
    if (!selectedProjectId) return;
    // TODO(1b-ii): navigate to the upload screen once it exists.
    // For now, persist the selection in the URL so this round-trips correctly.
    navigate(`/upload-boq?project=${selectedProjectId}`);
  };

  const handleCreated = (newProjectId: string) => {
    setCreateDialogOpen(false);
    setSelectedProjectId(newProjectId);
    navigate(`/upload-boq?project=${newProjectId}`);
  };

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

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">or</span>
        </div>
      </div>

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
