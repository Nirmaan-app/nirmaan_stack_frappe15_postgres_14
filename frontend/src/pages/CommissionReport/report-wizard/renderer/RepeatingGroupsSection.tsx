// Repeating groups section. Renders N independent group cards, each with a
// flat set of `groupFields` (e.g. Equipment + Area) on top and a nested
// repeating data-table below (`rowsTable`). Group count can be bound to a
// header field via `countBoundTo` — auto-seeds empty groups as that number
// grows; reductions are manual (mirrors the Earth Pit count behavior).

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';

import type {
    Field,
    RepeatingGroupsSection as RepeatingGroupsSectionT,
    Section,
} from '../types';
import { ChecklistSection } from './ChecklistSection';
import { FieldControl } from './FieldControl';
import { ProcessSection } from './ProcessSection';

interface Props {
    section: RepeatingGroupsSectionT;
    forceReadonly?: boolean;
    /** When set, render only this single group (zero-based index). Used by
     *  the wizard when each group lives on its own synthetic step. Hides the
     *  Add Group button, the count-mismatch banner and the group counter. */
    groupIndexFilter?: number;
}

/** A group is considered "empty enough to silently trim" when **every
 *  declared groupField** (e.g. EQUIPMENT + AREA on the DX/CFM templates) is
 *  empty. Nested checklist defaults or pre-seeded rows don't keep a group
 *  alive — those are template-side seeding artifacts, not user intent. The
 *  decision rests on whether the operator has identified the unit/area. */
const isGroupBlank = (
    group: unknown,
    groupFields: { key: string }[],
): boolean => {
    if (!group || typeof group !== 'object') return true;
    const g = group as Record<string, unknown>;
    for (const f of groupFields) {
        const v = g[f.key];
        if (v === undefined || v === null) continue;
        if (typeof v === 'string' && v.trim() === '') continue;
        if (typeof v === 'number' && Number.isNaN(v)) continue;
        // First non-empty identifier → group is meaningful, keep it.
        return false;
    }
    return true;
};

export const RepeatingGroupsSection: React.FC<Props> = ({
    section,
    forceReadonly,
    groupIndexFilter,
}) => {
    const { control, getValues } = useFormContext();
    const { toast } = useToast();
    const groupsName = `responses.${section.id}`;
    const { fields: groups, append, remove } = useFieldArray({ control, name: groupsName });

    const maxGroups = section.maxGroups ?? 50;
    const titlePrefix = section.groupTitlePrefix || 'Group';

    const buildEmptyRow = useCallback((): Record<string, unknown> => {
        const row: Record<string, unknown> = {};
        if (!section.rowsTable) return row;
        for (const col of section.rowsTable.columns) {
            row[col.key] =
                col.default !== undefined && col.default !== null && col.default !== ''
                    ? col.default
                    : '';
        }
        return row;
    }, [section.rowsTable]);

    const buildEmptyGroup = useCallback((): Record<string, unknown> => {
        const g: Record<string, unknown> = {};
        for (const f of section.groupFields) {
            g[f.key] =
                f.default !== undefined && f.default !== null && f.default !== ''
                    ? f.default
                    : '';
        }
        if (section.rowsTable) {
            const minRows = Math.max(1, section.rowsTable.minRows ?? 1);
            g.rows = Array.from({ length: minRows }, () => buildEmptyRow());
        }
        // Seed nestedSections so DX Unit 2..N start the same as DX Unit 1
        // (avoids the asymmetry where prefill seeded the first group but
        // header-driven auto-seeding leaves later groups empty).
        if (section.nestedSections) {
            for (const nested of section.nestedSections) {
                if (nested.type === 'header' || nested.type === 'fields') {
                    const sub: Record<string, unknown> = {};
                    for (const f of nested.fields) {
                        sub[f.key] =
                            f.default !== undefined && f.default !== null && f.default !== ''
                                ? f.default
                                : '';
                    }
                    g[nested.id] = sub;
                } else if (nested.type === 'checklist') {
                    const sub: Record<string, { result: unknown; remarks: unknown }> = {};
                    for (const item of nested.items) {
                        const resultDefault =
                            item.result.default !== undefined &&
                            item.result.default !== null &&
                            item.result.default !== ''
                                ? item.result.default
                                : '';
                        const remarksDefault =
                            item.remarks &&
                            item.remarks.default !== undefined &&
                            item.remarks.default !== null &&
                            item.remarks.default !== ''
                                ? item.remarks.default
                                : '';
                        sub[item.id] = { result: resultDefault, remarks: remarksDefault };
                    }
                    g[nested.id] = sub;
                }
                // process / signatures / image_attachments have no per-group inputs
            }
        }
        return g;
    }, [buildEmptyRow, section.groupFields, section.nestedSections, section.rowsTable]);

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

        // GROW: header count exceeds current groups — seed empty groups to match.
        if (declaredCount > groups.length && declaredCount > lastSeededRef.current) {
            const toAdd = declaredCount - groups.length;
            for (let i = 0; i < toAdd; i++) append(buildEmptyGroup());
            lastSeededRef.current = declaredCount;
            return;
        }

        // SHRINK (Pattern A — smart auto-trim): when the header count drops
        // below the current group count, silently remove trailing groups
        // whose identifier fields (groupFields) are all empty. Stop at the
        // first non-blank group — those keep the banner visible so the user
        // can deliberately confirm before destroying typed data.
        if (declaredCount < groups.length) {
            const allValues =
                (getValues(groupsName) as Array<Record<string, unknown>>) || [];
            const indexesToRemove: number[] = [];
            for (let i = groups.length - 1; i >= declaredCount; i--) {
                if (isGroupBlank(allValues[i], section.groupFields)) {
                    indexesToRemove.push(i);
                } else {
                    break; // first non-blank tail group → stop
                }
            }
            if (indexesToRemove.length > 0) {
                remove(indexesToRemove);
                lastSeededRef.current = Math.min(
                    lastSeededRef.current,
                    groups.length - indexesToRemove.length,
                );
                // Identifier fields (e.g. EQUIPMENT + AREA) for these groups
                // were blank, so silently trimming is safe. Toast the user
                // so the wizard doesn't feel like it lost data on its own.
                const fieldLabels = section.groupFields
                    .map((f) => f.label)
                    .join(' / ');
                toast({
                    title: `Removed ${indexesToRemove.length} empty ${
                        titlePrefix.toLowerCase()
                    }${indexesToRemove.length === 1 ? '' : 's'}`,
                    description: `Trailing group${
                        indexesToRemove.length === 1 ? '' : 's'
                    } with no ${fieldLabels} filled in were trimmed to match the header count.`,
                });
            }
        }
    }, [
        append,
        buildEmptyGroup,
        declaredCount,
        forceReadonly,
        getValues,
        groups.length,
        groupsName,
        remove,
        section.groupFields,
        titlePrefix,
        toast,
    ]);

    const countMismatch =
        declaredCount !== null && declaredCount < groups.length;
    const extraCount = countMismatch ? groups.length - (declaredCount as number) : 0;

    /** "Remove N filled groups" — manual escape hatch when the trailing
     *  groups have data and weren't auto-trimmed. Confirms before deleting. */
    const handleForceTrim = useCallback(() => {
        if (declaredCount === null) return;
        const confirmed = window.confirm(
            `Remove ${extraCount} group(s) from the end? Any data entered in those groups will be lost. This cannot be undone.`,
        );
        if (!confirmed) return;
        const indexesToRemove: number[] = [];
        for (let i = groups.length - 1; i >= declaredCount; i--) indexesToRemove.push(i);
        if (indexesToRemove.length > 0) {
            remove(indexesToRemove);
            lastSeededRef.current = Math.min(lastSeededRef.current, declaredCount);
        }
    }, [declaredCount, extraCount, groups.length, remove]);

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
                    <div className="flex-1 space-y-2">
                        <div className="text-xs text-amber-800">
                            Header says <span className="font-semibold">{declaredCount}</span>{' '}
                            group(s) but you have{' '}
                            <span className="font-semibold">{groups.length}</span>. The{' '}
                            <span className="font-semibold">{extraCount}</span> extra group(s) have
                            data, so they weren't auto-removed. Either delete them below, raise the
                            header count back, or click the button to remove them now.
                        </div>
                        {!forceReadonly && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={handleForceTrim}
                                className="h-7 border-amber-500/60 bg-white text-amber-800 hover:bg-amber-100"
                            >
                                <Trash2 className="mr-1 h-3.5 w-3.5" />
                                Remove last {extraCount} group(s)
                            </Button>
                        )}
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

/** Dispatch helper for rendering a nested section inside a repeating-groups
 *  group card. Today only `checklist` (form inputs) and `process` (read-only
 *  text) are supported, which covers the DX Commission Report. Add more
 *  cases here when other section types need per-group rendering — each
 *  must accept a `pathRoot` so its RHF paths nest under the group. */
const renderNestedSection = (
    section: Section,
    pathRoot: string,
    forceReadonly?: boolean,
): React.ReactNode => {
    switch (section.type) {
        case 'checklist':
            return (
                <div key={section.id} className="space-y-2">
                    {section.title && (
                        <h5 className="text-xs font-semibold text-foreground">
                            {section.title}
                        </h5>
                    )}
                    <ChecklistSection
                        section={section}
                        forceReadonly={forceReadonly}
                        pathRoot={pathRoot}
                    />
                </div>
            );
        case 'process':
            // Process has no inputs — pathRoot is irrelevant.
            return <ProcessSection key={section.id} section={section} />;
        default:
            return (
                <p key={section.id} className="text-xs italic text-muted-foreground">
                    Nested section type "{section.type}" not supported yet.
                </p>
            );
    }
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
    const { fields: rows, append, remove } = useFieldArray({
        control,
        name: rowsName,
        // RHF errors when name doesn't exist in defaultValues — for groups
        // without a rowsTable we still want this hook to be called (hooks must
        // run unconditionally) but the rows array will stay empty.
    });
    const hasRowsTable = !!section.rowsTable;
    const minRows = hasRowsTable ? Math.max(1, section.rowsTable!.minRows ?? 1) : 0;
    const maxRows = hasRowsTable ? (section.rowsTable!.maxRows ?? 100) : 0;
    const addRowLabel = hasRowsTable
        ? section.rowsTable!.addRowLabel || 'Add another row'
        : '';
    const canRemoveRow = hasRowsTable && !forceReadonly && rows.length > minRows;
    const canAddRow = hasRowsTable && !forceReadonly && rows.length < maxRows;
    const groupPathRoot = `responses.${section.id}.${groupIdx}`;

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

                {/* Nested rows table (optional — only when rowsTable is declared) */}
                {hasRowsTable && (
                    <>
                        {section.rowsTable!.title && (
                            <h5 className="text-xs font-semibold text-foreground">
                                {section.rowsTable!.title}
                            </h5>
                        )}
                        <div className="overflow-x-auto rounded-md border">
                            <table className="w-full table-fixed border-collapse text-sm">
                                <thead>
                                    <tr className="border-b bg-muted/20">
                                        <th className="w-10 py-2 px-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                            #
                                        </th>
                                        {section.rowsTable!.columns.map((col) => (
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
                                            {section.rowsTable!.columns.map((col) => {
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
                    </>
                )}

                {/* Nested sub-sections (e.g. per-group Physical Test checklist
                    + Timer process). RHF paths are rooted at this group via
                    pathRoot. Only `checklist` and `process` are supported today
                    — extend the dispatch below if more types are needed. */}
                {section.nestedSections && section.nestedSections.length > 0 && (
                    <div className="space-y-4 pt-2">
                        {section.nestedSections.map((nested) =>
                            renderNestedSection(nested, groupPathRoot, forceReadonly),
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
