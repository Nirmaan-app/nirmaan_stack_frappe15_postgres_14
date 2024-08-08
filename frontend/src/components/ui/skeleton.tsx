import { cn } from "@/lib/utils"

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

export { Skeleton }
