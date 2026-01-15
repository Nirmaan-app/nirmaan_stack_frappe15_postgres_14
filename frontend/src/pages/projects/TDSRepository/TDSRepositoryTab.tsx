import React, { useState } from 'react';
import { NoTDSRepositoryView } from './NoTDSRepositoryView';
import { TDSRepositoryView } from './TDSRepositoryView';
import { TDSRepositoryData } from './components';
import { useFrappeGetDocList, useFrappeCreateDoc, useFrappeUpdateDoc, useFrappeFileUpload } from "frappe-react-sdk";
import { ProjectTDSSetting } from "@/types/NirmaanStack/ProjectTDSSetting";
import { toast } from "@/components/ui/use-toast";
import { TailSpin } from "react-loader-spinner";

interface TDSRepositoryTabProps {
    projectId?: string;
}

export const TDSRepositoryTab: React.FC<TDSRepositoryTabProps> = ({ projectId }) => {
    const { data: tdsSettings, isLoading, mutate } = useFrappeGetDocList<ProjectTDSSetting>("Project TDS Setting", {
        fields: ["*"],
        filters: [["tds_project_id", "=", projectId || ""]],
        limit: 1
    }, projectId ? `Project TDS Setting ${projectId}` : null);

    const { createDoc } = useFrappeCreateDoc();
    const { updateDoc } = useFrappeUpdateDoc();
    const { upload } = useFrappeFileUpload();

    const [isSubmitting, setIsSubmitting] = useState(false);

    const activeSetting = tdsSettings?.[0];

    const handleConfirmSetup = async (rawData: TDSRepositoryData) => {
        if (!projectId) return;
        setIsSubmitting(true);

        try {
            // Helper to upload if file is new
            const uploadLogo = async (file: File | null) => {
                if (!file) return null;
                // If it's already a string (url), return it
                if (typeof file === 'string') return file;

                try {
                    // Upload file - linking to doc will happen when we save the doc if we use fetch_from or just storing URL
                    const uploadResult = await upload(file, null, "Project TDS Setting");
                     return uploadResult.file_url;
                } catch (e) {
                    console.error("Upload failed", e);
                    return null;
                }
            };

            // Upload all logos in parallel
            const [
                clientLogoUrl,
                pmLogoUrl,
                archLogoUrl,
                consultantLogoUrl,
                gcLogoUrl,
                mepLogoUrl
            ] = await Promise.all([
                uploadLogo(rawData.client.logo),
                uploadLogo(rawData.projectManager.logo),
                uploadLogo(rawData.architect.logo),
                uploadLogo(rawData.consultant.logo),
                uploadLogo(rawData.gcContractor.logo),
                uploadLogo(rawData.mepContractor.logo)
            ]);

            const docData = {
                tds_project_id: projectId,
                client_name: rawData.client.name,
                client_logo: clientLogoUrl,
                manager_name: rawData.projectManager.name,
                mananger_logo: pmLogoUrl, // Note backend typo
                architect_name: rawData.architect.name,
                architect_logo: archLogoUrl,
                data_tjxu: rawData.consultant.name, // Consultant Name field
                consultant_logo: consultantLogoUrl,
                gc_contractor_name: rawData.gcContractor.name,
                gc_contractor_logo: gcLogoUrl,
                mep_contractor_name: rawData.mepContractor.name,
                mep_contractorlogo: mepLogoUrl // Note backend typo
            };

            if (activeSetting) {
                await updateDoc("Project TDS Setting", activeSetting.name, docData);
                toast({ title: "Success", description: "Repository updated successfully", variant: "success" });
            } else {
                await createDoc("Project TDS Setting", docData);
                toast({ title: "Success", description: "Repository created successfully", variant: "success" });
            }
            
            mutate(); // Refresh data

        } catch (error: any) {
            console.error("Error saving TDS Setting:", error);
            toast({ 
                title: "Error", 
                description: error.message || "Failed to save repository settings", 
                variant: "destructive" 
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isLoading) {
         return <div className="h-64 flex items-center justify-center"><TailSpin color="red" width={50} height={50} /></div>;
    }

    if (!activeSetting) {
        return <NoTDSRepositoryView onConfirm={handleConfirmSetup} />;
    }

    // Convert backend data to frontend format for the View/Edit
    const repositoryData: TDSRepositoryData = {
        client: { name: activeSetting.client_name, logo: activeSetting.client_logo as any },
        projectManager: { name: activeSetting.manager_name, logo: activeSetting.mananger_logo as any },
        architect: { name: activeSetting.architect_name, logo: activeSetting.architect_logo as any },
        consultant: { name: activeSetting.data_tjxu, logo: activeSetting.consultant_logo as any },
        gcContractor: { name: activeSetting.gc_contractor_name, logo: activeSetting.gc_contractor_logo as any },
        mepContractor: { name: activeSetting.mep_contractor_name, logo: activeSetting.mep_contractorlogo as any }
    };

    return (
        <TDSRepositoryView 
            data={repositoryData} 
            projectId={projectId || ''} 
            onUpdate={() => {/* Re-open dialog if needed, logic handled inside View */}} 
        />
    );
};
