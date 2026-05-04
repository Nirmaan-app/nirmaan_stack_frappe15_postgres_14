// Tabular Q&A checklist. Mobile-friendly: stacks per row on small screens.

import React from 'react';

import type { ChecklistSection as ChecklistSectionT, Field } from '../types';
import { FieldControl } from './FieldControl';

interface Props {
    section: ChecklistSectionT;
    forceReadonly?: boolean;
}

export const ChecklistSection: React.FC<Props> = ({ section, forceReadonly }) => {
    return (
        <section className="space-y-3">
            {section.title && (
                <h3 className="text-base font-semibold text-foreground">{section.title}</h3>
            )}

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
                                    <td className="px-3 py-2">{item.particular}</td>
                                    <td className="w-40 px-3 py-2">
                                        <FieldControl
                                            name={`responses.${section.id}.${item.id}.result`}
                                            field={resultField}
                                            hideLabel
                                            forceReadonly={forceReadonly}
                                        />
                                    </td>
                                    <td className="px-3 py-2">
                                        {remarksField ? (
                                            <FieldControl
                                                name={`responses.${section.id}.${item.id}.remarks`}
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
                                {item.particular}
                            </p>
                            <div className="space-y-2">
                                <FieldControl
                                    name={`responses.${section.id}.${item.id}.result`}
                                    field={resultField}
                                    forceReadonly={forceReadonly}
                                />
                                {remarksField && (
                                    <FieldControl
                                        name={`responses.${section.id}.${item.id}.remarks`}
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
