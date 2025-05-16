import { Terminal } from "lucide-react"

import {
    Alert,
    AlertDescription,
    AlertTitle,
} from "@/components/ui/alert"

interface ErrorAlertProps {
    error?: any;
}

export function AlertDestructive({ error }: ErrorAlertProps) {
    return (
        <Alert variant="destructive">
            <Terminal className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>
                {error?.message || "An unknown error occurred."}
            </AlertDescription>
        </Alert>
    )
}
