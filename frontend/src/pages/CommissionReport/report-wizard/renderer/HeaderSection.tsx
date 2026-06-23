// Cover-block section: identity / vendor / project / date.
// Renders a 2-column responsive grid; each row is one field.

import React from 'react';

import { cn } from '@/lib/utils';

import type { HeaderSection as HeaderSectionT } from '../types';
import { FieldControl } from './FieldControl';

interface Props {
    section: HeaderSectionT;
    /** Render in read-only mode (mode=view). */
    forceReadonly?: boolean;
    /** Override the RHF path root. Defaults to "responses". Used by zone-wise
     *  reports so this section reads/writes `zones.<i>.responses.<id>.<field>`. */
    pathRoot?: string;
}

export const HeaderSection: React.FC<Props> = ({ section, forceReadonly, pathRoot }) => {
    const root = pathRoot || 'responses';
    return (
        <section className="space-y-3">
            {section.title && (
                <h3 className="text-base font-semibold text-foreground">{section.title}</h3>
            )}
            <div className={cn('grid gap-x-4 gap-y-3', 'sm:grid-cols-2')}>
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
