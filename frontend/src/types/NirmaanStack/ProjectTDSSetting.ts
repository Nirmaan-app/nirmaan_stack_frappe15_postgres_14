
export interface ProjectTDSSetting {
    name: string;
    tds_project_id: string;
    tds_project_name: string;
    client_name: string;
    client_logo: string | null;
    manager_name: string;
    mananger_logo: string | null; // Note typo in backend
    architect_name: string;
    architect_logo: string | null;
    data_tjxu: string; // Consultant Name
    consultant_logo: string | null;
    gc_contractor_name: string;
    gc_contractor_logo: string | null;
    mep_contractor_name: string;
    mep_contractorlogo: string | null; // Note typo in backend
    enable_client: boolean;
    enable_manager: boolean;
    enable_architect: boolean;
    enable_consultant: boolean;
    enable_gc_contractor: boolean;
    enable_mep_contractor: boolean;
}
