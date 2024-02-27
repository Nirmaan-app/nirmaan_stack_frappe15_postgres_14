import { cn } from "@/lib/utils"
import { Link } from "react-router-dom"
import logo from "../../assets/logo-svg.svg"

export function MainNav({
    className,
    ...props
}: React.HTMLAttributes<HTMLElement>) {
    return (
        <nav
            className={cn("flex items-center space-x-4 lg:space-x-6", className)}
            {...props}
        >
            <Link
                to="/"
                className="text-sm font-medium transition-colors hover:text-primary"
            >
                <img className="col-span-2 max-h-12 w-full object-contain lg:col-span-1" src={logo} alt="" width="158" height="48" />
            </Link>

        </nav>
    )
}