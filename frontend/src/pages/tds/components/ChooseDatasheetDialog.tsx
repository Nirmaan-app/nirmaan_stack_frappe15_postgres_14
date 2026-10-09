import React from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radiogroup";
import { cn } from "@/lib/utils";
import { DATASHEET_CHOICE, datasheetFileName, type DatasheetChoice } from "@/utils/tdsRequestRules";

/** A selected New Make row whose Repository Entry was added after the request was sent. */
export interface DatasheetConflictRow {
    name: string;
    itemName: string;
    make: string;
    workPackage?: string;
    repositorySheet?: string;
    requestSheet?: string;
}

interface ChooseDatasheetDialogProps {
    rows: DatasheetConflictRow[];
    choices: Record<string, DatasheetChoice>;
    onChoiceChange: (rowName: string, choice: DatasheetChoice) => void;
    /** Selected rows outside the chooser, approved in the same action. */
    otherCount: number;
    onCancel: () => void;
    onConfirm: () => void;
    loading?: boolean;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const SheetOption: React.FC<{
    rowName: string;
    value: DatasheetChoice;
    selected: boolean;
    title: string;
    sheet?: string;
    note: string;
    noteClassName: string;
}> = ({ rowName, value, selected, title, sheet, note, noteClassName }) => {
    const id = `${rowName}-${value}`;
    return (
        <label
            htmlFor={id}
            className={cn(
                "flex gap-3 items-start border rounded-lg p-3",
                selected ? "border-red-600 bg-red-50" : "border-gray-200",
                sheet ? "cursor-pointer" : "cursor-not-allowed opacity-60"
            )}
        >
            <RadioGroupItem id={id} value={value} disabled={!sheet} className="mt-0.5 shrink-0" />
            <span className="min-w-0">
                <span className="block text-sm font-semibold text-gray-900">{title}</span>
                <span className="block text-xs text-gray-500 break-all">
                    {sheet ? (
                        <>
                            {datasheetFileName(sheet)} ·{" "}
                            <a href={sheet} target="_blank" rel="noreferrer" className="text-red-600 underline">
                                Preview
                            </a>
                        </>
                    ) : (
                        "No datasheet"
                    )}
                </span>
                <span className={cn("block text-xs mt-1", noteClassName)}>{note}</span>
            </span>
        </label>
    );
};

/**
 * "Choose the correct datasheet" (#1378, mockup M3): one choice per New Make whose entry exists,
 * the repository's sheet pre-selected by the caller. Cancel approves nothing.
 */
export const ChooseDatasheetDialog: React.FC<ChooseDatasheetDialogProps> = ({
    rows,
    choices,
    onChoiceChange,
    otherCount,
    onCancel,
    onConfirm,
    loading = false,
}) => (
    <Dialog open={rows.length > 0} onOpenChange={open => !open && !loading && onCancel()}>
        <DialogContent className="sm:max-w-[560px] max-h-[90vh] flex flex-col">
            <DialogHeader>
                <DialogTitle className="text-xl font-bold">Choose the correct datasheet</DialogTitle>
                <DialogDescription>
                    {rows.length === 1
                        ? "1 of your selected items already has a repository datasheet. It was added after this request was sent."
                        : `${rows.length} of your selected items already have a repository datasheet. They were added after this request was sent.`}
                </DialogDescription>
            </DialogHeader>

            <div className="space-y-5 overflow-y-auto pr-1">
                {rows.map(row => (
                    <div key={row.name} className="space-y-2">
                        <p className="text-sm">
                            <b>{row.itemName}</b> · {row.make}
                            {row.workPackage && <span className="text-gray-500"> · {row.workPackage}</span>}
                        </p>
                        <RadioGroup
                            value={choices[row.name]}
                            onValueChange={v => onChoiceChange(row.name, v as DatasheetChoice)}
                        >
                            <SheetOption
                                rowName={row.name}
                                value={DATASHEET_CHOICE.repository}
                                selected={choices[row.name] === DATASHEET_CHOICE.repository}
                                title="Keep the repository's datasheet"
                                sheet={row.repositorySheet}
                                note="This project uses the repository's sheet. Nothing else changes."
                                noteClassName="text-gray-600"
                            />
                            <SheetOption
                                rowName={row.name}
                                value={DATASHEET_CHOICE.request}
                                selected={choices[row.name] === DATASHEET_CHOICE.request}
                                title="Use the datasheet sent with this request"
                                sheet={row.requestSheet}
                                note="Replaces the repository's datasheet for every project from now on. Projects already approved keep the sheet they were approved with."
                                noteClassName="text-amber-800"
                            />
                        </RadioGroup>
                    </div>
                ))}
                {otherCount > 0 && (
                    <p className="text-xs text-gray-500">
                        The other {plural(otherCount, "selected item is", "selected items are")} approved as usual.
                    </p>
                )}
            </div>

            <DialogFooter className="gap-2">
                <Button variant="outline" onClick={onCancel} disabled={loading}>
                    Cancel
                </Button>
                <Button
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={onConfirm}
                    disabled={loading}
                >
                    {loading ? "Approving..." : `Approve ${plural(rows.length + otherCount, "item", "items")}`}
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
);

export default ChooseDatasheetDialog;
