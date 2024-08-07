import { useEffect, useState, useCallback, useRef } from "react";
import Select from "react-select";
import { Button } from "../ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { ArrowLeft, Paperclip } from "lucide-react";
import { useFrappeCreateDoc, useFrappeFileUpload, useFrappeGetDocList, useFrappePostCall, useFrappeUpdateDoc } from "frappe-react-sdk";
import { useNavigate } from "react-router-dom";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../ui/accordion";
import { useToast } from "../ui/use-toast";


interface UpdatedField {
    name: string;
    status: string;
}

export default function NewMilestones() {
    const [editingMilestone, setEditingMilestone] = useState<string | null>(null);
    const [selectedProject, setSelectedProject] = useState<{ label: string; value: string } | null>(null);
    const [initialFields, setInitialFields] = useState<UpdatedField[]>([]);
    const [updatedFields, setUpdatedFields] = useState<UpdatedField[]>([]);
    const [overallStatus, setOverallStatus] = useState<string | null>(null);
    const [selectedFile, setSelectedFile] = useState<File | null>(null)
    const [uploadProgress, setUploadProgress] = useState<number | null>(null);
    const [fileName, setFileName] = useState<string | null>(null);
    const [disableSaveButton, setDisableSaveButton] = useState<boolean>(true);
    const [buttonDescription, setButtonDescription] = useState<string>('');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [areaName, setAreaName] = useState<string | null>(null)
    
    const {toast} = useToast()

    const navigate = useNavigate();

    const { data: project_work_milestones_list, isLoading: project_work_milestones_list_loading, error: project_work_milestones_list_error, mutate: project_work_milestones_list_mutate } = useFrappeGetDocList("Project Work Milestones", {
        fields: ['name', 'project', 'work_package', 'scope_of_work', 'milestone', 'start_date', 'end_date', 'status', "status_list"],
        limit: 1000,
        filters: [['project', 'like', `%${selectedProject?.value}`]]
    });

    const { data: project_list, isLoading: project_list_loading, error: project_list_error, mutate: project_list_mutate } = useFrappeGetDocList("Projects", {
        fields: ['name', 'project_name', "project_start_date", "project_end_date"],
    });

    const {data:milestone_attachments} = useFrappeGetDocList("Milestone Attachments", {
        fields: ["milestone", "project", "area_name", "image"],
        limit: 1000
    })

    const { createDoc, loading: createLoading } = useFrappeCreateDoc();
    const { updateDoc, loading:updateLoading, error: updateError, isCompleted: updateCompleted } = useFrappeUpdateDoc();
    const { upload, loading: uploadLoading } = useFrappeFileUpload();
    const { call } = useFrappePostCall('frappe.client.set_value');

    // Handle project selection
    const projectOptions = project_list?.map(project => ({
        label: project.project_name,
        value: project.name
    }));

    useEffect(() => {
        if (editingMilestone) {
            const milestone = project_work_milestones_list?.find((milestone) => milestone.name === editingMilestone);
            if (milestone) {
                setInitialFields(milestone.status_list.list || []);
                setUpdatedFields(milestone.status_list.list || []);
                determineOverallStatus(milestone.status_list.list || []);
            }
        }
    }, [editingMilestone, project_work_milestones_list]);

    useEffect(() => {
        if (editingMilestone) {
            determineOverallStatus(updatedFields);
        }
    }, [updatedFields]);

    useEffect(() => {
        setButtonDescription(disableSaveButton ? 'Please change the status and upload an image to enable the Save button' : '');
    }, [disableSaveButton]);

    useEffect(() => {
        validateSaveButton(updatedFields.map(field => field.status))
    }, [updatedFields, selectedFile])

    const determineOverallStatus = (fields: UpdatedField[]) => {
        const statuses = fields.map(field => field.status);
        if (statuses.includes("Pending") || statuses.includes("WIP")) {
            setOverallStatus("Pending");
        } else if (statuses.every(status => status === "Completed")) {
            setOverallStatus("Completed");
        } else if (statuses.every(status => status === "Halted")) {
            setOverallStatus("Halted");
        } else if (statuses.some(status => status === "Completed") && statuses.some(status => status === "Halted")) {
            setOverallStatus("Completed");
        }
        // validateSaveButton(statuses);
    };

    const validateSaveButton = (statuses : string[]) => {
        const initialStatuses = initialFields.map(field => field.status);
        const hasStatusChanged = !initialStatuses.every((status, index) => status === statuses[index]);
        setDisableSaveButton(!(hasStatusChanged && selectedFile));
    };

    const handleStatusChange = useCallback((name: string, status: string) => {
        setAreaName(name)
        setUpdatedFields(prev =>
            prev.map(field => 
                field.name === name ? { ...field, status } : field
            )
        );
    }, []);

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files) {
            setSelectedFile(event.target.files[0]);
            setFileName(event.target.files[0].name);
            // validateSaveButton(updatedFields.map(field => field.status));
        };
    };

    const handleFileUpload = async () => {
        if (selectedFile) {
            try {
                const doc = await createDoc("Milestone Attachments", {
                    milestone: editingMilestone,
                    project: selectedProject?.value,
                    area_name: areaName,
                    area_status: overallStatus,
                });

                const fileArgs = {
                    doctype: "Milestone Attachments",
                    docname: doc.name,
                    fieldname: "image",
                    isPrivate: true
                };

                const uploadResult = await upload(selectedFile, fileArgs);
                await call({
                    doctype: "Milestone Attachments",
                    name: doc.name,
                    fieldname: "image",
                    value: uploadResult.file_url
                });
                setUploadProgress(100);
                // alert('File uploaded successfully');
                setSelectedFile(null);
                setFileName(null);
            } catch (error) {
                console.error("Error uploading file:", error);
            }
        }
    };

    const triggerFileInput = () => {
        fileInputRef.current?.click();
    }

    // console.log("milestoneAttachments", milestone_attachments)
    // // console.log(editingMilestone)

    // console.log(milestone_attachments?.filter((item) => item.area_name === "Area 1" )[0]?.image)

    const handleCancelMilestone = () => {
        setEditingMilestone(null)
        setOverallStatus(null)
        setUpdatedFields([])
        setSelectedFile(null)
        setFileName(null)
        setUploadProgress(null)
    }

    const handleUpdateMilestone = async () => {
        if (!updatedFields.length) return; // No changes to update

        try {
            await updateDoc("Project Work Milestones", editingMilestone, {
                status_list: { list: updatedFields },
                status: overallStatus
            });

            await handleFileUpload();
            
            toast({
                description: `${editingMilestone} Milestone updated successfully!`
            })
            // alert("Milestone updated successfully");
        } catch (error) {
            console.error("Error updating milestone", error);
            toast({
                description: "Error updating milestone",
                variant: "destructive"
            })
        } finally {
            setEditingMilestone(null); // Reset editing state
            setOverallStatus(null)
            setUpdatedFields([])
            setSelectedFile(null)
            setFileName(null)
            setUploadProgress(null)
        }
    };

    return (
        <div className="w-full h-auto p-4 flex flex-col space-y-4">
            <div className="flex flex-col space-y-4 mb-6">
                <div className="flex items-center gap-2">
                   <ArrowLeft className="cursor-pointer" onClick={() => navigate("/procurement-request")} />
                   <h1 className="text-xl max-md:text-lg font-bold">Project Status Details</h1>
                </div>
                <Select
                    options={projectOptions}
                    value={selectedProject}
                    onChange={setSelectedProject}
                    placeholder="Select a project..."
                />
            </div>

            <div className="flex justify-between w-[95%] items-center border-b mx-auto pb-4">
                <p className="text-gray-500 font-semibold">Milestone</p>
                <p className="text-gray-500 font-semibold">Package</p>
                <p className="text-gray-500 font-semibold">Status</p>
            </div>

            <div className="flex flex-col gap-2 w-full">
            {project_work_milestones_list?.length ? (
            <Accordion type="multiple" defaultValue={["Pending", "Completed", "Halted"]}>
                <AccordionItem value="Pending">
                    <AccordionTrigger>
                        <Button variant="ghost" size="lg" className="mb-2 text-[#D9502C] text-base md:text-lg hover:text-[#D9502C] px-2  w-full justify-start">
                            Pending/WIP
                        </Button>
                    </AccordionTrigger>

                    <AccordionContent>
                    {project_work_milestones_list.some((milestone) => milestone.status === "Pending")
                        ? (
                      project_work_milestones_list.map((milestone) => ( 
                         milestone.status === "Pending" && ( 
                        <Card className="w-full" key={milestone.name}>
                            <CardHeader className="p-4 flex flex-col gap-2 w-full">
                                <div className="flex justify-between items-center">
                                    <CardDescription>
                                        {milestone.start_date} to {milestone.end_date}
                                    </CardDescription>
                                    {editingMilestone === milestone.name ? (
                                            <div className="flex gap-2 items-center">
                                               <button
                                               className="text-red-500 max-md:text-base text-lg underline font-semibold"
                                               onClick={handleCancelMilestone}
                                               >
                                                   Cancel
                                               </button>
                                               <span>|</span>
                                               <button
                                               className="text-blue-500 max-md:text-base text-lg underline font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                                               onClick={handleUpdateMilestone}
                                               disabled={disableSaveButton}
                                               >
                                                   {updateLoading ? "Saving...." : "Save"}
                                               </button>
                                        </div>
                                        
                                    ) : (
                                        
                                        <button
                                            className="text-blue-500 max-md:text-base text-lg underline font-semibold"
                                            onClick={() => setEditingMilestone(milestone.name)}
                                        >
                                            Update
                                        </button>
                                    )}
                                </div>

                                <div className={` ${editingMilestone === milestone.name ? "flex-col" : "flex justify-between"} w-full relative`}>
                                    <CardTitle className="text-lg max-md:text-base break-words max-w-[40%]">{milestone.milestone}</CardTitle>
                                    <CardTitle className={`transition-all max-w-[30%] duration-300 ${editingMilestone === milestone.name ? 'relative pt-[10px] max-md:text-sm text-base font-normal break-words' : 'absolute top-0 left-[45%] max-md:text-base text-lg break-words'}`}>
                                        {milestone.work_package}
                                    </CardTitle>
                                    <CardTitle className={`text-lg max-md:text-base ${editingMilestone === milestone.name ? "opacity-0" : "opacity-100"} text-[#D9502C] break-words`}>
                                        {milestone.status}
                                    </CardTitle>
                                </div>


                                {editingMilestone === milestone.name ? (
                                    <div className="flex flex-col gap-4 transition-opacity duration-500 opacity-100">
                                        {milestone.status_list.list?.map((item) => (
                                            <div key={item.name}>
                                                <CardDescription className="font-semibold text-[#1D2939]">
                                                    {item.name}
                                                </CardDescription>
                                                <div className="flex max-sm:flex-col max-sm:gap-2 justify-between mt-2 items-center">
                                                    <div className="flex gap-2 items-center flex-wrap">
                                                    <Button
                                                    size="sm"
                                                            onClick={() => handleStatusChange(item.name, "Pending")}
                                                            variant={updatedFields.some(field => field.name === item.name && field.status === "Pending") ? "default" : "outline"}
                                                        >
                                                            Pending
                                                        </Button>
                                                        <Button
                                                        size="sm"
                                                            onClick={() => handleStatusChange(item.name, "WIP")}
                                                            variant={updatedFields.some(field => field.name === item.name && field.status ==="WIP" ) ? "default" : "outline"}
                                                        >
                                                            WIP
                                                        </Button>
                                                        <Button
                                                        size="sm"
                                                            onClick={() => handleStatusChange(item.name, "Completed")}
                                                            variant={updatedFields.some(field => field.name === item.name && field.status === "Completed") ? "default" : "outline"}
                                                        >
                                                            Completed
                                                        </Button>
                                                        <Button
                                                        size="sm"
                                                            onClick={() => handleStatusChange(item.name, "Halted")}
                                                            variant={updatedFields.some(field => field.name === item.name && field.status === "Halted") ? "default" : "outline"}
                                                        >
                                                            Halted
                                                        </Button>
                                                    </div>
                                                    <div className="flex gap-2 flex-col">
                                                    <div className={`text-blue-500 cursor-pointer flex gap-2 items-center justify-center border border-blue-500 rounded-md py-1 px-2 ${selectedFile !== null && "opacity-50 cursor-not-allowed"}`}
                                                    onClick={triggerFileInput}
                                                    >
                                                        <Paperclip size="15px" />
                                                        <span>Attach</span>
                                                        <input type="file" disabled={selectedFile !== null} className="hidden" ref={fileInputRef} onChange={handleFileChange}/>
                                                    </div>
                                                    {fileName && (
                                                            <div className="flex items-center justify-between border rounded-md p-2 relative">
                                                                <span className="text-gray-800 max-w-[100px] truncate">{fileName}</span>
                                                                <button
                                                                    className="text-red-500 rounded-3xl px-1 font-semibold absolute -top-1 -right-2 bg-black "
                                                                    onClick={() => {
                                                                        setSelectedFile(null);
                                                                        setFileName(null);
                                                                        validateSaveButton(updatedFields.map(field => field.status));
                                                                    }}
                                                                >
                                                                    x
                                                                </button>
                                                            </div>
                                                            )}
                                                            {uploadProgress !== null && (
                                                                <div className="mt-2 text-gray-600">
                                                                    Upload Progress: {uploadProgress}%
                                                                </div>
                                                            )}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="flex flex-col gap-4">
                                        {milestone.status_list.list?.map((item) => (
                                            <div key={item.name} className="flex justify-between items-center">
                                                <CardDescription className="font-semibold text-md text-[#1D2939]">
                                                    {item.name}
                                                </CardDescription>
                                                <CardDescription className={`font-semibold text-md text-[#1D2939] ${(item.status === "Pending" || item.status === "WIP") ? "text-[#F29339]" : item.status === "Completed" ? "text-green-300" : "text-red-300"}`}>
                                                    {item.status}
                                                </CardDescription>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </CardHeader>
                        </Card> ) 
                    ) )) : (<div>No Pending Milestones found</div>)
                    }
                    </AccordionContent>

                </AccordionItem>


                <AccordionItem value="Completed">
                    <AccordionTrigger>
                        <Button variant="ghost" size="lg" className="mb-2 text-green-400 hover:text-green-400 px-2 text-base md:text-lg w-full justify-start">
                            Completed
                        </Button>
                    </AccordionTrigger>

                    <AccordionContent>

                    {project_work_milestones_list.some((milestone) => milestone.status === "Completed")
                        ? (
                      project_work_milestones_list.map((milestone) => ( 
                         milestone.status === "Completed" && ( 
                        <Card className="w-full" key={milestone.name}>
                            <CardHeader className="p-4 flex flex-col gap-2 w-full">
                                <div className="flex justify-between items-center">
                                    <CardDescription>
                                        {milestone.start_date} to {milestone.end_date}
                                    </CardDescription>
                                    {/* {editingMilestone === milestone.name ? (
                                        <button
                                            className="text-blue-500 text-lg underline font-semibold"
                                            onClick={handleUpdateMilestone}
                                        >
                                            Save
                                        </button>
                                    ) : (
                                        
                                        <button
                                            className="text-blue-500 text-lg underline font-semibold"
                                            onClick={() => setEditingMilestone(milestone.name)}
                                        >
                                            Update
                                        </button>
                                    )} */}
                                </div>

                                <div className={` ${editingMilestone === milestone.name ? "flex-col" : "flex justify-between"} w-full relative`}>
                                    <CardTitle className="text-lg max-md:text-base break-words max-w-[40%]">{milestone.milestone}</CardTitle>
                                    <CardTitle className={`transition-all max-w-[25%] duration-300 ${editingMilestone === milestone.name ? 'relative pt-[10px] max-md:text-sm text-base font-normal break-words' : 'absolute top-0 left-[45%] max-md:text-base text-lg break-words'}`}>
                                        {milestone.work_package}
                                    </CardTitle>
                                    <CardTitle className={`text-lg max-md:text-base ${editingMilestone === milestone.name ? "opacity-0" : "opacity-100"} break-words ${milestone.status === "Completed" && "text-green-400"}`}>
                                        {milestone.status}
                                    </CardTitle>
                                </div>


                                {editingMilestone === milestone.name ? (
                                    <div className="flex flex-col gap-4 transition-opacity duration-500 opacity-100">
                                        {milestone.status_list.list?.map((item) => (
                                            <div key={item.name}>
                                                <CardDescription className="font-semibold text-[#1D2939]">
                                                    {item.name}
                                                </CardDescription>
                                                <div className="flex justify-between mt-2 items-center">
                                                    <div className="flex gap-2 items-center flex-wrap">
                                                    <Button
                                                            onClick={() => handleStatusChange(item.name, "Pending")}
                                                            variant={updatedFields.some(field => field.name === item.name && field.status === "Pending") ? "default" : "outline"}
                                                        >
                                                            Pending
                                                        </Button>
                                                        <Button
                                                            onClick={() => handleStatusChange(item.name, "WIP")}
                                                            variant={updatedFields.some(field => field.name === item.name && field.status ==="WIP" ) ? "default" : "outline"}
                                                        >
                                                            WIP
                                                        </Button>
                                                        <Button
                                                            onClick={() => handleStatusChange(item.name, "Completed")}
                                                            variant={updatedFields.some(field => field.name === item.name && field.status === "Completed") ? "default" : "outline"}
                                                        >
                                                            Completed
                                                        </Button>
                                                        <Button
                                                            onClick={() => handleStatusChange(item.name, "Halted")}
                                                            variant={updatedFields.some(field => field.name === item.name && field.status === "Halted") ? "default" : "outline"}
                                                        >
                                                            Halted
                                                        </Button>
                                                    </div>
                                                    <div className="text-blue-500 cursor-pointer flex gap-2 items-center justify-center border border-blue-500 rounded-md py-1 px-2">
                                                        <Paperclip size="15px" />
                                                        <span>Attach</span>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="flex flex-col gap-4">
                                        {milestone.status_list.list?.map((item) => (
                                            <div key={item.name} className="flex justify-between items-center">
                                                <CardDescription className="font-semibold text-[#1D2939]">
                                                    {item.name}
                                                </CardDescription>
                                                {/* {milestone_attachments?.filter((att) => att.area_name === item.name)?.length && 
                                                <img src={milestone_attachments?.filter((att) => att.area_name === item.name)[0].image} alt="" />
                                                } */}
                                                
                                                
                                                <CardDescription className={`font-semibold text-[#1D2939] ${item.status === "Completed" && "text-green-300"}`}>
                                                    {item.status === "Pending" ? "WIP" : item.status}
                                                </CardDescription>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </CardHeader>
                        </Card> ) 
                    ) )) : (<div>No Completed Milestones found</div>)
                    }
                    </AccordionContent>
                </AccordionItem>

                <AccordionItem value="Halted">
                    <AccordionTrigger>
                        <Button variant="ghost" size="lg" className="mb-2 text-red-400 hover:text-red-400 px-2 text-base md:text-lg w-full justify-start">
                            Halted
                        </Button>
                    </AccordionTrigger>

                    <AccordionContent>

                    {project_work_milestones_list.some((milestone) => milestone.status === "Halted")
                        ? (
                      project_work_milestones_list.map((milestone) => ( 
                         milestone.status === "Halted" && ( 
                        <Card className="w-full" key={milestone.name}>
                            <CardHeader className="p-4 flex flex-col gap-2 w-full">
                                <div className="flex justify-between items-center">
                                    <CardDescription>
                                        {milestone.start_date} to {milestone.end_date}
                                    </CardDescription>
                                    {/* {editingMilestone === milestone.name ? (
                                        <button
                                            className="text-blue-500 text-lg underline font-semibold"
                                            onClick={handleUpdateMilestone}
                                        >
                                            Save
                                        </button>
                                    ) : (
                                        
                                        <button
                                            className="text-blue-500 text-lg underline font-semibold"
                                            onClick={() => setEditingMilestone(milestone.name)}
                                        >
                                            Update
                                        </button>
                                    )} */}
                                </div>

                                <div className={` ${editingMilestone === milestone.name ? "flex-col" : "flex justify-between"} w-full relative`}>
                                    <CardTitle className="text-lg max-md:text-base break-words max-w-[40%]">{milestone.milestone}</CardTitle>
                                    <CardTitle className={`transition-all max-w-[30%] duration-300 ${editingMilestone === milestone.name ? 'relative pt-[10px] max-md:text-sm text-base font-normal break-words' : 'absolute top-0 left-[45%] max-md:text-base text-lg break-words'}`}>
                                        {milestone.work_package}
                                    </CardTitle>
                                    <CardTitle className={`text-lg max-md:text-base ${editingMilestone === milestone.name ? "opacity-0" : "opacity-100"} ${milestone.status === "Halted" && "text-red-500"} break-words`}>
                                        {milestone.status}
                                    </CardTitle>
                                </div>


                                {editingMilestone === milestone.name ? (
                                    <div className="flex flex-col gap-4 transition-opacity duration-500 opacity-100">
                                        {milestone.status_list.list?.map((item) => (
                                            <div key={item.name}>
                                                <CardDescription className="font-semibold text-md text-[#1D2939]">
                                                    {item.name}
                                                </CardDescription>
                                                <div className="flex justify-between mt-2 items-center">
                                                    <div className="flex gap-2 items-center flex-wrap">
                                                    <Button
                                                            onClick={() => handleStatusChange(item.name, "Pending")}
                                                            variant={updatedFields.some(field => field.name === item.name && field.status === "Pending") ? "default" : "outline"}
                                                        >
                                                            Pending
                                                        </Button>
                                                        <Button
                                                            onClick={() => handleStatusChange(item.name, "WIP")}
                                                            variant={updatedFields.some(field => field.name === item.name && field.status ==="WIP" ) ? "default" : "outline"}
                                                        >
                                                            WIP
                                                        </Button>
                                                        <Button
                                                            onClick={() => handleStatusChange(item.name, "Completed")}
                                                            variant={updatedFields.some(field => field.name === item.name && field.status === "Completed") ? "default" : "outline"}
                                                        >
                                                            Completed
                                                        </Button>
                                                        <Button
                                                            onClick={() => handleStatusChange(item.name, "Halted")}
                                                            variant={updatedFields.some(field => field.name === item.name && field.status === "Halted") ? "default" : "outline"}
                                                        >
                                                            Halted
                                                        </Button>
                                                    </div>
                                                    <div className="text-blue-500 cursor-pointer flex gap-2 items-center justify-center border border-blue-500 rounded-md py-1 px-2">
                                                        <Paperclip size="15px" />
                                                        <span>Attach</span>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="flex flex-col gap-4">
                                        {milestone.status_list.list?.map((item) => (
                                            <div key={item.name} className="flex justify-between items-center">
                                                <CardDescription className="font-semibold text-md text-[#1D2939]">
                                                    {item.name}
                                                </CardDescription>
                                                <CardDescription className={`font-semibold text-md text-[#1D2939] ${item.status === "Halted" && "text-red-300"}`}>
                                                    {item.status === "Pending" ? "WIP" : item.status}
                                                </CardDescription>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </CardHeader>
                        </Card> ) 
                    ) )) : (<div>No Halted Milestones found</div>)
                    }
                    </AccordionContent>
                </AccordionItem>


            </Accordion>
                    
                ) : (
                    <div className="text-center text-gray-500 pt-[100px]">Please select a project to display the milestones</div>
                )}
                    
                
            </div>
        </div>
    );
}
