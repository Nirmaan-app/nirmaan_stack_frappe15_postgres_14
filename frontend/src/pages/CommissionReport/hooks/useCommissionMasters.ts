// frontend/src/pages/CommissionReport/hooks/useCommissionMasters.ts

import { useFrappeGetCall } from "frappe-react-sdk";
import { useMemo } from "react";
import { User, Project, MasterDataResponse } from "../types";

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
        mutate: mutateMasters } = useFrappeGetCall<{ message: MasterDataResponse }>(
            "nirmaan_stack.api.commission_report.tracker_options.get_all_master_data",
            {},
            "nirmaan_stack.api.commission_report.tracker_options.get_all_master_data"
        );


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
