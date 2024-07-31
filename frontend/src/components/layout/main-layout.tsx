import Dashboard from "@/pages/dashboard";
import { NavBar } from "../nav/nav-bar";
import { Sidebar } from "../sidebar-nav";


export function MainLayout({ children }: any) {
    return (
        <div>
            {/* <Dashboard /> */}
            {/* <NavBar /> */}
            <div className="flex">
                <div className="rounded-lg m-1 p-1 ">
                    <Sidebar className="" />

                </div>
                <div className="flex-1 space-x-2 md:space-y-1 p-1 md:p-1 pt-1">
                    {children}
                </div>

            </div>

        </div>
    );
}