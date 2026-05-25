// Dispatches by section.type to the right renderer. Used by the wizard step
// view AND by the read-only mode=view shell.

import React from 'react';

import type { Section } from '../types';
import { ChecklistSection } from './ChecklistSection';
import { FieldsSection } from './FieldsSection';
import { HeaderSection } from './HeaderSection';
import { ImageAttachmentSection } from './ImageAttachmentSection';
import { MeasurementMatrixSection } from './MeasurementMatrixSection';
import { ProcessSection } from './ProcessSection';
import { SignaturesSection } from './SignaturesSection';
import { TraineesDataTableSection } from './TraineesDataTableSection';

export interface SectionRendererProps {
    section: Section;
    /** Required for image_attachments. Other sections ignore. */
    parentName?: string;
    childRowName?: string;
    projectId?: string;
    /** Drives signatures preview — see SignaturesSection. */
    templateId?: string;
    forceReadonly?: boolean;
    onAttachmentCreated?: (attachmentName: string) => void;
}

export const SectionRenderer: React.FC<SectionRendererProps> = ({
    section,
    parentName,
    childRowName,
    projectId,
    templateId,
    forceReadonly,
    onAttachmentCreated,
}) => {
    switch (section.type) {
        case 'process':
            return <ProcessSection section={section} />;
        case 'header':
            return <HeaderSection section={section} forceReadonly={forceReadonly} />;
        case 'fields':
            return <FieldsSection section={section} forceReadonly={forceReadonly} />;
        case 'checklist':
            return <ChecklistSection section={section} forceReadonly={forceReadonly} />;
        case 'image_attachments': {
            if (!parentName || !childRowName || !projectId) {
                return (
                    <p className="text-xs text-destructive">
                        Image section misconfigured: parent/child/project context missing.
                    </p>
                );
            }
            return (
                <ImageAttachmentSection
                    section={section}
                    parentName={parentName}
                    childRowName={childRowName}
                    projectId={projectId}
                    forceReadonly={forceReadonly}
                    onAttachmentCreated={onAttachmentCreated}
                />
            );
        }
        case 'signatures':
            return (
                <SignaturesSection
                    section={section}
                    projectId={projectId}
                    templateId={templateId}
                    forceReadonly={forceReadonly}
                />
            );
        case 'trainees_data_table':
            return <TraineesDataTableSection section={section} forceReadonly={forceReadonly} />;
        case 'measurement_matrix':
            return <MeasurementMatrixSection section={section} forceReadonly={forceReadonly} />;
        default: {
            const _exhaustive: never = section;
            void _exhaustive;
            return null;
        }
    }
};
