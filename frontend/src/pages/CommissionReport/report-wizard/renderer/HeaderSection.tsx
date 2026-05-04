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
}

export const HeaderSection: React.FC<Props> = ({ section, forceReadonly }) => {
    return (
        <section className="space-y-3">
            {section.title && (
                <h3 className="text-base font-semibold text-foreground">{section.title}</h3>
            )}
            <div className={cn('grid gap-x-4 gap-y-3', 'sm:grid-cols-2')}>
                {section.fields.map((f) => (
                    <FieldControl
                        key={f.key}
                        name={`responses.${section.id}.${f.key}`}
                        field={f}
                        forceReadonly={forceReadonly}
                    />
                ))}
            </div>
        </section>
    );
};
