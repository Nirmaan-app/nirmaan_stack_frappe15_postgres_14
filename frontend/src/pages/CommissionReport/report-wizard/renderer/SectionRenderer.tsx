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
import { RepeatingGroupsSection } from './RepeatingGroupsSection';
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
    /** When set, repeating_groups renders only this group index. Used when
     *  the wizard expands a repeating-groups step into N synthetic steps. */
    groupIndexFilter?: number;
    /** RHF path root for the input-bearing sections. Defaults to "responses"
     *  (unchanged for non-zone reports). Zone-wise reports pass
     *  `zones.<i>.responses` so each zone's data is isolated. */
    responsesRoot?: string;
    /** Root of the attachments map. Defaults to "attachments" (top-level).
     *  Zone-wise reports pass `zones.<i>.attachments` so each zone's images
     *  (incl. per-equipment photos in a repeating_groups section) are stored
     *  in that zone's own attachments map. */
    attachmentsRoot?: string;
}

export const SectionRenderer: React.FC<SectionRendererProps> = ({
    section,
    parentName,
    childRowName,
    projectId,
    templateId,
    forceReadonly,
    onAttachmentCreated,
    groupIndexFilter,
    responsesRoot,
    attachmentsRoot,
}) => {
    switch (section.type) {
        case 'process':
            return <ProcessSection section={section} />;
        case 'header':
            return <HeaderSection section={section} forceReadonly={forceReadonly} pathRoot={responsesRoot} />;
        case 'fields':
            return <FieldsSection section={section} forceReadonly={forceReadonly} pathRoot={responsesRoot} />;
        case 'checklist':
            return <ChecklistSection section={section} forceReadonly={forceReadonly} pathRoot={responsesRoot} />;
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
                    attachmentsRoot={attachmentsRoot}
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
                    pathRoot={responsesRoot}
                />
            );
        case 'trainees_data_table':
            return (
                <TraineesDataTableSection
                    section={section}
                    parentName={parentName}
                    childRowName={childRowName}
                    projectId={projectId}
                    templateId={templateId}
                    forceReadonly={forceReadonly}
                    onAttachmentCreated={onAttachmentCreated}
                />
            );
        case 'measurement_matrix':
            return <MeasurementMatrixSection section={section} forceReadonly={forceReadonly} />;
        case 'repeating_groups':
            return (
                <RepeatingGroupsSection
                    section={section}
                    forceReadonly={forceReadonly}
                    groupIndexFilter={groupIndexFilter}
                    pathRoot={responsesRoot}
                    attachmentsRoot={attachmentsRoot}
                    parentName={parentName}
                    childRowName={childRowName}
                    projectId={projectId}
                    onAttachmentCreated={onAttachmentCreated}
                />
            );
        default: {
            const _exhaustive: never = section;
            void _exhaustive;
            return null;
        }
    }
};
