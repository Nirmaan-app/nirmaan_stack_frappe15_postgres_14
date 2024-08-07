


import { Outlet } from 'react-router-dom';
import { Sidebar } from "../sidebar-nav";

import { NavBar } from '../nav/nav-bar';

export const MainLayout = () => {

    return (
        <div className="">
            <NavBar />
            <div className="flex">
                <Sidebar  className="w-64" />
                <div className="flex-1">
                    <main className="">
                        
                        <Outlet />

                    </main>
                </div>
            </div>
        </div>
    );
};
