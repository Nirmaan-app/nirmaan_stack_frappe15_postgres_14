// Blank signature/stamp placeholders. v1: no input control.
// Renders as labelled boxes — meant to be hand-signed on the printed PDF.

import React from 'react';

import { cn } from '@/lib/utils';

import type { SignaturesSection as SignaturesSectionT } from '../types';

interface Props {
    section: SignaturesSectionT;
}

export const SignaturesSection: React.FC<Props> = ({ section }) => {
    return (
        <section className="space-y-3">
            {section.title && (
                <h3 className="text-base font-semibold text-foreground">{section.title}</h3>
            )}
            <div
                className={cn(
                    'grid gap-3',
                    section.blocks.length === 1 && 'grid-cols-1',
                    section.blocks.length === 2 && 'sm:grid-cols-2',
                    section.blocks.length >= 3 && 'sm:grid-cols-3',
                )}
            >
                {section.blocks.map((block) => (
                    <div
                        key={block.key}
                        className="flex h-24 flex-col items-center justify-end rounded-md border border-dashed bg-muted/20 p-3"
                    >
                        <div className="mb-1 w-full border-t border-foreground/30" />
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {block.label}
                        </span>
                        <span className="text-[10px] text-muted-foreground/70">
                            (Signature &amp; Stamp)
                        </span>
                    </div>
                ))}
            </div>
        </section>
    );
};
