import React, { useState } from "react";
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

export function Sidebar({ className }) {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const location = useLocation()
    const userData = useUserData()

    const toggleSidebar = () => {
        setIsSidebarOpen(!isSidebarOpen);
    };

    const isActive = (path) => location.pathname === path;

    return (
        <>
            <Button
                variant="secondary"
                size="sm"
                className="md:hidden p-2 fixed top-4 left-4 z-50"
                onClick={toggleSidebar}
                aria-label="Toggle Menu"
            >
                {isSidebarOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </Button>

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
                                className={cn("px-2 text-xs w-full justify-start", { "bg-red-200": isActive("/") })}>
                                <LayoutGrid className="mr-2 h-4 w-4" />
                                Dashboard
                            </Button>
                        </Link>
                        <Accordion type="multiple" >
                            {userData.user_id == "Administrator" && <AccordionItem value="admin-actions">
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
                                            className={cn("w-full justify-start", { "bg-red-200": isActive("/projects") })}>
                                            Projects
                                        </Button>
                                        <Button variant="ghost" size="sm" className="w-full justify-start">
                                            Users
                                        </Button>
                                        <Button variant="ghost" size="sm" className="w-full justify-start">
                                            Work Packages
                                        </Button>
                                    </Link>
                                </AccordionContent>

                            </AccordionItem>}
                            {(userData.role == 'Nirmaan Project Lead Profile' || userData.user_id == "Administrator") && <AccordionItem value="pl-actions">
                                <AccordionTrigger>
                                    <Button variant="ghost" size="sm" className="mb-2 px-2 text-xs w-full justify-start">
                                        <Shapes className="mr-2 h-4 w-4" />
                                        Procurement Actions
                                    </Button>
                                </AccordionTrigger>
                                <AccordionContent>
                                    <Link to="/approve-order">
                                        <Button variant="ghost" size="sm" className={cn("w-full justify-start", { "bg-red-200": isActive("/approve-order") })}>
                                            Approve PR
                                        </Button>
                                    </Link>
                                    <Link to="/approve-vendor">
                                        <Button variant="ghost" size="sm" className={cn("w-full justify-start", { "bg-red-200": isActive("/approve-vendor") })}>
                                            Approve Vendor
                                        </Button>
                                    </Link>
                                    <Link to="/approve-sent-back">
                                        <Button variant="ghost" size="sm" className={cn("w-full justify-start", { "bg-red-200": isActive("/approve-sent-back") })}>
                                            Approve Sent Back
                                        </Button>
                                    </Link>
                                </AccordionContent>
                            </AccordionItem>}
                            {(userData.role == 'Nirmaan Procurement Executive Profile' || userData.user_id == "Administrator") && <AccordionItem value="item-2">
                                <AccordionTrigger>
                                    <Button variant="ghost" size="sm" className="mb-2 px-2 text-xs w-full justify-start">
                                        <Building2 className="mr-2 h-4 w-4" />
                                        Procurements
                                    </Button>
                                </AccordionTrigger>
                                <AccordionContent>
                                    <Link to="/procure-request">
                                        <Button variant="ghost" size="sm" className={cn("w-full justify-start", { "bg-red-200": isActive("/procure-request") })}>
                                            New
                                        </Button>
                                    </Link>
                                    <Link to="/update-quote">
                                        <Button variant="ghost" size="sm" className={cn("w-full justify-start", { "bg-red-200": isActive("/update-quote") })}>
                                            Update Quote
                                        </Button>
                                    </Link>
                                    <Link to="/select-vendor-list">
                                    <Button variant="ghost" size="sm" className={cn("w-full justify-start", { "bg-red-200": isActive("/select-vendor-list") })}>
                                        Select Vendor
                                    </Button>
                                    </Link>
                                    <Link to="/release-po">
                                    <Button variant="ghost" size="sm" className={cn("w-full justify-start", { "bg-red-200": isActive("/release-po") })}>
                                        Release PO
                                    </Button>
                                    </Link>
                                    <Button variant="ghost" size="sm" className="w-full justify-start">
                                        Advance Payment
                                    </Button>
                                    <Button variant="ghost" size="sm" className="w-full justify-start">
                                        Track Delivery
                                    </Button>
                                    <Button variant="ghost" size="sm" className="w-full justify-start">
                                        Order Delivered
                                    </Button>
                                </AccordionContent>
                            </AccordionItem>}
                        </Accordion>
                    </div>
                </div>
            </div>

            {/* Backdrop for closing sidebar on mobile view */}
            {isSidebarOpen && (
                <div
                    className="fixed inset-0 bg-black opacity-50 z-30 md:hidden"
                    onClick={toggleSidebar}
                ></div>
            )}
        </>
    );
}
