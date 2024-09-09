import { useEffect, useState, useRef } from "react";
import Select from "react-select";
import { Button } from "../ui/button";
import { Card, CardDescription, CardHeader } from "../ui/card";
import { ArrowLeft, Check, Construction, FilePenLine, Milestone, Paperclip, Pencil, X } from "lucide-react";
import { useFrappeCreateDoc, useFrappeFileUpload, useFrappeGetDoc, useFrappeGetDocList, useFrappePostCall, useFrappeUpdateDoc } from "frappe-react-sdk";
import { useNavigate } from "react-router-dom";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../ui/accordion";
import { useToast } from "../ui/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "../ui/dialog";
import { convertDate, formatDate } from "@/utils/FormatDate";
import { DialogClose } from "@radix-ui/react-dialog";


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
    const [selectedFiles, setSelectedFiles] = useState<{ [key: string]: File | null }>({});
    const [uploadProgress, setUploadProgress] = useState<number | null>(null);
    const [fileNames, setFileNames] = useState<{ [key: string]: string | null }>({});
    const [disableSaveButton, setDisableSaveButton] = useState<boolean>(true);
    const [buttonDescription, setButtonDescription] = useState<string>('');
    const fileInputRefs = useRef({});
    const [areaName, setAreaName] = useState<string | null>(null)

    const { toast } = useToast()

    const navigate = useNavigate();

    const { data: project_work_milestones_list, isLoading: project_work_milestones_list_loading, error: project_work_milestones_list_error, mutate: project_work_milestones_list_mutate } = useFrappeGetDocList("Project Work Milestones", {
        fields: ["*"],
        limit: 1000,
        filters: [['project', 'like', `%${selectedProject?.value}`]],
        orderBy: { field: "modified", order: "desc" }
    },
        `Project Work Milestones ${selectedProject?.value}`
    );

    const { data: project_list, isLoading: project_list_loading, error: project_list_error, mutate: project_list_mutate } = useFrappeGetDocList("Projects", {
        fields: ["*"],
        limit: 1000
    },
        "Projects"
    );

    const [project, setProject] = useState(null)
    const [defaultValues, setDefaultValues] = useState<null | string[]>(null)
    const { createDoc, loading: createLoading } = useFrappeCreateDoc();
    const { updateDoc, loading: updateLoading, error: updateError, isCompleted: updateCompleted } = useFrappeUpdateDoc();
    const { upload, loading: uploadLoading } = useFrappeFileUpload();
    const { call } = useFrappePostCall('frappe.client.set_value');

    const projectOptions = project_list?.map(project => ({
        label: project.project_name,
        value: project.name
    }));

    useEffect(() => {
        if (selectedProject) {
            const project = project_list?.find((project) => project.name === selectedProject.value)
            setProject(project)
            const list: string[] = project.project_work_milestones.work_packages.map((wp) => wp.work_package_name)
            setDefaultValues(list)
        }
    }, [selectedProject])
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
    }, [updatedFields, selectedFiles])

    const determineOverallStatus = (fields: UpdatedField[]) => {
        const statuses = fields.map(field => field.status);
        if (statuses.every(status => status === "Completed")) {
            setOverallStatus("Completed");
        } else if (statuses.every(status => status === "Halted")) {
            setOverallStatus("Halted");
        } else if (statuses.every(status => status === "Pending")) {
            setOverallStatus("Pending");
        } else {
            setOverallStatus("WIP");
        }
    };


    const validateSaveButton = (statuses: string[]) => {
        const initialStatuses = initialFields.map(field => field.status);
        const hasStatusChanged = !initialStatuses.every((status, index) => status === statuses[index]);
        setDisableSaveButton(!(hasStatusChanged));
    };

    const handleStatusChange = (name: string, status: string) => {
        const newFields = updatedFields.map(field =>
            field.name === name ? { ...field, status } : field
        );
        setUpdatedFields(newFields);
        setAreaName(name);
    };

    const triggerFileInput = (name: string) => {
        if (name !== areaName) {
            return;
        }
        if (fileInputRefs.current[name]) {
            fileInputRefs.current[name].click();
        }
    };

    const handleFileChange = (event, name) => {
        const file = event.target.files[0];
        if (file) {
            setSelectedFiles(prev => ({ ...prev, [name]: file }));
            setFileNames(prev => ({ ...prev, [name]: file.name }));
            setUploadProgress(null);
        }
    };

    const handleFileUpload = async (area: string) => {
        if (selectedFiles[area]) {
            try {
                const doc = await createDoc("Milestone Attachments", {
                    milestone: editingMilestone,
                    project: selectedProject?.value,
                    area_name: area,
                    area_status: updatedFields.find((i) => i.name === area)?.status,
                });

                const fileArgs = {
                    doctype: "Milestone Attachments",
                    docname: doc.name,
                    fieldname: "image",
                    isPrivate: true
                };

                const uploadResult = await upload(selectedFiles[area], fileArgs);
                await call({
                    doctype: "Milestone Attachments",
                    name: doc.name,
                    fieldname: "image",
                    value: uploadResult.file_url
                });
                setUploadProgress(100);
                setSelectedFiles(prev => ({ ...prev, [area]: null }));
                setFileNames(prev => ({ ...prev, [area]: null }));
            } catch (error) {
                console.error("Error uploading file:", error);
            }
        }
    };

    const handleCancelMilestone = () => {
        setEditingMilestone(null);
        setOverallStatus(null);
        setUpdatedFields([]);
        setSelectedFiles({});
        setFileNames({});
        setUploadProgress(null);
        setAreaName(null);
    };

    const handleUpdateMilestone = async () => {
        if (!updatedFields.length) return;

        try {
            await updateDoc("Project Work Milestones", editingMilestone, {
                status_list: { list: updatedFields },
                status: overallStatus
            });
            await Promise.all(
                Object.keys(selectedFiles).map(area => handleFileUpload(area))
            );

            project_work_milestones_list_mutate();
            toast({
                title: "Success!",
                description: `${editingMilestone} Milestone updated successfully!`,
                variant: "success"
            });
        } catch (error) {
            console.error("Error updating milestone", error);
            toast({
                title: "Error!",
                description: "Error updating milestone",
                variant: "destructive"
            });
        } finally {
            handleCancelMilestone();
        }
    };

    function isMoreThanSixHours(modified: string) {
        const modifiedDate = new Date(modified);
        const currentTime = new Date();
        const timeDifference = currentTime - modifiedDate;
        const hoursDifference = timeDifference / (1000 * 60 * 60);
        return hoursDifference > 6;
    }

    const todayDate = new Date()

    const today = new Date().toISOString().split("T")[0];

    const [
        isSaveDisabled, setIsSaveDisabled] = useState(false);

    useEffect(() => {

        const today = new Date().toISOString().split("T")[0];
        const todayDate = new Date()
        if (project_work_milestones_list) {
            const filteredMilestones = project_work_milestones_list.filter(milestone =>
                milestone.status !== "Completed" &&
                new Date(milestone.start_date) <= new Date(today) &&
                milestone.modified !== milestone.creation
            );

            if (filteredMilestones.length) {
                const isAnyMilestoneRecent = filteredMilestones.some(milestone => {
                    const modifiedDate = new Date(milestone.modified);
                    const timeDifference = todayDate - modifiedDate;
                    const hoursDifference = timeDifference / (1000 * 60 * 60);
                    return hoursDifference > 6;
                });

                setIsSaveDisabled(isAnyMilestoneRecent);
            } else {
                setIsSaveDisabled(true)
            }
        }
    }, [project_work_milestones_list]);


    return (
        <div className="w-full h-auto p-4 flex flex-col space-y-4">
            <div className="flex flex-col space-y-4 md:mb-6">
                <div className="flex justify-between">
                    <div className="flex items-center gap-2">
                        {selectedProject !== null ?
                            <div className="pl-6" /> : <ArrowLeft className="cursor-pointer" onClick={() => navigate("/")} />
                        }


                        <h1 className="text-xl max-md:text-lg font-bold">Update Milestones</h1>

                    </div>
                    <span className="mt-0.5 text-red-700">{formatDate(todayDate)}</span>
                </div>
                {selectedProject === null ?
                    <Select
                        options={projectOptions}
                        value={selectedProject}
                        onChange={setSelectedProject}
                        placeholder="Select a project..."
                    /> :
                    <div className="font-bold text-center border rounded-sm p-2 text-lg"><span className="font-semibold text-red-700">Project:</span>{selectedProject.label}</div>
                }

            </div>

            {/* <div className="flex justify-between w-[95%] items-center border-b mx-auto pb-4">
                <p className="text-gray-500 font-semibold">Milestone</p>
                <p className="text-gray-500 font-semibold">Package</p>
                <p className="text-gray-500 font-semibold">Status</p>
            </div> */}

            <div className="flex flex-col gap-2 w-full">
                {project_work_milestones_list?.length ? (
                    defaultValues !== null && (
                        <>
                            <Accordion type="multiple" defaultValue={defaultValues}>
                                {project?.project_work_milestones?.work_packages?.map((wp) => (
                                    <AccordionItem key={wp.work_package_name} value={wp.work_package_name}>
                                        <AccordionTrigger>
                                            <Button variant="ghost" size="lg" className="md:mb-2 text-base md:text-lg px-2  w-full justify-start">
                                                <span className="text-red-700 text-base mb-0.5 md:text-lg font-slim">{wp.work_package_name}</span>
                                            </Button>
                                        </AccordionTrigger>

                                        <AccordionContent className="space-y-2">
                                            {
                                                // project_work_milestones_list.some((milestone) => milestone.status === "Pending")
                                                //     ? (
                                                //   project_work_milestones_list.map((milestone) => ( 
                                                //      (milestone.status !== "Completed") && ( 
                                                (project_work_milestones_list
                                                    .filter(milestone =>
                                                        milestone.status !== "Completed" &&
                                                        new Date(milestone.start_date) <= new Date(today) &&
                                                        milestone.work_package === wp.work_package_name
                                                    )).length !== 0 ? (

                                                    project_work_milestones_list
                                                        .filter(milestone =>
                                                            milestone.status !== "Completed" &&
                                                            new Date(milestone.start_date) <= new Date(today) &&
                                                            milestone.work_package === wp.work_package_name
                                                        )
                                                        .map(milestone => (
                                                            <Card className="w-full" key={milestone.name}>
                                                                <CardHeader className="p-4 flex flex-col gap-2 w-full">
                                                                    <div className="flex justify-between items-center">
                                                                        <CardDescription className="flex flex-col">
                                                                            {/* {milestone.start_date} to {milestone.end_date} */}
                                                                            <div className="text-lg font-semibold max-md:text-[15px] text-black">
                                                                                {milestone.milestone}
                                                                            </div>
                                                                            {/* <p>{milestone.work_package}</p> */}

                                                                        </CardDescription>
                                                                        {editingMilestone === milestone.name ? (
                                                                            <div className="flex gap-2 items-center mr-1 md:mr-2 h-10">
                                                                                <button
                                                                                    className="text-red-500"
                                                                                    onClick={handleCancelMilestone}
                                                                                >
                                                                                    {/* <SquareX className="md:w-8 md:h-8" /> */}
                                                                                    <X className="md:w-8 md:h-8" />
                                                                                </button>
                                                                                <span>|</span>
                                                                                <button
                                                                                    className={`text-blue-800 disabled:opacity-50 disabled:cursor-not-allowed ${updateLoading || createLoading && "animate-pulse"}`}
                                                                                    onClick={handleUpdateMilestone}
                                                                                    disabled={disableSaveButton}
                                                                                >
                                                                                    {/* <div className="md:w-8 md:h-8">✔</div> */}
                                                                                    <Check className="md:w-8 md:h-8" />
                                                                                </button>
                                                                            </div>

                                                                        ) : (
                                                                            <div className="flex">
                                                                                <div className={`mt-3.5 w-3 h-3 border rounded-lg mr-3 bg-green-500 hover:bg-green-500 ${(((Date.now() - convertDate(milestone.modified)) / (1000 * 60 * 60)) <= 6 && ((Date.now() - convertDate(milestone.modified)) / (1000 * 60 * 60)) >= 0 && milestone.creation !== milestone.modified) ? "block" : "hidden"}`}></div>
                                                                                <button
                                                                                    className="h-10"
                                                                                    onClick={() => setEditingMilestone(milestone.name)}
                                                                                >
                                                                                    <Button className="max-md:p-1 flex items-center justify-center gap-1">
                                                                                        <p>Update</p>
                                                                                        {/* <FilePenLine className="md:w-8 md:h-8 mr-1 md:mr-2 text-blue-300 hover:text-blue-600 cursor-pointer" /> */}
                                                                                        <Pencil className=" w-4 h-4" />
                                                                                    </Button>
                                                                                </button>
                                                                            </div>
                                                                        )}
                                                                    </div>

                                                                    {/* <div className={` ${editingMilestone === milestone.name ? "" : "flex justify-between items-center"} w-full relative`}>
                                                                <div className="text-lg font-semibold max-md:text-[15px] max-w-[80%]">
                                                                    {milestone.milestone}
                                                                </div>
                                                                <CardTitle className={`transition-all max-w-[30%] duration-300 ${editingMilestone === milestone.name ? 'relative pt-[10px] max-md:text-sm text-base font-normal break-words' : 'absolute top-0 left-[45%] max-md:text-base text-lg break-words'}`}>
                                        {milestone.work_package}
                                    </CardTitle>
                                                                <div className={`text-lg font-medium max-md:text-[15px] ${editingMilestone === milestone.name ? "hidden" : "block"} ${(milestone.status === "WIP") ? "text-yellow-500" : milestone.status === "Completed" ? "text-green-800" : milestone.status === "Halted" ? "text-red-500" : ""}`}>
                                                                    {milestone.status === "Pending" ? "--" : milestone.status}
                                                                </div>
                                                            </div> */}
                                                                    {editingMilestone === milestone.name ? (
                                                                        <>
                                                                            <div className={`flex flex-col gap-4`}>
                                                                                {milestone.status_list.list?.map((item) => (
                                                                                    <div key={item.name}>
                                                                                        <div className="font-medium text-[13px] text-[#1D2939]">
                                                                                            {item.name}
                                                                                        </div>
                                                                                        <div className="flex justify-between mt-2 items-center">
                                                                                            <div className="flex gap-2 items-center flex-wrap">
                                                                                                <Button
                                                                                                    size="sm"
                                                                                                    onClick={() => handleStatusChange(item.name, "WIP")}
                                                                                                    variant={(updatedFields.some(field => field.name === item.name && field.status === "WIP") && !isMoreThanSixHours(milestone.modified)) ? "wip" : "outline"}
                                                                                                >
                                                                                                    WIP
                                                                                                </Button>
                                                                                                <Button
                                                                                                    size="sm"
                                                                                                    onClick={() => handleStatusChange(item.name, "Completed")}
                                                                                                    variant={updatedFields.some(field => field.name === item.name && field.status === "Completed") ? "completed" : "outline"}
                                                                                                >
                                                                                                    Completed
                                                                                                </Button>
                                                                                                <Button
                                                                                                    size="sm"
                                                                                                    onClick={() => handleStatusChange(item.name, "Halted")}
                                                                                                    variant={(updatedFields.some(field => field.name === item.name && field.status === "Halted") && !isMoreThanSixHours(milestone.modified)) ? "default" : "outline"}
                                                                                                >
                                                                                                    Halted
                                                                                                </Button>
                                                                                            </div>
                                                                                            <div className="flex gap-2 flex-col">
                                                                                                <div className={`text-blue-500 cursor-pointer flex gap-2 items-center justify-center border border-blue-500 rounded-md py-1 px-2 ${((selectedFiles[item.name] !== undefined || null) || item.name !== areaName) && "opacity-50 cursor-not-allowed"}`}
                                                                                                    onClick={() => triggerFileInput(item.name)}
                                                                                                >
                                                                                                    <Paperclip size="15px" />
                                                                                                    <span>Attach</span>
                                                                                                    <input type="file" disabled={(selectedFiles[item.name] !== undefined || null) || item.name !== areaName} className="hidden"
                                                                                                        ref={(el) => (fileInputRefs.current[item.name] = el)}
                                                                                                        onChange={(event) => handleFileChange(event, item.name)} />
                                                                                                </div>
                                                                                                {(fileNames[item.name]) && (
                                                                                                    <div className="flex items-center justify-between border rounded-md p-2 relative">
                                                                                                        <span className="text-gray-800 max-w-[100px] truncate">{fileNames[item.name]}</span>
                                                                                                        <button
                                                                                                            className="text-red-500 rounded-3xl px-1 font-semibold absolute -top-1 -right-2 bg-black "
                                                                                                            onClick={() => {
                                                                                                                setSelectedFiles(prev => ({ ...prev, [item.name]: null }));
                                                                                                                setFileNames(prev => ({ ...prev, [item.name]: null }));
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

                                                                            {/* <div className="flex gap-2 items-center"><p className="font-bold md:text-lg">Note:</p> <span className="md:text-base text-[#3C25A3] font-semibold">Please update only one Area at a time!</span></div> */}
                                                                        </>
                                                                    ) : (
                                                                        <div className="flex flex-col gap-4">
                                                                            {milestone.status_list.list?.map((item) => (
                                                                                <div key={item.name} className="flex justify-between items-center">
                                                                                    <div className="font-medium text-[13px] text-[#1D2939]">
                                                                                        {item.name}
                                                                                    </div>
                                                                                    <div className={`font-medium text-[13px]  ${(item.status === "WIP") ? "text-yellow-500" : item.status === "Completed" ? "text-green-800" : item.status === "Halted" ? "text-red-500" : ""}`}>
                                                                                        {(item.status === "Pending" || isMoreThanSixHours(milestone.modified)) ? "--" : item.status}
                                                                                    </div>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    )}
                                                                </CardHeader>
                                                            </Card>
                                                            // ) )) : (<div>No Pending Milestones found</div>)
                                                        ))) : (
                                                    <div>No Pending Milestones as of today for this work package</div>
                                                )}
                                        </AccordionContent>
                                    </AccordionItem>
                                ))}
                                {/* 
                <AccordionItem value="WIP">
                    <AccordionTrigger>
                        <Button variant="ghost" size="lg" className="md:mb-2 text-[#D9502C] hover:text-[#D9502C] text-base md:text-lg px-2  w-full justify-start">
                            WIP
                        </Button>
                    </AccordionTrigger>

                    <AccordionContent className="space-y-2">
                    {project_work_milestones_list.some((milestone) => milestone.status === "WIP")
                        ? (
                      project_work_milestones_list.map((milestone) => ( 
                         milestone.status === "WIP" && ( 
                        <Card className="w-full" key={milestone.name}>
                            <CardHeader className="p-4 flex flex-col gap-2 w-full">
                                <div className="flex justify-between items-center">
                                    <CardDescription>
                                        //  {milestone.start_date} to {milestone.end_date} 
                                        {milestone.work_package}
                                    </CardDescription>
                                    {editingMilestone === milestone.name ? (
                                            <div className="flex gap-2 items-center mr-1 md:mr-2">
                                               <button
                                               className="text-red-500"
                                               onClick={handleCancelMilestone}
                                               >
                                                   <SquareX className="md:w-8 md:h-8" />
                                               </button>
                                               <span>|</span>
                                               <button
                                               className={`text-blue-800 disabled:opacity-50 disabled:cursor-not-allowed ${updateLoading || createLoading && "animate-pulse"}`}
                                               onClick={handleUpdateMilestone}
                                               disabled={disableSaveButton}
                                               >
                                                   <SaveAll className="md:w-8 md:h-8" />
                                               </button>
                                        </div>
                                        
                                    ) : (
                                        
                                        <button
                                            onClick={() => setEditingMilestone(milestone.name)}
                                        >
                                        <FilePenLine className="md:w-8 md:h-8  mr-1 md:mr-2 text-blue-300 hover:text-blue-600 cursor-pointer" />
                                        </button>
                                    )}
                                </div>

                                <div className={` ${editingMilestone === milestone.name ? "flex-col" : "flex justify-between items-center"} w-full relative`}>
                                    <div className="text-lg font-semibold max-md:text-[15px] max-w-[80%]">{milestone.milestone}</div>
                                    {/* <CardTitle className={`transition-all max-w-[30%] duration-300 ${editingMilestone === milestone.name ? 'relative pt-[10px] max-md:text-sm text-base font-normal break-words' : 'absolute top-0 left-[45%] max-md:text-base text-lg break-words'}`}>
                                        {milestone.work_package}
                                    </CardTitle> 
                                    <div className={`text-lg font-medium max-md:text-[15px] text-[#D9502C] ${editingMilestone === milestone.name ? "opacity-0" : "opacity-100"}`}>
                                        {milestone.status}
                                    </div>
                                </div>


                                {editingMilestone === milestone.name ? (
                                    <>
                                    <div className="flex flex-col gap-4 transition-opacity duration-500 opacity-100">
                                        {milestone.status_list.list?.map((item) => (
                                            <div key={item.name}>
                                                <div className="font-medium text-[13px] text-[#1D2939]">
                                                    {item.name}
                                                </div>
                                                <div className="flex justify-between mt-2 items-center">
                                                    <div className="flex gap-2 items-center flex-wrap">
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
                                                    <div className={`text-blue-500 cursor-pointer flex gap-2 items-center justify-center border border-blue-500 rounded-md py-1 px-2 ${((selectedFiles[item.name] !== undefined || null) || item.name !== areaName) && "opacity-50 cursor-not-allowed"}`}
                                                    onClick={() => triggerFileInput(item.name)}
                                                    >
                                                        <Paperclip size="15px" />
                                                        <span>Attach</span>
                                                        <input type="file" disabled={(selectedFiles[item.name] !== undefined || null) || item.name !== areaName} className="hidden" 
                                                        ref={(el) => (fileInputRefs.current[item.name] = el)}
                                                        onChange={(event) => handleFileChange(event, item.name)}/>
                                                    </div>
                                                    {(fileNames[item.name] && item.name === areaName) && (
                                                            <div className="flex items-center justify-between border rounded-md p-2 relative">
                                                                <span className="text-gray-800 max-w-[100px] truncate">{fileNames[item.name]}</span>
                                                                <button
                                                                    className="text-red-500 rounded-3xl px-1 font-semibold absolute -top-1 -right-2 bg-black "
                                                                    onClick={() => {
                                                                        setSelectedFiles(prev => ({...prev, [item.name]: null}));
                                                                        setFileNames(prev => ({...prev, [item.name]: null}));
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

                                {/* <div className="flex gap-2 items-center"><p className="font-bold md:text-lg">Note:</p> <span className="md:text-base text-[#3C25A3] font-semibold">Please update only one Area at a time!</span></div> 
                                    </>
                                ) : (
                                    <div className="flex flex-col gap-4">
                                        {milestone.status_list.list?.map((item) => (
                                            <div key={item.name} className="flex justify-between items-center">
                                                <div className="font-medium text-[13px] text-[#1D2939]">
                                                    {item.name}
                                                </div>
                                                <div className={`font-medium text-[13px]  ${(item.status === "WIP") ? "text-[#D9502C]" : item.status === "Completed" ? "text-green-700" : item.status === "Halted" ? "text-red-500" : ""}`}>
                                                    {item.status}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </CardHeader>
                        </Card> ) 
                    ) )) : (<div>No WIP Milestones found</div>)
                    }
                    </AccordionContent>

                </AccordionItem>

                <AccordionItem value="Completed">
                    <AccordionTrigger>
                        <Button variant="ghost" size="lg" className="mb-2 text-green-800 hover:text-green-600 px-2 text-base md:text-lg w-full justify-start">
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
                                        {/* {milestone.start_date} to {milestone.end_date} 
                                        {milestone.work_package}
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
                                    )} 
                                </div>

                                <div className={` ${editingMilestone === milestone.name ? "flex-col" : "flex justify-between"} w-full relative`}>
                                    <div className="text-lg font-semibold max-md:text-[15px] max-w-[80%]">{milestone.milestone}</div>
                                    {/* <CardTitle className={`transition-all max-w-[30%] duration-300 ${editingMilestone === milestone.name ? 'relative pt-[10px] max-md:text-sm text-base font-normal break-words' : 'absolute top-0 left-[45%] max-md:text-base text-lg break-words'}`}>
                                        {milestone.work_package}
                                    </CardTitle> 
                                    <div className={`text-lg font-medium max-md:text-[15px] text-green-800 ${editingMilestone === milestone.name ? "opacity-0" : "opacity-100"}`}>
                                        {milestone.status}
                                    </div>
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
                                    <div className="flex flex-col gap-4 max-sm:pt-10">
                                        {milestone.status_list.list?.map((item) => (
                                            <div key={item.name} className="flex justify-between items-center">
                                                <div className="font-medium text-[13px] text-[#1D2939]">
                                                    {item.name}
                                            </div>
                                                {milestone_attachments?.filter((att) => (att.area_name === item.name && att.milestone === milestone.name))?.length !==0 && 
                                            (<Dialog>
                                                 <DialogTrigger asChild>
                                                     <img className="object-contain w-[100px] h-[50px]" src={`http://localhost:8000/${milestone_attachments?.filter((att) => (att.area_name === item.name && att.milestone === milestone.name))[0].image}`} alt="" />
     
                                                 </DialogTrigger>
                                                 <DialogContent className="max-sm:max-w-[425px] p-8">
                                                     <img src={`http://localhost:8000/${milestone_attachments?.filter((att) => (att.area_name === item.name && att.milestone === milestone.name))[0].image}`} alt="" />
                                                 </DialogContent>
                                            </Dialog>)
                                                }
                                                <div className={`font-medium text-[13px] opacity-70 text-red-500 ${item.status === "Completed" && "text-green-800"}`}>
                                                    {item.status}
                                                </div>
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
                        <Button variant="ghost" size="lg" className="mb-2 text-red-500 hover:text-red-600 px-2 text-base md:text-lg w-full justify-start">
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
                                        {/* {milestone.start_date} to {milestone.end_date} 
                                        {milestone.work_package}
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
                                    )} 
                                </div>

                                <div className={` ${editingMilestone === milestone.name ? "flex-col" : "flex justify-between"} w-full relative`}>
                                    <div className="text-lg font-semibold max-md:text-[15px] max-w-[80%]">{milestone.milestone}</div>
                                    {/* <CardTitle className={`transition-all max-w-[30%] duration-300 ${editingMilestone === milestone.name ? 'relative pt-[10px] max-md:text-sm text-base font-normal break-words' : 'absolute top-0 left-[45%] max-md:text-base text-lg break-words'}`}>
                                        {milestone.work_package}
                                    </CardTitle> 
                                    <div className={`text-lg font-medium max-md:text-[15px] text-red-500 ${editingMilestone === milestone.name ? "opacity-0" : "opacity-100"}`}>
                                        {milestone.status}
                                    </div>
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
                                                <div className="font-medium text-[13px] text-[#1D2939]">
                                                    {item.name}
                                                </div>
                                                {milestone_attachments?.filter((att) => (att.area_name === item.name && att.milestone === milestone.name))?.length !==0 && 
                                            (<Dialog>
                                                 <DialogTrigger asChild>
                                                     <img className="object-contain w-[100px] h-[50px]" src={`http://localhost:8000/${milestone_attachments?.filter((att) => (att.area_name === item.name && att.milestone === milestone.name))[0].image}`} alt="" />
     
                                                 </DialogTrigger>
                                                 <DialogContent className="max-sm:max-w-[425px] p-8">
                                                     <img src={`http://localhost:8000/${milestone_attachments?.filter((att) => (att.area_name === item.name && att.milestone === milestone.name))[0].image}`} alt="" />
                                                 </DialogContent>
                                            </Dialog>)
                                                }
                                                <div className={`font-medium text-[13px] ${item.status === "Halted" && "text-red-300"}`}>
                                                    {item.status}
                                                </div>
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

                */}


                            </Accordion>


                            <div className="flex justify-center">
                                <Dialog>
                                    <DialogTrigger asChild>
                                        <Button disabled={isSaveDisabled} className="mr-2" variant="completed">Save</Button>
                                    </DialogTrigger>
                                    <DialogContent>
                                        <DialogHeader>
                                            <DialogTitle>Are you sure?</DialogTitle>
                                            <DialogDescription>
                                                Once submitted, these updates will be shared with project lead.


                                            </DialogDescription>

                                        </DialogHeader>
                                        <div className="flex justify-center">
                                            <Button className="mr-2" variant="completed" onClick={() => navigate("/prs&milestones")}>Yes</Button>
                                            <DialogClose><Button>No</Button></DialogClose>
                                        </div>

                                    </DialogContent>
                                </Dialog>

                                <Dialog>
                                    <DialogTrigger asChild>
                                        <Button>Cancel</Button>
                                    </DialogTrigger>
                                    <DialogContent>
                                        <DialogHeader>
                                            <DialogTitle>Are you sure?</DialogTitle>
                                            <DialogDescription>
                                                If you cancel now, all the unsaved updates will be lost


                                            </DialogDescription>

                                        </DialogHeader>
                                        <div className="flex justify-center">
                                            <Button className="mr-2" variant="completed" onClick={() => navigate("/prs&milestones")}>Yes</Button>
                                            <DialogClose><Button>No</Button></DialogClose>
                                        </div>

                                    </DialogContent>
                                </Dialog>


                            </div>
                        </>
                    )
                ) : (
                    <div className="text-center text-gray-500 pt-[100px]">Please select a project to display the milestones</div>
                )}


            </div>
        </div>
    );
}