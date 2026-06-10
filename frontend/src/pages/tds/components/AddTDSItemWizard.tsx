import React, { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useFrappeCreateDoc } from "frappe-react-sdk";
import RSelect from "react-select";
import { Trash2, PackagePlus, Layers, ListChecks } from "lucide-react";

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { WizardSteps } from "@/components/ui/wizard-steps";
import { FuzzySearchSelect } from "@/components/ui/fuzzy-search-select";
import { useTDSItemOptions } from "../hooks/useTDSItemOptions";

// ─────────────────────────────────────────────────────────────────────────────
// Why this exists: the restructured TDS Repository groups several Items-master
// SKUs under one reusable "TDS Item" (one datasheet often specs many catalog
// items). This wizard authors ONLY a `TDS Item` doc — NOT a TDS Repository
// entry (the datasheet/make entry is a separate "Add Entry" flow). Admin-only.
// Design source of truth: nirmaan_stack/.claude/context/domain/tds/phase-1-plan.md (T5).
// ─────────────────────────────────────────────────────────────────────────────

type Mode = "Normal" | "Custom";

// A member row staged in the wizard before submission.
interface MemberRow {
    /** Items-master row name — the value sent to the backend as `member.item`. */
    value: string;
    /** item_name for display. */
    label: string;
    /** category row name. */
    category: string;
    /** human-readable category name for display. */
    categoryName: string;
}

// Form schema — only label + WP are validated by zod. Members are managed in
// local state (a table) and validated imperatively before advancing/submitting,
// mirroring how multi-add tables work elsewhere in the codebase.
const wizardSchema = z.object({
    tds_item_name: z.string().min(1, "TDS Item name is required."),
    work_package: z.string().min(1, "Work Package is required."),
    description: z.string().optional(),
});

type WizardValues = z.infer<typeof wizardSchema>;

export interface AddTDSItemWizardProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Called after a TDS Item is created so the parent can refresh its list. */
    onCreated?: () => void;
}

// react-select portal styles so the menu escapes the Dialog's overflow/stacking.
// pointerEvents:"auto" — Radix Dialog sets pointer-events:none on document.body; a menu portaled there inherits it and swallows mouse clicks, so we re-enable them on the portal.
const PORTAL_SELECT_STYLES = {
    menuPortal: (base: any) => ({ ...base, zIndex: 9999, pointerEvents: "auto" }),
    control: (base: any) => ({ ...base, minHeight: "40px", borderRadius: "8px", borderColor: "#e5e7eb" }),
};

const NORMAL_STEPS = [
    { key: "details", title: "Details", shortTitle: "Details", icon: Layers },
    { key: "members", title: "Members", shortTitle: "Members", icon: PackagePlus },
    { key: "review", title: "Review", shortTitle: "Review", icon: ListChecks },
];

export const AddTDSItemWizard: React.FC<AddTDSItemWizardProps> = ({
    open,
    onOpenChange,
    onCreated,
}) => {
    const [mode, setMode] = useState<Mode>("Normal");
    const [step, setStep] = useState(0); // Normal mode only (0=details,1=members,2=review)
    const [members, setMembers] = useState<MemberRow[]>([]);

    const { createDoc, loading: creating } = useFrappeCreateDoc();

    const form = useForm<WizardValues>({
        resolver: zodResolver(wizardSchema),
        defaultValues: {
            tds_item_name: "",
            work_package: "",
            description: "",
        },
    });

    const selectedWP = form.watch("work_package");

    // Reuse the WP→categories→items derivation. `itemOptionsForWP` lists every
    // Items SKU under the selected Work Package, regardless of category (we pass
    // no `selectedCategory`), which is exactly the cross-category member picker
    // we need here.
    const { wpOptions, itemOptionsForWP } = useTDSItemOptions({ selectedWP });

    // Annotate options with showCategory (when the same item_name appears across
    // multiple categories, surface the category to disambiguate) and exclude
    // items already added as members.
    const memberOptions = useMemo(() => {
        const addedIds = new Set(members.map((m) => m.value));
        const nameCounts = new Map<string, number>();
        itemOptionsForWP.forEach((item) => {
            nameCounts.set(item.label, (nameCounts.get(item.label) || 0) + 1);
        });
        return itemOptionsForWP
            .filter((item) => !addedIds.has(item.value))
            .map((item) => ({
                label: item.label,
                value: item.value,
                category: item.category,
                categoryName: item.categoryName,
                showCategory: (nameCounts.get(item.label) || 0) > 1,
            }));
    }, [itemOptionsForWP, members]);

    // Reset everything when the dialog closes.
    useEffect(() => {
        if (!open) {
            form.reset();
            setMembers([]);
            setStep(0);
            setMode("Normal");
        }
    }, [open, form]);

    // Switching Work Package invalidates any staged members (they're WP-scoped).
    const prevWP = React.useRef(selectedWP);
    useEffect(() => {
        if (selectedWP !== prevWP.current) {
            if (members.length > 0) setMembers([]);
            prevWP.current = selectedWP;
        }
    }, [selectedWP, members.length]);

    const handleModeChange = (next: Mode) => {
        if (next === mode) return;
        setMode(next);
        setStep(0);
        setMembers([]);
    };

    const handleAddMember = (opt: any) => {
        if (!opt?.value) return;
        // Guard against double-add (the option list already filters added ones,
        // but defend against rapid selection / stale state).
        if (members.some((m) => m.value === opt.value)) return;
        setMembers((prev) => [
            ...prev,
            {
                value: opt.value,
                label: opt.label,
                category: opt.category || "",
                categoryName: opt.categoryName || opt.category || "",
            },
        ]);
    };

    const handleRemoveMember = (value: string) => {
        setMembers((prev) => prev.filter((m) => m.value !== value));
    };

    // Advance from Details → Members (or → Review depending on step).
    const handleNext = async () => {
        if (step === 0) {
            const valid = await form.trigger(["tds_item_name", "work_package"]);
            if (!valid) return;
            setStep(1);
        } else if (step === 1) {
            // Members are optional at the schema level, but Normal mode is for
            // grouping — nudge the user to add at least one.
            if (members.length === 0) {
                toast({
                    title: "No members added",
                    description: "Add at least one item, or switch to Custom mode for a member-less TDS Item.",
                    variant: "destructive",
                });
                return;
            }
            setStep(2);
        }
    };

    const handleBack = () => {
        if (step > 0) setStep((s) => s - 1);
    };

    const submit = async () => {
        const valid = await form.trigger();
        if (!valid) {
            // For Custom mode the schema fields live on step 0; surface them.
            if (mode === "Custom") setStep(0);
            return;
        }
        const values = form.getValues();

        try {
            const payload: Record<string, any> = {
                tds_item_name: values.tds_item_name,
                work_package: values.work_package,
                description: values.description || "",
            };

            if (mode === "Normal") {
                // item_name / category are fetched server-side via fetch_from on
                // the TDS Item Member child table — send only the `item` link.
                payload.members = members.map((m) => ({ item: m.value }));
            }
            // Custom mode: omit members → member-less TDS Item (the backend
            // treats zero members as a custom item; no category, no Items write).

            await createDoc("TDS Items", payload);

            toast({ title: "Success", description: "TDS Item created successfully" });
            onCreated?.();
            onOpenChange(false);
        } catch (e: any) {
            console.error("Error creating TDS Item:", e);
            toast({
                title: "Error",
                description: e?.message || "Failed to create TDS Item",
                variant: "destructive",
            });
        }
    };

    const wpLabel = useMemo(
        () => wpOptions.find((o) => o.value === selectedWP)?.label || selectedWP,
        [wpOptions, selectedWP]
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[560px] p-0 rounded-xl border-none max-h-[88vh] flex flex-col">
                <DialogHeader className="p-6 pb-2">
                    <DialogTitle className="text-xl font-bold">Add New TDS Item</DialogTitle>
                    <DialogDescription className="text-sm text-muted-foreground">
                        Group catalog items under a single reusable TDS Item, or create a member-less custom item.
                    </DialogDescription>
                </DialogHeader>

                {/* Mode toggle */}
                <div className="px-6">
                    <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
                        {(["Normal", "Custom"] as Mode[]).map((m) => (
                            <button
                                key={m}
                                type="button"
                                onClick={() => handleModeChange(m)}
                                className={cn(
                                    "px-4 py-1.5 text-sm font-medium rounded-md transition-colors",
                                    mode === m
                                        ? "bg-[#dc2626] text-white shadow-sm"
                                        : "text-gray-600 hover:text-gray-900"
                                )}
                            >
                                {m}
                            </button>
                        ))}
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                        {mode === "Normal"
                            ? "Normal: group one or more catalog items under this TDS Item."
                            : "Custom: a member-less TDS Item (Work Package + name only)."}
                    </p>
                </div>

                {/* Stepper — Normal mode only */}
                {mode === "Normal" && (
                    <WizardSteps steps={NORMAL_STEPS} currentStep={step} className="pt-2" />
                )}

                <div className="px-6 pb-2 overflow-y-auto flex-1">
                    <Form {...form}>
                        <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
                            {/* ── Step 1 (Details) — shared by both modes ── */}
                            {(mode === "Custom" || step === 0) && (
                                <>
                                    <FormField
                                        control={form.control}
                                        name="tds_item_name"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-sm font-semibold flex items-center">
                                                    TDS Item Name
                                                    <span className="text-red-500 ml-0.5">*</span>
                                                </FormLabel>
                                                <FormControl>
                                                    <Input
                                                        placeholder='e.g. "Modular Switches"'
                                                        {...field}
                                                        className="bg-white border-gray-200"
                                                    />
                                                </FormControl>
                                                <FormMessage className="text-xs" />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="work_package"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-sm font-semibold flex items-center">
                                                    Work Package
                                                    <span className="text-red-500 ml-0.5">*</span>
                                                </FormLabel>
                                                <FormControl>
                                                    <RSelect
                                                        options={wpOptions}
                                                        value={wpOptions.find((o) => o.value === field.value) || null}
                                                        onChange={(opt) => field.onChange(opt?.value || "")}
                                                        placeholder="Select Work Package"
                                                        classNamePrefix="react-select"
                                                        menuPortalTarget={document.body}
                                                        menuPosition="fixed"
                                                        styles={PORTAL_SELECT_STYLES}
                                                    />
                                                </FormControl>
                                                <FormMessage className="text-xs" />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="description"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-sm font-semibold flex items-center">
                                                    Description
                                                    <span className="text-gray-400 font-normal ml-1">(Optional)</span>
                                                </FormLabel>
                                                <FormControl>
                                                    <Textarea
                                                        placeholder="Group-level note"
                                                        {...field}
                                                        className="bg-white border-gray-200 min-h-[80px]"
                                                    />
                                                </FormControl>
                                                <FormMessage className="text-xs" />
                                            </FormItem>
                                        )}
                                    />
                                </>
                            )}

                            {/* ── Step 2 (Members) — Normal mode only ── */}
                            {mode === "Normal" && step === 1 && (
                                <div className="space-y-3">
                                    <div>
                                        <label className="text-sm font-semibold flex items-center">
                                            Add Members
                                            <span className="text-gray-400 font-normal ml-1">
                                                (items under {wpLabel})
                                            </span>
                                        </label>
                                        <p className="text-xs text-muted-foreground mb-1.5">
                                            Search any item under this Work Package and add it to the group.
                                        </p>
                                        <FuzzySearchSelect
                                            allOptions={memberOptions}
                                            tokenSearchConfig={{
                                                searchFields: ["label", "value", "categoryName"],
                                                minSearchLength: 1,
                                                partialMatch: true,
                                                minTokenLength: 1,
                                                fieldWeights: { label: 2.0, value: 1.5, categoryName: 1.0 },
                                                minTokenMatches: 1,
                                            }}
                                            value={null}
                                            onChange={handleAddMember as any}
                                            placeholder="Search item to add..."
                                            classNamePrefix="react-select"
                                            isDisabled={!selectedWP}
                                            controlShouldRenderValue={false}
                                            menuPortalTarget={document.body}
                                            menuPosition="fixed"
                                            styles={PORTAL_SELECT_STYLES}
                                            formatOptionLabel={(option: any) => (
                                                <span>
                                                    {option.label}
                                                    {option.showCategory && option.categoryName && (
                                                        <span className="text-blue-600 ml-1">
                                                            ({option.categoryName})
                                                        </span>
                                                    )}
                                                </span>
                                            )}
                                        />
                                    </div>

                                    {/* Members table */}
                                    <div className="border rounded-lg overflow-hidden">
                                        <div className="grid grid-cols-[1fr_1fr_auto] gap-2 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-600">
                                            <span>Item</span>
                                            <span>Category</span>
                                            <span className="text-right pr-1">Action</span>
                                        </div>
                                        {members.length === 0 ? (
                                            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                                                No members added yet.
                                            </div>
                                        ) : (
                                            members.map((m) => (
                                                <div
                                                    key={m.value}
                                                    className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center px-3 py-2 border-t text-sm"
                                                >
                                                    <div className="flex flex-col min-w-0">
                                                        <span className="font-medium truncate">{m.label}</span>
                                                        <span className="text-xs text-gray-400 truncate">{m.value}</span>
                                                    </div>
                                                    <span className="text-gray-600 truncate">{m.categoryName}</span>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50 justify-self-end"
                                                        onClick={() => handleRemoveMember(m.value)}
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                    {members.length > 0 && (
                                        <p className="text-xs text-muted-foreground">
                                            {members.length} member{members.length === 1 ? "" : "s"} added.
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* ── Step 3 (Review) — Normal mode only ── */}
                            {mode === "Normal" && step === 2 && (
                                <div className="space-y-3 text-sm">
                                    <div className="grid grid-cols-[120px_1fr] gap-y-2">
                                        <span className="text-gray-500">Name</span>
                                        <span className="font-medium">{form.getValues("tds_item_name")}</span>
                                        <span className="text-gray-500">Work Package</span>
                                        <span className="font-medium">{wpLabel}</span>
                                        {form.getValues("description") && (
                                            <>
                                                <span className="text-gray-500">Description</span>
                                                <span className="font-medium whitespace-pre-wrap">
                                                    {form.getValues("description")}
                                                </span>
                                            </>
                                        )}
                                    </div>
                                    <div>
                                        <p className="text-gray-500 mb-1.5">
                                            Members ({members.length})
                                        </p>
                                        <div className="border rounded-lg overflow-hidden">
                                            {members.map((m) => (
                                                <div
                                                    key={m.value}
                                                    className="flex items-center justify-between px-3 py-2 border-b last:border-b-0"
                                                >
                                                    <div className="flex flex-col min-w-0">
                                                        <span className="font-medium truncate">{m.label}</span>
                                                        <span className="text-xs text-gray-400 truncate">{m.value}</span>
                                                    </div>
                                                    <span className="text-gray-600 text-xs ml-2 shrink-0">
                                                        {m.categoryName}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </form>
                    </Form>
                </div>

                {/* Footer / navigation */}
                <div className="flex items-center justify-between gap-2 p-6 pt-4 border-t border-gray-100">
                    <div>
                        {mode === "Normal" && step > 0 && (
                            <Button type="button" variant="outline" onClick={handleBack}>
                                Back
                            </Button>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                            className="bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100"
                        >
                            Cancel
                        </Button>
                        {mode === "Normal" && step < 2 ? (
                            <Button
                                type="button"
                                onClick={handleNext}
                                className="bg-[#dc2626] hover:bg-[#b91c1c] text-white"
                            >
                                Next
                            </Button>
                        ) : (
                            <Button
                                type="button"
                                onClick={submit}
                                disabled={creating}
                                className="bg-[#dc2626] hover:bg-[#b91c1c] text-white"
                            >
                                {creating ? "Saving..." : "Create TDS Item"}
                            </Button>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default AddTDSItemWizard;
