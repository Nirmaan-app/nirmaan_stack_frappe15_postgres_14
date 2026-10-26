import { useMemo, useState } from "react";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { Info } from "lucide-react";

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
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { FuzzySearchSelect } from "@/components/ui/fuzzy-search-select";
import { Projects } from "@/types/NirmaanStack/Projects";
import { useConvertBoqOptions } from "@/pages/projects/data/project-form/useProjectFormQueries";
import {
    BusyWarning,
    TARGET_SEARCH,
    useMergeBlockers,
    type TargetOption,
} from "@/pages/projects/tendering/TenderingMergeDialogs";
import type { MergeSource } from "../boqPackageSeed";

interface AddTenderingBoqsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Projects not to offer: the one being converted, and those already added. */
    excludeProjects: readonly string[];
    /** The added project being edited, or null to add a new one. */
    editing: MergeSource | null;
    onSave: (source: MergeSource) => void;
}

/**
 * The wizard's "Add BoQs from a Tendering project" dialog (ADR-0038, owner 2026-10-21). Pick a
 * Tendering project, tick its BoQs: on Create every BoQ moves into the new project -- ticked ones
 * Selected, the rest Draft -- and the picked project becomes Merged. A project may be added with
 * nothing ticked; the BOQ step needs one tick overall. Nothing is saved here; the server checks
 * every added project again on Create.
 */
export function AddTenderingBoqsDialog({
    open,
    onOpenChange,
    excludeProjects,
    editing,
    onSave,
}: AddTenderingBoqsDialogProps) {
    const [project, setProject] = useState<TargetOption | null>(
        editing ? { value: editing.project, label: editing.project_name } : null
    );
    const [ticked, setTicked] = useState<Set<string>>(new Set(editing?.selected_boqs ?? []));

    const { data: tenderingProjects, isLoading: projectsLoading } = useFrappeGetDocList<Projects>(
        "Projects",
        {
            fields: ["name", "project_name"],
            filters: [["tendering_status", "=", "Tendering"]],
            limit: 1000,
            orderBy: { field: "creation", order: "desc" },
        },
        open ? "wizard-merge-source-projects" : null
    );
    const options = useMemo<TargetOption[]>(
        () =>
            (tenderingProjects ?? [])
                .filter((p) => !excludeProjects.includes(p.name))
                .map((p) => ({ value: p.name, label: p.project_name || p.name })),
        [tenderingProjects, excludeProjects]
    );

    const { data: boqData, isLoading: boqsLoading } = useConvertBoqOptions(open ? project?.value : undefined);
    const boqs = boqData?.message?.boqs ?? [];
    const { busy, checking, recheck } = useMergeBlockers(project?.value ?? "", "merge", open && !!project);

    const pickProject = (option: TargetOption | null) => {
        setProject(option);
        setTicked(new Set());
    };

    const toggle = (name: string, on: boolean) => {
        const next = new Set(ticked);
        if (on) next.add(name);
        else next.delete(name);
        setTicked(next);
    };

    const save = () => {
        if (!project || boqs.length === 0) return;
        onSave({
            project: project.value,
            project_name: project.label,
            boqs: boqs.map((boq) => ({
                name: boq.name,
                boq_name: boq.boq_name,
                version: boq.version,
                packages: boq.packages,
                unmapped_headers: boq.unmapped_headers,
            })),
            // Keep the step's order, whatever order the boxes were ticked in.
            selected_boqs: boqs.map((boq) => boq.name).filter((name) => ticked.has(name)),
        });
        onOpenChange(false);
    };

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent className="max-w-lg">
                <AlertDialogHeader>
                    <AlertDialogTitle>Add BoQs from a Tendering project</AlertDialogTitle>
                    <AlertDialogDescription>
                        When you create this project, the chosen project's BoQs move into it and that
                        project becomes <strong>Merged</strong>. It can be undone from that project later.
                    </AlertDialogDescription>
                </AlertDialogHeader>

                <div className="space-y-2">
                    <Label className="text-sm">Tendering project</Label>
                    <FuzzySearchSelect<TargetOption, false>
                        allOptions={options}
                        tokenSearchConfig={TARGET_SEARCH}
                        isLoading={projectsLoading}
                        isDisabled={!!editing}
                        value={project}
                        onChange={pickProject}
                        placeholder="Search Tendering projects…"
                        isClearable={!editing}
                        menuPortalTarget={document.body}
                        menuPosition="fixed"
                        formatOptionLabel={(option, meta) =>
                            meta.context === "value" ? (
                                option.label
                            ) : (
                                <span className="truncate">
                                    {option.label} <span className="text-muted-foreground">({option.value})</span>
                                </span>
                            )
                        }
                    />
                </div>

                {project && (
                    <div className="space-y-1.5">
                        {boqsLoading ? (
                            <div className="h-16 rounded-md border animate-pulse bg-muted/40" />
                        ) : boqs.length === 0 ? (
                            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                <Info className="h-4 w-4" />
                                This project has no BoQ to add.
                            </p>
                        ) : (
                            <>
                                <p className="text-sm">Tick the BoQs that are part of this project:</p>
                                <ul className="max-h-48 overflow-y-auto rounded-md border px-3 py-2 text-sm space-y-1.5">
                                    {boqs.map((boq) => {
                                        const id = `add-merge-boq-${boq.name}`;
                                        const on = ticked.has(boq.name);
                                        return (
                                            <li key={boq.name} className="flex items-center gap-2">
                                                <Checkbox
                                                    id={id}
                                                    checked={on}
                                                    onCheckedChange={(value) => toggle(boq.name, value === true)}
                                                />
                                                <label htmlFor={id} className="flex-1 min-w-0 cursor-pointer">
                                                    {boq.boq_name || boq.name}{" "}
                                                    <span className="text-muted-foreground">v{boq.version}</span>
                                                </label>
                                                <span
                                                    className={`text-xs whitespace-nowrap ${on ? "font-medium text-emerald-700" : "text-muted-foreground"}`}
                                                >
                                                    {on ? "→ Selected" : "→ Draft"}
                                                </span>
                                            </li>
                                        );
                                    })}
                                </ul>
                                <p className="text-xs text-muted-foreground">
                                    All its BoQs move. Ticked ones become <strong>Selected</strong>, the rest{" "}
                                    <strong>Draft</strong> (Other BoQs).
                                </p>
                            </>
                        )}
                        <BusyWarning
                            busy={busy}
                            actionLabel="Creating the project"
                            checking={checking}
                            onRecheck={recheck}
                        />
                    </div>
                )}

                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <Button disabled={!project || boqsLoading || boqs.length === 0} onClick={save}>
                        {editing ? "Save" : "Add"}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}

export default AddTenderingBoqsDialog;
