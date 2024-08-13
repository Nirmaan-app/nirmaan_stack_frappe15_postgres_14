import { Outlet } from 'react-router-dom';
import { Sidebar } from "../sidebar-nav";
import { NavBar } from '../nav/nav-bar';

export const MainLayout = () => {

    return (
        <div className="">
            <NavBar />
            <div className="flex pt-16">
                <Sidebar  className="w-64" />
                    <main className="flex-1 md:ml-64">
                        <Outlet />
                    </main>
            </div>
        </div>
    );
};
