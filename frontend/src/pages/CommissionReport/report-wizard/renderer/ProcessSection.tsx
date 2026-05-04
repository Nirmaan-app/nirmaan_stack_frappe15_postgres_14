// Read-only renderer for process / instructional text. No inputs.
// Same component is used in the wizard step AND (later) in the print format.

import React from 'react';

import type { ProcessSection as ProcessSectionT } from '../types';

interface Props {
    section: ProcessSectionT;
}

export const ProcessSection: React.FC<Props> = ({ section }) => {
    return (
        <section className="space-y-4">
            {section.title && (
                <h3 className="text-base font-semibold text-foreground">{section.title}</h3>
            )}
            {section.blocks.map((block, idx) => (
                <div key={idx} className="space-y-1.5">
                    <h4 className="text-sm font-semibold text-muted-foreground">{block.subtitle}</h4>
                    <ul className="space-y-1.5 pl-1">
                        {block.items.map((item, i) => (
                            <li key={i} className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                                {item}
                            </li>
                        ))}
                    </ul>
                </div>
            ))}
        </section>
    );
};
