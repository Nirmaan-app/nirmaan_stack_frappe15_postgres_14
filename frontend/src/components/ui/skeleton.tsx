import { cn } from "@/lib/utils"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./card"
import { Button } from "./button"
import { ArrowLeft, CirclePlus } from "lucide-react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table";

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
    <>
    <div className="flex items-center justify-between pt-8">
      <div className="flex gap-2 w-full">
        <Skeleton className="p-4 w-1/4" />
        <Skeleton className="p-4 w-[10%]" />
      </div>
      <Skeleton className="p-4 w-[10%]" />
    </div>
    <div className="space-y-4 mt-10 p-4 border rounded-md border-gray-200">
        {/* Skeleton for Table Header */}
        <div className="flex flex-col space-y-2">
          {/* Simulating multiple header rows */}
          {[...Array(1)].map((_, index) => (
            <div key={index} className="flex space-x-10">
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
        <div className="flex flex-col space-y-10">
          {/* Simulating multiple rows */}
          {[...Array(6)].map((_, rowIndex) => (
            <div key={rowIndex} className="flex space-x-10">
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
      </>
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
    <div className="min-h-screen p-12 pt-8 max-md:p-8 max-sm:p-4">
      <div className="mx-auto space-y-6 sm:space-y-8">
        {/* Header Section */}
        <div className="flex items-center justify-between">
          <Button variant="ghost" className="flex items-center gap-2">
            <ArrowLeft className="h-6 w-6" />
            <Skeleton className="h-6 w-32" />
          </Button>
        </div>

        {/* Card Section */}
        <Card>
          <CardHeader className="flex flex-row items-start justify-between">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              {/* Avatar */}
              <Skeleton className="h-20 w-20 rounded-full" />

              <div>
                <Skeleton className="h-6 w-48 mb-2" />
                <Skeleton className="h-4 w-32" />
              </div>
            </div>
            {/* Delete Button Placeholder */}
            <Skeleton className="h-10 w-32" />
          </CardHeader>

          <CardContent className="grid gap-4">
            {/* Info Section */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-48" />
              </div>
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-48" />
              </div>
              <div className="flex items-center gap-2 sm:col-span-2">
                <Skeleton className="h-4 w-96" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Assigned Projects Section */}
        <div>
          <div className="flex justify-between items-center mb-4">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-10 w-48" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Project Cards Skeleton */}
            {[...Array(3)].map((_, index) => (
              <Card key={index} className="flex flex-col">
                <CardHeader>
                  <Skeleton className="h-5 w-40 mb-2" />
                  <Skeleton className="h-4 w-24" />
                </CardHeader>
                <CardContent className="flex-grow">
                  <Skeleton className="h-4 w-56 mb-2" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};


export const OverviewSkeleton = () => {
  return (
    <div>
      <Card>
        <CardHeader>
          <CardTitle>
            <Skeleton className="h-6 w-32 bg-gray-300" />
          </CardTitle>
        </CardHeader>
        <CardContent className="flex max-lg:flex-col max-lg:gap-10">
                <div className="space-y-4 lg:w-[50%]">
                  <CardDescription className="space-y-2">
                    <Skeleton className="h-4 w-16 bg-gray-200" />
                    <Skeleton className="bg-gray-200 h-5 w-20" />
                  </CardDescription>

                  <CardDescription className="space-y-2">
                  <Skeleton className="bg-gray-200 h-4 w-16" />
                    <Skeleton className="bg-gray-200 h-5 w-32" />
                  </CardDescription>

                  <CardDescription className="space-y-2">
                  <Skeleton className="bg-gray-200 h-4 w-16" />
                    <Skeleton className="bg-gray-200 h-5 w-24" /> 
                  </CardDescription>

                  <CardDescription className="space-y-2">
                  <Skeleton className="bg-gray-200 h-4 w-16" />
                    <Skeleton className="bg-gray-200 h-5 w-40" /> 
                  </CardDescription>
                </div>

                <div className="space-y-4">
                  <CardDescription className="space-y-2">
                  <Skeleton className="bg-gray-200 h-4 w-16" />
                    <Skeleton className="bg-gray-200 h-5 w-64" /> 
                  </CardDescription>

                  <CardDescription className="space-y-2">
                  <Skeleton className="bg-gray-200 h-4 w-16" />
                    <Skeleton className="bg-gray-200 h-5 w-24" /> 
                  </CardDescription>

                  <CardDescription className="space-y-2">
                  <Skeleton className="bg-gray-200 h-4 w-16" />
                    <Skeleton className="bg-gray-200 h-5 w-24" /> 
                  </CardDescription>

                  <CardDescription className="space-y-2">
                  <Skeleton className="bg-gray-200 h-4 w-16" />
                    <Skeleton className="bg-gray-200 h-5 w-40" /> 
                  </CardDescription>
                </div>
        </CardContent>
      </Card>
    </div>
  );
};


export function OverviewSkeleton2() {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent className="flex flex-col gap-10 w-full">
          <div className="flex max-lg:flex-col max-lg:gap-10">
            {/* Left Column */}
            <div className="space-y-4 lg:w-[50%]">
              <CardDescription className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-6 w-48" />
              </CardDescription>

              <CardDescription className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-6 w-48" />
              </CardDescription>

              <CardDescription className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-6 w-48" />
              </CardDescription>

              <CardDescription className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-6 w-48" />
              </CardDescription>
            </div>

            {/* Right Column */}
            <div className="space-y-4">
              <CardDescription className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-6 w-48" />
              </CardDescription>

              <CardDescription className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-6 w-48" />
              </CardDescription>

              <CardDescription className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-6 w-48" />
              </CardDescription>

              <CardDescription className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-6 w-48" />
              </CardDescription>
            </div>
          </div>

          {/* Work Packages & Health Score */}
          <div className="space-y-4 w-full">
            <CardDescription className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <div className="flex gap-2 flex-wrap">
                <Skeleton className="h-6 w-24" />
                <Skeleton className="h-6 w-24" />
                <Skeleton className="h-6 w-24" />
              </div>
            </CardDescription>

            <CardDescription className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-6 w-full" />
            </CardDescription>
          </div>
        </CardContent>
      </Card>

      {/* Assignees */}
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex gap-2 flex-wrap">
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-8 w-40" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export const ProcurementRequestsSkeleton = () => {
  return (
    <div className="flex-1 md:space-y-4">
      {/* Header Section */}
      <div className="flex items-center pt-1 pb-4">
        <ArrowLeft className="cursor-pointer" />
        <Skeleton className="h-6 w-48 ml-2" />
      </div>

      {/* Project Select and Table Skeleton */}
      <div className="gap-4 border border-gray-200 rounded-lg p-0.5">
        {/* ProjectSelect Skeleton */}
        <Skeleton className="h-10 w-full mb-4" />

        {/* Created By User Section */}
        <div className="mx-0 px-0 pt-4">
          <Skeleton className="h-6 w-48 mb-2" />

          <Table>
            <TableHeader className="bg-red-100">
              <TableRow>
                <TableHead className="w-[30%] text-center">
                  <Skeleton className="h-4 w-full" />
                </TableHead>
                <TableHead className="w-[35%] text-center">
                  <Skeleton className="h-4 w-full" />
                </TableHead>
                <TableHead className="w-[35%] text-center">
                  <Skeleton className="h-4 w-full" />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...Array(3)].map((_, index) => (
                <TableRow key={index}>
                  <TableCell className="text-sm text-center">
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                  <TableCell className="text-sm text-center">
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                  <TableCell className="text-sm text-center">
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Created By Others Section */}
        <div className="mx-0 px-0 pt-4">
          <Skeleton className="h-6 w-48 mb-2" />

          <Table>
            <TableHeader className="bg-red-100">
              <TableRow>
                <TableHead className="w-[30%] text-center">
                  <Skeleton className="h-4 w-full" />
                </TableHead>
                <TableHead className="w-[35%] text-center">
                  <Skeleton className="h-4 w-full" />
                </TableHead>
                <TableHead className="w-[35%] text-center">
                  <Skeleton className="h-4 w-full" />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...Array(3)].map((_, index) => (
                <TableRow key={index}>
                  <TableCell className="text-sm text-center">
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                  <TableCell className="text-sm text-center">
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                  <TableCell className="text-sm text-center">
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Create New PR Button Skeleton */}
        <div className="flex flex-col justify-end items-end fixed bottom-4 right-4">
          <Button className="font-normal py-2 px-6">
            <div className="flex items-center">
              <CirclePlus className="w-5 h-5 mt- pr-1" />
              <Skeleton className="h-5 w-32" />
            </div>
          </Button>
        </div>
      </div>

      <div className="pt-10"></div>
    </div>
  );
};

export const PRSummarySkeleton = () => {
  return (
    <div className="flex-1 md:space-y-4">
  <div className="flex items-center pt-1">
    <Skeleton className="w-6 h-6 mb-3" /> {/* For ArrowLeft */}
    <Skeleton className="h-6 w-1/3 ml-2" /> {/* For Summary */}
    <Skeleton className="h-6 w-1/4 ml-2" /> {/* For PR Number */}
  </div>
  
  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
    {/* PR Details Card Skeleton */}
    <Card className="w-full">
      <CardHeader>
        <Skeleton className="h-6 w-1/4" /> {/* PR Details Title */}
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1">
          <Skeleton className="h-4 w-1/3" /> {/* Label */}
          <Skeleton className="h-4 w-2/3" /> {/* Project Name */}
        </div>
        <div className="space-y-1">
          <Skeleton className="h-4 w-1/3" /> {/* Label */}
          <Skeleton className="h-4 w-2/3" /> {/* Package */}
        </div>
        <div className="space-y-1">
          <Skeleton className="h-4 w-1/3" /> {/* Label */}
          <Skeleton className="h-4 w-2/3" /> {/* Date Created */}
        </div>
      </CardContent>
    </Card>

    {/* Order Details Card Skeleton */}
    <Card className="w-full">
      <CardHeader>
        <Skeleton className="h-6 w-1/4" /> {/* Order Details Title */}
      </CardHeader>
      <div className="overflow-x-auto">
        <div className="min-w-full inline-block align-middle">
          {/* Categories */}
          <div className="p-5">
            <Skeleton className="h-5 w-1/3 mb-4" /> {/* Category Name */}
            <Table>
              <TableHeader>
                <TableRow className="bg-red-100">
                  <TableHead>
                    <Skeleton className="h-4 w-full" /> {/* Table Head */}
                  </TableHead>
                  <TableHead>
                    <Skeleton className="h-4 w-full" /> {/* Table Head */}
                  </TableHead>
                  <TableHead>
                    <Skeleton className="h-4 w-full" /> {/* Table Head */}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...Array(7)].map((_, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Skeleton className="h-4 w-full" /> {/* Item */}
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-full" /> {/* UOM */}
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-full" /> {/* Qty */}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </Card>
  </div>
</div>

  )
}


export const NewPRSkeleton = () => {
  return (
    <div className="flex-1 md:space-y-4">
       <div className="flex items-center pt-1">
        <Skeleton className="w-6 h-6" />
        <Skeleton className="h-6 w-1/3 ml-2" />
      </div>
  
      <div className="flex gap-4">
      {[...Array(5)].map((_, i) => (
        <div className="flex flex-col gap-4 p-4 border border-gray-300 rounded-xl">
          <Skeleton className="w-28 h-32" />
          <Skeleton className="w-28 h-4" />
        </div>
      ))}
      </div>
    </div>
  )
}



export { Skeleton }
