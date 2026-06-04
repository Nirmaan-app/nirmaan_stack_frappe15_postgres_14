// Trainees data table — repeatable rows. One default row; user clicks "Add
// another trainee" to grow. Each row holds typed inputs defined by
// `section.columns`. Row values land in RHF as `responses.<section.id>` =
// Array<Record<colKey, value>>.
//
// UX mirrors the image_attachments "Add another" pattern.

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Controller, useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { useFrappeFileUpload, useFrappeGetCall, useFrappePostCall } from 'frappe-react-sdk';
import { AlertTriangle, Check, ImagePlus, Loader2, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/use-toast';

import {
    COMMISSION_REPORT_CHILD_DOCTYPE,
    COMMISSION_REPORT_FILE_FIELDNAME,
    COMMISSION_REPORT_IMAGE_MAX_MB_DEFAULT,
} from '../../commission.constants';
import type {
    AttachmentRecord,
    Field,
    TraineesDataTableSection as TraineesDataTableSectionT,
} from '../types';
import { FieldControl } from './FieldControl';

interface Props {
    section: TraineesDataTableSectionT;
    /** Accepted for symmetry with image_attachments; not used by this section today. */
    parentName?: string;
    childRowName?: string;
    projectId?: string;
    templateId?: string;
    forceReadonly?: boolean;
    onAttachmentCreated?: (fileDoc: string) => void;
}

const EARTH_PIT_TEMPLATE_ID = 'earth-pit-resistance-report';
const EARTH_PIT_PARAMETERS_SECTION_ID = 'parameters';
const EARTH_PIT_HEADER_FIELD_PATH = 'responses.hdr.num_earth_pits';

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

/** Per-row image cell. Uploads to S3 via Frappe's File upload (same plumbing
 *  as ImageAttachmentSection), then stores an AttachmentRecord inline in the
 *  row's column value. Empty → small "Add photo" button; filled → thumbnail
 *  with a Remove control. */
const ImageCell: React.FC<{
    name: string;
    column: Field & { type: 'image'; maxSizeMb?: number; accept?: string };
    childRowName?: string;
    forceReadonly?: boolean;
    onAttachmentCreated?: (fileDoc: string) => void;
}> = ({ name, column, childRowName, forceReadonly, onAttachmentCreated }) => {
    const { control, setValue, getValues } = useFormContext();
    const { toast } = useToast();
    const { upload } = useFrappeFileUpload();
    const { call: deleteDoc } = useFrappePostCall('frappe.client.delete');
    const inputId = useId();
    const [isUploading, setIsUploading] = useState(false);
    const max = column.maxSizeMb ?? COMMISSION_REPORT_IMAGE_MAX_MB_DEFAULT;
    const accept = column.accept ?? 'image/*';

    const handleFile = useCallback(
        async (file: File) => {
            if (!file || !childRowName) return;
            if (file.size > max * 1024 * 1024) {
                toast({
                    title: 'File too large',
                    description: `${file.name}: exceeds ${max} MB limit`,
                    variant: 'destructive',
                });
                return;
            }
            setIsUploading(true);
            try {
                const uploaded = await upload(file, {
                    doctype: COMMISSION_REPORT_CHILD_DOCTYPE,
                    docname: childRowName,
                    fieldname: COMMISSION_REPORT_FILE_FIELDNAME,
                    isPrivate: true,
                });
                if (!uploaded?.file_url) {
                    toast({
                        title: 'Upload failed',
                        description: `Upload failed for ${file.name}`,
                        variant: 'destructive',
                    });
                    return;
                }
                // Single-image cell: delete any prior record before replacing so
                // we don't leak.
                const prior = getValues(name) as AttachmentRecord | null | undefined;
                if (prior && prior.file_doc) {
                    try {
                        await deleteDoc({ doctype: 'File', name: prior.file_doc });
                    } catch {
                        /* best-effort */
                    }
                }
                const record: AttachmentRecord = {
                    file_url: uploaded.file_url,
                    file_name: uploaded.file_name || file.name,
                    file_doc: uploaded.name,
                };
                if (record.file_doc) onAttachmentCreated?.(record.file_doc);
                setValue(name, record, { shouldDirty: true, shouldValidate: true });
            } catch (e) {
                toast({
                    title: 'Upload failed',
                    description: (e as Error).message || 'unknown',
                    variant: 'destructive',
                });
            } finally {
                setIsUploading(false);
            }
        },
        [childRowName, deleteDoc, getValues, max, name, onAttachmentCreated, setValue, toast, upload],
    );

    const handleRemove = useCallback(
        async (rec: AttachmentRecord | null | undefined) => {
            if (rec && rec.file_doc) {
                try {
                    await deleteDoc({ doctype: 'File', name: rec.file_doc });
                } catch {
                    /* best-effort */
                }
            }
            setValue(name, null, { shouldDirty: true, shouldValidate: true });
        },
        [deleteDoc, name, setValue],
    );

    return (
        <Controller
            control={control}
            name={name}
            defaultValue={null}
            render={({ field }) => {
                const rec = (field.value as AttachmentRecord | null | undefined) || null;
                if (rec && rec.file_url) {
                    return (
                        <div className="flex flex-col items-center gap-1">
                            <a
                                href={rec.file_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={rec.file_name}
                                className="block"
                            >
                                <img
                                    src={rec.file_url}
                                    alt={rec.file_name}
                                    className="h-10 w-10 rounded border object-cover"
                                />
                            </a>
                            {!forceReadonly && (
                                <button
                                    type="button"
                                    onClick={() => handleRemove(rec)}
                                    className="text-[10px] text-rose-600 hover:underline"
                                >
                                    Remove
                                </button>
                            )}
                        </div>
                    );
                }
                if (forceReadonly) {
                    return <span className="text-[11px] italic text-muted-foreground">—</span>;
                }
                return (
                    <div className="flex flex-col items-center gap-1">
                        <label
                            htmlFor={inputId}
                            className={cn(
                                'inline-flex cursor-pointer items-center gap-1 rounded border border-dashed border-muted-foreground/40 bg-muted/20 px-1.5 py-1 text-[10px] font-medium text-muted-foreground hover:bg-muted/40',
                                isUploading && 'cursor-wait opacity-70',
                            )}
                            title="Upload photo"
                        >
                            {isUploading ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                                <ImagePlus className="h-3 w-3" />
                            )}
                            <span>{isUploading ? 'Uploading…' : 'Upload'}</span>
                        </label>
                        <input
                            id={inputId}
                            type="file"
                            accept={accept}
                            className="hidden"
                            onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) void handleFile(f);
                                // Reset input so re-selecting the same file fires onChange.
                                e.target.value = '';
                            }}
                        />
                    </div>
                );
            }}
        />
    );
};

export const TraineesDataTableSection: React.FC<Props> = ({
    section,
    parentName: _parentName,
    childRowName,
    projectId,
    templateId,
    forceReadonly,
    onAttachmentCreated,
}) => {
    void _parentName;
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

    // Auto-name the `type` column on Earth Pit rows: "Earth Pit 1", "Earth Pit 2", …
    // Applied both to header-driven seeding and the manual "Add another parameter"
    // button. Users can still edit the value if they want a different label.
    const isEarthPitParameters =
        templateId === EARTH_PIT_TEMPLATE_ID && section.id === EARTH_PIT_PARAMETERS_SECTION_ID;
    const buildSeededRow = useCallback(
        (rowIdx: number): Record<string, unknown> => {
            const row = buildEmptyRow();
            if (isEarthPitParameters) {
                row.type = `Earth Pit ${rowIdx + 1}`;
            }
            return row;
        },
        [buildEmptyRow, isEarthPitParameters],
    );

    const handleAdd = useCallback(() => {
        if (fields.length >= maxRows) return;
        append(buildSeededRow(fields.length));
    }, [append, buildSeededRow, fields.length, maxRows]);

    const canRemove = !forceReadonly && fields.length > minRows;
    const canAdd = !forceReadonly && fields.length < maxRows;

    // ─── Earth Pit: row seeding from header's num_earth_pits ─────────────
    // Watch the header field. When it grows above the current row count, seed
    // empty rows up to match. When it shrinks, do NOT auto-delete — show a
    // yellow banner asking the user to remove rows manually.
    const earthPitSeedEnabled =
        templateId === EARTH_PIT_TEMPLATE_ID && section.id === EARTH_PIT_PARAMETERS_SECTION_ID;
    const numEarthPitsRaw = useWatch({
        control,
        name: EARTH_PIT_HEADER_FIELD_PATH,
    }) as unknown;
    const numEarthPits = useMemo(() => {
        if (!earthPitSeedEnabled) return null;
        const n = Number(numEarthPitsRaw);
        return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    }, [earthPitSeedEnabled, numEarthPitsRaw]);
    // Track the last seeded value so we only auto-fill on growth, not on every
    // re-render. Also avoids fighting with user-added rows.
    const lastSeededRef = useRef<number>(0);
    useEffect(() => {
        if (!earthPitSeedEnabled || forceReadonly) return;
        if (numEarthPits === null) return;
        if (numEarthPits <= fields.length) return;
        // Only grow if the new target exceeds what we last seeded — prevents
        // re-seeding after the user manually deletes rows below the target.
        if (numEarthPits <= lastSeededRef.current) return;
        const startIdx = fields.length;
        const toAdd = numEarthPits - fields.length;
        for (let i = 0; i < toAdd; i++) append(buildSeededRow(startIdx + i));
        lastSeededRef.current = numEarthPits;
    }, [append, buildSeededRow, earthPitSeedEnabled, fields.length, forceReadonly, numEarthPits]);

    const earthPitCountMismatch =
        earthPitSeedEnabled && numEarthPits !== null && numEarthPits < fields.length;

    return (
        <section className="space-y-3">
            {section.title && (
                <h3 className="text-base font-semibold text-foreground">{section.title}</h3>
            )}

            {earthPitCountMismatch && (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                    <div className="text-xs text-amber-800">
                        Header says <span className="font-semibold">{numEarthPits}</span> earth
                        pit(s) but you have{' '}
                        <span className="font-semibold">{fields.length}</span> earth pit(s) below.
                        Either <span className="font-medium">remove the unwanted earth pit(s)</span>{' '}
                        here, or <span className="font-medium">increase Number of Earth Pits</span>{' '}
                        in the Header step.
                    </div>
                </div>
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
                                    // Per-row image cell: upload to S3 + store the
                                    // AttachmentRecord inline in the row.
                                    if (col.type === 'image') {
                                        return (
                                            <td key={col.key} className="py-2 px-2 align-top text-center">
                                                <ImageCell
                                                    name={cellName}
                                                    column={col as Field & { type: 'image' }}
                                                    childRowName={childRowName}
                                                    forceReadonly={forceReadonly}
                                                    onAttachmentCreated={onAttachmentCreated}
                                                />
                                            </td>
                                        );
                                    }
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

            {canAdd && !isEarthPitParameters && (
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
            {isEarthPitParameters && !forceReadonly && (
                <p className="text-[11px] text-muted-foreground">
                    Row count is controlled by <span className="font-medium">Number of Earth Pits</span>{' '}
                    in the Header step.
                </p>
            )}
        </section>
    );
};
