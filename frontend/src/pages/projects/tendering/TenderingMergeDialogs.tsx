import { useMemo, useState } from "react";
import { useFrappeGetCall, useFrappeGetDocList } from "frappe-react-sdk";
import { AlertTriangle, Loader2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  FuzzySearchSelect,
  type FuzzyOptionType,
  type TokenSearchConfig,
} from "@/components/ui/fuzzy-search-select";
import { useToast } from "@/components/ui/use-toast";
import { getFrappeErrorText } from "@/utils/frappeErrors";
import { Projects } from "@/types/NirmaanStack/Projects";

import { useMergeTenderingBoqs, useUndoTenderingMerge } from "./hooks/useTenderingMutations";

/** A BoQ as the merge dialog lists it. */
export interface MergeBoqRow {
  name: string;
  boq_name: string;
  version: number;
}

interface TargetOption extends FuzzyOptionType {
  value: string;
  label: string;
  status?: string;
}

const TARGET_SEARCH: TokenSearchConfig = {
  searchFields: ["label", "value"],
  minSearchLength: 1,
  partialMatch: true,
  minTokenLength: 1,
  fieldWeights: { label: 2.0, value: 1.5 },
  minTokenMatches: 1,
};

type MergeAction = "merge" | "undo";

/**
 * Who is editing the BoQs this action would move, right now (ADR-0038 D9): one line per sheet
 * someone has open in Configure / Review / Pricing, and per BoQ whose parse is running. Read
 * while the dialog is open and every 30 s; the server refuses the action the same way.
 */
function useMergeBlockers(projectName: string, action: MergeAction, open: boolean) {
  const { data, isLoading, isValidating, mutate } = useFrappeGetCall<{ message: { busy: string[] } }>(
    "nirmaan_stack.api.projects.tendering_merge.get_merge_blockers",
    { project_name: projectName, action },
    open ? `tendering-merge-blockers-${action}-${projectName}` : null,
    { refreshInterval: 30000, revalidateOnFocus: true }
  );
  return {
    busy: data?.message?.busy ?? [],
    checking: isLoading || isValidating,
    recheck: () => void mutate(),
  };
}

function BusyWarning({
  busy,
  actionLabel,
  checking,
  onRecheck,
}: {
  busy: string[];
  actionLabel: string;
  checking: boolean;
  onRecheck: () => void;
}) {
  if (busy.length === 0) return null;
  return (
    <div className="space-y-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <p className="flex items-center gap-1.5 font-medium">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        These BoQs are being edited right now:
      </p>
      <ul className="list-disc space-y-0.5 pl-6">
        {busy.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{actionLabel} is blocked until they leave the page.</span>
        <Button size="sm" variant="outline" onClick={onRecheck} disabled={checking}>
          {checking && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Check again
        </Button>
      </div>
    </div>
  );
}

interface MergeBoqsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  projectTitle: string;
  boqs: MergeBoqRow[];
  onMerged: () => void;
}

/**
 * "Merge BoQs into a Won project" (ADR-0038 D7). Picks the target -- a Won project that is not
 * Completed (Q5) -- and lists every BoQ that will move (all of them, Q2). The server re-checks
 * everything (`tendering_merge.merge_tendering_boqs`).
 */
export function MergeBoqsDialog({
  open,
  onOpenChange,
  projectName,
  projectTitle,
  boqs,
  onMerged,
}: MergeBoqsDialogProps) {
  const { toast } = useToast();
  const [target, setTarget] = useState<TargetOption | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { mergeTenderingBoqs, loading } = useMergeTenderingBoqs();
  const { busy, checking, recheck } = useMergeBlockers(projectName, "merge", open);

  const { data: projects, isLoading } = useFrappeGetDocList<Projects>(
    "Projects",
    {
      fields: ["name", "project_name", "status"],
      filters: [
        ["tendering_status", "=", "Won"],
        ["status", "!=", "Completed"],
      ],
      limit: 1000,
      orderBy: { field: "creation", order: "desc" },
    },
    open ? "tendering-merge-target-projects" : null
  );

  const options = useMemo<TargetOption[]>(
    () =>
      (projects ?? []).map((p) => ({
        value: p.name,
        label: p.project_name || p.name,
        status: p.status,
      })),
    [projects]
  );

  const close = () => {
    if (loading) return;
    setTarget(null);
    setError(null);
    onOpenChange(false);
  };

  const handleMerge = async () => {
    if (!target) return;
    setError(null);
    try {
      const response = await mergeTenderingBoqs(projectName, target.value);
      if (response.message.status !== 200) {
        setError(response.message.error || "Could not merge the BoQs.");
        return;
      }
      // The server's count, not the dialog's list: the server moves every BoQ (Q2).
      const moved = response.message.boqs?.length ?? boqs.length;
      toast({
        title: "BoQs merged",
        description: `${moved} BoQ${moved === 1 ? "" : "s"} moved into ${target.label}.`,
        variant: "success",
      });
      setTarget(null);
      onOpenChange(false);
      onMerged();
    } catch (err) {
      setError(getFrappeErrorText(err));
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>Merge BoQs into a Won project</AlertDialogTitle>
          <AlertDialogDescription>
            Use this when <strong>{projectTitle}</strong> was won as part of a job that already
            exists as a Won project.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2">
          <Label className="text-sm">Won project</Label>
          <FuzzySearchSelect<TargetOption, false>
            allOptions={options}
            tokenSearchConfig={TARGET_SEARCH}
            isLoading={isLoading}
            isDisabled={loading}
            value={target}
            onChange={(option) => {
              setTarget(option);
              setError(null);
            }}
            placeholder="Search Won projects…"
            isClearable
            menuPortalTarget={document.body}
            menuPosition="fixed"
            formatOptionLabel={(option, meta) =>
              meta.context === "value" ? (
                option.label
              ) : (
                <span className="flex items-center justify-between gap-2 w-full">
                  <span className="truncate">
                    {option.label} <span className="text-muted-foreground">({option.value})</span>
                  </span>
                  {option.status && (
                    <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                      {option.status}
                    </span>
                  )}
                </span>
              )
            }
          />
          <p className="text-xs text-muted-foreground">Completed projects are not listed.</p>
        </div>

        <div className="space-y-1.5">
          <p className="text-sm">
            {boqs.length === 1 ? "This BoQ moves" : `These ${boqs.length} BoQs move`} to the chosen
            project as <strong>Selected</strong>:
          </p>
          <ul className="max-h-40 overflow-y-auto rounded-md border px-3 py-2 text-sm space-y-1">
            {boqs.map((boq) => (
              <li key={boq.name}>
                {boq.boq_name || boq.name}{" "}
                <span className="text-muted-foreground">v{boq.version}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            This project becomes <strong>Merged</strong>. You can undo it.
          </p>
          <p className="text-xs text-muted-foreground">
            Merging does not change {target ? <strong>{target.label}</strong> : "the chosen project"}'s
            packages. Add any it needs from that project's page → Edit.
          </p>
        </div>

        <BusyWarning busy={busy} actionLabel="Merge" checking={checking} onRecheck={recheck} />

        {error && <p className="text-sm text-destructive">{error}</p>}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          {/* Plain Button (not AlertDialogAction) so the dialog stays open on a backend error. */}
          <Button
            disabled={!target || loading || busy.length > 0}
            onClick={() => void handleMerge()}
          >
            {loading && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Merge BoQs
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface UndoMergeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  projectTitle: string;
  targetTitle: string;
  onUndone: () => void;
}

/** "Undo merge?" (ADR-0038 D3). The server finds the BoQs by `merged_from` and may refuse (D4). */
export function UndoMergeDialog({
  open,
  onOpenChange,
  projectName,
  projectTitle,
  targetTitle,
  onUndone,
}: UndoMergeDialogProps) {
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const { undoTenderingMerge, loading } = useUndoTenderingMerge();
  const { busy, checking, recheck } = useMergeBlockers(projectName, "undo", open);

  const close = () => {
    if (loading) return;
    setError(null);
    onOpenChange(false);
  };

  const handleUndo = async () => {
    setError(null);
    try {
      const response = await undoTenderingMerge(projectName);
      if (response.message.status !== 200) {
        setError(response.message.error || "Could not undo the merge.");
        return;
      }
      toast({
        title: "Merge undone",
        description: response.message.message,
        variant: "success",
      });
      onOpenChange(false);
      onUndone();
    } catch (err) {
      setError(getFrappeErrorText(err));
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Undo the merge?</AlertDialogTitle>
          <AlertDialogDescription>
            The BoQs merged from <strong>{projectTitle}</strong> leave{" "}
            <strong>{targetTitle}</strong> and come back here as <strong>Draft</strong>, with any
            changes made to them since. {projectTitle} returns to <strong>Tendering</strong>.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <BusyWarning busy={busy} actionLabel="Undo" checking={checking} onRecheck={recheck} />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          <Button disabled={loading || busy.length > 0} onClick={() => void handleUndo()}>
            {loading && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Undo merge
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
