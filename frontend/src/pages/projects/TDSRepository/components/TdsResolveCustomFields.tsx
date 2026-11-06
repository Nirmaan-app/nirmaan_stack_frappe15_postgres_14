import React from "react";
import ReactSelect from "react-select";
import { CustomAttachment } from "@/components/helpers/CustomAttachment";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getSelectStyles } from "@/config/selectTheme";
import { useTdsProjectCustomOptions } from "@/hooks/useTdsProjectCustomOptions";
import {
    CUSTOM_RESOLVE_FIELD_LABEL,
    datasheetFileName,
    type CustomResolveDraft,
} from "@/utils/tdsRequestRules";

type Option = { label: string; value: string };

interface TdsResolveCustomFieldsProps {
    draft: CustomResolveDraft;
    onChange: (draft: CustomResolveDraft) => void;
    /** The Makelist makes on offer for the draft's name, the row's own first. */
    makeOptions: Option[];
    /** From `customResolveCheck`: the fields changed, and a row the draft's name + make clashes with. */
    check: { changed: (keyof CustomResolveDraft)[]; clash?: { tds_request_id?: string | null } };
    sheetFile: File | null;
    onSheetFile: (file: File | null) => void;
    /** The row's current datasheet URL, which stays unless a new one is uploaded. */
    currentSheet?: string | null;
    disabled: boolean;
}

const SELECT_PROPS = {
    styles: getSelectStyles<Option>(),
    menuPortalTarget: typeof document !== "undefined" ? document.body : undefined,
    menuPosition: "fixed" as const,
};

const valueOf = (options: Option[], value: string) =>
    options.find(o => o.value === value) ?? (value ? { label: value, value } : null);

/**
 * The Project Custom part of the Resolve dialog: the request's own fields, as the approval page's
 * request edit has them, but with no Type switch (GLOSSARY "Resolve"). The Work Package and
 * Category lists are that edit's (`useTdsProjectCustomOptions`). A new datasheet is optional; once
 * anything changes without one, a note asks the user to check the current sheet still matches.
 */
export const TdsResolveCustomFields: React.FC<TdsResolveCustomFieldsProps> = ({
    draft,
    onChange,
    makeOptions,
    check,
    sheetFile,
    onSheetFile,
    currentSheet,
    disabled,
}) => {
    const { packageOptions, categoryOptions, isLoadingCategories } = useTdsProjectCustomOptions(true, draft.work_package);
    const set = (patch: Partial<CustomResolveDraft>) => onChange({ ...draft, ...patch });
    const changedText = check.changed.map(f => CUSTOM_RESOLVE_FIELD_LABEL[f]).join(", ");

    return (
        <div className="space-y-3" data-testid="tds-resolve-custom">
            <div className="space-y-1.5">
                <Label htmlFor="tds-resolve-name">Item Name<span className="text-red-500 ml-0.5">*</span></Label>
                <Input
                    id="tds-resolve-name"
                    value={draft.tds_item_name}
                    onChange={e => set({ tds_item_name: e.target.value })}
                    disabled={disabled}
                />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5 min-w-0">
                    <Label htmlFor="tds-resolve-wp">Work Package<span className="text-red-500 ml-0.5">*</span></Label>
                    <ReactSelect<Option>
                        inputId="tds-resolve-wp"
                        options={packageOptions}
                        value={valueOf(packageOptions, draft.work_package)}
                        // A Category belongs to one package, so a package change clears it.
                        onChange={opt => {
                            const next = opt?.value ?? "";
                            if (next !== draft.work_package) set({ work_package: next, category: "" });
                        }}
                        placeholder="Select Work Package"
                        isDisabled={disabled}
                        {...SELECT_PROPS}
                    />
                </div>
                <div className="space-y-1.5 min-w-0">
                    <Label htmlFor="tds-resolve-category">Category<span className="text-red-500 ml-0.5">*</span></Label>
                    <ReactSelect<Option>
                        inputId="tds-resolve-category"
                        options={categoryOptions}
                        value={valueOf(categoryOptions, draft.category)}
                        onChange={opt => set({ category: opt?.value ?? "" })}
                        placeholder={draft.work_package ? "Select Category" : "Pick a Work Package first"}
                        isDisabled={disabled || !draft.work_package}
                        isLoading={isLoadingCategories}
                        noOptionsMessage={() => "No categories under this package"}
                        {...SELECT_PROPS}
                    />
                </div>
            </div>
            <div className="space-y-1.5">
                <Label htmlFor="tds-resolve-custom-make">Make<span className="text-red-500 ml-0.5">*</span></Label>
                <ReactSelect<Option>
                    inputId="tds-resolve-custom-make"
                    options={makeOptions}
                    value={makeOptions.find(o => o.value === draft.make) ?? null}
                    onChange={opt => set({ make: opt?.value ?? "" })}
                    placeholder="Select a make"
                    isDisabled={disabled}
                    {...SELECT_PROPS}
                />
            </div>
            <div className="space-y-1.5">
                <Label htmlFor="tds-resolve-boq">BOQ Line Item</Label>
                <Input
                    id="tds-resolve-boq"
                    value={draft.tds_boq_line_item}
                    onChange={e => set({ tds_boq_line_item: e.target.value })}
                    disabled={disabled}
                />
            </div>
            <div className="space-y-1.5">
                <Label htmlFor="tds-resolve-description">
                    Description <span className="text-gray-400 font-normal">(Optional)</span>
                </Label>
                <Textarea
                    id="tds-resolve-description"
                    rows={2}
                    value={draft.description}
                    onChange={e => set({ description: e.target.value })}
                    disabled={disabled}
                    className="resize-none"
                />
            </div>
            <div className="space-y-1.5">
                <Label>Datasheet <span className="text-gray-400 font-normal">(upload only to replace it)</span></Label>
                <CustomAttachment
                    selectedFile={sheetFile}
                    onFileSelect={onSheetFile}
                    acceptedTypes="application/pdf"
                    label="Upload new PDF"
                    maxFileSize={50 * 1024 * 1024}
                    className="w-full"
                    disabled={disabled}
                />
                {currentSheet && !sheetFile && (
                    <p className="text-xs text-gray-500">
                        Current:{" "}
                        <a href={currentSheet} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                            {datasheetFileName(currentSheet) || "View current datasheet"}
                        </a>
                    </p>
                )}
            </div>
            {check.changed.length > 0 && !sheetFile && (
                <p
                    className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
                    data-testid="tds-resolve-check-sheet"
                >
                    You changed the {changedText}. Check the current datasheet still matches; upload a new one if it
                    doesn't.
                </p>
            )}
            {check.clash && (
                <p className="text-xs font-medium text-red-600" data-testid="tds-resolve-clash">
                    {draft.tds_item_name.trim()} ({draft.make}) is already on this project in{" "}
                    {check.clash.tds_request_id || "another request"}.
                </p>
            )}
        </div>
    );
};
