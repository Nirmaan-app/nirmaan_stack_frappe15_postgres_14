import { cn } from "@/lib/utils"
import { Link } from "react-router-dom"
import logo from "../../assets/logo-svg.svg"

export function MainNav({
    className,
    ...props
}: React.HTMLAttributes<HTMLElement>) {
    return (
        <nav
            className={cn(className)}
            {...props}
        >
            <Link
                to="/"
            >
                <img src={logo} alt="Nirmaan" width="158" height="48" />
            </Link>

        </nav>
    )
}