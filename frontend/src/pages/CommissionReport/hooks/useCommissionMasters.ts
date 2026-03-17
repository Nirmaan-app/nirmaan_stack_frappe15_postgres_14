// frontend/src/pages/CommissionReport/hooks/useCommissionMasters.ts

import { useMemo } from "react";
import { User, Project } from "../types";
import { useCommissionMasterData } from "../data/useCommissionQueries";

export const TASK_STATUS_OPTIONS = [
    { label: "Not Applicable", value: "Not Applicable" },
    { label: "Pending", value: "Pending" },
    { label: "In Progress", value: "In Progress" },
    { label: "Completed", value: "Completed" },
];

export const useCommissionMasters = () => {

    // --- Single API Call to Fetch All Master Data ---
    const { data: response,
        isLoading: masterLoading,
        error: masterError,
        mutate: mutateMasters } = useCommissionMasterData();


    const masterData = response?.message;

    const projects: Project[] = masterData?.projects || [];
    const projectOptions = useMemo(() =>
        projects.map(p => ({ label: p.project_name, value: p.name }))
        , [projects]);

    const usersList: User[] = masterData?.users || [];

    const FacetProjectsOptions: any[] = masterData?.facetProjects?.map((projectArray: any) => {
        const [id, name] = projectArray;
        return {
            value: id,
            label: name
        };
    }) || [];

    const rawCategories = masterData?.categories || [];

    const categoryData = useMemo(() => {
        return rawCategories.map((cat: any) => ({
            category_name: cat.category_name,
            work_package: cat.work_package,
            tasks: cat.tasks.map((t: any) => ({
                task_name: t.task_name,
                deadline_offset: t.deadline_offset
            }))
        }));
    }, [rawCategories]);


    const isLoading = masterLoading;
    const error = masterError;

    return {
        projectOptions,
        projects,
        usersList,
        isLoading,
        error,
        categories: rawCategories.map((c: any) => c.category_name),
        categoryData: categoryData,
        statusOptions: TASK_STATUS_OPTIONS,
        FacetProjectsOptions: FacetProjectsOptions,
        mutateMasters
    };
};
