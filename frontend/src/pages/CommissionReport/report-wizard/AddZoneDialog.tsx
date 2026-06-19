// Dialog for adding one or more zones to a zone-wise commissioning report.
//
// Opened from the per-zone Review step ([Add Another Zone]). Two areas:
//   1. (optional) Rename the CURRENT zone — shown only while the current zone
//      still carries its default name (`/^Zone \d+$/`), so the user can name
//      `Zone 1` → e.g. "Ground Floor". Omitted once renamed.
//   2. One or more new-zone name inputs — starts with one empty row, a small
//      "+ Add another name" control appends more.
//
// Confirm is disabled until at least one new name is non-empty. On confirm the
// parent receives `{ renameCurrentTo?, newNames }` (trimmed; empty rows ignored).

import React, { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';

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

/** A zone label still in its default form (`Zone 1`, `Zone 2`, …). */
export const isDefaultZoneLabel = (label: string): boolean => /^Zone \d+$/.test(label.trim());

export interface AddZoneResult {
    /** When present + changed, rename the current zone to this. */
    renameCurrentTo?: string;
    /** One or more new zone names (trimmed, non-empty). */
    newNames: string[];
}

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The current (active) zone's label — used to seed the rename field. */
    currentLabel: string;
    /** Labels of all zones that already exist — shown as badges for context. */
    existingLabels: string[];
    onConfirm: (result: AddZoneResult) => void;
}

export const AddZoneDialog: React.FC<Props> = ({
    open,
    onOpenChange,
    currentLabel,
    existingLabels,
    onConfirm,
}) => {
    // Offer the rename only while the current zone still has its default name.
    const canRename = isDefaultZoneLabel(currentLabel);
    const [renameValue, setRenameValue] = useState(currentLabel);
    const [newNames, setNewNames] = useState<string[]>(['']);

    // Re-seed on each open (the active zone / its label may have changed).
    useEffect(() => {
        if (open) {
            setRenameValue(currentLabel);
            setNewNames(['']);
        }
    }, [open, currentLabel]);

    const updateName = (index: number, value: string) => {
        setNewNames((prev) => prev.map((n, i) => (i === index ? value : n)));
    };
    const addNameRow = () => setNewNames((prev) => [...prev, '']);
    const removeNameRow = (index: number) =>
        setNewNames((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));

    const trimmedNew = newNames.map((n) => n.trim()).filter((n) => n !== '');
    const canConfirm = trimmedNew.length > 0;

    const handleConfirm = () => {
        if (!canConfirm) return;
        const trimmedRename = renameValue.trim();
        const result: AddZoneResult = { newNames: trimmedNew };
        if (canRename && trimmedRename && trimmedRename !== currentLabel) {
            result.renameCurrentTo = trimmedRename;
        }
        onConfirm(result);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Add another zone</DialogTitle>
                    <DialogDescription>
                        Name the new zone(s). Each new zone runs the full workflow
                        (Header → Checklist → Signatures → Review).
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    {existingLabels.length > 0 && (
                        <div className="space-y-1.5">
                            <span className="text-xs font-medium text-muted-foreground">
                                Current zones ({existingLabels.length})
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                                {existingLabels.map((lbl, i) => (
                                    <span
                                        key={i}
                                        className={
                                            'rounded-full border px-2 py-0.5 text-xs ' +
                                            (lbl === currentLabel
                                                ? 'border-primary bg-primary/10 font-medium text-primary'
                                                : 'border-border bg-muted text-muted-foreground')
                                        }
                                    >
                                        {lbl}
                                        {lbl === currentLabel ? ' · current' : ''}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                    {canRename && (
                        <div className="space-y-1.5">
                            <label
                                htmlFor="rename-current-zone"
                                className="text-sm font-medium text-foreground"
                            >
                                Rename this zone
                            </label>
                            <Input
                                id="rename-current-zone"
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                placeholder="e.g. Ground Floor"
                            />
                            <p className="text-xs text-muted-foreground">
                                Give the current zone a real name before adding more (optional).
                            </p>
                        </div>
                    )}

                    <div className="space-y-1.5">
                        <span className="text-sm font-medium text-foreground">New zone name(s)</span>
                        <div className="space-y-2">
                            {newNames.map((name, index) => (
                                <div key={index} className="flex items-center gap-2">
                                    <Input
                                        value={name}
                                        onChange={(e) => updateName(index, e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                handleConfirm();
                                            }
                                        }}
                                        placeholder="e.g. First Floor"
                                        aria-label={`New zone name ${index + 1}`}
                                    />
                                    {newNames.length > 1 && (
                                        <button
                                            type="button"
                                            onClick={() => removeNameRow(index)}
                                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                                            aria-label={`Remove name ${index + 1}`}
                                        >
                                            <X className="h-4 w-4" />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={addNameRow}
                            className="h-7 px-1.5 text-xs"
                        >
                            <Plus className="mr-1 h-3.5 w-3.5" />
                            Add another name
                        </Button>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button onClick={handleConfirm} disabled={!canConfirm}>
                        Create &amp; continue
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
