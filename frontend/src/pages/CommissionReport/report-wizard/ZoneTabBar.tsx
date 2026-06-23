// Zone tab bar for zone-wise commissioning reports (zone_wise_enable === "YES").
// The OUTER navigation, shown only once there is MORE than one zone: one tab per
// zone + an "All-Zones Review" tab. There is NO "+ Add Zone" button here —
// adding a zone happens via the [Add Another Zone] dialog on the per-zone Review
// step (see AddZoneDialog).
//
// Tabs are renamable inline (click the label / pencil), reorderable by dragging
// the tab (grip handle), and deletable (with confirmation when the zone has
// data; never below 1 zone).
//
// This component is purely presentational — all zone state lives in the wizard's
// RHF form (`zones` field array) and the parent's `activeZoneIndex` state.

import React, { useEffect, useRef, useState } from 'react';
import { Check, GripVertical, Layers, Pencil, Trash2, X } from 'lucide-react';

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

export interface ZoneTab {
    id: string;
    label: string;
    /** Whether the zone currently holds any user-entered data (drives the
     *  delete-confirm prompt). */
    hasData: boolean;
}

interface Props {
    zones: ZoneTab[];
    activeZoneIndex: number;
    /** True when the All-Zones Review tab is selected. */
    reviewActive: boolean;
    /** Read-only mode (view): hides add/rename/reorder/delete affordances. */
    readonly?: boolean;
    onSelectZone: (index: number) => void;
    onSelectReview: () => void;
    onRenameZone: (index: number, label: string) => void;
    /** Move the zone at `from` to position `to` (drag-and-drop). */
    onReorderZone: (from: number, to: number) => void;
    onDeleteZone: (index: number) => void;
}

export const ZoneTabBar: React.FC<Props> = ({
    zones,
    activeZoneIndex,
    reviewActive,
    readonly,
    onSelectZone,
    onSelectReview,
    onRenameZone,
    onReorderZone,
    onDeleteZone,
}) => {
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [draftLabel, setDraftLabel] = useState('');
    const [pendingDelete, setPendingDelete] = useState<number | null>(null);
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (editingIndex !== null) inputRef.current?.focus();
    }, [editingIndex]);

    const beginRename = (index: number) => {
        setEditingIndex(index);
        setDraftLabel(zones[index]?.label || '');
    };

    const commitRename = () => {
        if (editingIndex === null) return;
        const trimmed = draftLabel.trim();
        if (trimmed) onRenameZone(editingIndex, trimmed);
        setEditingIndex(null);
        setDraftLabel('');
    };

    const cancelRename = () => {
        setEditingIndex(null);
        setDraftLabel('');
    };

    const showReviewTab = zones.length > 1;

    const requestDelete = (index: number) => {
        if (zones.length <= 1) return;
        if (zones[index]?.hasData) {
            setPendingDelete(index);
        } else {
            onDeleteZone(index);
        }
    };

    return (
        <div className="rounded-md border bg-muted/20 p-2">
            <div className="flex flex-wrap items-center gap-2">
                {zones.map((zone, index) => {
                    const isActive = !reviewActive && index === activeZoneIndex;
                    const isEditing = editingIndex === index;
                    return (
                        <div
                            key={zone.id}
                            draggable={!readonly && zones.length > 1 && !isEditing}
                            onDragStart={(e) => {
                                setDragIndex(index);
                                e.dataTransfer.effectAllowed = 'move';
                            }}
                            onDragEnd={() => {
                                setDragIndex(null);
                                setDragOverIndex(null);
                            }}
                            onDragOver={(e) => {
                                if (dragIndex !== null && dragIndex !== index) {
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = 'move';
                                    setDragOverIndex(index);
                                }
                            }}
                            onDrop={(e) => {
                                e.preventDefault();
                                if (dragIndex !== null && dragIndex !== index) {
                                    onReorderZone(dragIndex, index);
                                }
                                setDragIndex(null);
                                setDragOverIndex(null);
                            }}
                            className={cn(
                                'group flex items-center gap-1 rounded-md border px-2 py-1 text-sm transition',
                                !readonly && zones.length > 1 && !isEditing && 'cursor-grab active:cursor-grabbing',
                                dragOverIndex === index && dragIndex !== null && dragIndex !== index
                                    ? 'ring-2 ring-primary ring-offset-1'
                                    : '',
                                dragIndex === index && 'opacity-50',
                                isActive
                                    ? 'border-primary bg-primary text-primary-foreground'
                                    : 'border-border bg-background hover:bg-accent',
                            )}
                        >
                            {!readonly && !isEditing && zones.length > 1 && (
                                <GripVertical
                                    className={cn(
                                        'h-3.5 w-3.5 shrink-0',
                                        isActive ? 'text-primary-foreground/70' : 'text-muted-foreground/60',
                                    )}
                                />
                            )}

                            {isEditing ? (
                                <div className="flex items-center gap-1">
                                    <input
                                        ref={inputRef}
                                        value={draftLabel}
                                        onChange={(e) => setDraftLabel(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                commitRename();
                                            } else if (e.key === 'Escape') {
                                                e.preventDefault();
                                                cancelRename();
                                            }
                                        }}
                                        className="h-6 w-32 rounded border border-input bg-background px-1.5 text-sm text-foreground"
                                        aria-label="Zone name"
                                    />
                                    <button
                                        type="button"
                                        onClick={commitRename}
                                        className="rounded p-0.5 text-emerald-600 hover:bg-emerald-100"
                                        aria-label="Save zone name"
                                    >
                                        <Check className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={cancelRename}
                                        className="rounded p-0.5 text-muted-foreground hover:bg-muted"
                                        aria-label="Cancel rename"
                                    >
                                        <X className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            ) : (
                                <>
                                    <button
                                        type="button"
                                        onClick={() => onSelectZone(index)}
                                        onDoubleClick={() => !readonly && beginRename(index)}
                                        className="max-w-[12rem] truncate font-medium"
                                        title={zone.label}
                                    >
                                        {zone.label}
                                    </button>
                                    {!readonly && (
                                        <div className="flex items-center gap-0.5">
                                            <button
                                                type="button"
                                                onClick={() => beginRename(index)}
                                                className={cn(
                                                    'rounded p-0.5 opacity-60 hover:opacity-100',
                                                    isActive
                                                        ? 'hover:bg-primary-foreground/15'
                                                        : 'hover:bg-muted',
                                                )}
                                                aria-label={`Rename ${zone.label}`}
                                            >
                                                <Pencil className="h-3 w-3" />
                                            </button>
                                            {zones.length > 1 && (
                                                <button
                                                    type="button"
                                                    onClick={() => requestDelete(index)}
                                                    className={cn(
                                                        'rounded p-0.5 opacity-60 hover:opacity-100',
                                                        isActive
                                                            ? 'text-primary-foreground hover:bg-primary-foreground/15'
                                                            : 'text-destructive hover:bg-destructive/10',
                                                    )}
                                                    aria-label={`Delete ${zone.label}`}
                                                >
                                                    <Trash2 className="h-3 w-3" />
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    );
                })}

                {showReviewTab && (
                    <button
                        type="button"
                        onClick={onSelectReview}
                        className={cn(
                            'ml-auto flex items-center gap-1 rounded-md border px-2.5 py-1 text-sm font-medium transition',
                            reviewActive
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-border bg-background hover:bg-accent',
                        )}
                    >
                        <Layers className="h-3.5 w-3.5" />
                        All-Zones Review
                    </button>
                )}
            </div>

            <AlertDialog
                open={pendingDelete !== null}
                onOpenChange={(open) => {
                    if (!open) setPendingDelete(null);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete this zone?</AlertDialogTitle>
                        <AlertDialogDescription>
                            {pendingDelete !== null && (
                                <>
                                    <span className="font-medium">{zones[pendingDelete]?.label}</span> has
                                    data entered. Deleting it permanently discards that zone's header,
                                    checklist, and signature selections. This cannot be undone.
                                </>
                            )}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => {
                                if (pendingDelete !== null) onDeleteZone(pendingDelete);
                                setPendingDelete(null);
                            }}
                        >
                            Delete zone
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};
