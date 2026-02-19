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
            // 1. Prepare Text Data
            const textData: any = {
                tds_project_id: projectId,
                client_name: rawData.client.name,
                enable_client: rawData.client.enabled,
                manager_name: rawData.projectManager.name,
                enable_manager: rawData.projectManager.enabled,
                architect_name: rawData.architect.name,
                enable_architect: rawData.architect.enabled,
                data_tjxu: rawData.consultant.name,
                enable_consultant: rawData.consultant.enabled,
                gc_contractor_name: rawData.gcContractor.name,
                enable_gc_contractor: rawData.gcContractor.enabled,
                mep_contractor_name: rawData.mepContractor.name,
                enable_mep_contractor: rawData.mepContractor.enabled,
            };

            let docName = activeSetting?.name;
            const finalUpdates: any = {};

            // 2. Create Doc if needed (to get ID for uploads)
            if (!docName) {
                const newDoc = await createDoc("Project TDS Setting", textData);
                docName = newDoc.name;
                console.log("Created Doc:", docName);
                // Text data is already saved, so we only need to update files later
            } else {
                // For existing doc, we will update text data along with files in the final step
                Object.assign(finalUpdates, textData);
            }

            if (!docName) throw new Error("Failed to get Document Name");

            // 3. Upload Files (Linked to Doc) & Collect URLs
            const uploadQueue: Array<{ file: File; field: string }> = [];
            
            // Safe File check helper
            const isFile = (f: any) => f instanceof File;

            if (isFile(rawData.client.logo)) uploadQueue.push({ file: rawData.client.logo as File, field: 'client_logo' });
            if (isFile(rawData.projectManager.logo)) uploadQueue.push({ file: rawData.projectManager.logo as File, field: 'mananger_logo' });
            if (isFile(rawData.architect.logo)) uploadQueue.push({ file: rawData.architect.logo as File, field: 'architect_logo' });
            if (isFile(rawData.consultant.logo)) uploadQueue.push({ file: rawData.consultant.logo as File, field: 'consultant_logo' });
            if (isFile(rawData.gcContractor.logo)) uploadQueue.push({ file: rawData.gcContractor.logo, field: 'gc_contractor_logo' });
            if (isFile(rawData.mepContractor.logo)) uploadQueue.push({ file: rawData.mepContractor.logo, field: 'mep_contractorlogo' });

            // Execute uploads
            await Promise.all(uploadQueue.map(async ({ file, field }) => {
                 try {
                     console.log(`Uploading ${field}...`);
                     const res = await upload(file, {
                         doctype: "Project TDS Setting",
                         docname: docName,
                         fieldname: field,
                         isPrivate: true
                     });
                     
                     const fileUrl = res?.file_url;
                     if (fileUrl) {
                         finalUpdates[field] = fileUrl;
                         console.log(`Got URL for ${field}: ${fileUrl}`);
                     }
                 } catch (e) {
                     console.error(`Failed to upload ${field}`, e);
                     toast({ title: "Upload Warning", description: `Failed to upload logo for ${field}`, variant: "destructive" });
                 }
            }));

            // 4. Final Update (Text + Files for existing; Files only for new)
            if (Object.keys(finalUpdates).length > 0) {
                 console.log("Updating doc with combined data:", finalUpdates);
                 await updateDoc("Project TDS Setting", docName, finalUpdates);
            }

            toast({ title: "Success", description: "Repository configuration saved", variant: "success" });
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
        return <NoTDSRepositoryView onConfirm={handleConfirmSetup} isLoading={isSubmitting} />;
    }

    // Convert backend data to frontend format for the View/Edit
    const repositoryData: TDSRepositoryData = {
        client: { name: activeSetting.client_name, logo: activeSetting.client_logo as any, enabled: activeSetting.enable_client },
        projectManager: { name: activeSetting.manager_name, logo: activeSetting.mananger_logo as any, enabled: activeSetting.enable_manager },
        architect: { name: activeSetting.architect_name, logo: activeSetting.architect_logo as any, enabled: activeSetting.enable_architect },
        consultant: { name: activeSetting.data_tjxu, logo: activeSetting.consultant_logo as any, enabled: activeSetting.enable_consultant },
        gcContractor: { name: activeSetting.gc_contractor_name, logo: activeSetting.gc_contractor_logo as any, enabled: activeSetting.enable_gc_contractor },
        mepContractor: { name: activeSetting.mep_contractor_name, logo: activeSetting.mep_contractorlogo as any, enabled: activeSetting.enable_mep_contractor }
    };

    return (
        <TDSRepositoryView 
            data={repositoryData} 
            projectId={projectId || ''} 
            onUpdate={handleConfirmSetup} 
        />
    );
};
