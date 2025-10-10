// import type React from 'react'
// import { Check } from 'lucide-react'
// import { cn } from '@/lib/utils'

// function clamp(input: number, a: number, b: number): number {
//   return Math.max(Math.min(input, Math.max(a, b)), Math.min(a, b))
// }

// // NOTE: We now define the SVG internal dimensions logically, 
// // and let the CSS class (className) control the physical size.
// const SVG_DIMENSION = 24 // Base logical size for viewBox
// const strokeWidth = 2
// const total = 100

// export interface ProgressCircleProps extends React.ComponentProps<'svg'> {
//   value: number
//   className?: string
//   color?: string
//   // New: You might want to pass text size if the component scales a lot
//   textSizeClassName?: string 
// }

// export const ProgressCircle = ({ 
//     value, 
//     className, 
//     color, 
//     textSizeClassName = 'text-xs', // Default to 'text-xs'
//     ...restSvgProps 
// }: ProgressCircleProps) => {
//   const normalizedValue = clamp(value, 0, total)
//   const isComplete = normalizedValue === total

//   // The radius calculation now uses the logical SVG_DIMENSION
//   const radius = (SVG_DIMENSION - strokeWidth) / 2
//   const circumference = 2 * Math.PI * radius
//   const progress = (normalizedValue / total) * circumference
//   const halfSize = SVG_DIMENSION / 2

//   const commonParams = {
//     cx: halfSize,
//     cy: halfSize,
//     r: radius,
//     fill: 'none',
//     strokeWidth,
//   }

//   // Determine the primary color.
//   const primaryColorClass = color ? `text-[${color}]` : 'text-primary'
//   const completeColorClass = 'text-green-500' 

//   return (
//     // **KEY CHANGE: The size is determined by className (e.g., 'size-10')**
//     // We removed the 'size-6' conditional check.
//     <div
//       className={cn(
//         'relative inline-flex items-center justify-center', 
//         'size-6', // Set a reasonable default size if className doesn't override it
//         className // Allows external classes like 'size-10' to override 'size-6'
//       )}
//     >
//       {/* 1. The original SVG component */}
//       <svg
//         role="progressbar"
//         // Uses the logical dimension for the viewBox
//         viewBox={`0 0 ${SVG_DIMENSION} ${SVG_DIMENSION}`}
//         // The SVG is set to 100% width/height of its parent div container
//         className={cn('h-full w-full flex-shrink-0', primaryColorClass)}
//         aria-valuenow={normalizedValue}
//         aria-valuemin={0}
//         aria-valuemax={100}
//         {...restSvgProps}
//       >
//         {/* ... circle definitions remain the same ... */}
//         <circle {...commonParams} className="stroke-current/25" />
//         <circle
//           {...commonParams}
//           stroke="currentColor"
//           strokeDasharray={circumference}
//           strokeDashoffset={circumference - progress}
//           strokeLinecap="round"
//           transform={`rotate(-90 ${halfSize} ${halfSize})`}
//           className="stroke-current"
//         />
//       </svg>

//       {/* 2. Text or Checkmark positioned absolutely in the center */}
//       <div
//         className={cn(
//           'absolute inset-0 flex items-center justify-center font-semibold',
//           textSizeClassName, // Now customizable based on prop
//           {
//             [primaryColorClass]: !isComplete,
//             [completeColorClass]: isComplete,
//           }
//         )}
//       >
//         {isComplete ? (
//           // Scale the Check icon relative to the new size
//           <Check className="h-1/2 w-1/2 stroke-current" /> 
//         ) : (
//           <span className="leading-none">{Math.round(normalizedValue)}%</span>
//         )}
//       </div>
//     </div>
//   )
// }

import type React from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

function clamp(input: number, a: number, b: number): number {
  return Math.max(Math.min(input, Math.max(a, b)), Math.min(a, b))
}

const SVG_DIMENSION = 24
const strokeWidth = 2
const total = 100

export interface ProgressCircleProps extends React.ComponentProps<'svg'> {
  value: number
  className?: string
  textSizeClassName?: string
}

export const ProgressCircle = ({ 
    value, 
    className, 
    textSizeClassName = 'text-xs',
    ...restSvgProps 
}: ProgressCircleProps) => {
  const normalizedValue = clamp(value, 0, total)
  const isComplete = normalizedValue === total

  const radius = (SVG_DIMENSION - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const progress = (normalizedValue / total) * circumference
  const halfSize = SVG_DIMENSION / 2

  const commonParams = {
    cx: halfSize,
    cy: halfSize,
    r: radius,
    fill: 'none',
    strokeWidth,
  }

  return (
    <div
      className={cn(
        'relative inline-flex items-center justify-center', 
        'size-6', // Default size
        className // This should include both size AND color classes
      )}
    >
      {/* SVG inherits text color from parent div via className */}
      <svg
        role="progressbar"
        viewBox={`0 0 ${SVG_DIMENSION} ${SVG_DIMENSION}`}
        className="h-full w-full flex-shrink-0"
        aria-valuenow={normalizedValue}
        aria-valuemin={0}
        aria-valuemax={100}
        {...restSvgProps}
      >
        {/* Background circle with opacity */}
        <circle 
          {...commonParams} 
          className="stroke-current opacity-25" 
        />
        {/* Progress circle */}
        <circle
          {...commonParams}
          stroke="currentColor"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - progress}
          strokeLinecap="round"
          transform={`rotate(-90 ${halfSize} ${halfSize})`}
          className="stroke-current"
        />
      </svg>

      {/* Text or Checkmark */}
      <div
        className={cn(
          'absolute inset-0 flex items-center justify-center font-semibold',
          textSizeClassName,
          // Complete state overrides with green
          isComplete && 'text-green-500'
        )}
      >
        {isComplete ? (
          <Check className="h-1/2 w-1/2 stroke-current" /> 
        ) : (
          <span className="leading-none">{Math.round(normalizedValue)}%</span>
        )}
      </div>
    </div>
  )
}

