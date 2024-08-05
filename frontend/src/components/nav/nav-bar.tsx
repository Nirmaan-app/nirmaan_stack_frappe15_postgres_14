import { useState } from "react";
import { MainNav } from "./main-nav"
import { ModeToggle } from "./mode-toggle"
import { Notifications } from "./notifications"
import { UserNav } from "./user-nav"
import { Button } from "@/components/ui/button";
import {
    Menu,
    X,
} from "lucide-react";
import { Sidebar } from "../sidebar-nav";

export const NavBar = () => {

    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    const toggleSidebar = () => {
        setIsSidebarOpen(!isSidebarOpen);
    };
    return (
        <>
            {/* NAVBAR */}
            <div className="">
                <div className="border-b">
                    <div className="flex h-16 items-center px-2 md:px-4">
                      <div className="flex items-center justify-center">
                        <Button
                          variant="secondary"
                          size="sm"
                          className="md:hidden p-2 "
                          onClick={toggleSidebar}
                          aria-label="Toggle Menu"
                         >
                            {/* {isSidebarOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />} */}
                            <Menu className="h-6 w-6" />
                        </Button>
                        <MainNav className="mx-2 md:mx-6"/>
                      </div>
                        <div className="ml-auto flex items-center space-x-4">
                            <ModeToggle />
                            <Notifications />
                            <UserNav />
                        </div>
                    </div>
                </div>
            </div>

            {isSidebarOpen && <Sidebar setIsSidebarOpen={setIsSidebarOpen} isSidebarOpen={isSidebarOpen} className="" toggleSidebar={toggleSidebar} />}
        </>
    )

}
