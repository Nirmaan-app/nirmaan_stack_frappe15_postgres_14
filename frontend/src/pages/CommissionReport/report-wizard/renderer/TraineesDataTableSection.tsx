// Trainees data table — repeatable rows. One default row; user clicks "Add
// another trainee" to grow. Each row holds typed inputs defined by
// `section.columns`. Row values land in RHF as `responses.<section.id>` =
// Array<Record<colKey, value>>.
//
// UX mirrors the image_attachments "Add another" pattern.

import React, { useCallback } from 'react';
import { useFieldArray, useFormContext } from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

import type { TraineesDataTableSection as TraineesDataTableSectionT, Field } from '../types';
import { FieldControl } from './FieldControl';

interface Props {
    section: TraineesDataTableSectionT;
    forceReadonly?: boolean;
}

export const TraineesDataTableSection: React.FC<Props> = ({ section, forceReadonly }) => {
    const { control } = useFormContext();
    const fieldName = `responses.${section.id}`;
    const { fields, append, remove } = useFieldArray({ control, name: fieldName });

    const minRows = Math.max(1, section.minRows ?? 1);
    const maxRows = section.maxRows ?? 100;
    const addLabel = section.addRowLabel || 'Add another trainee';

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
                <table className="w-full border-collapse text-sm">
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
                                {section.columns.map((col) => (
                                    <td key={col.key} className="py-2 px-2">
                                        <FieldControl
                                            name={`${fieldName}.${idx}.${col.key}`}
                                            field={{ ...col, bind: undefined } as Field}
                                            forceReadonly={forceReadonly}
                                            hideLabel
                                        />
                                    </td>
                                ))}
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
