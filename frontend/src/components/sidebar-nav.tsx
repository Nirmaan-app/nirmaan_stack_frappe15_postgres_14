import { useState } from "react";
import {
    Building2,
    LayoutGrid,
    Shapes,
    Menu,
    X,
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useUserData } from "@/hooks/useUserData";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";
import { Separator } from "./ui/separator";

interface SidebarProps {
    className: string
}

export function Sidebar({ className }: SidebarProps) {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const location = useLocation()
    const userData = useUserData()

    const toggleSidebar = () => {
        setIsSidebarOpen(!isSidebarOpen);
    };

    const isActive = (path: string) => location.pathname === path;

    return (
        <>
            {/* <Button
                variant="secondary"
                size="sm"
                className="md:hidden p-2 fixed top-4 left-4 z-50"
                onClick={toggleSidebar}
                aria-label="Toggle Menu"
            >
                {isSidebarOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </Button> */}

            <div
                className={cn(
                    "pb-4 text-gray-500 transition-transform duration-300 ease-in-out",
                    isSidebarOpen ? "translate-x-0 bg-white" : "-translate-x-full",
                    "fixed md:relative md:translate-x-0 md:w-64 w-64 h-full z-40"
                )}
            >
                <div className="space-y-4 py-2">
                    <div className="px-2 py-2">
                        <Link to="/">
                            <Button
                                variant="ghost"
                                size="sm"
                                disabled={isActive("/")}
                                className={cn("px-2 text-xs w-full justify-start", { "bg-red-400": isActive("/") })}>
                                <LayoutGrid className="mr-2 h-4 w-4" />
                                <span className={cn({ "text-white": isActive("/") })}>Dashboard</span>
                            </Button>
                        </Link>
                        <Accordion type="multiple" defaultValue={["admin-actions", "pl-actions", "pe-actions"]} >
                            {(userData.user_id == "Administrator" || userData.role == "Nirmaan Admin Profile") && <AccordionItem value="admin-actions">
                                <AccordionTrigger>
                                    <Button variant="ghost" size="sm" className="mb-2 px-2 text-xs w-full justify-start">
                                        <Shapes className="mr-2 h-4 w-4" />
                                        Admin Options
                                    </Button>
                                </AccordionTrigger>
                                <AccordionContent>
                                    <Link to="/projects">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            disabled={isActive("/projects")}
                                            className={cn("w-full justify-start", { "bg-red-400": isActive("/projects") })}>
                                            <span className={cn({ "text-white": isActive("/projects") })}>Projects</span>
                                        </Button>
                                    </Link>
                                    <Link to="/users">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            disabled={isActive("/users")}
                                            className={cn("w-full justify-start", { "bg-red-400": isActive("/users") })}>
                                            <span className={cn({ "text-white": isActive("/users") })}>Users</span>
                                        </Button>
                                    </Link>
                                    <Link to="/wp">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            disabled={isActive("/wp")}
                                            className={cn("w-full justify-start", { "bg-red-400": isActive("/wp") })}>
                                            <span className={cn({ "text-white": isActive("/wp") })}>Work Packages</span>
                                        </Button>
                                    </Link>
                                    {/* <Button variant="ghost" size="sm" className="w-full justify-start">
                                        Procurement Requests
                                    </Button> */}
                                    <Link to="/items">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            disabled={isActive("/items")}
                                            className={cn("w-full justify-start", { "bg-red-400": isActive("/items") })}>
                                            <span className={cn({ "text-white": isActive("/items") })}>Items</span>
                                        </Button>
                                    </Link>
                                    <Link to="/vendors">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            disabled={isActive("/vendors")}
                                            className={cn("w-full justify-start", { "bg-red-400": isActive("/vendors") })}>
                                            <span className={cn({ "text-white": isActive("/vendors") })}>Vendors</span>
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
                                    <Link to="/approve-order">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            disabled={isActive("/approve-order")}
                                            className={cn("w-full justify-start", { "bg-red-400": isActive("/approve-order") })}>
                                            <span className={cn({ "text-white": isActive("/approve-order") })}>Approve PR</span>
                                        </Button>
                                    </Link>
                                    <Link to="/approve-vendor">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            disabled={isActive("/approve-vendor")}
                                            className={cn("w-full justify-start", { "bg-red-400": isActive("/approve-vendor") })}>
                                            <span className={cn({ "text-white": isActive("/approve-vendor") })}>Approve Vendor</span>
                                        </Button>
                                    </Link>
                                    <Link to="/approve-sent-back">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            disabled={isActive("/approve-sent-back")}
                                            className={cn("w-full justify-start", { "bg-red-400": isActive("/approve-sent-back") })}>
                                            <span className={cn({ "text-white": isActive("/approve-sent-back") })}>Approve Sent Back</span>
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
                                    <Link to="/procure-request">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            disabled={isActive("/procure-request")}
                                            className={cn("w-full justify-start", { "bg-red-400": isActive("/procure-request") })}>
                                            <span className={cn({ "text-white": isActive("/procure-request") })}>New PR Request</span>
                                        </Button>
                                    </Link>
                                    <Link to="/update-quote">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            disabled={isActive("/update-quote")}
                                            className={cn("w-full justify-start", { "bg-red-400": isActive("/update-quote") })}>
                                            <span className={cn({ "text-white": isActive("/update-quote") })}>Update Quote</span>
                                        </Button>
                                    </Link>
                                    <Link to="/select-vendor-list">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            disabled={isActive("/select-vendor-list")}
                                            className={cn("w-full justify-start", { "bg-red-400": isActive("/select-vendor-list") })}>
                                            <span className={cn({ "text-white": isActive("/select-vendor-list") })}>Select Vendor</span>
                                        </Button>
                                    </Link>
                                    <Link to="/release-po">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            disabled={isActive("/release-po")}
                                            className={cn("w-full justify-start", { "bg-red-400": isActive("/release-po") })}>
                                            <span className={cn({ "text-white": isActive("/release-po") })}>Release PO</span>
                                        </Button>
                                    </Link>
                                    {/* <Button variant="ghost" size="sm" className="w-full justify-start">
                                        Advance Payment
                                    </Button> */}
                                    {/* <Button variant="ghost" size="sm" className="w-full justify-start">
                                        Track Delivery
                                    </Button> */}
                                    {/* <Button variant="ghost" size="sm" className="w-full justify-start">
                                        Order Delivered
                                    </Button> */}
                                    <Separator className="m-4" />
                                    <Link to="/sent-back-request">
                                        <Button
                                            variant="ghost"
                                            size="sm"
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
                        className="fixed inset-0 bg-black opacity-50 z-30 md:hidden"
                        onClick={toggleSidebar}
                    ></div>
                )
            }
        </>
    );
}
