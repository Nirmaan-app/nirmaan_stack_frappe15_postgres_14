import { useMemo, useState } from "react";
import { UseFormReturn } from "react-hook-form";
import { AlertTriangle, FileSpreadsheet, GitMerge, Info, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { formatDate } from "@/utils/FormatDate";
import { ConvertBoqOption } from "@/pages/projects/data/project-form/useProjectFormQueries";
import { ProjectFormValues } from "../schema";
import { wizardBoqCounts, type MergeSource } from "../boqPackageSeed";
import { AddTenderingBoqsDialog } from "./AddTenderingBoqsDialog";

interface BoqSelectionStepProps {
    form: UseFormReturn<ProjectFormValues>;
    /** Convert mode: this stub's own BoQs. Create mode has none. */
    isConvertMode: boolean;
    /** The stub being converted (never offered as a source), if any. */
    currentProjectId?: string;
    boqOptions: ConvertBoqOption[];
    isLoading: boolean;
    error: unknown;
    /** False while the package/category masters are still loading — seeding needs them. */
    canContinue: boolean;
    onNext: () => void;
    onPrevious: () => void;
}

/**
 * The BOQ step, in both modes. Convert: tick the stub's own BoQs it was won on. Both modes: add
 * BoQs from other Tendering projects (ADR-0038, owner 2026-10-21) — on Create each added project
 * is merged in. Ticked BoQs (own or added) become Selected, the rest Draft, and their packages
 * pre-tick the next step. Nothing changes here: only Create saves (server: `select_project_boqs`,
 * `tendering_merge.merge_sources_into`). At least one BoQ must be ticked overall whenever any BoQ
 * is involved; there is no minimum per project.
 */
export const BoqSelectionStep: React.FC<BoqSelectionStepProps> = ({
    form,
    isConvertMode,
    currentProjectId,
    boqOptions,
    isLoading,
    error,
    canContinue,
    onNext,
    onPrevious,
}) => {
    const selected = form.watch("selected_boqs") ?? [];
    const sources = (form.watch("merge_sources") ?? []) as MergeSource[];
    const selectedSet = useMemo(() => new Set(selected), [selected]);

    // "Will you add BoQs from another Tendering project?" -- asked once, then a button.
    const [answeredNo, setAnsweredNo] = useState(false);
    const [dialog, setDialog] = useState<{ editing: MergeSource | null } | null>(null);

    // Keep the list in display order, whatever order the boxes were ticked in.
    const toggle = (name: string, checked: boolean) => {
        form.setValue(
            "selected_boqs",
            boqOptions.map((b) => b.name).filter((n) => (n === name ? checked : selectedSet.has(n)))
        );
    };

    const saveSource = (source: MergeSource) => {
        const others = sources.filter((s) => s.project !== source.project);
        const index = sources.findIndex((s) => s.project === source.project);
        const next = index >= 0 ? [...others.slice(0, index), source, ...others.slice(index)] : [...sources, source];
        form.setValue("merge_sources", next);
    };
    const removeSource = (project: string) =>
        form.setValue("merge_sources", sources.filter((s) => s.project !== project));
    // Tick / untick one BoQ of an added project, keeping its BoQs' order.
    const toggleSourceBoq = (project: string, boqName: string, on: boolean) =>
        form.setValue(
            "merge_sources",
            sources.map((s) =>
                s.project !== project
                    ? s
                    : {
                          ...s,
                          selected_boqs: s.boqs
                              .map((b) => b.name)
                              .filter((n) => (n === boqName ? on : s.selected_boqs.includes(n))),
                      }
            )
        );

    // Rows arrive grouped by boq_name, highest version first — keep that grouping.
    const groups = useMemo(() => {
        const result: { boqName: string; rows: ConvertBoqOption[] }[] = [];
        for (const row of boqOptions) {
            const last = result[result.length - 1];
            if (last && last.boqName === row.boq_name) last.rows.push(row);
            else result.push({ boqName: row.boq_name, rows: [row] });
        }
        return result;
    }, [boqOptions]);

    const counts = wizardBoqCounts(boqOptions.length, selected, sources);
    const needsTick = counts.boqs > 0 && counts.ticked === 0;
    const excludeProjects = useMemo(
        () => [
            ...(currentProjectId ? [currentProjectId] : []),
            ...sources.map((s) => s.project).filter((p) => p !== dialog?.editing?.project),
        ],
        [currentProjectId, sources, dialog]
    );

    return (
        <div className="space-y-6">
            {isConvertMode && (
                <>
                    <div className="space-y-1">
                        <Label className="text-sm font-medium text-gray-700">
                            Select the BoQs this project was won on{" "}
                            {counts.boqs > 0 && <span className="text-red-500">*</span>}
                        </Label>
                        <p className="text-xs text-gray-500">
                            Tick every BoQ that is part of the award — their packages are pre-selected in the next step.
                            Nothing changes yet: when you create the project, the ticked BoQs become{" "}
                            <span className="font-medium">Selected</span> and the rest stay{" "}
                            <span className="font-medium">Draft</span>. After that, only an Admin can edit a Draft BoQ
                            or change which BoQs are Selected.
                        </p>
                    </div>

                    {isLoading ? (
                        <div className="border border-gray-200 rounded">
                            {[1, 2, 3].map((i) => (
                                <div key={i} className="h-14 border-b border-gray-100 last:border-b-0 animate-pulse bg-gray-50" />
                            ))}
                        </div>
                    ) : error ? (
                        <div className="flex items-start gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            <span>Could not load this project's BoQs. Reload the page to try again.</span>
                        </div>
                    ) : boqOptions.length === 0 ? (
                        <div className="flex items-start gap-2 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            <span>No BoQ has been uploaded for this project.</span>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {groups.map((group) => (
                                <div key={group.boqName} className="space-y-2">
                                    <p className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
                                        <FileSpreadsheet className="h-3.5 w-3.5" />
                                        {group.boqName}
                                    </p>
                                    {group.rows.map((boq) => (
                                        <BoqOptionCard
                                            key={boq.name}
                                            boq={boq}
                                            isSelected={selectedSet.has(boq.name)}
                                            onToggle={toggle}
                                        />
                                    ))}
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}

            {/* BoQs from other Tendering projects (both modes). */}
            <div className="space-y-3">
                <div className="space-y-1">
                    <Label className="text-sm font-medium text-gray-700">
                        BoQs from other Tendering projects
                        {!isConvertMode && counts.boqs > 0 && <span className="text-red-500"> *</span>}
                    </Label>
                    <p className="text-xs text-gray-500">
                        Won as part of another tender too? Add that Tendering project here: when you create this
                        project, all its BoQs move in — ticked ones <span className="font-medium">Selected</span>, the
                        rest <span className="font-medium">Draft</span> — and that project becomes{" "}
                        <span className="font-medium">Merged</span>.
                    </p>
                </div>

                {sources.map((source) => {
                    const tickedSet = new Set(source.selected_boqs);
                    const ticked = source.selected_boqs.length;
                    const drafts = source.boqs.length - ticked;
                    return (
                        <div key={source.project} className="rounded border border-violet-200 bg-violet-50/50">
                            <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                                <GitMerge className="h-4 w-4 shrink-0 text-violet-600" />
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium text-gray-800">
                                        {source.project_name}{" "}
                                        <span className="text-xs text-gray-500">({source.project})</span>
                                    </p>
                                    <p className="text-xs text-gray-500">
                                        {source.boqs.length} BoQ{source.boqs.length === 1 ? "" : "s"} · {ticked} Selected,{" "}
                                        {drafts} Draft
                                    </p>
                                </div>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="text-gray-500 hover:text-red-600"
                                    onClick={() => removeSource(source.project)}
                                >
                                    <X className="mr-1 h-3.5 w-3.5" />
                                    Remove
                                </Button>
                            </div>
                            {/* Each BoQ, ticked here: ticked → Selected, unticked → Draft on Create. */}
                            <ul className="space-y-1 border-t border-violet-100 px-3 py-2">
                                {source.boqs.map((boq) => {
                                    const id = `merge-source-${source.project}-${boq.name}`;
                                    const on = tickedSet.has(boq.name);
                                    return (
                                        <li key={boq.name} className="flex items-center gap-2 text-sm">
                                            <Checkbox
                                                id={id}
                                                checked={on}
                                                onCheckedChange={(value) =>
                                                    toggleSourceBoq(source.project, boq.name, value === true)
                                                }
                                            />
                                            <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer text-gray-800">
                                                {boq.boq_name || boq.name}{" "}
                                                <span className="text-xs text-gray-500">
                                                    {boq.name} · v{boq.version}
                                                </span>
                                            </label>
                                            <span
                                                className={`text-xs whitespace-nowrap ${
                                                    on ? "font-medium text-emerald-700" : "text-gray-500"
                                                }`}
                                            >
                                                {on ? "→ Selected" : "→ Draft"}
                                            </span>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    );
                })}

                {sources.length === 0 && !answeredNo ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-gray-200 bg-gray-50 px-3 py-2.5">
                        <span className="text-sm text-gray-700">Will you add BoQs from another Tendering project?</span>
                        <div className="flex gap-2">
                            <Button type="button" size="sm" onClick={() => setDialog({ editing: null })}>
                                Yes, add
                            </Button>
                            <Button type="button" size="sm" variant="outline" onClick={() => setAnsweredNo(true)}>
                                No
                            </Button>
                        </div>
                    </div>
                ) : (
                    <Button type="button" variant="outline" size="sm" onClick={() => setDialog({ editing: null })}>
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        Add from another Tendering project
                    </Button>
                )}
            </div>

            {counts.boqs > 0 && (
                <p className={`text-xs ${needsTick ? "text-red-600" : "text-gray-500"}`}>
                    {needsTick
                        ? "Tick at least one BoQ, from this project or from another Tendering project."
                        : `On create: ${counts.ticked} BoQ${counts.ticked === 1 ? "" : "s"} → Selected · ${
                              counts.boqs - counts.ticked
                          } stay${counts.boqs - counts.ticked === 1 ? "s" : ""} Draft`}
                </p>
            )}

            {/* Navigation */}
            <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                <Button
                    type="button"
                    variant="ghost"
                    onClick={onPrevious}
                    className="text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                >
                    ← Previous
                </Button>
                <Button
                    type="button"
                    onClick={onNext}
                    disabled={isLoading || !!error || !canContinue || needsTick}
                    className="bg-sky-500 hover:bg-sky-600 text-white px-6"
                >
                    Continue →
                </Button>
            </div>

            {/* Mounted only while open, so each open starts from the project being edited (or none). */}
            {dialog && (
                <AddTenderingBoqsDialog
                    open
                    onOpenChange={(open) => {
                        if (!open) setDialog(null);
                    }}
                    excludeProjects={excludeProjects}
                    editing={dialog.editing}
                    onSave={saveSource}
                />
            )}
        </div>
    );
};

const BoqOptionCard: React.FC<{
    boq: ConvertBoqOption;
    isSelected: boolean;
    onToggle: (name: string, checked: boolean) => void;
}> = ({ boq, isSelected, onToggle }) => {
    const id = `boq-option-${boq.name}`;
    return (
        <label
            htmlFor={id}
            className={`flex items-start gap-3 rounded border px-3 py-2.5 cursor-pointer ${
                isSelected ? "border-sky-400 bg-sky-50/60" : "border-gray-200 hover:bg-gray-50"
            }`}
        >
            <Checkbox
                id={id}
                checked={isSelected}
                onCheckedChange={(checked) => onToggle(boq.name, checked === true)}
                className="mt-0.5"
            />
            <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-gray-800">{boq.name}</span>
                    <span className="text-xs text-gray-500">v{boq.version}</span>
                    {boq.is_latest && (
                        <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 border border-emerald-200">
                            Latest
                        </span>
                    )}
                    {boq.origin === "revision" && (
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600 border border-gray-200">
                            Revision
                        </span>
                    )}
                </div>
                <p className="text-xs text-gray-500">
                    {boq.uploaded_at ? `Uploaded ${formatDate(boq.uploaded_at)}` : "Uploaded"}
                    {boq.uploaded_by_name ? ` by ${boq.uploaded_by_name}` : ""} ·{" "}
                    {boq.committed_sheets} committed sheet{boq.committed_sheets === 1 ? "" : "s"}
                </p>
                {boq.packages.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                        {boq.packages.map((pkg) => (
                            <span
                                key={pkg}
                                className="rounded bg-sky-50 px-2 py-0.5 text-[11px] text-sky-700 border border-sky-200"
                            >
                                {pkg}
                            </span>
                        ))}
                    </div>
                ) : (
                    <p className="text-xs text-gray-400 italic">
                        {boq.committed_sheets > 0 ? "No package mapped" : "Not committed — no packages to pre-select"}
                    </p>
                )}
                {boq.unmapped_headers.length > 0 && (
                    <p className="flex items-start gap-1.5 text-xs text-amber-700">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        <span>
                            {boq.unmapped_headers.join(", ")} {boq.unmapped_headers.length === 1 ? "has" : "have"} no
                            single package — tick {boq.unmapped_headers.length === 1 ? "it" : "them"} in the next step
                        </span>
                    </p>
                )}
            </div>
        </label>
    );
};

export default BoqSelectionStep;
