import { useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { ArrowLeftRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import {
  FuzzySearchSelect,
  type FuzzyOptionType,
} from "@/components/ui/fuzzy-search-select";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { useUserData } from "@/hooks/useUserData";
import { ITM_CREATE_ROLES } from "@/constants/itm";
import type { Projects } from "@/types/NirmaanStack/Projects";
import { InventoryPickerTable } from "./components/InventoryPickerTable";
import { TransferRequestPreviewDialog } from "./TransferRequestPreviewDialog";
import { useInventoryPickerData } from "./hooks/useInventoryPickerData";
import { useCreateITMs } from "./hooks/useCreateITMs";
import type {
  CreateItmsPayloadSelection,
  SelectionState,
} from "./types";

interface ProjectOption extends FuzzyOptionType {
  label: string;
  value: string;
}

export default function CreateITMPage() {
  const navigate = useNavigate();
  const { role } = useUserData();

  const [targetProject, setTargetProject] = useState<ProjectOption | null>(null);
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState<SelectionState>({});
  const [previewOpen, setPreviewOpen] = useState(false);

  const { items, isLoading, error } = useInventoryPickerData(search);
  const { create, isLoading: isCreating } = useCreateITMs();

  const { data: projects, isLoading: projectsLoading } = useFrappeGetDocList<Projects>(
    "Projects",
    { fields: ["name", "project_name"], limit: 0 },
    "itm-all-projects-minimal"
  );

  const projectOptions = useMemo<ProjectOption[]>(() => {
    return (projects ?? [])
      .map((p) => ({ label: p.project_name || p.name, value: p.name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [projects]);

  const { isValid, flatSelections, invalidReason } = useMemo(() => {
    if (!targetProject) {
      return {
        isValid: false,
        flatSelections: [] as CreateItmsPayloadSelection[],
        invalidReason: "Select a target destination",
      };
    }
    const flat: CreateItmsPayloadSelection[] = [];
    let valid = true;
    let reason = "";
    for (const [source, byItem] of Object.entries(selection)) {
      if (source === targetProject.value) {
        valid = false;
        reason = "Source and target cannot be the same";
        continue;
      }
      for (const [itemId, row] of Object.entries(byItem)) {
        if (!(row.qty > 0) || row.qty > row.available_quantity) {
          valid = false;
          reason = `Invalid qty for ${row.item_name}`;
          continue;
        }
        flat.push({
          item_id: itemId,
          source_project: source,
          transfer_quantity: row.qty,
        });
      }
    }
    if (!flat.length && valid) {
      valid = false;
      reason = "Select at least one item";
    }
    return { isValid: valid, flatSelections: flat, invalidReason: reason };
  }, [targetProject, selection]);

  // Role guard — after hooks
  if (role && role !== "Loading" && !ITM_CREATE_ROLES.includes(role)) {
    return <Navigate to="/internal-transfer-memos" replace />;
  }

  const handleCreate = async () => {
    if (!targetProject || !isValid) return;
    try {
      const result = await create({
        target_project: targetProject.value,
        selections: flatSelections,
      });
      const count = result?.message?.count ?? flatSelections.length;
      toast({
        title: `${count} transfer memo${count === 1 ? "" : "s"} created`,
        variant: "success",
      });
      setPreviewOpen(false);
      navigate("/internal-transfer-memos?tab=Pending+Approval");
    } catch (e: any) {
      toast({
        title: "Failed to create transfer memos",
        description: e?.message || "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="flex-1 flex flex-col space-y-4 px-4 pt-2 pb-6">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b pb-3 sticky top-0 z-20 bg-background">
        <div className="flex items-center gap-2">
          <ArrowLeftRight className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-bold tracking-tight text-primary">
            Internal Transfer Memo
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => navigate(-1)}
            disabled={isCreating}
          >
            Cancel
          </Button>
          <Button
            disabled={!isValid || isCreating}
            onClick={() => setPreviewOpen(true)}
            title={!isValid ? invalidReason : undefined}
          >
            Continue
          </Button>
        </div>
      </div>

      {/* Select Destination */}
      <div className="rounded-md border bg-card p-4 space-y-2">
        <div>
          <Label className="text-sm font-semibold">Select Destination</Label>
          <p className="text-xs text-muted-foreground">
            Select the project where these materials will be transferred.
          </p>
        </div>
        <FuzzySearchSelect<ProjectOption>
          allOptions={projectOptions}
          value={targetProject}
          onChange={(opt) => setTargetProject(opt as ProjectOption | null)}
          tokenSearchConfig={{
            searchFields: ["label", "value"],
            minSearchLength: 1,
            partialMatch: true,
            fieldWeights: { label: 2, value: 1 },
          }}
          isClearable
          isLoading={projectsLoading}
          placeholder="Search and select target project..."
        />
      </div>

      {/* Picker */}
      <div className="rounded-md border bg-card p-4 space-y-3 flex-1 flex flex-col min-h-0">
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search item name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>

        {error ? (
          <AlertDestructive error={error} />
        ) : isLoading ? (
          <LoadingFallback />
        ) : (
          <InventoryPickerTable
            data={items}
            targetProject={targetProject?.value ?? null}
            selection={selection}
            onSelectionChange={setSelection}
          />
        )}
      </div>

      <TransferRequestPreviewDialog
        open={previewOpen}
        onOpenChange={(v) => !isCreating && setPreviewOpen(v)}
        targetProjectName={targetProject?.label ?? ""}
        selection={selection}
        onConfirm={handleCreate}
        isSubmitting={isCreating}
      />
    </div>
  );
}
