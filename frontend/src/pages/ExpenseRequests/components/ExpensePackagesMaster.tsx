// src/pages/ExpenseRequests/components/ExpensePackagesMaster.tsx
//
// Packages Settings → "Expense Packages". Manages the `Expense Type` master: add a type,
// edit its project / non-project scope and who may see it, author the Expense Request form
// format, and switch that form on or off.
//
// The scope checkboxes are not cosmetic — they drive real behaviour downstream:
//   project only      -> the request form REQUIRES a project; approval writes Project Expenses
//   non-project only  -> the Project field is HIDDEN; approval writes Non Project Expenses
//   both              -> the field is OPTIONAL and the requester's choice picks the ledger
//   neither           -> unusable; the request form refuses the type outright
//
// "Who gets paid" (ADR-0033, #1429): each type is Required / Optional / Not asked (the default),
// shown in the Payee column and set in the Add / Edit dialog.
//
// "Confirmed as Expense Request" (spec #1494, owner 2026-10-20): a LABEL ONLY, shown in the Confirmed
// column and ticked in the Edit dialog by Admin alone. It changes nothing about raising, intake or the
// catalog. The fixture ships it, so a mark made here survives a migrate only once exported.
//
// The search and the Scope / Payee / Role Access / Confirmed filters (in their column headers, like
// the app's other tables) narrow the loaded rows together (`utils/expenses/expensePackagesFilter`).

import React, { useMemo, useRef, useState } from "react";
import { useFrappeGetCall, useFrappeGetDocList, useFrappePostCall, useSWRConfig } from "frappe-react-sdk";
import ReactSelect from "react-select";
import { TailSpin } from "react-loader-spinner";
import { BadgeCheck, Braces, Pencil, PlusCircle, Search, TextCursorInput, X } from "lucide-react";

import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radiogroup";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { getFrappeError } from "@/utils/frappeErrors";
import { useUserData } from "@/hooks/useUserData";

import type { ExpenseType } from "@/types/NirmaanStack/ExpenseType";
import {
    PAYEE_RULE, PAYEE_RULES, PAYEE_RULE_HELP, asPayeeRule, countAskingWhoGetsPaid, type PayeeRule,
} from "@/utils/payees/expensePayee";
import {
    ADMIN_ONLY, CONFIRMED_CHOICES, NO_PACKAGE_FILTERS, SCOPES, filterExpenseTypes, hasActiveFilters, scopeOf,
    type PackageFilters, type ScopeLabel,
} from "@/utils/expenses/expensePackagesFilter";
import { SimpleFacetedFilter } from "@/pages/projects/components/SimpleFacetedFilter";
import { ExpenseFormatDialog } from "./ExpenseFormatDialog";
import { RECORDS_WITHOUT_REVIEW_KEY, RecordsWithoutReviewSection } from "./RecordsWithoutReviewSection";

const SCOPE_STYLE: Record<ScopeLabel, string> = {
    Project: "bg-sky-100 text-sky-800",
    "Non-Project": "bg-violet-100 text-violet-800",
    Both: "bg-amber-100 text-amber-900",
    Unusable: "bg-red-100 text-red-800",
};

const PAYEE_RULE_STYLE: Record<PayeeRule, string> = {
    [PAYEE_RULE.REQUIRED]: "bg-rose-100 text-rose-800",
    [PAYEE_RULE.OPTIONAL]: "bg-sky-100 text-sky-800",
    [PAYEE_RULE.NOT_ASKED]: "bg-zinc-100 text-zinc-600",
};

/** "Nirmaan Project Manager Profile" -> "Project Manager", for a table cell. */
const shortProfile = (p: string) => p.replace(/^Nirmaan /, "").replace(/ Profile$/, "");

interface ExpenseTypeAccess {
    /** Every profile the picker may offer -- all but Admin, who sees every type. */
    role_profiles: string[];
    /** Types listing no role are absent, and are Admin only. */
    allowed_roles: Record<string, string[]>;
}

interface RoleOption { value: string; label: string }

const SCOPE_OPTIONS = SCOPES.map((s) => ({ value: s, label: s }));
const PAYEE_OPTIONS = PAYEE_RULES.map((r) => ({ value: r, label: r }));
const CONFIRMED_OPTIONS = CONFIRMED_CHOICES.map((c) => ({ value: c, label: c }));

/** The picks of a filter popover, kept to the values that filter knows. */
const picked = <T extends string>(known: readonly T[], values: Set<string>): Set<T> =>
    new Set(known.filter((k) => values.has(k)));

interface EditState {
    open: boolean;
    /** null = adding a new type */
    target: ExpenseType | null;
    expense_name: string;
    project: boolean;
    non_project: boolean;
    allowed_roles: string[];
    /** Who gets paid on a request of this type. */
    payee_rule: PayeeRule;
    /** "Confirmed as Expense Request": a label only, Admin alone may change it. */
    confirmed_as_request: boolean;
}

const BLANK: EditState = {
    open: false, target: null, expense_name: "", project: false, non_project: false,
    allowed_roles: [], payee_rule: PAYEE_RULE.NOT_ASKED,
    confirmed_as_request: false,
};

export const ExpensePackagesMaster: React.FC = () => {
    const [search, setSearch] = useState("");
    const [filters, setFilters] = useState<PackageFilters>(NO_PACKAGE_FILTERS);
    const [edit, setEdit] = useState<EditState>(BLANK);
    /** The Edit dialog's scrolling fields: scrolling them closes the Role Access menu. */
    const editBodyRef = useRef<HTMLDivElement>(null);
    const [formatFor, setFormatFor] = useState<ExpenseType | null>(null);
    const [toggling, setToggling] = useState<string | null>(null);
    // A type switched ON with no format yet: its format dialog is open, and a non-empty save
    // there finishes the switch-on.
    const [enableAfterSave, setEnableAfterSave] = useState<string | null>(null);
    const [renameFor, setRenameFor] = useState<ExpenseType | null>(null);
    const [newName, setNewName] = useState("");

    // Rename is ADMIN ONLY. This hides the button; `rename_expense_type` is the real gate.
    const { role, user_id } = useUserData();
    const isAdmin = user_id === "Administrator" || role === "Nirmaan Admin Profile";
    // Records without review offers only profiles that can raise a type, so a type's roles changing
    // refreshes it.
    const { mutate: mutateKey } = useSWRConfig();

    const { data, isLoading, error, mutate } = useFrappeGetDocList<ExpenseType>("Expense Type", {
        fields: ["name", "expense_name", "project", "non_project", "source_format",
                 "source_format_enabled", "payee_rule", "confirmed_as_request"],
        limit: 0,
        orderBy: { field: "expense_name", order: "asc" },
    });

    // Role Profile is a System Manager doctype and a list read does not return the child
    // table, so both come from one admin-gated endpoint.
    const { data: accessRes, mutate: mutateAccess } = useFrappeGetCall<{ message: ExpenseTypeAccess }>(
        "nirmaan_stack.api.expense_requests.masters.get_expense_type_access",
        undefined,
        "expense_type_access"
    );
    const allowedByType = useMemo(() => accessRes?.message?.allowed_roles ?? {}, [accessRes]);
    const roleOptions: RoleOption[] = useMemo(
        () => (accessRes?.message?.role_profiles ?? []).map((p) => ({ value: p, label: shortProfile(p) })),
        [accessRes]
    );
    const roleFilterOptions: RoleOption[] = useMemo(
        () => [{ value: ADMIN_ONLY, label: "Admin only (empty list)" }, ...roleOptions],
        [roleOptions]
    );

    // ADMIN-GATED endpoints, not raw doc writes: `Expense Type` carries write for ~15 roles
    // (Project Manager included), and the scope flags decide which ledger a request becomes.
    const { call: createType, loading: creating } = useFrappePostCall(
        "nirmaan_stack.api.expense_requests.masters.create_expense_type");
    const { call: updateType, loading: updating } = useFrappePostCall(
        "nirmaan_stack.api.expense_requests.masters.update_expense_type");
    const { call: setFormEnabled } = useFrappePostCall(
        "nirmaan_stack.api.expense_requests.masters.set_expense_form_enabled");
    const { call: renameType, loading: renaming } = useFrappePostCall(
        "nirmaan_stack.api.expense_requests.masters.rename_expense_type");
    const busy = creating || updating;

    const rows = useMemo(
        () => filterExpenseTypes(data ?? [], { search, filters, allowedByType }),
        [data, search, filters, allowedByType]
    );
    const filtering = hasActiveFilters(filters) || !!search.trim();

    const formsOn = useMemo(
        () => (data ?? []).filter((t) => !!t.source_format_enabled && (t.source_format || "").trim()).length,
        [data]
    );
    const askingWhoGetsPaid = useMemo(() => countAskingWhoGetsPaid(data ?? []), [data]);

    const handleToggleForm = async (t: ExpenseType, enabled: boolean) => {
        // Nothing to enable yet: open the format dialog instead. The server refuses the switch
        // without a format, so it is turned on only once a non-empty format is saved.
        if (enabled && !(t.source_format || "").trim()) {
            setEnableAfterSave(t.name);
            setFormatFor(t);
            return;
        }
        setToggling(t.name);
        try {
            await setFormEnabled({ name: t.name, enabled: enabled ? 1 : 0 });
            await mutate();
        } catch (e) {
            toast({ title: "Could not switch the form", description: getFrappeError(e), variant: "destructive" });
        } finally {
            setToggling(null);
        }
    };

    const handleFormatSaved = async (hasFormat: boolean) => {
        // Read from this render's closure: the dialog closes (clearing both) right after.
        const pending = enableAfterSave;
        if (hasFormat && pending && pending === formatFor?.name) {
            try {
                await setFormEnabled({ name: pending, enabled: 1 });
                toast({ title: "JSON format enabled", description: pending, variant: "success" });
            } catch (e) {
                toast({ title: "Could not switch the form", description: getFrappeError(e), variant: "destructive" });
            }
        }
        mutate();
    };

    const handleRename = async () => {
        if (!renameFor) return;
        const target = newName.trim();
        if (!target || target === renameFor.name) return;
        try {
            await renameType({ name: renameFor.name, new_name: target });
            toast({ title: "Expense type renamed", description: `${renameFor.name} → ${target}`, variant: "success" });
            setRenameFor(null);
            mutate();
            mutateAccess();   // role access is keyed by the type's name
        } catch (e) {
            toast({ title: "Could not rename", description: getFrappeError(e), variant: "destructive" });
        }
    };

    const handleSave = async () => {
        const name = edit.expense_name.trim();
        if (!name) {
            toast({ title: "Name is required", variant: "destructive" });
            return;
        }
        if (!edit.project && !edit.non_project) {
            toast({
                title: "Pick at least one scope",
                description: "A type flagged for neither project nor non-project use cannot be requested at all.",
                variant: "destructive",
            });
            return;
        }
        try {
            if (edit.target) {
                await updateType({
                    name: edit.target.name,
                    project: edit.project ? 1 : 0,
                    non_project: edit.non_project ? 1 : 0,
                    allowed_roles: edit.allowed_roles,
                    payee_rule: edit.payee_rule,
                    // Sent only by Admin: the server refuses anyone else changing it.
                    ...(isAdmin ? { confirmed_as_request: edit.confirmed_as_request ? 1 : 0 } : {}),
                });
                toast({ title: "Updated", description: edit.target.name, variant: "success" });
            } else {
                await createType({
                    expense_name: name,
                    project: edit.project ? 1 : 0,
                    non_project: edit.non_project ? 1 : 0,
                    allowed_roles: edit.allowed_roles,
                    payee_rule: edit.payee_rule,
                });
                toast({ title: "Expense type added", description: name, variant: "success" });
            }
            setEdit(BLANK);
            mutate();
            mutateAccess();
            mutateKey(RECORDS_WITHOUT_REVIEW_KEY);
        } catch (e) {
            toast({ title: "Could not save", description: getFrappeError(e), variant: "destructive" });
        }
    };

    if (isLoading) {
        return (
            <div className="flex min-h-[40vh] items-center justify-center">
                <TailSpin width={32} height={32} color="#475569" />
            </div>
        );
    }
    if (error) {
        return <div className="p-8 text-center text-destructive">Could not load expense types: {error.message}</div>;
    }

    return (
        <div className="flex flex-col gap-4 p-1">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="text-lg font-semibold">Expense Packages</h2>
                    <p className="text-sm text-muted-foreground">
                        {data?.length ?? 0} expense types · {askingWhoGetsPaid} ask who gets paid · {formsOn} using a request form
                    </p>
                </div>
                <Button size="sm" onClick={() => setEdit({ ...BLANK, open: true })}>
                    <PlusCircle className="mr-1.5 h-4 w-4" /> Add Expense Type
                </Button>
            </div>

            {/* Admin only: the endpoint behind it is admin-gated. */}
            {isAdmin && <RecordsWithoutReviewSection />}

            <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full max-w-sm">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        className="pl-8"
                        placeholder="Search expense types…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                {filtering && (
                    <Button
                        variant="ghost" size="sm"
                        onClick={() => { setFilters(NO_PACKAGE_FILTERS); setSearch(""); }}
                    >
                        <X className="mr-1 h-3.5 w-3.5" /> Clear filters
                    </Button>
                )}
                {filtering && (
                    <span className="text-xs text-muted-foreground">
                        {rows.length} of {data?.length ?? 0} shown
                    </span>
                )}
            </div>

            <div className="overflow-x-auto rounded border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Expense Type</TableHead>
                            <TableHead>
                                <div className="flex items-center gap-1">
                                    <SimpleFacetedFilter
                                        title="Scope"
                                        options={SCOPE_OPTIONS}
                                        selectedValues={new Set<string>(filters.scopes)}
                                        onSelectedValuesChange={(v) => setFilters((f) => ({ ...f, scopes: picked(SCOPES, v) }))}
                                    />
                                    <span>Scope</span>
                                </div>
                            </TableHead>
                            <TableHead>
                                <div className="flex items-center gap-1">
                                    <SimpleFacetedFilter
                                        title="Payee"
                                        options={PAYEE_OPTIONS}
                                        selectedValues={new Set<string>(filters.payeeRules)}
                                        onSelectedValuesChange={(v) => setFilters((f) => ({ ...f, payeeRules: picked(PAYEE_RULES, v) }))}
                                    />
                                    <span>Payee</span>
                                </div>
                            </TableHead>
                            <TableHead>
                                <div className="flex items-center gap-1">
                                    <SimpleFacetedFilter
                                        title="Role Access"
                                        options={roleFilterOptions}
                                        selectedValues={new Set<string>(filters.roles)}
                                        onSelectedValuesChange={(v) => setFilters((f) => ({ ...f, roles: v }))}
                                        contentClassName="w-[260px]"
                                    />
                                    <span>Role Access</span>
                                </div>
                            </TableHead>
                            <TableHead>
                                <div className="flex items-center gap-1">
                                    <SimpleFacetedFilter
                                        title="Confirmed"
                                        options={CONFIRMED_OPTIONS}
                                        selectedValues={new Set<string>(filters.confirmed)}
                                        onSelectedValuesChange={(v) => setFilters((f) => ({ ...f, confirmed: picked(CONFIRMED_CHOICES, v) }))}
                                    />
                                    <span>Confirmed</span>
                                </div>
                            </TableHead>
                            <TableHead>JSON Format</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows.map((t) => {
                            const scope = scopeOf(t);
                            const hasFormat = !!(t.source_format || "").trim();
                            const formOn = hasFormat && !!t.source_format_enabled;
                            const roles = allowedByType[t.name] ?? [];
                            const payeeRule = asPayeeRule(t.payee_rule);
                            return (
                                <TableRow key={t.name}>
                                    <TableCell className="font-medium">{t.name}</TableCell>
                                    <TableCell>
                                        <Badge className={cn(SCOPE_STYLE[scope], "hover:bg-inherit")}>
                                            {scope}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        <Badge
                                            title={PAYEE_RULE_HELP[payeeRule]}
                                            className={cn(PAYEE_RULE_STYLE[payeeRule], "whitespace-nowrap hover:bg-inherit")}
                                        >
                                            {payeeRule}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="max-w-[20rem]">
                                        <div className="flex flex-wrap gap-1">
                                            {roles.length ? roles.map((r) => (
                                                <Badge
                                                    key={r}
                                                    variant="outline"
                                                    title={r}
                                                    className="whitespace-nowrap bg-slate-50 text-[11px] font-normal text-slate-700 hover:bg-slate-50"
                                                >
                                                    {shortProfile(r)}
                                                </Badge>
                                            )) : (
                                                <Badge
                                                    variant="outline"
                                                    title="No role listed -- only Admin can pick this type"
                                                    className="whitespace-nowrap border-amber-300 bg-amber-50 text-[11px] font-normal text-amber-800 hover:bg-amber-50"
                                                >
                                                    Admin only
                                                </Badge>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        {t.confirmed_as_request ? (
                                            <Badge
                                                title="Confirmed as Expense Request (a label only)"
                                                className="whitespace-nowrap bg-emerald-100 text-emerald-800 hover:bg-emerald-100"
                                            >
                                                <BadgeCheck className="mr-1 h-3.5 w-3.5" /> Confirmed
                                            </Badge>
                                        ) : (
                                            <span className="text-xs text-muted-foreground">—</span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex flex-col gap-1">
                                            <label
                                                className="flex items-center gap-2"
                                                title={formOn
                                                    ? "Requests use this type's JSON form"
                                                    : "Requests use the standard fields"}
                                            >
                                                <Switch
                                                    checked={formOn}
                                                    disabled={toggling === t.name}
                                                    onCheckedChange={(v) => handleToggleForm(t, v)}
                                                />
                                                <span className={cn("text-xs", formOn ? "text-emerald-700" : "text-muted-foreground")}>
                                                    {formOn ? "Enabled" : "Disabled"}
                                                </span>
                                            </label>
                                            <span className={cn("text-[11px]", hasFormat ? "text-emerald-700" : "text-amber-700")}>
                                                {hasFormat ? "Format added" : "No format (empty)"}
                                            </span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-right whitespace-nowrap">
                                        <Button
                                            variant="ghost" size="sm"
                                            onClick={() => setEdit({
                                                open: true, target: t, expense_name: t.name,
                                                project: !!t.project, non_project: !!t.non_project,
                                                allowed_roles: roles,
                                                payee_rule: payeeRule,
                                                confirmed_as_request: !!t.confirmed_as_request,
                                            })}
                                        >
                                            <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                                        </Button>
                                        {isAdmin && (
                                            <Button
                                                variant="ghost" size="sm"
                                                onClick={() => { setRenameFor(t); setNewName(t.name); }}
                                            >
                                                <TextCursorInput className="mr-1 h-3.5 w-3.5" /> Rename
                                            </Button>
                                        )}
                                        <Button variant="ghost" size="sm" onClick={() => setFormatFor(t)}>
                                            <Braces className="mr-1 h-3.5 w-3.5" /> Format
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                        {rows.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                                    {filtering
                                        ? "No expense types match the search and filters."
                                        : "No expense types yet."}
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* --- add / edit --- */}
            <Dialog open={edit.open} onOpenChange={(o) => !o && setEdit(BLANK)}>
                {/* The fields scroll between a fixed title and fixed buttons, so a short screen still reaches Save. */}
                <DialogContent className="flex max-h-[90vh] max-w-md flex-col supports-[height:100dvh]:max-h-[90dvh]">
                    <DialogHeader>
                        <DialogTitle>{edit.target ? `Edit — ${edit.target.name}` : "Add Expense Type"}</DialogTitle>
                        <DialogDescription>
                            The scope decides whether a request of this type asks for a project, and
                            which ledger approval writes to.
                        </DialogDescription>
                    </DialogHeader>

                    <div ref={editBodyRef} className="-mx-1 min-h-0 flex-1 space-y-4 overflow-y-auto px-1 py-1">
                        <div className="space-y-1.5">
                            <Label>Name</Label>
                            <Input
                                value={edit.expense_name}
                                onChange={(e) => setEdit((s) => ({ ...s, expense_name: e.target.value }))}
                                disabled={!!edit.target}
                                placeholder="e.g. Site Refreshments"
                            />
                            {edit.target && (
                                <p className="text-xs text-muted-foreground">
                                    The name is the record's ID, referenced by every existing
                                    expense, so renaming it is a different operation from
                                    editing its scope and is not offered here.
                                </p>
                            )}
                        </div>

                        <div className="space-y-2">
                            <Label>Scope</Label>
                            <label className="flex items-center gap-2 text-sm">
                                <Checkbox
                                    checked={edit.project}
                                    onCheckedChange={(v) => setEdit((s) => ({ ...s, project: !!v }))}
                                />
                                Project — can be charged to a project
                            </label>
                            <label className="flex items-center gap-2 text-sm">
                                <Checkbox
                                    checked={edit.non_project}
                                    onCheckedChange={(v) => setEdit((s) => ({ ...s, non_project: !!v }))}
                                />
                                Non-Project — company-wide
                            </label>
                            <p className="text-xs text-muted-foreground">
                                {edit.project && edit.non_project
                                    ? "Both: the Project field is optional and the requester's choice picks the ledger."
                                    : edit.project
                                        ? "Project only: a project is required on every request."
                                        : edit.non_project
                                            ? "Non-Project only: the Project field is hidden."
                                            : "Pick at least one — a type with neither cannot be requested."}
                            </p>
                        </div>

                        <div className="space-y-1.5">
                            <Label>Role Access</Label>
                            <ReactSelect<RoleOption, true>
                                isMulti
                                options={roleOptions}
                                value={roleOptions.filter((o) => edit.allowed_roles.includes(o.value))}
                                onChange={(selected) =>
                                    setEdit((s) => ({ ...s, allowed_roles: selected.map((o) => o.value) }))
                                }
                                placeholder="Select roles…"
                                // Portalled so the menu is not clipped by the dialog; a modal
                                // Radix dialog sets pointer-events:none outside itself, so the
                                // portal must turn them back on or options are keyboard-only.
                                menuPortalTarget={document.body}
                                menuPosition="fixed"
                                // A fixed menu would stay put while the fields scroll under it.
                                closeMenuOnScroll={(e) => e.target === editBodyRef.current}
                                styles={{
                                    menuPortal: (base) => ({ ...base, zIndex: 9999, pointerEvents: "auto" as const }),
                                }}
                            />
                            <p className="text-xs text-muted-foreground">
                                Who can pick this type when raising an expense request. Admin always
                                sees every type; leave empty for Admin only.
                            </p>
                        </div>

                        <fieldset className="space-y-2">
                            <legend className="mb-2 text-sm font-medium">Who gets paid</legend>
                            <RadioGroup
                                value={edit.payee_rule}
                                onValueChange={(v) => setEdit((s) => ({ ...s, payee_rule: asPayeeRule(v) }))}
                                className="gap-2"
                            >
                                {PAYEE_RULES.map((rule) => (
                                    <label
                                        key={rule}
                                        className={cn(
                                            "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm leading-snug",
                                            edit.payee_rule === rule && "border-primary bg-primary/5"
                                        )}
                                    >
                                        <RadioGroupItem value={rule} className="mt-0.5" />
                                        <span>
                                            <span className="font-semibold">{rule}</span>
                                            <span className="block text-[13px] text-muted-foreground">
                                                {PAYEE_RULE_HELP[rule]}
                                            </span>
                                        </span>
                                    </label>
                                ))}
                            </RadioGroup>
                        </fieldset>

                        {/* Admin only: the server refuses anyone else changing it. */}
                        {edit.target && isAdmin && (
                            <label className="flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm leading-snug">
                                <Checkbox
                                    className="mt-0.5"
                                    checked={edit.confirmed_as_request}
                                    onCheckedChange={(v) => setEdit((s) => ({ ...s, confirmed_as_request: !!v }))}
                                />
                                <span>
                                    <span className="font-semibold">Confirmed as Expense Request</span>
                                    <span className="block text-[13px] text-muted-foreground">
                                        A label only: it changes nothing about raising or approving
                                        requests. Export the fixture to keep it past a deployment.
                                    </span>
                                </span>
                            </label>
                        )}
                    </div>

                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setEdit(BLANK)}>Cancel</Button>
                        <Button onClick={handleSave} disabled={busy}>
                            {busy ? "Saving…" : edit.target ? "Save changes" : "Add"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* --- rename (admin only) --- */}
            <Dialog open={!!renameFor} onOpenChange={(o) => !o && setRenameFor(null)}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Rename — {renameFor?.name}</DialogTitle>
                        <DialogDescription>
                            Every expense, expense request and bank-import rule linked to this type
                            moves to the new name.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3 py-1">
                        <div className="space-y-1.5">
                            <Label>New name</Label>
                            <Input
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") handleRename(); }}
                                autoFocus
                            />
                        </div>
                        <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                            <li>
                                PO Adjustment Items and Outflow Import Rows store the type as plain
                                text and keep the old name.
                            </li>
                            <li>
                                Update the expense type fixture in code too, or the next deployment
                                brings the old name back as a separate type.
                            </li>
                        </ul>
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setRenameFor(null)}>Cancel</Button>
                        <Button
                            onClick={handleRename}
                            disabled={renaming || !newName.trim() || newName.trim() === renameFor?.name}
                        >
                            {renaming ? "Renaming…" : "Rename"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <ExpenseFormatDialog
                expenseType={formatFor}
                open={!!formatFor}
                onOpenChange={(o) => {
                    if (!o) {
                        setFormatFor(null);
                        setEnableAfterSave(null);
                    }
                }}
                onSaved={handleFormatSaved}
            />
        </div>
    );
};

export default ExpensePackagesMaster;
