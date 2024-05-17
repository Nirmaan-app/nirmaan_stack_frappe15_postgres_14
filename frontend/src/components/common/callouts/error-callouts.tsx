import { PropsWithChildren } from "react"
import { TriangleAlert } from 'lucide-react';
import { CustomCallout } from "./custom-callout"


export const ErrorCallout = ({ children, ...props }: PropsWithChildren<{ message?: string }>) => {
    return (<CustomCallout
        rootProps={{ color: "red" }}
        iconChildren={<TriangleAlert size={18} />}
        textChildren={children || props.message || "An error occurred"}
    />)
}