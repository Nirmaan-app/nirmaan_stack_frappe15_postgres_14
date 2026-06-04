// Trainees data table — repeatable rows. One default row; user clicks "Add
// another trainee" to grow. Each row holds typed inputs defined by
// `section.columns`. Row values land in RHF as `responses.<section.id>` =
// Array<Record<colKey, value>>.
//
// UX mirrors the image_attachments "Add another" pattern.

import React, { useCallback, useMemo } from 'react';
import { Controller, useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { useFrappeGetCall } from 'frappe-react-sdk';
import { Check, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import type { TraineesDataTableSection as TraineesDataTableSectionT, Field } from '../types';
import { FieldControl } from './FieldControl';

interface Props {
    section: TraineesDataTableSectionT;
    projectId?: string;
    templateId?: string;
    forceReadonly?: boolean;
}

// Template-specific dropdown source for the LT Cable Megger Test Report's
// `cable_size` column — pulls distinct item names from the project's Material
// Usage data (PO + Custom items) filtered to category "Wires & Cables" with
// "ARMOURED CABLE" in the name. Kept as a narrow special-case here rather
// than a grammar extension; see git history for context.
const LT_CABLE_MEGGER_TEMPLATE_ID = 'lt-cable-megger-test-report';
const LT_CABLE_SIZE_COL_KEY = 'cable_size';
const LT_CABLE_CATEGORY = 'Wires & Cables';
const LT_CABLE_NAME_MATCH = 'ARMOURED CABLE';

// Columns in the LT Cable Megger template that render as the "pass-toggle"
// cell — the column's `default` (e.g. ">200 MΩ") is shown as a label with a
// green tick beneath it. Untick to override with a custom reading.
const LT_CABLE_NON_PASS_COL_KEYS = new Set(['cable_size', 'from', 'to']);
const isLtCablePassColumn = (
    templateId: string | undefined,
    col: { key: string; type: string; default?: unknown },
): boolean =>
    templateId === LT_CABLE_MEGGER_TEMPLATE_ID &&
    col.type === 'text' &&
    typeof col.default === 'string' &&
    col.default.length > 0 &&
    !LT_CABLE_NON_PASS_COL_KEYS.has(col.key);

const useLtCableSizeOptions = (projectId?: string, enabled?: boolean) => {
    const { data, isLoading } = useFrappeGetCall<{
        message: {
            po_items: Array<{ item_name?: string; category?: string }>;
            custom_items: Array<{ item_name?: string; category?: string }>;
        };
    }>(
        'nirmaan_stack.api.procurement_orders.generate_po_summary',
        enabled && projectId ? { project_id: projectId } : undefined,
        enabled && projectId ? ['lt-cable-size-options', projectId] : undefined,
    );

    const options = useMemo<string[]>(() => {
        if (!data?.message) return [];
        const all = [
            ...(data.message.po_items || []),
            ...(data.message.custom_items || []),
        ];
        const set = new Set<string>();
        for (const it of all) {
            const name = (it.item_name || '').trim();
            const cat = (it.category || '').trim();
            if (!name) continue;
            if (cat !== LT_CABLE_CATEGORY) continue;
            if (!name.toUpperCase().includes(LT_CABLE_NAME_MATCH)) continue;
            set.add(name);
        }
        return Array.from(set).sort((a, b) => a.localeCompare(b));
    }, [data]);

    return { options, isLoading };
};

/** Cell that renders a compact single-line pill `✓ >200 MΩ` for the pass
 *  state, and flips to a tight text input when the user wants to record a
 *  different reading. Click the pill (or the input's adjacent tick) to
 *  toggle. Designed to fit a ~55px-wide column. */
const MeasurementPassCell: React.FC<{
    name: string;
    defaultValue: string;
    forceReadonly?: boolean;
}> = ({ name, defaultValue, forceReadonly }) => {
    const { control } = useFormContext();
    return (
        <Controller
            control={control}
            name={name}
            defaultValue={defaultValue}
            render={({ field }) => {
                const value = typeof field.value === 'string' ? field.value : '';
                const isPass = value === defaultValue;

                const togglePass = () => {
                    if (forceReadonly) return;
                    field.onChange(isPass ? '' : defaultValue);
                };

                // Visual label drops the unit (e.g. "MΩ") — the column-group
                // header already says "VALUES IN MΩ", so the unit would
                // duplicate it and force truncation in the narrow cell.
                // Stored value still includes the unit for the print + edit.
                const displayLabel = defaultValue.replace(/\s*M(Ω|Ohm)?\s*$/i, '').trim() || defaultValue;

                if (isPass) {
                    return (
                        <button
                            type="button"
                            disabled={forceReadonly}
                            onClick={togglePass}
                            title={`${defaultValue} — click to enter a custom reading`}
                            className={cn(
                                'flex w-full items-center justify-center gap-0.5 rounded border border-emerald-300 bg-emerald-50/70 px-1 py-1 text-[11px] font-semibold leading-tight text-emerald-800',
                                !forceReadonly && 'hover:bg-emerald-100 cursor-pointer',
                                forceReadonly && 'opacity-70 cursor-not-allowed',
                            )}
                        >
                            <Check className="h-2.5 w-2.5 shrink-0" />
                            <span>{displayLabel}</span>
                        </button>
                    );
                }

                return (
                    <div className="flex items-center gap-0.5">
                        <Input
                            value={value}
                            onChange={(e) => field.onChange(e.target.value)}
                            disabled={forceReadonly}
                            placeholder={defaultValue}
                            className="h-6 min-w-0 flex-1 px-1 text-center text-[10px]"
                            onBlur={field.onBlur}
                            name={field.name}
                            ref={field.ref}
                        />
                        <button
                            type="button"
                            disabled={forceReadonly}
                            onClick={togglePass}
                            title={`Reset to ${defaultValue}`}
                            className={cn(
                                'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-muted-foreground/40 bg-background text-muted-foreground hover:border-emerald-500 hover:text-emerald-600',
                                forceReadonly && 'cursor-not-allowed opacity-60',
                            )}
                        >
                            <Check className="h-2.5 w-2.5" />
                        </button>
                    </div>
                );
            }}
        />
    );
};

export const TraineesDataTableSection: React.FC<Props> = ({
    section,
    projectId,
    templateId,
    forceReadonly,
}) => {
    const { control, getValues } = useFormContext();
    const fieldName = `responses.${section.id}`;
    const { fields, append, remove } = useFieldArray({ control, name: fieldName });

    const minRows = Math.max(1, section.minRows ?? 1);
    const maxRows = section.maxRows ?? 100;
    const addLabel = section.addRowLabel || 'Add another trainee';

    const ltCableSizeEnabled =
        templateId === LT_CABLE_MEGGER_TEMPLATE_ID &&
        section.columns.some((c) => c.key === LT_CABLE_SIZE_COL_KEY);
    const { options: apiCableSizeOptions, isLoading: ltCableSizeLoading } =
        useLtCableSizeOptions(projectId, ltCableSizeEnabled);

    // Union the API-derived options with any already-saved row values so
    // historical entries (or items removed from the project later) still
    // render correctly in view/edit mode — shadcn Select shows the placeholder
    // when value isn't in the option list. We read via getValues (no
    // subscription) and re-derive when the row count changes; in-cell edits
    // pick a value that's already in apiCableSizeOptions, so we don't need
    // per-keystroke updates here.
    const ltCableSizeOptions = useMemo<string[]>(() => {
        if (!ltCableSizeEnabled) return apiCableSizeOptions;
        const set = new Set<string>(apiCableSizeOptions);
        const rows = (getValues(fieldName) as Array<Record<string, unknown>> | undefined) || [];
        for (const r of rows) {
            const v = r?.[LT_CABLE_SIZE_COL_KEY];
            if (typeof v === 'string' && v.trim()) set.add(v.trim());
        }
        return Array.from(set).sort((a, b) => a.localeCompare(b));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ltCableSizeEnabled, apiCableSizeOptions, fields.length]);

    // Subscribe to row values so each row's cable_size dropdown can hide
    // entries already picked in OTHER rows. Each cell still shows its own
    // current value so the user can keep what's there even if it would
    // otherwise be filtered out.
    const watchedRows = useWatch({ control, name: fieldName }) as
        | Array<Record<string, unknown>>
        | undefined;
    const allUsedCableSizes = useMemo<string[]>(() => {
        if (!ltCableSizeEnabled) return [];
        return (watchedRows || [])
            .map((r) => (typeof r?.[LT_CABLE_SIZE_COL_KEY] === 'string'
                ? (r[LT_CABLE_SIZE_COL_KEY] as string).trim()
                : ''))
            .map((v) => v || '');
    }, [ltCableSizeEnabled, watchedRows]);
    const buildCableSizeOptionsFor = useCallback(
        (rowIdx: number): string[] => {
            if (!ltCableSizeEnabled) return ltCableSizeOptions;
            const usedByOthers = new Set<string>();
            allUsedCableSizes.forEach((v, i) => {
                if (i === rowIdx) return;
                if (v) usedByOthers.add(v);
            });
            const own = allUsedCableSizes[rowIdx] || '';
            const filtered = ltCableSizeOptions.filter((o) => !usedByOthers.has(o));
            // Always keep this row's current pick selectable (e.g. legacy
            // value not in the API list, or it'd just been chosen).
            if (own && !filtered.includes(own)) filtered.push(own);
            return filtered.sort((a, b) => a.localeCompare(b));
        },
        [ltCableSizeEnabled, ltCableSizeOptions, allUsedCableSizes],
    );

    const buildEmptyRow = useCallback((): Record<string, unknown> => {
        const row: Record<string, unknown> = {};
        for (const col of section.columns) {
            row[col.key] =
                col.default !== undefined && col.default !== null && col.default !== ''
                    ? col.default
                    : '';
        }
        return row;
    }, [section.columns]);

    const handleAdd = useCallback(() => {
        if (fields.length >= maxRows) return;
        append(buildEmptyRow());
    }, [append, buildEmptyRow, fields.length, maxRows]);

    const canRemove = !forceReadonly && fields.length > minRows;
    const canAdd = !forceReadonly && fields.length < maxRows;

    return (
        <section className="space-y-3">
            {section.title && (
                <h3 className="text-base font-semibold text-foreground">{section.title}</h3>
            )}

            <div className="overflow-x-auto rounded-md border">
                <table className="w-full table-fixed border-collapse text-sm">
                    <thead>
                        <tr className="border-b bg-muted/30">
                            <th className="w-10 py-2 px-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                #
                            </th>
                            {section.columns.map((col) => (
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
                            {!forceReadonly && (
                                <th className="w-10 py-2 px-2" aria-label="Actions" />
                            )}
                        </tr>
                    </thead>
                    <tbody>
                        {fields.map((row, idx) => (
                            <tr key={row.id} className="border-b last:border-0 align-top">
                                <td className="py-2 px-2 text-muted-foreground">{(section.rowLabelPrefix || '') + (idx + 1)}</td>
                                {section.columns.map((col) => {
                                    const cellName = `${fieldName}.${idx}.${col.key}`;
                                    // LT Cable Megger measurement columns render as a
                                    // pass-default cell (label + tick), not a plain input.
                                    if (isLtCablePassColumn(templateId, col)) {
                                        return (
                                            <td key={col.key} className="py-2 px-2 align-top">
                                                <MeasurementPassCell
                                                    name={cellName}
                                                    defaultValue={col.default as string}
                                                    forceReadonly={forceReadonly}
                                                />
                                            </td>
                                        );
                                    }

                                    const isLtCableSize =
                                        ltCableSizeEnabled && col.key === LT_CABLE_SIZE_COL_KEY;
                                    // Swap the text input for a select fed by the project's
                                    // filtered Wires & Cables items, with per-row dedup so
                                    // each cable appears in at most one row's dropdown.
                                    // While the API is loading (or returns nothing), fall
                                    // back to the original text input so the user is
                                    // never blocked.
                                    const perRowCableSizeOptions = isLtCableSize
                                        ? buildCableSizeOptionsFor(idx)
                                        : [];
                                    const effectiveField =
                                        isLtCableSize && perRowCableSizeOptions.length > 0
                                            ? ({
                                                  ...col,
                                                  bind: undefined,
                                                  type: 'select',
                                                  options: perRowCableSizeOptions,
                                              } as Field)
                                            : ({ ...col, bind: undefined } as Field);
                                    return (
                                        <td key={col.key} className="py-2 px-2">
                                            <FieldControl
                                                name={cellName}
                                                field={effectiveField}
                                                forceReadonly={forceReadonly}
                                                hideLabel
                                            />
                                            {isLtCableSize &&
                                                ltCableSizeLoading &&
                                                ltCableSizeOptions.length === 0 && (
                                                    <p className="mt-1 text-[10px] text-muted-foreground">
                                                        Loading Wires &amp; Cables items…
                                                    </p>
                                                )}
                                            {isLtCableSize &&
                                                !ltCableSizeLoading &&
                                                ltCableSizeOptions.length === 0 && (
                                                    <p className="mt-1 text-[10px] text-muted-foreground">
                                                        No ARMOURED CABLE items found on this
                                                        project — type the cable size manually.
                                                    </p>
                                                )}
                                        </td>
                                    );
                                })}
                                {!forceReadonly && (
                                    <td className="py-2 px-2 text-right">
                                        {canRemove ? (
                                            <button
                                                type="button"
                                                onClick={() => remove(idx)}
                                                className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                                aria-label={`Remove row ${idx + 1}`}
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

            {canAdd && (
                <div className="flex items-center justify-between gap-3">
                    <Button type="button" variant="outline" size="sm" onClick={handleAdd}>
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        {addLabel}
                    </Button>
                    <span className="text-[11px] text-muted-foreground">
                        {fields.length} / {maxRows} rows
                    </span>
                </div>
            )}
        </section>
    );
};
