
import React, { useMemo, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { LinkIcon, CirclePlus, Trash2, Loader2, ExternalLink, FilePenLine } from "lucide-react";
import { TailSpin } from "react-loader-spinner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { DataTable, SearchFieldOption } from "@/components/data-table/new-data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter,
    DialogDescription
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import { useFrappeGetDoc, useFrappeUpdateDoc } from "frappe-react-sdk";

// --- CONSTANTS ---
const CHILD_TABLE_FIELD = 'drive_links';

export interface ProjectDriveLinkDetail {
    name: string;
    idx?: number;
    drive_name: string;
    drive_link: string;
}

interface ProjectDriveLinkTableRow extends ProjectDriveLinkDetail {
    project_name: string;
}

interface ProjectDriveLinkProps {
    projectId?: string;
    projectName?: string;
}

// --- Add Drive Link Dialog ---

interface AddProjectDriveLinkDialogProps {
    projectName: string; 
    currentLinks: ProjectDriveLinkDetail[];
    onSuccess: () => void;
}

export const AddProjectDriveLinkDialog: React.FC<AddProjectDriveLinkDialogProps> = ({ projectName, currentLinks, onSuccess }) => {
    const [open, setOpen] = useState(false);
    const [formData, setFormData] = useState({
        drive_name: '',
        drive_link: ''
    });

    const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc();

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { id, value } = e.target;
        setFormData(prev => ({ ...prev, [id]: value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        if (!formData.drive_name || !formData.drive_link) {
            toast({ title: "Validation Error", description: "Please fill all fields.", variant: "destructive" });
            return;
        }

        // Uniqueness Validation
        const isDuplicate = currentLinks.some(link => link.drive_name.trim().toLowerCase() === formData.drive_name.trim().toLowerCase());
        if (isDuplicate) {
             toast({ title: "Validation Error", description: "Drive Name must be unique within this project.", variant: "destructive" });
             return;
        }

        try {
            const newLink = {
                drive_name: formData.drive_name,
                drive_link: formData.drive_link
            };
            
            const updatedLinks = [...currentLinks, newLink];

            await updateDoc('Projects', projectName, {
                [CHILD_TABLE_FIELD]: updatedLinks
            });

            toast({ title: "Success", description: "Drive File added successfully.", variant: "success" });
            setOpen(false);
            setFormData({ drive_name: '', drive_link: '' });
            onSuccess();

        } catch (error: any) {
            console.error("Failed to add drive File:", error);
             const errorMessage = error?.messages?.[0]?.message || error?.message || "An unknown error occurred.";
            toast({ title: "Error", description: `Failed to add drive File: ${errorMessage}`, variant: "destructive" });
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="default" className="ml-4">
                    <CirclePlus className="h-4 w-4 mr-2" /> Add File
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Add Project Drive File</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="drive_name">File Name</Label>
                        <Input
                            id="drive_name"
                            value={formData.drive_name}
                            onChange={handleInputChange}
                            placeholder="e.g. Design Files"
                            required
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="drive_link">File Link</Label>
                        <Input
                            id="drive_link"
                            value={formData.drive_link}
                            onChange={handleInputChange}
                            placeholder="https://..."
                            type="url"
                            required
                        />
                    </div>
                    <Button type="submit" disabled={updateLoading}>
                        {updateLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CirclePlus className="mr-2 h-4 w-4" />}
                        {updateLoading ? "Adding..." : "Add Link"}
                    </Button>
                </form>
            </DialogContent>
        </Dialog>
    );
};

// --- Edit Drive Link Dialog ---

interface EditProjectDriveLinkDialogProps {
    open: boolean;
    onClose: () => void;
    linkDetail: ProjectDriveLinkDetail;
    projectName: string;
    currentLinks: ProjectDriveLinkDetail[];
    onSuccess: () => void;
}

export const EditProjectDriveLinkDialog: React.FC<EditProjectDriveLinkDialogProps> = ({ 
    open, onClose, linkDetail, projectName, currentLinks, onSuccess 
}) => {
    const [formData, setFormData] = useState({
        drive_name: linkDetail.drive_name,
        drive_link: linkDetail.drive_link
    });

    const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc();

    // Reset form when linkDetail changes only if it's different
    React.useEffect(() => {
        setFormData({
            drive_name: linkDetail.drive_name,
            drive_link: linkDetail.drive_link
        });
    }, [linkDetail]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { id, value } = e.target;
        setFormData(prev => ({ ...prev, [id]: value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        if (!formData.drive_name || !formData.drive_link) {
            toast({ title: "Validation Error", description: "Please fill all fields.", variant: "destructive" });
            return;
        }

        // Uniqueness Validation (exclude current item)
        const isDuplicate = currentLinks.some(link => 
            link.name !== linkDetail.name && // Check by DocName to exclude self
            link.drive_name.trim().toLowerCase() === formData.drive_name.trim().toLowerCase()
        );
        
        if (isDuplicate) {
             toast({ title: "Validation Error", description: "Drive Name must be unique within this project.", variant: "destructive" });
             return;
        }

        try {
            // Update the specific row
            // We map through the current links and replace the modified one
            const updatedLinks = currentLinks.map(link => 
                link.name === linkDetail.name 
                ? { ...link, drive_name: formData.drive_name, drive_link: formData.drive_link }
                : link
            );

            await updateDoc('Projects', projectName, {
                [CHILD_TABLE_FIELD]: updatedLinks
            });

            toast({ title: "Success", description: "Drive link updated successfully.", variant: "success" });
            onClose();
            onSuccess();

        } catch (error: any) {
            console.error("Failed to update drive link:", error);
             const errorMessage = error?.messages?.[0]?.message || error?.message || "An unknown error occurred.";
            toast({ title: "Error", description: `Failed to update: ${errorMessage}`, variant: "destructive" });
        }
    };

    return (
         <Dialog open={open} onOpenChange={(val) => !val && onClose()}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Edit Project File </DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="drive_name">File Name</Label>
                        <Input
                            id="drive_name"
                            value={formData.drive_name}
                            onChange={handleInputChange}
                            placeholder="e.g. Design Files"
                            required
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="drive_link">File Link</Label>
                        <Input
                            id="drive_link"
                            value={formData.drive_link}
                            onChange={handleInputChange}
                            placeholder="https://..."
                            type="url"
                            required
                        />
                    </div>
                    <Button type="submit" disabled={updateLoading}>
                        {updateLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FilePenLine className="mr-2 h-4 w-4" />}
                        {updateLoading ? "Updating..." : "Update Link"}
                    </Button>
                </form>
            </DialogContent>
        </Dialog>
    );
};


// --- Delete Dialog ---

interface DeleteDriveLinkDialogProps {
    open: boolean;
    onClose: () => void;
    linkDetail: ProjectDriveLinkDetail;
    projectName: string;
    currentLinks: ProjectDriveLinkDetail[];
    onSuccess: () => void;
}

export const DeleteDriveLinkDialog: React.FC<DeleteDriveLinkDialogProps> = ({ 
    open, onClose, linkDetail, projectName, currentLinks, onSuccess 
}) => {
    const { updateDoc, loading: deleteLoading } = useFrappeUpdateDoc();

    const handleDelete = async () => {
        try {
            const updatedLinks = currentLinks.filter(l => l.name !== linkDetail.name);
            
            await updateDoc('Projects', projectName, {
                [CHILD_TABLE_FIELD]: updatedLinks
            });

            toast({ title: "Success", description: "Drive File deleted successfully.", variant: "success" });
            onClose();
            onSuccess();
        } catch (error: any) {
             const errorMessage = error?.messages?.[0]?.message || error?.message || "An unknown error occurred.";
            toast({ title: "Error", description: `Failed to delete: ${errorMessage}`, variant: "destructive" });
        }
    };

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center text-red-600">
                        <Trash2 className="w-6 h-6 mr-2" /> Confirm Deletion
                    </DialogTitle>
                    <DialogDescription className="pt-2">
                        Are you sure you want to delete the File: <strong>{linkDetail.drive_name}</strong>?
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter className="pt-4">
                    <Button variant="outline" onClick={onClose} disabled={deleteLoading}>Cancel</Button>
                    <Button variant="destructive" onClick={handleDelete} disabled={deleteLoading}>
                        {deleteLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                        {deleteLoading ? "Deleting..." : "Delete"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};


// --- Column Definition ---

const getColumns = (
    handleEditClick: (row: ProjectDriveLinkTableRow) => void,
    handleDeleteClick: (row: ProjectDriveLinkTableRow) => void
): ColumnDef<ProjectDriveLinkTableRow>[] => {
    return [
        {
            accessorKey: "drive_name",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title="File Name" />
            ),
            cell: ({ row }) => (
                <div className="font-medium">{row.original.drive_name}</div>
            ),
            enableSorting: true,
            enableColumnFilter: true,
        },
        {
            accessorKey: "drive_link",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title="File Link" />
            ),
            cell: ({ row }) => (
                <div className="flex items-center gap-2">
                    <a 
                        href={row.original.drive_link} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="text-blue-600 hover:underline flex items-center gap-1 truncate max-w-[300px]"
                    >
                         {row.original.drive_link}
                         <ExternalLink className="w-3 h-3" />
                    </a>
                </div>
            ),
            enableSorting: false,
            enableColumnFilter: false,
        },
        {
            id: "actions",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title="Actions" />
            ),
            cell: ({ row }) => (
                <div className="flex justify-start gap-2">
                    <Button
                        onClick={() => handleEditClick(row.original)}
                        variant="ghost"
                        className="h-8 w-8 p-0 text-blue-600 hover:text-blue-800 transition"
                        title="Edit Link"
                    >
                        <FilePenLine className="w-4 h-4" />
                    </Button>
                    <Button
                        onClick={() => handleDeleteClick(row.original)}
                        variant="ghost"
                        className="h-8 w-8 p-0 text-red-600 hover:text-red-800 transition"
                        title="Delete Link"
                    >
                        <Trash2 className="w-4 h-4" />
                    </Button>
                </div>
            ),
            size: 100,
            enableSorting: false,
            enableColumnFilter: false,
        }
    ];
};

export const ProjectDriveLink: React.FC<ProjectDriveLinkProps> = ({ projectId }) => {
    
    // --- State ---
    const [deletingLink, setDeletingLink] = useState<ProjectDriveLinkDetail | null>(null);
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

    const [editingLink, setEditingLink] = useState<ProjectDriveLinkDetail | null>(null);
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

    // --- Fetch Data ---
    const { 
        data: projectData, 
        isLoading: projectLoading,
        mutate: refetchProject
    } = useFrappeGetDoc<any>("Projects", projectId, { enabled: !!projectId });

    const driveLinks = useMemo(() => {
        return (projectData?.[CHILD_TABLE_FIELD] || []) as ProjectDriveLinkDetail[];
    }, [projectData]);

    const clientData: ProjectDriveLinkTableRow[] = useMemo(() => {
        return driveLinks.map(link => ({
            ...link,
            project_name: projectData?.project_name || ''
        }));
    }, [driveLinks, projectData]);


    // --- Handlers ---
    const handleDeleteClick = useCallback((link: ProjectDriveLinkTableRow) => {
        setDeletingLink(link);
        setIsDeleteDialogOpen(true);
    }, []);

    const handleEditClick = useCallback((link: ProjectDriveLinkTableRow) => {
        setEditingLink(link);
        setIsEditDialogOpen(true);
    }, []);

    const handleSuccess = async () => {
        await refetchProject();
        setDeletingLink(null);
        setEditingLink(null);
    };

    // --- Table Hook ---
    const {
        table,
        data: tableData,
        totalCount,
        isLoading: tableLoading,
        error: tableError,
        searchTerm,
        setSearchTerm,
        selectedSearchField,
        setSelectedSearchField
    } = useServerDataTable<ProjectDriveLinkTableRow>({
        doctype: 'Projects', 
        columns: useMemo(() => getColumns(handleEditClick, handleDeleteClick), []), // Handlers are memoized or stable enough
        searchableFields: [{ value: 'drive_name', label: 'Drive Name', default: true }],
        defaultSort: 'drive_name asc',
        urlSyncKey: `drive_links_${projectId}`,
        clientData: clientData,
        clientTotalCount: clientData.length,
        shouldCache: false
    });

    const isLoading = projectLoading || tableLoading;

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex justify-between items-center">
                    <div className="text-2xl">Project Drive Links</div>
                    {projectId && (
                        <AddProjectDriveLinkDialog 
                            projectName={projectId}
                            currentLinks={driveLinks}
                            onSuccess={handleSuccess}
                        />
                    )}
                </CardTitle>
                <CardDescription>
                    Manage drive links for this project.
                </CardDescription>
            </CardHeader>
            <CardContent>
                 {isLoading && !tableData?.length ? (
                    <div className="flex items-center justify-center p-8"><TailSpin color="#ef4444" height={20} width={20} /></div>
                ) : (
                    <DataTable<ProjectDriveLinkTableRow>
                        table={table}
                        columns={table.options.columns}
                        isLoading={isLoading}
                        error={tableError}
                        totalCount={totalCount}
                        searchFieldOptions={[{ value: 'drive_name', label: 'File Name', default: true }]}
                        selectedSearchField={selectedSearchField}
                        onSelectedSearchFieldChange={setSelectedSearchField}
                        searchTerm={searchTerm}
                        onSearchTermChange={setSearchTerm}
                        showRowSelection={false}
                        showExportButton={false} 
                    />
                )}
            </CardContent>

             {deletingLink && projectId && (
                <DeleteDriveLinkDialog 
                    open={isDeleteDialogOpen}
                    onClose={() => setIsDeleteDialogOpen(false)}
                    linkDetail={deletingLink}
                    projectName={projectId}
                    currentLinks={driveLinks}
                    onSuccess={handleSuccess}
                />
            )}

            {editingLink && projectId && (
                <EditProjectDriveLinkDialog 
                    open={isEditDialogOpen}
                    onClose={() => setIsEditDialogOpen(false)}
                    linkDetail={editingLink}
                    projectName={projectId}
                    currentLinks={driveLinks}
                    onSuccess={handleSuccess}
                />
            )}

        </Card>
    );
};
