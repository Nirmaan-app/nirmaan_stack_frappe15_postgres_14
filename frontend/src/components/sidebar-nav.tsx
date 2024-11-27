import {
    Building2,
    LayoutGrid,
    Shapes,
    X,
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useUserData } from "@/hooks/useUserData";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";
import { Separator } from "./ui/separator";
// import { UserContext } from '@/utils/auth/UserProvider';

interface SidebarProps {
    className?: string,
    isSidebarOpen?: boolean,
    toggleSidebar?: () => void,
    setIsSidebarOpen?: (isOpen: boolean) => void;
}

export function Sidebar({ className, isSidebarOpen, setIsSidebarOpen, toggleSidebar }: SidebarProps) {
    const location = useLocation()
    const userData = useUserData()

    const isActive = (path: string) => {
        return location.pathname === path;
    }

    const handleToggleSidebar = () => {
        if (toggleSidebar) {
            toggleSidebar();
        }
    };

    const handleSetSidebarOpen = (isOpen: boolean) => {
        if (setIsSidebarOpen) {
            setIsSidebarOpen(isOpen);
        }
    };

    return (
        <>
            <div
                className={cn(
                    " pb-4 max-md:pt-16 md:pb-10 text-gray-500 transition-transform duration-300 ease-in-out overflow-auto",
                    isSidebarOpen ? "translate-x-0 bg-white" : "-translate-x-full",
                    "fixed md:translate-x-0 w-64 h-full z-40 bg-white"
                )}
            >
                <div className="py-2">
                    <div className="px-2 py-2">

                        <div className="flex items-center justify-between w-full">
                            <Link to="/">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleSetSidebarOpen(false)}
                                    disabled={isActive("/")}
                                    className={cn("px-2 text-xs w-[200px] justify-start", { "bg-red-400": isActive("/") })}>
                                    <LayoutGrid className="mr-2 h-4 w-4" />
                                    <span className={cn({ "text-white": isActive("/") })}>Dashboard</span>
                                </Button>
                            </Link>

                            {isSidebarOpen && <X onClick={handleToggleSidebar} className="h-5 w-5" />}

                        </div>
                        <Accordion type="multiple" defaultValue={["admin-actions", "pl-actions", "pe-actions"]} >
                            {(userData.user_id == "Administrator" || userData.role == "Nirmaan Admin Profile") && <AccordionItem value="admin-actions">
                                <AccordionTrigger>
                                    <Button variant="ghost" size="sm" className="mb-2 px-2 text-xs w-full justify-start">
                                        <Shapes className="mr-2 h-4 w-4" />
                                        Admin Options
                                    </Button>
                                </AccordionTrigger>
                                <AccordionContent>
                                    <Link to="/projects"
                                    >
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleSetSidebarOpen(false)}
                                            disabled={isActive("/projects")}
                                            className={cn("w-full justify-start", { "bg-red-400": isActive("/projects") })}>
                                            <span className={cn({ "text-white": isActive("/projects") })}>Projects</span>
                                        </Button>
                                    </Link>
                                    <Link to="/users">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleSetSidebarOpen(false)}
                                            disabled={isActive("/users")}
                                            className={cn("w-full justify-start", { "bg-red-400": isActive("/users") })}>
                                            <span className={cn({ "text-white": isActive("/users") })}>Users</span>
                                        </Button>
                                    </Link>
                                    {/* <Link to="/wp">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleSetSidebarOpen(false)}
                                            disabled={isActive("/wp")}
                                            className={cn("w-full justify-start", { "bg-red-400": isActive("/wp") })}>
                                            <span className={cn({ "text-white": isActive("/wp") })}>Work Packages</span>
                                        </Button>
                                    </Link> */}
                                    <Link to="/items">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleSetSidebarOpen(false)}
                                            disabled={isActive("/items")}
                                            className={cn("w-full justify-start", { "bg-red-400": isActive("/items") })}>
                                            <span className={cn({ "text-white": isActive("/items") })}>Items</span>
                                        </Button>
                                    </Link>
                                    <Link to="/vendors">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleSetSidebarOpen(false)}
                                            disabled={isActive("/vendors")}
                                            className={cn("w-full justify-start", { "bg-red-400": isActive("/vendors") })}>
                                            <span className={cn({ "text-white": isActive("/vendors") })}>Vendors</span>
                                        </Button>
                                    </Link>

                                    <Link to="/customers">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleSetSidebarOpen(false)}
                                            disabled={isActive("/customers")}
                                            className={cn("w-full justify-start", { "bg-red-400": isActive("/customers") })}>
                                            <span className={cn({ "text-white": isActive("/customers") })}>Customers</span>
                                        </Button>
                                    </Link>

                                </AccordionContent>

                            </AccordionItem>}
                            {(userData.role == 'Nirmaan Project Lead Profile' || userData.user_id == "Administrator" || userData.role == "Nirmaan Admin Profile") && <AccordionItem value="pl-actions">
                                <AccordionTrigger>
                                    <Button variant="ghost" size="sm" className="mb-2 px-2 text-xs w-full justify-start">
                                        <Shapes className="mr-2 h-4 w-4" />
                                        Procurement Actions
                                    </Button>
                                </AccordionTrigger>
                                <AccordionContent>
                                    <Link to="/prs&milestones">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleSetSidebarOpen(false)}
                                            disabled={isActive("/prs&milestones")}
                                            className={cn("w-full justify-start", { "bg-red-400": isActive("/prs&milestones") })}>
                                            <span className={cn({ "text-white": isActive("/prs&milestones") })}>PRs & Milestones</span>
                                        </Button>
                                    </Link>
                                    <Link to="/approve-new-pr">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleSetSidebarOpen(false)}
                                            disabled={isActive("/approve-new-pr")}
                                            className={cn("w-full justify-start", { "bg-red-400": isActive("/approve-new-pr") })}>
                                            <span className={cn({ "text-white": isActive("/approve-new-pr") })}>Approve PR</span>
                                        </Button>
                                    </Link>
                                    <Link to="/approve-po">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleSetSidebarOpen(false)}
                                            disabled={isActive("/approve-po")}
                                            className={cn("w-full justify-start", { "bg-red-400": isActive("/approve-po") })}>
                                            <span className={cn({ "text-white": isActive("/approve-po") })}>Approve PO</span>
                                        </Button>
                                    </Link>
                                    <Link to="/approve-sent-back">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleSetSidebarOpen(false)}
                                            disabled={isActive("/approve-sent-back")}
                                            className={cn("w-full justify-start", { "bg-red-400": isActive("/approve-sent-back") })}>
                                            <span className={cn({ "text-white": isActive("/approve-sent-back") })}>Approve Sent Back PO</span>
                                        </Button>
                                    </Link>
                                </AccordionContent>
                            </AccordionItem>}
                            {(userData.role == 'Nirmaan Procurement Executive Profile' || userData.user_id == "Administrator" || userData.role == "Nirmaan Admin Profile") && <AccordionItem value="pe-actions">
                                <AccordionTrigger>
                                    <Button variant="ghost" size="sm" className="mb-2 px-2 text-xs w-full justify-start">
                                        <Building2 className="mr-2 h-4 w-4" />
                                        Procurements
                                    </Button>
                                </AccordionTrigger>
                                <AccordionContent>
                                    <Link to="/new-procure-request">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleSetSidebarOpen(false)}
                                            disabled={isActive("/new-procure-request")}
                                            className={cn("w-full justify-start", { "bg-red-400": isActive("/new-procure-request") })}>
                                            <span className={cn({ "text-white": isActive("/new-procure-request") })}>New PR Request</span>
                                        </Button>
                                    </Link>
                                    <Link to="/update-quote">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleSetSidebarOpen(false)}
                                            disabled={isActive("/update-quote")}
                                            className={cn("w-full justify-start", { "bg-red-400": isActive("/update-quote") })}>
                                            <span className={cn({ "text-white": isActive("/update-quote") })}>Update Quote</span>
                                        </Button>
                                    </Link>
                                    <Link to="/choose-vendor">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleSetSidebarOpen(false)}
                                            disabled={isActive("/choose-vendor")}
                                            className={cn("w-full justify-start", { "bg-red-400": isActive("/choose-vendor") })}>
                                            <span className={cn({ "text-white": isActive("/choose-vendor") })}>Select Vendor</span>
                                        </Button>
                                    </Link>
                                    <Link to="/approved-po">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleSetSidebarOpen(false)}
                                            disabled={isActive("/approved-po")}
                                            className={cn("w-full justify-start", { "bg-red-400": isActive("/approved-po") })}>
                                            <span className={cn({ "text-white": isActive("/approved-po") })}>Release PO</span>
                                        </Button>
                                    </Link>
                                    <Separator className="m-4" />
                                    <Link to="/sent-back-request">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleSetSidebarOpen(false)}
                                            disabled={isActive("/sent-back-request")}
                                            className={cn("w-full justify-start", { "bg-red-400": isActive("/sent-back-request") })}>
                                            <span className={cn({ "text-white": isActive("/sent-back-request") })}>New Sent Back</span>
                                        </Button>
                                    </Link>
                                </AccordionContent>
                            </AccordionItem>}
                        </Accordion>
                    </div>
                </div>
            </div >

            {/* Backdrop for closing sidebar on mobile view */}
            {
                isSidebarOpen && (
                    <div
                        className="fixed inset-0 overflow-hidden bg-black opacity-50 z-30 md:hidden"
                        onClick={handleToggleSidebar}
                    ></div>
                )
            }
        </>
    );
}




// import { useState } from "react";
// import { Link, useLocation } from "react-router-dom";
// import { cn } from "@/lib/utils";
// import { Button } from "@/components/ui/button";
// import { useUserData } from "@/hooks/useUserData";
// import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";
// import { Separator } from "./ui/separator";
// import {
//     LayoutGrid,
//     Shapes,
//     Menu,
//     X,
// } from "lucide-react";

// interface SidebarProps {
//     className: string
// }

// export function Sidebar({ className }: SidebarProps) {
//     const [isSidebarOpen, setIsSidebarOpen] = useState(false);
//     const location = useLocation();
//     const userData = useUserData();

//     const toggleSidebar = () => {
//         setIsSidebarOpen(!isSidebarOpen);
//     };

//     const isActive = (path: string) => location.pathname === path;

//     return (
//         <>
//             <Button
//                 variant="secondary"
//                 size="sm"
//                 className="md:hidden p-2 fixed top-4 left-4 z-50"
//                 onClick={toggleSidebar}
//                 aria-label="Toggle Menu"
//             >
//                 {isSidebarOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
//             </Button>

//             <div
//                 className={cn(
//                     "pb-4 text-gray-500 transition-transform duration-300 ease-in-out",
//                     isSidebarOpen ? "translate-x-0 bg-white" : "-translate-x-full",
//                     "fixed md:relative md:translate-x-0 md:w-64 w-64 h-full z-40"
//                 )}
//             >
//                 <div className="space-y-4 py-2">
//                     <div className="px-2 py-2">
//                         <Link to="/">
//                             <Button
//                                 variant="ghost"
//                                 size="sm"
//                                 disabled={isActive("/")}
//                                 className={cn("px-2 text-xs w-full justify-start", { "bg-red-400": isActive("/") })}>
//                                 <LayoutGrid className="mr-2 h-4 w-4" />
//                                 Dashboard
//                             </Button>
//                         </Link>
//                     </div>
//                     <Separator />
//                     <Accordion type="single" collapsible>
//                         {(userData.user_id === "Administrator" || userData.role === "Nirmaan Admin Profile") && (
//                             <>
//                                 <AccordionItem value="productManagement">
//                                     <AccordionTrigger>
//                                         <Shapes className="mr-2 h-4 w-4" />
//                                         Product Management
//                                     </AccordionTrigger>
//                                     <AccordionContent>
//                                         <div className="space-y-1">
//                                             <Link to="/projects">
//                                                 <Button
//                                                     variant="ghost"
//                                                     size="sm"
//                                                     disabled={isActive("/products")}
//                                                     className={cn("w-full justify-start text-xs", { "bg-red-400": isActive("/products") })}>
//                                                     Product List
//                                                 </Button>
//                                             </Link>
//                                             <Link to="/products/add">
//                                                 <Button
//                                                     variant="ghost"
//                                                     size="sm"
//                                                     disabled={isActive("/products/add")}
//                                                     className={cn("w-full justify-start text-xs", { "bg-red-400": isActive("/products/add") })}>
//                                                     Add Product
//                                                 </Button>
//                                             </Link>
//                                         </div>
//                                     </AccordionContent>
//                                 </AccordionItem>
//                             </>
//                         )}
//                         {userData.role === "Nirmaan Procurement Executive Profile" && (
//                             <>
//                                 <AccordionItem value="orderManagement">
//                                     <AccordionTrigger>
//                                         <Shapes className="mr-2 h-4 w-4" />
//                                         Order Management
//                                     </AccordionTrigger>
//                                     <AccordionContent>
//                                         <div className="space-y-1">
//                                             <Link to="/orders">
//                                                 <Button
//                                                     variant="ghost"
//                                                     size="sm"
//                                                     disabled={isActive("/orders")}
//                                                     className={cn("w-full justify-start text-xs", { "bg-red-400": isActive("/orders") })}>
//                                                     Order List
//                                                 </Button>
//                                             </Link>
//                                             <Link to="/orders/add">
//                                                 <Button
//                                                     variant="ghost"
//                                                     size="sm"
//                                                     disabled={isActive("/orders/add")}
//                                                     className={cn("w-full justify-start text-xs", { "bg-red-400": isActive("/orders/add") })}>
//                                                     Add Order
//                                                 </Button>
//                                             </Link>
//                                         </div>
//                                     </AccordionContent>
//                                 </AccordionItem>
//                             </>
//                         )}
//                     </Accordion>
//                 </div>
//             </div>
//         </>
//     );
// }


// import { useState } from "react";
// import { Link, useLocation } from "react-router-dom";
// import { cn } from "@/lib/utils";
// import { Button } from "@/components/ui/button";
// import { useUserData } from "@/hooks/useUserData";
// import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";
// import { Separator } from "./ui/separator";
// import {
//     LayoutGrid,
//     Shapes,
//     Menu,
//     X,
// } from "lucide-react";

// interface SidebarProps {
//     className: string
// }

// export function Sidebar({ className }: SidebarProps) {
//     const [isSidebarOpen, setIsSidebarOpen] = useState(false);
//     const location = useLocation();
//     const userData = useUserData();

//     const toggleSidebar = () => {
//         setIsSidebarOpen(!isSidebarOpen);
//     };

//     const isActive = (path: string) => location.pathname === path;

//     return (
//         <>
//             <Button
//                 variant="secondary"
//                 size="sm"
//                 className="md:hidden p-2 fixed top-4 left-4 z-50"
//                 onClick={toggleSidebar}
//                 aria-label="Toggle Menu"
//             >
//                 {isSidebarOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
//             </Button>

//             <div
//                 className={cn(
//                     "pb-4 text-gray-500 transition-transform duration-300 ease-in-out",
//                     isSidebarOpen ? "translate-x-0 bg-white" : "-translate-x-full",
//                     "fixed md:relative md:translate-x-0 md:w-64 w-64 h-full z-40"
//                 )}
//             >
//                 <div className="space-y-4 py-2">
//                     <div className="px-2 py-2">
//                         <Link to="/">
//                             <Button
//                                 variant="ghost"
//                                 size="sm"
//                                 disabled={isActive("/")}
//                                 className={cn("px-2 text-xs w-full justify-start", { "bg-red-400": isActive("/") })}>
//                                 <LayoutGrid className="mr-2 h-4 w-4" />
//                                 Dashboard
//                             </Button>
//                         </Link>
//                     </div>
//                     <Separator />
//                     <Accordion type="single" collapsible>
//                         {(userData.user_id === "Administrator" || userData.role === "Nirmaan Admin Profile") && (
//                             <>
//                                 <AccordionItem value="productManagement">
//                                     <AccordionTrigger>
//                                         <Shapes className="mr-2 h-4 w-4" />
//                                         Product Management
//                                     </AccordionTrigger>
//                                     <AccordionContent>
//                                         <div className="space-y-1">
//                                             <Link to="/projects">
//                                                 <Button
//                                                     variant="ghost"
//                                                     size="sm"
//                                                     disabled={isActive("/products")}
//                                                     className={cn("w-full justify-start text-xs", { "bg-red-400": isActive("/products") })}>
//                                                     Product List
//                                                 </Button>
//                                             </Link>
//                                             <Link to="/products/add">
//                                                 <Button
//                                                     variant="ghost"
//                                                     size="sm"
//                                                     disabled={isActive("/products/add")}
//                                                     className={cn("w-full justify-start text-xs", { "bg-red-400": isActive("/products/add") })}>
//                                                     Add Product
//                                                 </Button>
//                                             </Link>
//                                         </div>
//                                     </AccordionContent>
//                                 </AccordionItem>
//                             </>
//                         )}
//                         {userData.role === "Nirmaan Procurement Executive Profile" && (
//                             <>
//                                 <AccordionItem value="orderManagement">
//                                     <AccordionTrigger>
//                                         <Shapes className="mr-2 h-4 w-4" />
//                                         Order Management
//                                     </AccordionTrigger>
//                                     <AccordionContent>
//                                         <div className="space-y-1">
//                                             <Link to="/orders">
//                                                 <Button
//                                                     variant="ghost"
//                                                     size="sm"
//                                                     disabled={isActive("/orders")}
//                                                     className={cn("w-full justify-start text-xs", { "bg-red-400": isActive("/orders") })}>
//                                                     Order List
//                                                 </Button>
//                                             </Link>
//                                             <Link to="/orders/add">
//                                                 <Button
//                                                     variant="ghost"
//                                                     size="sm"
//                                                     disabled={isActive("/orders/add")}
//                                                     className={cn("w-full justify-start text-xs", { "bg-red-400": isActive("/orders/add") })}>
//                                                     Add Order
//                                                 </Button>
//                                             </Link>
//                                         </div>
//                                     </AccordionContent>
//                                 </AccordionItem>
//                             </>
//                         )}
//                     </Accordion>
//                 </div>
//             </div>
//         </>
//     );
// }
