// Generic typed-input grid (measurements, free-form fields).

import React from 'react';

import { cn } from '@/lib/utils';

import type { FieldsSection as FieldsSectionT } from '../types';
import { FieldControl } from './FieldControl';

interface Props {
    section: FieldsSectionT;
    forceReadonly?: boolean;
    /** Override the RHF path root. Defaults to "responses". Used by zone-wise
     *  reports so this section reads/writes `zones.<i>.responses.<id>.<field>`. */
    pathRoot?: string;
}

export const FieldsSection: React.FC<Props> = ({ section, forceReadonly, pathRoot }) => {
    const root = pathRoot || 'responses';
    const cols = section.columns ?? 2;
    const layout = section.layout ?? 'grid';

    return (
        <section className="space-y-3">
            {section.title && (
                <h3 className="text-base font-semibold text-foreground">{section.title}</h3>
            )}
            <div
                className={cn(
                    layout === 'grid' ? 'grid gap-x-4 gap-y-3' : 'flex flex-col gap-3',
                    layout === 'grid' && cols === 1 && 'sm:grid-cols-1',
                    layout === 'grid' && cols === 2 && 'sm:grid-cols-2',
                    layout === 'grid' && cols === 3 && 'sm:grid-cols-3',
                    layout === 'grid' && cols && cols >= 4 && 'sm:grid-cols-4',
                )}
            >
                {section.fields.map((f) => (
                    <FieldControl
                        key={f.key}
                        name={`${root}.${section.id}.${f.key}`}
                        field={f}
                        forceReadonly={forceReadonly}
                    />
                ))}
            </div>
        </section>
    );
};
