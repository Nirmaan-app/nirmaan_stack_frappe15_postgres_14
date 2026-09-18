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
// ⚠️ The category is deliberately NOT shown here (owner ruling 2026-09-16). It still exists:
// a new type is saved as "Uncategorized" and an edit keeps the type's current category.

import React, { useMemo, useState } from "react";
import { useFrappeGetCall, useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import ReactSelect from "react-select";
import { TailSpin } from "react-loader-spinner";
import { Braces, Pencil, PlusCircle, Search, TextCursorInput } from "lucide-react";

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
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { getFrappeError } from "@/utils/frappeErrors";
import { useUserData } from "@/hooks/useUserData";

import type { ExpenseType } from "@/types/NirmaanStack/ExpenseType";

// Where none of the named categories fit, a type belongs to "Uncategorized". The category is
// no longer picked on this screen, so every new type lands here.
const FALLBACK_CATEGORY = "Uncategorized";
import { ExpenseFormatDialog } from "./ExpenseFormatDialog";

type ScopeLabel = "Project" | "Non-Project" | "Both" | "Unusable";

const scopeOf = (t: ExpenseType): ScopeLabel =>
    t.project && t.non_project ? "Both"
        : t.project ? "Project"
            : t.non_project ? "Non-Project"
                : "Unusable";

const SCOPE_STYLE: Record<ScopeLabel, string> = {
    Project: "bg-sky-100 text-sky-800",
    "Non-Project": "bg-violet-100 text-violet-800",
    Both: "bg-amber-100 text-amber-900",
    Unusable: "bg-red-100 text-red-800",
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

interface EditState {
    open: boolean;
    /** null = adding a new type */
    target: ExpenseType | null;
    expense_name: string;
    project: boolean;
    non_project: boolean;
    /** Not editable here -- carried so an edit keeps the type's current category. */
    expense_category: string;
    allowed_roles: string[];
}

const BLANK: EditState = {
    open: false, target: null, expense_name: "", project: false, non_project: false,
    expense_category: FALLBACK_CATEGORY, allowed_roles: [],
};

export const ExpensePackagesMaster: React.FC = () => {
    const [search, setSearch] = useState("");
    const [edit, setEdit] = useState<EditState>(BLANK);
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

    const { data, isLoading, error, mutate } = useFrappeGetDocList<ExpenseType>("Expense Type", {
        fields: ["name", "expense_name", "project", "non_project", "source_format",
                 "source_format_enabled", "expense_category"],
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
    const allowedByType = accessRes?.message?.allowed_roles ?? {};
    const roleOptions: RoleOption[] = useMemo(
        () => (accessRes?.message?.role_profiles ?? []).map((p) => ({ value: p, label: shortProfile(p) })),
        [accessRes]
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

    const rows = useMemo(() => {
        const q = search.trim().toLowerCase();
        const all = data ?? [];
        return q ? all.filter((t) => t.name.toLowerCase().includes(q)) : all;
    }, [data, search]);

    const formsOn = useMemo(
        () => (data ?? []).filter((t) => !!t.source_format_enabled && (t.source_format || "").trim()).length,
        [data]
    );

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
                    expense_category: edit.expense_category,
                    allowed_roles: edit.allowed_roles,
                });
                toast({ title: "Updated", description: edit.target.name, variant: "success" });
            } else {
                await createType({
                    expense_name: name,
                    project: edit.project ? 1 : 0,
                    non_project: edit.non_project ? 1 : 0,
                    expense_category: FALLBACK_CATEGORY,
                    allowed_roles: edit.allowed_roles,
                });
                toast({ title: "Expense type added", description: name, variant: "success" });
            }
            setEdit(BLANK);
            mutate();
            mutateAccess();
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
                        {data?.length ?? 0} expense types · {formsOn} using a request form
                    </p>
                </div>
                <Button size="sm" onClick={() => setEdit({ ...BLANK, open: true })}>
                    <PlusCircle className="mr-1.5 h-4 w-4" /> Add Expense Type
                </Button>
            </div>

            <div className="relative max-w-sm">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                    className="pl-8"
                    placeholder="Search expense types…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
            </div>

            <div className="overflow-x-auto rounded border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Expense Type</TableHead>
                            <TableHead>Scope</TableHead>
                            <TableHead>Role Access</TableHead>
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
                            return (
                                <TableRow key={t.name}>
                                    <TableCell className="font-medium">{t.name}</TableCell>
                                    <TableCell>
                                        <Badge className={cn(SCOPE_STYLE[scope], "hover:bg-inherit")}>
                                            {scope}
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
                                                expense_category: t.expense_category || FALLBACK_CATEGORY,
                                                allowed_roles: roles,
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
                                <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                                    No expense types match “{search}”.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* --- add / edit --- */}
            <Dialog open={edit.open} onOpenChange={(o) => !o && setEdit(BLANK)}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{edit.target ? `Edit — ${edit.target.name}` : "Add Expense Type"}</DialogTitle>
                        <DialogDescription>
                            The scope decides whether a request of this type asks for a project, and
                            which ledger approval writes to.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-1">
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
                                styles={{
                                    menuPortal: (base) => ({ ...base, zIndex: 9999, pointerEvents: "auto" as const }),
                                }}
                            />
                            <p className="text-xs text-muted-foreground">
                                Who can pick this type when raising an expense request. Admin always
                                sees every type; leave empty for Admin only.
                            </p>
                        </div>
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
