import { Projects, ProjectWorkHeaderEntry } from "@/types/NirmaanStack/Projects";
import type { WorkHeaderDoc } from "./useProjectWorkReportTabApi";

export type { WorkHeaderDoc };

export interface LocalProjectWorkHeaderEntry {
    work_header_doc_name: string;
    work_header_display_name: string;
    work_package_link: string;
    enabled: boolean;
    name?: string;
}

export const toBoolean = (val: boolean | string | "True" | "False" | undefined | null): boolean => {
    if (typeof val === "boolean") return val;
    if (typeof val === "string") return val.toLowerCase() === "true";
    return false;
};

export const getLinkedWorkHeaderName = (entry: ProjectWorkHeaderEntry): string | null => {
    if (typeof entry.project_work_header_name === "string") {
        return entry.project_work_header_name;
    }
    if (typeof entry.project_work_header_name === "object" && (entry.project_work_header_name as any)?.name) {
        return (entry.project_work_header_name as any).name;
    }
    return null;
};

export const generateCombinedHeaders = (
    projectData: Projects,
    allWorkHeaders: WorkHeaderDoc[],
    toBooleanFn: (val: any) => boolean = toBoolean,
    getLinkedWorkHeaderNameFn: (entry: ProjectWorkHeaderEntry) => string | null = getLinkedWorkHeaderName
): LocalProjectWorkHeaderEntry[] => {
    const projectEnabledWorkHeadersMap = new Map<string, ProjectWorkHeaderEntry>();
    if (projectData.project_work_header_entries) {
        projectData.project_work_header_entries.forEach((entry) => {
            const linkedName = getLinkedWorkHeaderNameFn(entry);
            if (linkedName) {
                projectEnabledWorkHeadersMap.set(linkedName, { ...entry, enabled: toBooleanFn(entry.enabled) });
            }
        });
    }

    const combinedHeaders: LocalProjectWorkHeaderEntry[] = (allWorkHeaders || []).map((masterHeader) => {
        const masterHeaderDocName = masterHeader.name;
        const masterHeaderDisplayName = masterHeader.work_header_name;
        const masterHeaderWorkPackageLink = masterHeader.work_package_link || "General Work Package";

        const existingEntry = projectEnabledWorkHeadersMap.get(masterHeaderDocName);

        return {
            work_header_doc_name: masterHeaderDocName,
            work_header_display_name: masterHeaderDisplayName,
            work_package_link: masterHeaderWorkPackageLink,
            enabled: existingEntry ? existingEntry.enabled : false,
            name: existingEntry ? existingEntry.name : undefined,
        };
    });

    combinedHeaders.sort((a, b) =>
        a.work_package_link.localeCompare(b.work_package_link) ||
        a.work_header_display_name.localeCompare(b.work_header_display_name)
    );

    return combinedHeaders;
};
