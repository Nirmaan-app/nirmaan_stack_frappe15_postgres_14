import React from "react";
import { CirclePlus, PencilLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PLACEHOLDERS } from "../constants";

export interface CustomServiceDraft {
    description: string;
    uom: string;
    quantity: number;
    rate: number;
}

export const EMPTY_CUSTOM_DRAFT: CustomServiceDraft = { description: "", uom: "", quantity: 0, rate: 0 };

/** Every field filled, quantity above 0, rate not 0 — and a negative rate only where allowed. */
export const isCustomDraftReady = (draft: CustomServiceDraft, allowNegative: boolean): boolean =>
    !!draft.description.trim() &&
    !!draft.uom.trim() &&
    draft.quantity > 0 &&
    draft.rate !== 0 &&
    (allowNegative || draft.rate > 0);

interface CustomServiceFormProps {
    packageLabel: string;
    draft: CustomServiceDraft;
    onChange: (draft: CustomServiceDraft) => void;
    onAdd: () => void;
    /** Amend flows only: the rate may be negative. Quantity never may. */
    allowNegative: boolean;
}

/** The inline "Custom Service" input area — a service that is not in the rate card. */
export const CustomServiceForm: React.FC<CustomServiceFormProps> = ({ packageLabel, draft, onChange, onAdd, allowNegative }) => {
    const rateInvalid = !allowNegative && draft.rate < 0;

    return (
        <div className="space-y-3">
            <Label className="text-sm font-medium flex items-center gap-2">
                <PencilLine className="h-4 w-4 text-primary" />
                Custom Service · adding to {packageLabel}
            </Label>
            <div className="space-y-1.5">
                <Label htmlFor="custom-description" className="text-sm font-medium">
                    Service Description <span className="text-red-500">*</span>
                </Label>
                <Textarea
                    id="custom-description"
                    placeholder={PLACEHOLDERS.description}
                    value={draft.description}
                    onChange={(e) => onChange({ ...draft, description: e.target.value })}
                    className="min-h-[88px] border-slate-200 resize-y bg-white"
                />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                    <Label htmlFor="custom-uom" className="text-sm font-medium">
                        Unit <span className="text-red-500">*</span>
                    </Label>
                    <Input
                        id="custom-uom"
                        type="text"
                        placeholder="e.g., Sq.ft, Nos, Job"
                        value={draft.uom}
                        onChange={(e) => onChange({ ...draft, uom: e.target.value })}
                        className="h-10 border-slate-200 bg-white"
                    />
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor="custom-quantity" className="text-sm font-medium">
                        Estimated Qty <span className="text-red-500">*</span>
                    </Label>
                    <Input
                        id="custom-quantity"
                        type="number"
                        placeholder="0"
                        min={0}
                        step="any"
                        value={draft.quantity || ""}
                        onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            onChange({ ...draft, quantity: isNaN(v) || v < 0 ? 0 : v });
                        }}
                        onKeyDown={(e) => {
                            if (e.key === "e" || e.key === "-") e.preventDefault();
                        }}
                        className="h-10 border-slate-200 bg-white"
                    />
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor="custom-rate" className="text-sm font-medium">
                        Rate <span className="text-red-500">*</span>
                    </Label>
                    <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₹</span>
                        <Input
                            id="custom-rate"
                            type="number"
                            placeholder="0.00"
                            step="any"
                            value={draft.rate || ""}
                            onChange={(e) => onChange({ ...draft, rate: parseFloat(e.target.value) || 0 })}
                            onKeyDown={(e) => {
                                if (e.key === "e") e.preventDefault();
                            }}
                            className={`h-10 pl-7 font-semibold bg-white ${rateInvalid ? "border-red-500 focus-visible:ring-red-500" : "border-slate-200"}`}
                        />
                    </div>
                    {rateInvalid && <p className="text-[11px] text-red-600">Rate cannot be negative.</p>}
                </div>
            </div>

            <div className="flex justify-end">
                <Button
                    type="button"
                    size="sm"
                    onClick={onAdd}
                    disabled={!isCustomDraftReady(draft, allowNegative)}
                    className="gap-2 shadow-sm"
                >
                    <CirclePlus className="h-4 w-4" />
                    Add to List
                </Button>
            </div>
        </div>
    );
};

export default CustomServiceForm;
