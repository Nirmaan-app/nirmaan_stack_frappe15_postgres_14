import { Building2, MapPin, Calendar, Users, Package, ListChecks } from "lucide-react";
import { WizardStep } from "@/components/ui/wizard-steps";

/**
 * Wizard Steps Configuration
 *
 * Defines the steps for the project creation wizard with icons and titles.
 */
export const wizardStepsConfig: WizardStep[] = [
    { key: "projectDetails", title: "Project Details", shortTitle: "Details", icon: Building2 },
    { key: "projectAddressDetails", title: "Project Address", shortTitle: "Address", icon: MapPin },
    { key: "projectTimeline", title: "Project Timeline", shortTitle: "Timeline", icon: Calendar },
    { key: "projectAssignees", title: "Project Assignees", shortTitle: "Team", icon: Users },
    { key: "packageSelection", title: "Package Selection", shortTitle: "Packages", icon: Package },
    { key: "reviewDetails", title: "Review Details", shortTitle: "Review", icon: ListChecks },
];

/**
 * Section keys in order
 */
export const sections = [
    "projectDetails",
    "projectAddressDetails",
    "projectTimeline",
    "projectAssignees",
    "packageSelection",
    "reviewDetails"
] as const;

export type SectionKey = typeof sections[number];

/**
 * Section titles for display
 */
export const sectionTitles: Record<SectionKey, string> = {
    projectDetails: "Project Details",
    projectAddressDetails: "Project Address Details",
    projectTimeline: "Project Timeline",
    projectAssignees: "Project Assignees",
    packageSelection: "Package Selection",
    reviewDetails: "Review Details"
};

/**
 * GST Options for project locations
 */
export const gstOptions = [
    { location: "Bengaluru", gst: "29ABFCS9095N1Z9" },
    { location: "Gurugram", gst: "06ABFCS9095N1ZH" },
    { location: "Noida", gst: "09ABFCS9095N1ZB" },
] as const;

/**
 * Get next section in the wizard
 */
export const getNextSection = (currentSection: SectionKey): SectionKey => {
    const currentIndex = sections.indexOf(currentSection);
    if (currentIndex < sections.length - 1) {
        return sections[currentIndex + 1];
    }
    return currentSection;
};

/**
 * Get previous section in the wizard
 */
export const getPreviousSection = (currentSection: SectionKey): SectionKey => {
    const currentIndex = sections.indexOf(currentSection);
    if (currentIndex > 0) {
        return sections[currentIndex - 1];
    }
    return currentSection;
};
