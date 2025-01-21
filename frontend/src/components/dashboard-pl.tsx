import { Link, useNavigate } from "react-router-dom";
import { Card } from "./ui/card";
import { useDocCountStore } from "@/zustand/useDocCountStore";
import { Button } from "./ui/button";
import { CirclePlus } from "lucide-react";

export const ProjectLead = () => {
    const { approvePRCount, pendingPRCount, amendPOCount, newSBApproveCount } = useDocCountStore()
    const navigate = useNavigate()

    return (
        <div className="flex-1 space-y-4">
            {/* <div className="flex justify-between gap-2 max-sm:flex-col">
                <h2 className="text-2xl max-md:text-xl font-bold tracking-tight">Project Lead Dashboard</h2>
                <div className="flex gap-2">
                    <Button onClick={() => navigate("/prs&milestones/procurement-requests")} className="flex"><CirclePlus className="w-5 h-5 mt- pr-1" />Urgent PR</Button>
                    <Button onClick={() => navigate("/service-requests")} className="flex"><CirclePlus className="w-5 h-5 mt- pr-1" />Service Request</Button>
                </div>
            </div> */}
            <div className=" space-y-2">
                <h2 className="text-base font-bold tracking-tight">Procurement Actions</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4 border border-gray-100 rounded-lg p-4">
                    <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                        <Link to="/prs&milestones">
                            <p className="text-center py-6 font-bold text-gray-500">PRs and Milestones</p>
                            <p className="text-center text-red-400 text-sm font-light py-6 font-bold text-gray-500">Create/View PRs, update Milestones & DNs</p>
                        </Link>
                    </Card>
                    <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                        <Link to="/approve-new-pr">
                            <p className="text-center py-6 font-bold text-gray-500">Approve PR</p>
                            <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500">
                                {pendingPRCount || 0}
                            </p>
                        </Link>
                    </Card>
                    <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                        <Link to="/approve-po">
                            <p className="text-center py-6 font-bold text-gray-500">Approve PO</p>
                            <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500">
                                {approvePRCount || 0}
                            </p>
                        </Link>
                    </Card>
                    <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                        <Link to="/approve-amended-po">
                            <p className="text-center py-6 font-bold text-gray-500">Approve Amended PO</p>
                            <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500">
                                {amendPOCount || 0}
                            </p>
                        </Link>
                    </Card>

                </div>
                <h2 className="text-base font-bold tracking-tight pt-4">Rejected/Delayed/Cancelled Sent Back Actions</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4 border border-gray-100 rounded-lg p-4">
                    <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                        <Link to="/approve-sent-back">
                            <p className="text-center py-6 font-bold text-gray-500">Approve Sent Back</p>
                            <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500">
                                {newSBApproveCount || 0}
                            </p>
                        </Link>
                    </Card>
                </div>
            </div>
        </div>
    );
}