import { cn } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle } from "./card"

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export const TableSkeleton = () => {
  return  (
    <div className="space-y-4 mt-10 p-4 border rounded-md border-gray-200">
        {/* Skeleton for Table Header */}
        <div className="flex flex-col space-y-2">
          {/* Simulating multiple header rows */}
          {[...Array(1)].map((_, index) => (
            <div key={index} className="flex space-x-4">
              {[...Array(4)].map((_, cellIndex) => (
                <Skeleton
                  key={cellIndex}
                  className="w-1/4 h-8 rounded-md"
                />
              ))}
            </div>
          ))}
        </div>

        {/* Skeleton for Table Body */}
        <div className="flex flex-col space-y-2">
          {/* Simulating multiple rows */}
          {[...Array(2)].map((_, rowIndex) => (
            <div key={rowIndex} className="flex space-x-4">
              {[...Array(4)].map((_, cellIndex) => (
                <Skeleton
                  key={cellIndex}
                  className="w-1/4 h-12 rounded-md"
                />
              ))}
            </div>
          ))}
        </div>
      </div>
  )
}


export const WPSkeleton = () => {
  return (
    <div className="p-4 border rounded-md bg-white shadow-md">
      <div className="flex flex-row items-center justify-between space-y-0 pb-2">
        <Skeleton className="w-1/3 h-4 rounded-md" />
        <div className="flex items-center space-x-2">
          <Skeleton className="w-8 h-8 rounded-full" />
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <div className="flex flex-row items-center justify-between space-y-0 pb-2">
        <Skeleton className="w-2/3 h-20 rounded-md" />
        <div className="flex items-center space-x-2">
          <Skeleton className="w-8 h-8 rounded-full" />
        </div>
      </div>
      <div className="flex flex-row items-center justify-between space-y-0 pb-2">
        <Skeleton className="w-2/3 h-20 rounded-md" />
        <div className="flex items-center space-x-2">
          <Skeleton className="w-8 h-8 rounded-full" />
        </div>
      </div>
      </div>
    </div>
  )
}


export const ProjectSkeleton = () => {
  return (
    <div className="p-4 space-y-4">
      {/* Header Section Skeleton */}
      <div className="flex items-center justify-between space-y-2">
        <div className="flex items-center space-x-2">
          <Skeleton className="h-6 w-6 rounded-full" />
          <Skeleton className="h-8 w-1/3 rounded-md" />
        </div>
        <div className="flex space-x-2">
          <Skeleton className="h-10 px-4 rounded-md" />
          <Skeleton className="h-10 px-4 rounded-md" />
          <Skeleton className="h-10 w-24 rounded-md" />
        </div>
      </div>
      
      {/* Grid Skeleton */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2">
        {/* Project Details Card Skeleton */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <Skeleton className="h-8 w-1/2 rounded-md" />
            <Skeleton className="h-6 w-6 rounded-full" />
          </CardHeader>
          <CardContent>
            <Card>
              <CardContent>
                <div className="flex flex-row">
                  <div className="basis-1/2 flex flex-col space-y-4">
                    {[...Array(3)].map((_, index) => (
                      <div key={index} className="flex flex-col pt-2 pb-2">
                        <Skeleton className="h-4 w-2/3 rounded-md" />
                        <Skeleton className="h-6 w-full rounded-md" />
                      </div>
                    ))}
                  </div>
                  <div className="basis-1/2 flex flex-col space-y-4">
                    {[...Array(3)].map((_, index) => (
                      <div key={index} className="flex flex-col pt-2 pb-2">
                        <Skeleton className="h-4 w-2/3 rounded-md" />
                        <Skeleton className="h-6 w-full rounded-md" />
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </CardContent>
        </Card>
      
        {/* Work Package Card Skeleton */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <Skeleton className="h-8 w-1/2 rounded-md" />
            <Skeleton className="h-6 w-6 rounded-full" />
          </CardHeader>
          <CardContent>
            {[...Array(3)].map((_, index) => (
              <Skeleton key={index} className="h-8 w-2/3 mb-2 rounded-md" />
            ))}
          </CardContent>
        </Card>
      
        {/* Status Card Skeleton */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <Skeleton className="h-8 w-1/2 rounded-md" />
            <Skeleton className="h-6 w-6 rounded-full" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-6 w-3/4 rounded-md" />
            <Skeleton className="h-4 w-1/2 rounded-md" />
          </CardContent>
        </Card>
      
        {/* Health Score Card Skeleton */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <Skeleton className="h-8 w-1/2 rounded-md" />
            <Skeleton className="h-6 w-6 rounded-full" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-6 w-3/4 rounded-md" />
            <Skeleton className="h-4 w-1/2 rounded-md" />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}


export const UserProfileSkeleton = () => {
  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      {/* Header Section Skeleton */}
      <div className="flex items-center justify-between mb-2 space-y-2">
        <div className="flex">
          <Skeleton className="h-6 w-6 rounded-full" />
          <Skeleton className="h-8 w-1/2 md:w-1/3 rounded-md ml-2" />
        </div>
        <div className="flex items-center space-x-2">
          <Skeleton className="h-10 px-4 rounded-md" />
        </div>
      </div>

      {/* Grid Section Skeleton */}
      <div className="grid gap-4 md:grid-cols-5 lg:grid-cols-5">
        {/* User Avatar and Basic Info Card Skeleton */}
        <Card className="md:col-span-2 hover:animate-shadow-drop-center">
          <CardContent className="p-6">
            <div className="max-w-md mx-auto bg-white rounded-xl shadow-md overflow-hidden">
              <div className="flex items-center justify-center mt-6">
                <Skeleton className="h-24 w-24 rounded-full bg-gray-300" />
              </div>
              <div className="text-center px-4 py-6">
                <Skeleton className="h-6 w-3/4 mx-auto bg-gray-300" />
                <Skeleton className="h-4 w-1/2 mx-auto bg-gray-300 mt-2" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* User Details Card Skeleton */}
        <Card className="md:col-span-3 hover:animate-shadow-drop-center">
          <CardContent className="p-6">
            <div className="border-b border-gray-300 mb-4 pb-2">
              <Skeleton className="h-8 w-1/3 bg-gray-300 mb-4" />
              <div className="grid grid-cols-2 gap-x-4">
                {[...Array(5)].map((_, index) => (
                  <div key={index} className="flex justify-between py-2">
                    <Skeleton className="h-4 w-1/2 bg-gray-300" />
                    <Skeleton className="h-4 w-1/2 bg-gray-300" />
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Assigned Projects Card Skeleton */}
        <Card className="md:col-span-2 hover:animate-shadow-drop-center">
          <CardContent className="p-6">
            <CardTitle className="text-lg font-bold pl-2">
              <Skeleton className="h-6 w-1/2 bg-gray-300" />
            </CardTitle>
            <div className="mt-6">
              <Skeleton className="h-6 w-full bg-gray-300 mb-4" />
              <table className="min-w-full divide-y divide-gray-200 mt-6">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <Skeleton className="h-4 w-2/3 bg-gray-300" />
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <Skeleton className="h-4 w-2/3 bg-gray-300" />
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {[...Array(5)].map((_, index) => (
                    <tr key={index}>
                      <td className="px-6 py-4">
                        <Skeleton className="h-4 w-3/4 bg-gray-300" />
                      </td>
                      <td className="px-6 py-4">
                        <Skeleton className="h-4 w-3/4 bg-gray-300" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export { Skeleton }
