// Fixed-row tabular measurement grid: N declared rows × M typed column-groups.
// Each cell renders as [static row label | typed input]. Row count is locked
// by the template — no add/remove controls. Mirrors the printed PDF layout.

import React from 'react';
import { useFieldArray, useFormContext } from 'react-hook-form';

import type { Field, MeasurementMatrixSection as MeasurementMatrixSectionT, NumberField } from '../types';
import { FieldControl } from './FieldControl';

interface Props {
    section: MeasurementMatrixSectionT;
    forceReadonly?: boolean;
}

export const MeasurementMatrixSection: React.FC<Props> = ({ section, forceReadonly }) => {
    const { control } = useFormContext();
    const fieldName = `responses.${section.id}`;
    const { fields } = useFieldArray({ control, name: fieldName });

    return (
        <section className="space-y-3">
            {section.title && (
                <h3 className="text-base font-semibold text-foreground">{section.title}</h3>
            )}

            <div className="overflow-x-auto rounded-md border">
                <table className="w-full border-collapse text-sm">
                    <thead>
                        <tr className="border-b bg-muted/30">
                            {section.columns.map((col) => (
                                <React.Fragment key={col.key}>
                                    <th className="py-2 px-2 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                        {col.label}
                                    </th>
                                    <th className="py-2 px-2 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                        {col.valueLabel
                                            || (col.type === 'number' && (col as NumberField).unit
                                                ? `In ${(col as NumberField).unit}`
                                                : 'Value')}
                                    </th>
                                </React.Fragment>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {fields.map((row, idx) => {
                            const rowDef = section.rows[idx];
                            if (!rowDef) return null;
                            return (
                                <tr key={row.id} className="border-b last:border-0 align-middle">
                                    {section.columns.map((col) => {
                                        const cellLabel = rowDef.labels[col.key] || '';
                                        return (
                                            <React.Fragment key={col.key}>
                                                <td className="py-2 px-2 text-center font-medium text-foreground">
                                                    {cellLabel || <span className="text-muted-foreground">—</span>}
                                                </td>
                                                <td className="py-2 px-2">
                                                    <FieldControl
                                                        name={`${fieldName}.${idx}.${col.key}`}
                                                        field={{ ...col, bind: undefined, label: cellLabel || col.label } as Field}
                                                        forceReadonly={forceReadonly}
                                                        hideLabel
                                                    />
                                                </td>
                                            </React.Fragment>
                                        );
                                    })}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </section>
    );
};
