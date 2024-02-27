import { MainNav } from "./main-nav"
import { ModeToggle } from "./mode-toggle"
import { UserNav } from "./user-nav"

export const NavBar = () => {
    return (
        <>
            {/* NAVBAR */}
            <div className="hidden flex-col md:flex">
                <div className="border-b">
                    <div className="flex h-16 items-center px-4">
                        <MainNav className="mx-6" />
                        <div className="ml-auto flex items-center space-x-4">
                            <ModeToggle />
                            <UserNav />
                        </div>
                    </div>
                </div>
            </div>
            {/* END_NAVBAR */}
        </>
    )

}