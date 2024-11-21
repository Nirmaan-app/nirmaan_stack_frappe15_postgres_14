import { useState } from "react";
import ProjectSelect from "./custom-select/project-select";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { useFrappeGetDoc } from "frappe-react-sdk";
import { Button } from "./ui/button";
import { toast } from "./ui/use-toast";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

export const ManPowerReport = () => {
    const [project, setProject] = useState(null);
    const { data } = useFrappeGetDoc("Projects", project, project ? undefined : null);
    const [manpowerDetails, setManpowerDetails] = useState([
        { role: "MEP Engineer", count: 0 },
        { role: "Electrical Team", count: 0 },
        { role: "AC Technician", count: 0 },
    ]);

    const handleChange = (selectedItem: any) => {
        setProject(selectedItem ? selectedItem.value : null);
        sessionStorage.setItem('selectedProject', JSON.stringify(selectedItem.value));
    };

    const handleInputChange = (index: number, value: string) => {
        const updatedDetails = [...manpowerDetails];
        updatedDetails[index].count = Number(value) || 0;
        setManpowerDetails(updatedDetails);
    };

    const handleCopy = () => {
        const total = manpowerDetails.reduce((sum, item) => sum + item.count, 0);
        const message = `
*Manpower Report*

Project - ${data?.project_name}
Date - ${new Date().toLocaleDateString()}

${manpowerDetails
                .map((item, index) => `${index + 1}. ${item.role} - ${item.count.toString().padStart(2, '0')} Nos.`)
                .join("\n")}
  
Total - ${total.toString().padStart(2, '0')} Nos.
        `.trim();
        navigator.clipboard.writeText(message);
        toast({
            title: "Success!",
            description: "Message copied to clipboard!",
            variant: "success"
        })
    };

    return (
        <div className="flex-1 space-y-2 md:space-y-4">
            <div className="flex items-center ">
                <Link to="/prs&milestones"><ArrowLeft className="" /></Link>
                <h2 className="pl-2 text-xl md:text-2xl font-bold tracking-tight">Man Power Details</h2>
            </div>
            <ProjectSelect onChange={handleChange} />
            {project && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-primary">Format the message!</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex flex-col gap-4">
                            <h3>Manpower Details...</h3>
                            <div>
                                <strong>Project:</strong> {data?.project_name}
                            </div>
                            <div>
                                <strong>Date:</strong> {new Date().toLocaleDateString()}
                            </div>
                            {manpowerDetails.map((item, index) => (
                                <div key={index} className="flex items-center gap-4">
                                    <label className="w-40">{item.role}:</label>
                                    <input
                                        type="number"
                                        value={item.count}
                                        onChange={(e) =>
                                            handleInputChange(index, e.target.value)
                                        }
                                        className="border border-gray-300 rounded-md px-2 py-1"
                                    />
                                </div>
                            ))}
                            <Button
                                onClick={handleCopy}
                            >
                                Copy Message
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
};
