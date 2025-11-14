import { Banknote, ClipboardMinus, FileUp, Landmark, LandmarkIcon, ReceiptText, UsersRound, WalletCards,  SquareSquare } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../ui/button";

function DashboardCard({ title, icon, onClick, className, beta = false }: any) {
    return (
        <Button
            variant="ghost"
            className={`h-[150px] w-full p-0 ${className}`}
            onClick={onClick}
        >
            <div className="flex h-full w-full flex-col justify-between p-6">
                <div className="text-left">
                    <p className="text-lg font-semibold text-white text-wrap">{title}</p>
                </div>
                <div className="self-end">{icon}</div>
            </div>
        </Button>
    )
}

function SectionHeader({ title }: { title: string }) {
    return (
       <h2 className="text-xl font-semibold text-muted-foreground mb-3 mt-6 first:mt-0">
            {title}
        </h2>
    )
}

export const Accountant = () => {

    const navigate = useNavigate();

    return (
        <>
            {/* <div className="flex-1 space-y-4">
                <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-3">
                    <DashboardCard
                        title="Project Payments"
                        icon={<WalletCards className="h-8 w-8 text-white" />}
                        onClick={() => navigate("/project-payments")}
                        className="bg-red-600"
                    />
                     <DashboardCard
                        title="Work Orders"
                        icon={<  SquareSquare className="h-8 w-8 text-white" />}
                        onClick={() => navigate("/service-requests")}
                        className="bg-red-600"
                    />
                    <DashboardCard
                        title="Vendors"
                        icon={<UsersRound className="h-8 w-8 text-white" />}
                        onClick={() => navigate("/vendors")}
                        className="bg-red-600"
                    />
                    <DashboardCard
                        title="In-Flow Payments"
                        icon={<UsersRound className="h-8 w-8 text-white" />}
                        onClick={() => navigate("/in-flow-payments")}
                        className="bg-red-600"
                    />
                    <DashboardCard
                        title="Invoice Recon"
                        icon={<ReceiptText className="h-8 w-8 text-white" />}
                        onClick={() => navigate("/invoice-reconciliation")}
                        className="bg-red-600"
                    />
                    <DashboardCard
                        title="Project Invoices"
                        icon={<FileUp className="h-8 w-8 text-white" />}
                        onClick={() => navigate("/project-invoices")}
                        className="bg-red-600"
                    />
                    <DashboardCard
                        title="Project Expenses"
                        icon={<Landmark className="h-8 w-8 text-white" />}
                        onClick={() => navigate("/project-expenses")}
                        className="bg-red-600"
                    />
                    <DashboardCard
                        title="Non Project Expenses"
                        icon={<Banknote className="h-8 w-8 text-white" />}
                        onClick={() => navigate("/non-project")}
                        className="bg-red-600"
                    />
                    <DashboardCard
                        title="Reports"
                        icon={<ClipboardMinus className="h-8 w-8 text-white" />}
                        onClick={() => navigate("/reports")}
                        className="bg-red-600"
                    />
                </div>
            </div> */}
            <div className="flex-1 space-y-4">
            {/* Payments Section */}
            <SectionHeader title="Payments" />
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-3">
                <DashboardCard
                    title="Project Payments"
                    icon={<WalletCards className="h-8 w-8 text-white" />}
                    onClick={() => navigate("/project-payments")}
                    className="bg-red-600"
                />
                <DashboardCard
                    title="In-Flow Payments"
                    icon={<UsersRound className="h-8 w-8 text-white" />}
                    onClick={() => navigate("/in-flow-payments")}
                    className="bg-red-600"
                />
                <DashboardCard
                    title="Project Expenses"
                    icon={<Landmark className="h-8 w-8 text-white" />}
                    onClick={() => navigate("/project-expenses")}
                    className="bg-red-600"
                />
                <DashboardCard
                    title="Non Project Expenses"
                    icon={<Banknote className="h-8 w-8 text-white" />}
                    onClick={() => navigate("/non-project")}
                    className="bg-red-600"
                />
            </div>

            {/* Invoice Section */}
            <SectionHeader title="Invoice" />
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-3">
                <DashboardCard
                    title="Invoice Recon"
                    icon={<ReceiptText className="h-8 w-8 text-white" />}
                    onClick={() => navigate("/invoice-reconciliation")}
                    className="bg-red-600"
                />
                <DashboardCard
                    title="Project Invoices"
                    icon={<FileUp className="h-8 w-8 text-white" />}
                    onClick={() => navigate("/project-invoices")}
                    className="bg-red-600"
                />
            </div>

            {/* Others Section */}
            <SectionHeader title="Others" />
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-3">
                <DashboardCard
                    title="Work Orders"
                    icon={<SquareSquare className="h-8 w-8 text-white" />}
                    onClick={() => navigate("/service-requests")}
                    className="bg-red-600"
                />
                <DashboardCard
                    title="Vendors"
                    icon={<UsersRound className="h-8 w-8 text-white" />}
                    onClick={() => navigate("/vendors")}
                    className="bg-red-600"
                />
                
                <DashboardCard
                    title="Reports"
                    icon={<ClipboardMinus className="h-8 w-8 text-white" />}
                    onClick={() => navigate("/reports")}
                    className="bg-red-600"
                />
            </div>
        </div>
        </>
    )
}
