import { useMemo } from "react";
import { UseFormReturn } from "react-hook-form";
import { AlertTriangle, FileSpreadsheet, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { formatDate } from "@/utils/FormatDate";
import { ConvertBoqOption } from "@/pages/projects/data/project-form/useProjectFormQueries";
import { ProjectFormValues } from "../schema";

interface BoqSelectionStepProps {
    form: UseFormReturn<ProjectFormValues>;
    boqOptions: ConvertBoqOption[];
    isLoading: boolean;
    error: unknown;
    /** False while the package/category masters are still loading — seeding needs them. */
    canContinue: boolean;
    onNext: () => void;
    onPrevious: () => void;
}

/**
 * Convert mode only. The user ticks the BoQs the project was won on (a multi-trade
 * project is often won on several). The next step pre-ticks their packages. Nothing
 * changes here: only when the project is created do the ticked BoQs become Selected;
 * every other BoQ stays Draft (server: `select_project_boqs`, ADR-0037).
 */
export const BoqSelectionStep: React.FC<BoqSelectionStepProps> = ({
    form,
    boqOptions,
    isLoading,
    error,
    canContinue,
    onNext,
    onPrevious,
}) => {
    const selected = form.watch("selected_boqs") ?? [];
    const selectedSet = useMemo(() => new Set(selected), [selected]);

    // Keep the list in display order, whatever order the boxes were ticked in.
    const toggle = (name: string, checked: boolean) => {
        form.setValue(
            "selected_boqs",
            boqOptions.map((b) => b.name).filter((n) => (n === name ? checked : selectedSet.has(n)))
        );
    };

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

    const otherCount = boqOptions.length - selected.length;

    return (
        <div className="space-y-6">
            <div className="space-y-1">
                <Label className="text-sm font-medium text-gray-700">
                    Select the BoQs this project was won on {boqOptions.length > 0 && <span className="text-red-500">*</span>}
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
                    <span>No BoQ has been uploaded for this project. Continue and select the packages yourself.</span>
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

            {selected.length > 0 && (
                <p className="text-xs text-gray-500">
                    On create: <span className="font-medium text-gray-700">{selected.join(", ")}</span> → Selected
                    {otherCount > 0 && (
                        <>
                            {" "}· {otherCount} other BoQ{otherCount === 1 ? "" : "s"} stay{otherCount === 1 ? "s" : ""} Draft
                        </>
                    )}
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
                    disabled={isLoading || !!error || !canContinue || (boqOptions.length > 0 && selected.length === 0)}
                    className="bg-sky-500 hover:bg-sky-600 text-white px-6"
                >
                    Continue →
                </Button>
            </div>
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
