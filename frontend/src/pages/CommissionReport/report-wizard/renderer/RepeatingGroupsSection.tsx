// Repeating groups section. Renders N independent group cards, each with a
// flat set of `groupFields` (e.g. Equipment + Area) on top and a nested
// repeating data-table below (`rowsTable`). Group count can be bound to a
// header field via `countBoundTo` — auto-seeds empty groups as that number
// grows; reductions are manual (mirrors the Earth Pit count behavior).

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

import type { Field, RepeatingGroupsSection as RepeatingGroupsSectionT } from '../types';
import { FieldControl } from './FieldControl';

interface Props {
    section: RepeatingGroupsSectionT;
    forceReadonly?: boolean;
    /** When set, render only this single group (zero-based index). Used by
     *  the wizard when each group lives on its own synthetic step. Hides the
     *  Add Group button, the count-mismatch banner and the group counter. */
    groupIndexFilter?: number;
}

export const RepeatingGroupsSection: React.FC<Props> = ({
    section,
    forceReadonly,
    groupIndexFilter,
}) => {
    const { control } = useFormContext();
    const groupsName = `responses.${section.id}`;
    const { fields: groups, append, remove } = useFieldArray({ control, name: groupsName });

    const maxGroups = section.maxGroups ?? 50;
    const titlePrefix = section.groupTitlePrefix || 'Group';

    const buildEmptyRow = useCallback((): Record<string, unknown> => {
        const row: Record<string, unknown> = {};
        for (const col of section.rowsTable.columns) {
            row[col.key] =
                col.default !== undefined && col.default !== null && col.default !== ''
                    ? col.default
                    : '';
        }
        return row;
    }, [section.rowsTable.columns]);

    const buildEmptyGroup = useCallback((): Record<string, unknown> => {
        const g: Record<string, unknown> = {};
        for (const f of section.groupFields) {
            g[f.key] =
                f.default !== undefined && f.default !== null && f.default !== ''
                    ? f.default
                    : '';
        }
        const minRows = Math.max(1, section.rowsTable.minRows ?? 1);
        g.rows = Array.from({ length: minRows }, () => buildEmptyRow());
        return g;
    }, [buildEmptyRow, section.groupFields, section.rowsTable.minRows]);

    // ─── Header-driven group seeding ───────────────────────────────────────
    const declaredRaw = useWatch({
        control,
        name: section.countBoundTo || '',
        disabled: !section.countBoundTo,
    }) as unknown;
    const declaredCount = useMemo(() => {
        if (!section.countBoundTo) return null;
        const n = Number(declaredRaw);
        return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    }, [declaredRaw, section.countBoundTo]);
    const lastSeededRef = useRef<number>(0);
    useEffect(() => {
        if (forceReadonly) return;
        if (declaredCount === null) return;
        if (declaredCount <= groups.length) return;
        if (declaredCount <= lastSeededRef.current) return;
        const toAdd = declaredCount - groups.length;
        for (let i = 0; i < toAdd; i++) append(buildEmptyGroup());
        lastSeededRef.current = declaredCount;
    }, [append, buildEmptyGroup, declaredCount, forceReadonly, groups.length]);

    const countMismatch =
        declaredCount !== null && declaredCount < groups.length;

    // Single-group mode: the wizard expands a `repeating_groups` step into
    // one synthetic step per group. Hide the Add/banner/count chrome and
    // render only the target group's card.
    const singleGroupMode = typeof groupIndexFilter === 'number';

    const canAddGroup =
        !forceReadonly &&
        !singleGroupMode &&
        groups.length < maxGroups &&
        declaredCount === null;
    // When count is bound, group count is driven by header → no manual + button.
    // When NOT bound, user can add groups freely.

    return (
        <section className="space-y-4">
            {section.title && !singleGroupMode && (
                <h3 className="text-base font-semibold text-foreground">{section.title}</h3>
            )}

            {countMismatch && !singleGroupMode && (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                    <div className="text-xs text-amber-800">
                        Header says <span className="font-semibold">{declaredCount}</span> group(s)
                        but you have <span className="font-semibold">{groups.length}</span>. Either
                        remove the unwanted group(s) below, or raise the count in the Header step.
                    </div>
                </div>
            )}

            {section.countBoundTo && !forceReadonly && declaredCount === null && !singleGroupMode && (
                <p className="text-[11px] text-muted-foreground">
                    Group count is controlled by the matching header field.
                </p>
            )}

            <div className="space-y-4">
                {groups.map((group, gIdx) => {
                    // In single-group mode, only render the targeted group.
                    if (singleGroupMode && gIdx !== groupIndexFilter) return null;
                    return (
                        <GroupCard
                            key={group.id}
                            section={section}
                            groupIdx={gIdx}
                            titlePrefix={titlePrefix}
                            forceReadonly={forceReadonly}
                            canRemove={!forceReadonly && groups.length > 1}
                            onRemove={() => remove(gIdx)}
                            buildEmptyRow={buildEmptyRow}
                            hideGroupHeader={singleGroupMode}
                        />
                    );
                })}
                {singleGroupMode &&
                    (groupIndexFilter as number) >= groups.length && (
                        <p className="text-xs italic text-muted-foreground">
                            This group hasn't been added yet. Go back to the Header and confirm the
                            count, then return here.
                        </p>
                    )}
            </div>

            {canAddGroup && (
                <div className="flex items-center justify-between gap-3">
                    <Button type="button" variant="outline" size="sm" onClick={() => append(buildEmptyGroup())}>
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        Add {titlePrefix}
                    </Button>
                    <span className="text-[11px] text-muted-foreground">
                        {groups.length} / {maxGroups} groups
                    </span>
                </div>
            )}
        </section>
    );
};

const GroupCard: React.FC<{
    section: RepeatingGroupsSectionT;
    groupIdx: number;
    titlePrefix: string;
    forceReadonly?: boolean;
    canRemove: boolean;
    onRemove: () => void;
    buildEmptyRow: () => Record<string, unknown>;
    /** When true, hides the in-card group header strip — used by the wizard
     *  in single-group mode since the step title already names the group. */
    hideGroupHeader?: boolean;
}> = ({
    section,
    groupIdx,
    titlePrefix,
    forceReadonly,
    canRemove,
    onRemove,
    buildEmptyRow,
    hideGroupHeader,
}) => {
    const { control } = useFormContext();
    const rowsName = `responses.${section.id}.${groupIdx}.rows`;
    const { fields: rows, append, remove } = useFieldArray({ control, name: rowsName });
    const minRows = Math.max(1, section.rowsTable.minRows ?? 1);
    const maxRows = section.rowsTable.maxRows ?? 100;
    const addRowLabel = section.rowsTable.addRowLabel || 'Add another row';
    const canRemoveRow = !forceReadonly && rows.length > minRows;
    const canAddRow = !forceReadonly && rows.length < maxRows;

    return (
        <div className="rounded-lg border bg-background">
            {!hideGroupHeader && (
                <div className="flex items-center justify-between gap-3 border-b bg-muted/30 px-3 py-2">
                    <h4 className="text-sm font-semibold text-foreground">
                        {titlePrefix} {groupIdx + 1}
                    </h4>
                    {canRemove && (
                        <button
                            type="button"
                            onClick={onRemove}
                            className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            title={`Remove ${titlePrefix} ${groupIdx + 1}`}
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                            Remove
                        </button>
                    )}
                </div>
            )}

            <div className="space-y-3 p-3">
                {/* Group-level flat fields (e.g. equipment, area) */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {section.groupFields.map((f) => (
                        <FieldControl
                            key={f.key}
                            name={`responses.${section.id}.${groupIdx}.${f.key}`}
                            field={f}
                            forceReadonly={forceReadonly}
                        />
                    ))}
                </div>

                {/* Nested rows table */}
                {section.rowsTable.title && (
                    <h5 className="text-xs font-semibold text-foreground">
                        {section.rowsTable.title}
                    </h5>
                )}
                <div className="overflow-x-auto rounded-md border">
                    <table className="w-full table-fixed border-collapse text-sm">
                        <thead>
                            <tr className="border-b bg-muted/20">
                                <th className="w-10 py-2 px-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                    #
                                </th>
                                {section.rowsTable.columns.map((col) => (
                                    <th
                                        key={col.key}
                                        className="py-2 px-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                                        style={col.width ? { width: col.width } : undefined}
                                    >
                                        {col.label}
                                        {col.required && (
                                            <sup className="ml-0.5 text-destructive">*</sup>
                                        )}
                                    </th>
                                ))}
                                {!forceReadonly && <th className="w-10 py-2 px-2" />}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row, rIdx) => (
                                <tr key={row.id} className="border-b last:border-0 align-top">
                                    <td className="py-2 px-2 text-muted-foreground">{rIdx + 1}</td>
                                    {section.rowsTable.columns.map((col) => {
                                        const effectiveField = { ...col, bind: undefined } as Field;
                                        return (
                                            <td key={col.key} className="py-2 px-2">
                                                <FieldControl
                                                    name={`${rowsName}.${rIdx}.${col.key}`}
                                                    field={effectiveField}
                                                    forceReadonly={forceReadonly}
                                                    hideLabel
                                                />
                                            </td>
                                        );
                                    })}
                                    {!forceReadonly && (
                                        <td className="py-2 px-2 text-right">
                                            {canRemoveRow ? (
                                                <button
                                                    type="button"
                                                    onClick={() => remove(rIdx)}
                                                    className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                                    title="Remove row"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </button>
                                            ) : (
                                                <span className="inline-block h-3.5 w-3.5" />
                                            )}
                                        </td>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {canAddRow && (
                    <div className="flex items-center justify-between gap-3">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => append(buildEmptyRow())}
                        >
                            <Plus className="mr-1 h-3.5 w-3.5" />
                            {addRowLabel}
                        </Button>
                        <span className="text-[11px] text-muted-foreground">
                            {rows.length} / {maxRows} rows
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
};
