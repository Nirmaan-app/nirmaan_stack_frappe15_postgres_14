import React, { useMemo, useState } from 'react';
import { useFrappeCreateDoc, useFrappeGetDocList, useFrappePostCall, useFrappeUpdateDoc, useSWRConfig } from 'frappe-react-sdk';
import { Building2, Pencil, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { DEPARTMENT_LIST_KEYS } from '@/hooks/useDepartmentOptions';
import { normalizeDepartment, sameDepartment } from '@/utils/assetDepartment';
import { getFrappeError } from '@/utils/frappeErrors';

const DEPARTMENT_DOCTYPE = 'Nirmaan Department';
const LIST_KEY = 'nirmaan_department_manage_list';

interface DepartmentRow {
    name: string;
    is_active: 0 | 1;
}

interface CountRow {
    department: string;
    count: number;
}

type DialogState = { mode: 'add' } | { mode: 'rename'; name: string } | null;

/**
 * The department list (Nirmaan Department) -- Admin and HR add, rename and switch off departments
 * here. Renaming moves every person and asset to the new name; a switched-off department stays on
 * the records that have it but can't be given to anyone new. The server enforces who may do this.
 */
export const DepartmentsList: React.FC = () => {
    const { toast } = useToast();
    const { mutate: globalMutate } = useSWRConfig();
    const [dialog, setDialog] = useState<DialogState>(null);
    const [nameInput, setNameInput] = useState('');
    const [savingName, setSavingName] = useState<string | null>(null);

    const { data: departments, isLoading, mutate } = useFrappeGetDocList<DepartmentRow>(
        DEPARTMENT_DOCTYPE,
        { fields: ['name', 'is_active'], orderBy: { field: 'name', order: 'asc' }, limit: 0 },
        LIST_KEY
    );
    const { data: peopleCounts, mutate: mutatePeople } = useFrappeGetDocList<CountRow>(
        'Nirmaan Users',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { fields: ['department', 'count(name) as count'], filters: [['department', '!=', '']], groupBy: 'department', limit: 0 } as any,
        'department_people_counts'
    );
    const { data: assetCounts, mutate: mutateAssets } = useFrappeGetDocList<CountRow>(
        'Asset Master',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { fields: ['department', 'count(name) as count'], filters: [['department', '!=', '']], groupBy: 'department', limit: 0 } as any,
        'department_asset_counts'
    );

    const people = useMemo(() => new Map((peopleCounts ?? []).map((r) => [r.department, r.count])), [peopleCounts]);
    const assets = useMemo(() => new Map((assetCounts ?? []).map((r) => [r.department, r.count])), [assetCounts]);

    const { createDoc } = useFrappeCreateDoc();
    const { updateDoc } = useFrappeUpdateDoc();
    const { call: renameDoc } = useFrappePostCall('frappe.client.rename_doc');

    // Every picker reads the department list from these keys.
    const refreshAll = () => {
        mutate();
        mutatePeople();
        mutateAssets();
        globalMutate(DEPARTMENT_LIST_KEYS.active);
        globalMutate(DEPARTMENT_LIST_KEYS.all);
    };

    const openDialog = (state: DialogState) => {
        setNameInput(state?.mode === 'rename' ? state.name : '');
        setDialog(state);
    };

    const typedName = normalizeDepartment(nameInput);
    const duplicate =
        !!typedName &&
        (departments ?? []).some(
            (d) => sameDepartment(d.name, typedName) && !(dialog?.mode === 'rename' && d.name === dialog.name)
        );

    const handleSaveName = async () => {
        if (!typedName || duplicate || !dialog) return;
        setSavingName(typedName);
        try {
            if (dialog.mode === 'add') {
                await createDoc(DEPARTMENT_DOCTYPE, { department_name: typedName, is_active: 1 });
                toast({ title: 'Department added', description: `${typedName} is now in the list.`, variant: 'success' });
            } else if (typedName !== dialog.name) {
                await renameDoc({ doctype: DEPARTMENT_DOCTYPE, old_name: dialog.name, new_name: typedName });
                toast({
                    title: 'Department renamed',
                    description: `${dialog.name} is now ${typedName}, for every person and asset in it.`,
                    variant: 'success',
                });
            }
            setDialog(null);
            refreshAll();
        } catch (error) {
            toast({ title: 'Could not save the department', description: getFrappeError(error), variant: 'destructive' });
        } finally {
            setSavingName(null);
        }
    };

    const handleToggle = async (row: DepartmentRow) => {
        setSavingName(row.name);
        try {
            await updateDoc(DEPARTMENT_DOCTYPE, row.name, { is_active: row.is_active ? 0 : 1 });
            refreshAll();
        } catch (error) {
            toast({ title: 'Could not update the department', description: getFrappeError(error), variant: 'destructive' });
        } finally {
            setSavingName(null);
        }
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-gray-500">
                    People and assets pick from this list. Switch a department off to stop new use; records that already have it keep it.
                </p>
                <Button size="sm" onClick={() => openDialog({ mode: 'add' })} className="gap-2 shrink-0">
                    <Plus className="h-4 w-4" />
                    Add Department
                </Button>
            </div>

            <div className="overflow-x-auto rounded-lg border bg-white">
                <table className="w-full min-w-[560px] text-sm">
                    <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                        <tr>
                            <th className="px-3 py-2">Department</th>
                            <th className="px-3 py-2 text-right">People</th>
                            <th className="px-3 py-2 text-right">Assets</th>
                            <th className="px-3 py-2">Active</th>
                            <th className="px-3 py-2"><span className="sr-only">Actions</span></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y">
                        {isLoading ? (
                            [...Array(4)].map((_, i) => (
                                <tr key={i}>
                                    <td colSpan={5} className="px-3 py-2"><Skeleton className="h-6 w-full bg-gray-100" /></td>
                                </tr>
                            ))
                        ) : (departments ?? []).length === 0 ? (
                            <tr>
                                <td colSpan={5} className="px-3 py-10 text-center text-gray-500">
                                    No departments yet. Add the first one, or run the department setup patch.
                                </td>
                            </tr>
                        ) : (
                            (departments ?? []).map((row) => (
                                <tr key={row.name} className={row.is_active ? '' : 'bg-gray-50/70'}>
                                    <td className="px-3 py-2">
                                        <span className={`inline-flex items-center gap-2 font-medium ${row.is_active ? 'text-gray-900' : 'text-gray-400'}`}>
                                            <Building2 className="h-4 w-4 text-gray-400" />
                                            {row.name}
                                        </span>
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums">{people.get(row.name) ?? 0}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">{assets.get(row.name) ?? 0}</td>
                                    <td className="px-3 py-2">
                                        <Switch
                                            checked={!!row.is_active}
                                            onCheckedChange={() => handleToggle(row)}
                                            disabled={savingName === row.name}
                                            aria-label={`${row.name} active`}
                                        />
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-8 gap-1.5 text-gray-600 hover:text-blue-600"
                                            onClick={() => openDialog({ mode: 'rename', name: row.name })}
                                        >
                                            <Pencil className="h-3.5 w-3.5" />
                                            Rename
                                        </Button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            <Dialog open={!!dialog} onOpenChange={(open) => !open && !savingName && setDialog(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{dialog?.mode === 'rename' ? 'Rename Department' : 'Add Department'}</DialogTitle>
                        <DialogDescription>
                            {dialog?.mode === 'rename'
                                ? 'Everyone and every asset in this department moves to the new name. Past history keeps the old name.'
                                : 'The new department appears in every department picker straight away.'}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-1.5">
                        <Label htmlFor="departmentName">Department name</Label>
                        <Input
                            id="departmentName"
                            value={nameInput}
                            onChange={(e) => setNameInput(e.target.value)}
                            placeholder="e.g. Projects"
                            autoFocus
                        />
                        {duplicate && <p className="text-xs text-red-600">A department with this name already exists.</p>}
                    </div>
                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button variant="outline" onClick={() => setDialog(null)} disabled={!!savingName}>
                            Cancel
                        </Button>
                        <Button onClick={handleSaveName} disabled={!typedName || duplicate || !!savingName}>
                            {savingName ? 'Saving…' : dialog?.mode === 'rename' ? 'Rename' : 'Add'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};
