import { Building2, MapPin, Calendar, Users, FileSpreadsheet, Package, ListChecks } from "lucide-react";
import { WizardStep } from "@/components/ui/wizard-steps";

/**
 * Wizard Steps Configuration
 *
 * Defines the steps for the project creation wizard with icons and titles. Both modes show
 * every step (ADR-0038): converting a Tendering stub ticks its own BoQs on `boqSelection`, and
 * both convert and create can add BoQs from other Tendering projects there.
 */
export const wizardStepsConfig: WizardStep[] = [
    { key: "projectDetails", title: "Project Details", shortTitle: "Details", icon: Building2 },
    { key: "projectAddressDetails", title: "Project Address", shortTitle: "Address", icon: MapPin },
    { key: "projectTimeline", title: "Project Timeline", shortTitle: "Timeline", icon: Calendar },
    { key: "projectAssignees", title: "Project Assignees", shortTitle: "Team", icon: Users },
    { key: "boqSelection", title: "BOQ Selection", shortTitle: "BOQ", icon: FileSpreadsheet },
    { key: "packageSelection", title: "Package Selection", shortTitle: "Packages", icon: Package },
    { key: "reviewDetails", title: "Review Details", shortTitle: "Review", icon: ListChecks },
];

/**
 * Every section key, in order. Use `getSections` for the list a given mode actually shows.
 */
export const allSections = [
    "projectDetails",
    "projectAddressDetails",
    "projectTimeline",
    "projectAssignees",
    "boqSelection",
    "packageSelection",
    "reviewDetails"
] as const;

export type SectionKey = typeof allSections[number];

/**
 * The sections a wizard run shows: all seven, in both modes. Creating a project used to skip
 * `boqSelection`; drafts saved then hold a step NUMBER from the six-step list, which is why a
 * draft resumes by its section name (`resumeStepIndex`).
 */
export const getSections = (): SectionKey[] => [...allSections];

/** The step-indicator config matching `getSections`. */
export const getWizardStepsConfig = (): WizardStep[] => wizardStepsConfig;

/**
 * The step to resume a saved draft on: the index of its saved SECTION NAME in today's list,
 * falling back to the saved number only when the name is unknown. A draft saved by the old
 * six-step Create wizard ("packageSelection" at step 4) must not land on today's step 4 (BOQ).
 */
export const resumeStepIndex = (
    sections: readonly string[],
    section: string | undefined,
    savedStep: number | undefined
): number => {
    const index = section ? sections.indexOf(section) : -1;
    if (index >= 0) return index;
    return Math.min(Math.max(savedStep ?? 0, 0), Math.max(sections.length - 1, 0));
};

/**
 * Section titles for display
 */
export const sectionTitles: Record<SectionKey, string> = {
    projectDetails: "Project Details",
    projectAddressDetails: "Project Address Details",
    projectTimeline: "Project Timeline",
    projectAssignees: "Project Assignees",
    boqSelection: "BOQ Selection",
    packageSelection: "Package Selection",
    reviewDetails: "Review Details"
};

/**
 * Get next section in the wizard
 */
export const getNextSection = (currentSection: SectionKey, sections: readonly SectionKey[]): SectionKey => {
    const currentIndex = sections.indexOf(currentSection);
    if (currentIndex < sections.length - 1) {
        return sections[currentIndex + 1];
    }
    return currentSection;
};

/**
 * Get previous section in the wizard
 */
export const getPreviousSection = (currentSection: SectionKey, sections: readonly SectionKey[]): SectionKey => {
    const currentIndex = sections.indexOf(currentSection);
    if (currentIndex > 0) {
        return sections[currentIndex - 1];
    }
    return currentSection;
};
