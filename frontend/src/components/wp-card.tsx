//import React, {useState, useEffect} from "react"

import { useFrappeGetDocList } from "frappe-react-sdk"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"
import { PersonStanding } from "lucide-react"
import { SOWCard } from "./sow-card"

interface WPCardProps {
    wp: string
}

interface ScopesOfWork {
    name: string
    scope_of_work_name: string
}


export const WPCard: React.FC<WPCardProps> = ({ wp }) => {

    const { data: data, isLoading: isLoading, error: error } = useFrappeGetDocList<ScopesOfWork>("Scopes of Work", {
        fields: ["name", "scope_of_work_name"],
        filters: [["work_package", "=", wp]]
    })

    return (
        <Card className="hover:animate-shadow-drop-center" >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                    {wp}
                </CardTitle>
                <PersonStanding className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                <div>
                    {(isLoading) && (<p>Loading</p>)}
                    {error && <p>Error</p>}
                    {(data || []).map(d =>
                        <div>
                            <SOWCard sow_id={d.name} sow_name={d.scope_of_work_name} />
                        </div>
                    )}
                </div>
                {/* <p className="text-xs text-muted-foreground">COUNT</p> */}
            </CardContent>
        </Card>

    )
}