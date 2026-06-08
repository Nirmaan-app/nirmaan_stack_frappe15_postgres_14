// Tabular Q&A checklist. Mobile-friendly: stacks per row on small screens.

import React from 'react';
import { useWatch } from 'react-hook-form';

import type { ChecklistSection as ChecklistSectionT, Field } from '../types';
import { FieldControl } from './FieldControl';

interface Props {
    section: ChecklistSectionT;
    forceReadonly?: boolean;
    /** Override the RHF path root. Defaults to "responses". Used when this
     *  checklist is rendered as a nested section inside a `repeating_groups`
     *  group, e.g. `responses.readings.0`. */
    pathRoot?: string;
}

/** Substitute `{type}` in an item's particular text with the live value of
 *  the header's `test_type` field (e.g. Smoke / Light / Pressure on the Duct
 *  Pressure / Leak Test Report). No-op for items without the placeholder. */
const renderParticular = (particular: string, testType: unknown): string => {
    if (!particular.includes('{type}')) return particular;
    const v = typeof testType === 'string' && testType ? testType : '—';
    return particular.replace(/\{type\}/g, v);
};

export const ChecklistSection: React.FC<Props> = ({ section, forceReadonly, pathRoot }) => {
    const root = pathRoot || 'responses';
    const testType = useWatch({ name: 'responses.hdr.test_type' });
    return (
        <section className="space-y-3">
            {/* Desktop table */}
            <div className="hidden overflow-hidden rounded-md border md:block">
                <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                        <tr>
                            {section.columns.map((c) => (
                                <th key={c.key} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    {c.label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {section.items.map((item, idx) => {
                            const resultField = {
                                ...item.result,
                                key: 'result',
                                label: item.result.label || 'Result',
                            } as Field;
                            const remarksField = item.remarks
                                ? ({
                                      ...item.remarks,
                                      key: 'remarks',
                                      label: item.remarks.label || 'Remarks',
                                  } as Field)
                                : null;
                            return (
                                <tr key={item.id} className="border-t align-top">
                                    <td className="w-12 px-3 py-2 text-muted-foreground">{idx + 1}</td>
                                    <td className="px-3 py-2">{renderParticular(item.particular, testType)}</td>
                                    <td className="w-40 px-3 py-2">
                                        <FieldControl
                                            name={`${root}.${section.id}.${item.id}.result`}
                                            field={resultField}
                                            hideLabel
                                            forceReadonly={forceReadonly}
                                        />
                                    </td>
                                    <td className="px-3 py-2">
                                        {remarksField ? (
                                            <FieldControl
                                                name={`${root}.${section.id}.${item.id}.remarks`}
                                                field={remarksField}
                                                hideLabel
                                                forceReadonly={forceReadonly}
                                            />
                                        ) : (
                                            <span className="text-muted-foreground">—</span>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Mobile: stacked cards */}
            <div className="space-y-3 md:hidden">
                {section.items.map((item, idx) => {
                    const resultField = {
                        ...item.result,
                        key: 'result',
                        label: item.result.label || 'Result',
                    } as Field;
                    const remarksField = item.remarks
                        ? ({
                              ...item.remarks,
                              key: 'remarks',
                              label: item.remarks.label || 'Remarks',
                          } as Field)
                        : null;
                    return (
                        <div key={item.id} className="rounded-md border p-3">
                            <p className="mb-2 text-sm font-medium">
                                <span className="mr-2 text-muted-foreground">{idx + 1}.</span>
                                {renderParticular(item.particular, testType)}
                            </p>
                            <div className="space-y-2">
                                <FieldControl
                                    name={`${root}.${section.id}.${item.id}.result`}
                                    field={resultField}
                                    forceReadonly={forceReadonly}
                                />
                                {remarksField && (
                                    <FieldControl
                                        name={`${root}.${section.id}.${item.id}.remarks`}
                                        field={remarksField}
                                        forceReadonly={forceReadonly}
                                    />
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
};
