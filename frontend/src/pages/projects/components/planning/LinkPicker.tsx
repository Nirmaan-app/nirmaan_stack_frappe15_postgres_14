// The "Link / Change PO" (and WO) pieces shared by the Material Plan and Cashflow Edit dialogs (F3: one parametric
// module, not three copies): the ID badge in the dialog header with a ✏️ inside, and the picker panel it opens at
// the top of the form. Each dialog builds its own options and texts; the rules live in utils/materialPlan/poLink
// and utils/cashflowPlan/cashflowLink.

import type { ReactNode } from "react";
import { Link2, Pencil } from "lucide-react";
import { Label } from "@/components/ui/label";
import { FuzzySearchSelect, type TokenSearchConfig } from "@/components/ui/fuzzy-search-select";
import { criticalFieldsForPO, poOptionLabel, posForPicker, type PlanCriticalFields } from "@/utils/materialPlan/poLink";
import type { POLinkPicker } from "./usePOLinkPicker";

/** The picker searches the ID, the rest of the label (vendor, task) and an option's hidden `searchText`. */
const LINK_SEARCH_CONFIG: TokenSearchConfig = {
    searchFields: ["label", "value", "searchText"],
    partialMatch: true,
    fieldWeights: { value: 2.0, label: 1.5, searchText: 1.0 },
};

export interface LinkOption {
    value: string;
    label: string;
    /** Searched but not shown, e.g. a WO's descriptions. */
    searchText?: string;
}

interface EditableLinkBadgeProps {
    /** e.g. "PO: PO/012/00107/26-27" or "WO ID: SR-00107-001158". */
    text: string;
    /** A picked, unsaved PO / WO: shown highlighted until Confirm. */
    changed: boolean;
    /** Only Admin + PMO get the ✏️ (the server refuses anyone else). */
    canEdit: boolean;
    /** "Link PO" / "Change PO" / "Link WO" / "Change WO". */
    editLabel: string;
    onEdit: () => void;
    /** The tooltip while a pick is unsaved, e.g. "Not saved yet (was PO/105/…)". */
    changedHint?: string;
}

/** The ID badge in a dialog header; with `canEdit` the whole badge is the button and the ✏️ sits inside it. */
export const EditableLinkBadge = ({ text, changed, canEdit, editLabel, onEdit, changedHint }: EditableLinkBadgeProps) => {
    const tone = changed ? "border-blue-300 bg-blue-50 text-blue-700" : "border-gray-200 bg-white text-gray-600";
    const base = "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap";
    if (!canEdit) {
        return (
            <span className={`${base} ${tone}`} title={changed ? changedHint : undefined}>
                {text}
            </span>
        );
    }
    return (
        <button
            type="button"
            onClick={onEdit}
            title={changed && changedHint ? changedHint : editLabel}
            aria-label={`${text}. ${editLabel}`}
            className={`${base} ${tone} transition-colors hover:border-blue-300 hover:bg-blue-50`}
        >
            {text}
            <Pencil className="w-3 h-3 text-blue-600" aria-hidden="true" />
        </button>
    );
};

interface LinkPickerPanelProps {
    /** "Link a PO" / "Change PO" / "Link a WO" / "Change WO". */
    title: string;
    options: LinkOption[];
    value: LinkOption | null;
    onPick: (value: string) => void;
    isLoading: boolean;
    placeholder: string;
    ariaLabel: string;
    /** Shown instead of the select, e.g. "No POs are linked to this plan's task". */
    emptyMessage?: string | null;
    /** e.g. "2 POs linked to this plan's task (Low Pressure Plenum)." */
    summary?: ReactNode;
    /** e.g. "See all project POs" / "Show only this task's POs". */
    toggle?: { label: string; onClick: () => void } | null;
    /** A New PO / New WO entry's typed-in items, shown as "You planned: …". */
    plannedItems?: string[];
    /** e.g. "the plan's task will change to …". */
    warning?: ReactNode;
    /** e.g. "Then tick the items from that PO below …". */
    footnote?: ReactNode;
    /** "Keep it as New PO" / "Keep the current PO"; undoes the pick. */
    keepLabel: string;
    onKeep: () => void;
}

/** The picker panel the badge opens at the top of the form. */
export const LinkPickerPanel = ({
    title, options, value, onPick, isLoading, placeholder, ariaLabel, emptyMessage, summary, toggle,
    plannedItems, warning, footnote, keepLabel, onKeep,
}: LinkPickerPanelProps) => (
    <div className="space-y-3 p-3 border border-blue-200 rounded-lg bg-blue-50/30">
        <Label className="flex items-center gap-2 font-bold text-gray-700">
            <Link2 className="w-4 h-4" />
            {title}
        </Label>
        {emptyMessage ? (
            <p className="text-sm text-gray-600">{emptyMessage}</p>
        ) : (
            <FuzzySearchSelect
                allOptions={options}
                tokenSearchConfig={LINK_SEARCH_CONFIG}
                value={value}
                onChange={(option) => option && onPick(option.value)}
                isLoading={isLoading}
                placeholder={placeholder}
                aria-label={ariaLabel}
                menuPortalTarget={document.body}
                menuPosition="fixed"
            />
        )}
        {(summary || toggle) && (
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-gray-500">
                <span>{summary}</span>
                {toggle && (
                    <button type="button" onClick={toggle.onClick} className="font-medium text-blue-700 hover:underline">
                        {toggle.label}
                    </button>
                )}
            </div>
        )}
        {plannedItems && plannedItems.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="font-semibold text-gray-700">You planned:</span>
                {plannedItems.map((name, i) => (
                    <span key={i} className="px-2 py-0.5 rounded bg-white border border-gray-200 text-gray-700">
                        {name}
                    </span>
                ))}
            </div>
        )}
        {warning && <p className="text-[11px] text-amber-700">{warning}</p>}
        {footnote && <p className="text-[11px] text-gray-500">{footnote}</p>}
        <button type="button" onClick={onKeep} className="text-xs font-medium text-gray-600 hover:text-gray-900 underline">
            {keepLabel}
        </button>
    </div>
);

interface POLinkPickerPanelProps {
    picker: POLinkPicker;
    /** The entry's Critical PO fields (the list defaults to this task's POs). */
    plan: PlanCriticalFields;
    /** A New PO entry: the panel says "Link a PO" / "Keep it as New PO". */
    isNew: boolean;
    /** What the PO list is for, e.g. "plan" or "entry" ("POs linked to this plan's task"). */
    noun: string;
    /** A New PO entry's typed-in items. */
    plannedItems?: string[];
    /** The form's own reaction to a pick (reset the item ticks, fill the vendor, …). */
    onPick: (poName: string) => void;
    /** The form's own undo (restore its items, vendor, …); the picker resets itself. */
    onKeep: () => void;
}

/**
 * The PO picker panel, like Add Material Plan: the entry's task POs by default, "See all project POs" for the rest
 * (each of another task labelled with it), and a warning when the picked PO moves the entry to another task.
 */
export const POLinkPickerPanel = ({ picker, plan, isNew, noun, plannedItems, onPick, onKeep }: POLinkPickerPanelProps) => {
    const taskName = plan.critical_po_task;
    const taskPOCount = posForPicker(picker.projectPOs, plan, false).length;
    const options = posForPicker(picker.projectPOs, plan, picker.showAll).map((po) => ({
        value: po.name,
        label: poOptionLabel(po, plan, picker.showAll),
    }));
    const target = picker.targetPO;
    const next = target && picker.changed ? criticalFieldsForPO(target, plan) : null;
    const taskWillChange = !!next && (
        next.critical_po_task !== (plan.critical_po_task || null) ||
        next.critical_po_category !== (plan.critical_po_category || null)
    );
    const taskText = taskName ? ` (${taskName})` : "";

    return (
        <LinkPickerPanel
            title={isNew ? "Link a PO" : "Change PO"}
            options={options}
            value={target ? { value: target.name, label: poOptionLabel(target, plan, picker.showAll) } : null}
            onPick={(poName) => {
                picker.pick(poName);
                onPick(poName);
            }}
            isLoading={picker.isLoading}
            placeholder="Search PO number or vendor…"
            ariaLabel={`Pick the PO for this ${noun}`}
            emptyMessage={picker.loaded && !picker.showAll && taskPOCount === 0 ? `No POs are linked to this ${noun}'s task${taskText}.` : null}
            summary={
                picker.showAll
                    ? `All ${picker.projectPOs.length} project POs; this task's own are listed first.`
                    : picker.loaded
                        ? `${taskPOCount} PO${taskPOCount === 1 ? "" : "s"} linked to this ${noun}'s task${taskText}.`
                        : "Loading POs…"
            }
            toggle={picker.loaded ? {
                label: picker.showAll ? "Show only this task's POs" : "See all project POs",
                onClick: () => picker.setShowAll(!picker.showAll),
            } : null}
            plannedItems={isNew ? plannedItems : undefined}
            warning={taskWillChange && next ? (
                <>
                    This PO is linked to another task, so the {noun}'s task will change to{" "}
                    <span className="font-semibold">{next.critical_po_category} / {next.critical_po_task}</span>.
                </>
            ) : null}
            footnote={`Then tick the items from that PO below; the ${noun} keeps only the ticked items.`}
            keepLabel={isNew ? "Keep it as New PO" : "Keep the current PO"}
            onKeep={() => {
                picker.reset();
                onKeep();
            }}
        />
    );
};
