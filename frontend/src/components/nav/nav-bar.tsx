import { MainNav } from "./main-nav"
import { ModeToggle } from "./mode-toggle"
import { Notifications } from "./notifications"
import { UserNav } from "./user-nav"

export const NavBar = () => {
    return (
        <>
            {/* NAVBAR */}
            <div className="">
                <div className="border-b">
                    <div className="flex h-16 items-center px-2 md:px-4">
                        <MainNav className="mx-2 md:mx-6"/>
                        <div className="ml-auto flex items-center space-x-4">
                            <ModeToggle />
                            <Notifications />
                            <UserNav />
                        </div>
                    </div>
                </div>
            </div>
            {/* END_NAVBAR */}
        </>
    )

}