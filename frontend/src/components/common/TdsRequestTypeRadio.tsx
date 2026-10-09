import React from "react";

/**
 * The "Type" choice of a Project TDS (Technical Data Sheet) request: two stacked radio cards, each
 * with one line of help. Shared by the Request New dialog (Project → TDS) and the Admin's request
 * edit dialog (TDS Approval → Pending Review), so both offer the same choices with the same words.
 */

export const TDS_REQUEST_MODES = ["new_make", "project_custom"] as const;
export type TdsRequestMode = (typeof TDS_REQUEST_MODES)[number];

const TDS_REQUEST_TYPE_CHOICES: { value: TdsRequestMode; label: string; help: string }[] = [
    {
        value: "new_make",
        label: "Add New Make to an Existing TDS Item",
        help: "The item is in the repository but this make has no datasheet yet. Approving adds it to the repository.",
    },
    {
        value: "project_custom",
        label: "Create a Project Specific Custom TDS Item",
        help: "Only for this project. It never goes into the TDS Repository.",
    },
];

interface TdsRequestTypeRadioProps {
    value: TdsRequestMode;
    onChange: (mode: TdsRequestMode) => void;
}

export const TdsRequestTypeRadio: React.FC<TdsRequestTypeRadioProps> = ({ value, onChange }) => (
    <fieldset className="space-y-2">
        <legend className="text-sm font-bold text-gray-700 mb-2">Type</legend>
        <div role="radiogroup" aria-label="Type" className="space-y-2">
            {TDS_REQUEST_TYPE_CHOICES.map(choice => {
                const on = value === choice.value;
                return (
                    <button
                        key={choice.value}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => onChange(choice.value)}
                        className={`w-full text-left flex gap-3 items-start rounded-lg border p-3 transition-colors ${on ? "border-[#dc2626] bg-red-50" : "border-gray-200 hover:bg-gray-50"}`}
                    >
                        <span className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center ${on ? "border-[#dc2626]" : "border-gray-300"}`}>
                            {on && <span className="h-2 w-2 rounded-full bg-[#dc2626]" />}
                        </span>
                        <span>
                            <span className="block text-sm font-semibold text-gray-900">{choice.label}</span>
                            <span className="block text-xs text-gray-500">{choice.help}</span>
                        </span>
                    </button>
                );
            })}
        </div>
    </fieldset>
);
